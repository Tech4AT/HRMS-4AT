"""Fills an HR-uploaded .docx offer-letter template and converts it to PDF.

Uses `docxtpl` (Jinja2-in-Word) to substitute `{{placeholder}}` tokens typed
directly into the document — it handles Word's habit of splitting one piece
of visible text across several XML runs, which naive find/replace on the
raw XML does not. The filled .docx is then converted to PDF by driving the
real MS Word installed on this machine via COM automation (`docx2pdf`).

This only works on Windows with MS Word installed — there is no portable
equivalent without LibreOffice's headless `--convert-to pdf` (see the note
in requirements.txt). If this backend ever needs to run on Linux/Mac or a
machine without Word, swap this module for a LibreOffice-based one; nothing
outside this file and services.py needs to change.
"""
import logging
import tempfile
from pathlib import Path

from docxtpl import DocxTemplate

logger = logging.getLogger(__name__)


class DocxRenderError(ValueError):
    """Raised when the uploaded template can't be filled or converted —
    e.g. it isn't a valid .docx, or Word/COM isn't available on this
    machine. Subclasses ValueError so it's caught by the same handling as
    other offer-letter validation errors (see serializers.py, views.py)
    rather than surfacing as a raw 500."""


def _convert_via_word(docx_path: str, pdf_path: str) -> None:
    """Convert a .docx to PDF by spawning a fresh subprocess that owns its
    own COM apartment.  Calling docx2pdf directly inside a Django worker
    thread is unreliable on Windows: the thread may not have a message pump,
    which causes Word to hang waiting for a DDE/COM callback that never
    arrives.  Running the conversion in a fresh process sidesteps the issue
    entirely — the child process's main thread initialises COM cleanly."""
    import subprocess, sys

    script = (
        "import pythoncom, sys; from docx2pdf import convert; "
        "pythoncom.CoInitialize(); "
        f"convert({docx_path!r}, {pdf_path!r}); "
        "pythoncom.CoUninitialize()"
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr or "docx2pdf subprocess failed")


def _expand_salary_table(docx_path: Path, rows: list) -> None:
    """Templates written before the payroll engine have a fixed salary table
    (Basic Salary / HRA / Other Allowances / Other Components / Total CTC).
    Swap its component rows for the real breakup rows so the letter shows what
    payroll will actually pay. The template file itself is never modified —
    this runs on the temporary copy. Tables that don't match are left alone."""
    import copy

    from docx import Document
    from docx.table import _Row

    document = Document(str(docx_path))
    changed = False
    for table in document.tables:
        labels = [row.cells[0].text.strip() for row in table.rows]
        if 'Basic Salary' not in labels or 'Total CTC' not in labels:
            continue
        start, end = labels.index('Basic Salary'), labels.index('Total CTC')
        if end <= start or len(table.rows[start].cells) < 3:
            continue
        proto = table.rows[start]._tr
        anchor = table.rows[end]._tr
        old = [row._tr for row in table.rows[start:end]]
        for name, monthly, annual in rows:
            tr = copy.deepcopy(proto)
            anchor.addprevious(tr)
            for cell, text in zip(_Row(tr, table).cells, (name, monthly, annual)):
                paragraphs = cell.paragraphs
                runs = paragraphs[0].runs
                if runs:
                    runs[0].text = text
                    for extra in runs[1:]:
                        extra.text = ''
                else:
                    paragraphs[0].add_run(text)
                for extra in paragraphs[1:]:
                    extra._p.getparent().remove(extra._p)
        for tr in old:
            tr.getparent().remove(tr)
        changed = True
    if changed:
        document.save(str(docx_path))


def _append_signature_block(docx_path: Path, context: dict) -> None:
    """Mirrors `_render_text_template_pdf`'s post-signature block for the
    reportlab path (offer_letter.py) — an uploaded .docx template has no
    `{{signature_name}}`/`{{signed_date}}` tokens of its own (HR never typed
    them in), so docxtpl's substitution silently has nothing to fill. This
    appends the same "Signed and Accepted" section directly, so a signed
    offer looks signed regardless of which renderer produced it."""
    from docx import Document

    document = Document(str(docx_path))
    document.add_paragraph()
    document.add_heading('Signed and Accepted', level=2)
    document.add_paragraph(f"Signature: {context.get('signature_name', '')}")
    document.add_paragraph(f"Date: {context.get('signed_date', '')}")
    document.save(str(docx_path))


def render_docx_template_to_pdf(source_path: str, context: dict, *, signed: bool = False) -> bytes:
    with tempfile.TemporaryDirectory(prefix='offer_letter_') as tmp_dir:
        tmp_dir_path = Path(tmp_dir)
        try:
            source = source_path
            rows = context.get('salary_rows') or []
            if rows:
                prepared = tmp_dir_path / 'prepared.docx'
                import shutil

                shutil.copyfile(source_path, prepared)
                _expand_salary_table(prepared, rows)
                source = str(prepared)
            tpl = DocxTemplate(source)
            tpl.render(context)
        except Exception as exc:  # docxtpl/Jinja2 raise several distinct types
            raise DocxRenderError(f'Could not fill the Word template: {exc}') from exc

        rendered_docx = tmp_dir_path / 'rendered.docx'
        tpl.save(str(rendered_docx))

        if signed:
            _append_signature_block(rendered_docx, context)

        rendered_pdf = tmp_dir_path / 'rendered.pdf'
        try:
            _convert_via_word(str(rendered_docx), str(rendered_pdf))
        except ImportError as exc:
            logger.exception('docx2pdf/pywin32 not importable')
            raise DocxRenderError(
                'Could not convert the Word template to PDF: the server is missing the '
                f'"{exc.name}" Python package. Run `pip install -r requirements.txt` with the '
                'same Python that runs the backend, then restart it.'
            ) from exc
        except Exception as exc:
            logger.exception('docx2pdf conversion failed')
            raise DocxRenderError(
                'Could not convert the Word template to PDF. This requires Microsoft Word '
                'to be installed on the server — check it is available.'
            ) from exc

        if not rendered_pdf.exists():
            raise DocxRenderError('Word did not produce a PDF file — conversion failed silently.')

        return rendered_pdf.read_bytes()

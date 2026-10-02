/**
 * Browser-side helpers for the template wizard's "MS Word" mode.
 *
 * The .docx is rendered read-only with docx-preview (faithful: fonts, logo,
 * tables, letterhead) and placeholders are inserted by patching the original
 * file's document.xml in place — so nothing else in the document changes.
 */
import JSZip from 'jszip';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export async function renderDocx(buffer: ArrayBuffer, container: HTMLElement): Promise<void> {
  const { renderAsync } = await import('docx-preview');
  container.innerHTML = '';
  await renderAsync(buffer.slice(0), container, undefined, {
    className: 'docx',
    inWrapper: true,
    breakPages: true,
    ignoreLastRenderedPageBreak: true,
  });
}

/** Body paragraphs in document order, skipping mc:Fallback duplicates. */
function bodyParagraphs(doc: Document): Element[] {
  return Array.from(doc.getElementsByTagNameNS(W, 'p')).filter((p) => {
    for (let n = p.parentNode; n; n = n.parentNode) {
      if (n.nodeName.endsWith('Fallback')) return false;
    }
    return true;
  });
}

/** Insert `text` into the `index`-th paragraph at character `offset`
 * (null offset/index = end of the last paragraph that has text). */
export async function insertIntoDocx(
  buffer: ArrayBuffer,
  pos: { index: number; offset: number } | null,
  text: string,
): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('Not a valid .docx file');
  const xml = new DOMParser().parseFromString(await entry.async('string'), 'application/xml');
  const paras = bodyParagraphs(xml);
  if (!paras.length) throw new Error('The document has no paragraphs');

  let para: Element | undefined;
  let offset = pos?.offset ?? Number.MAX_SAFE_INTEGER;
  if (pos) para = paras[pos.index];
  if (!para) {
    para = [...paras].reverse().find((p) => p.getElementsByTagNameNS(W, 't').length > 0) ?? paras[paras.length - 1];
    offset = Number.MAX_SAFE_INTEGER;
  }

  const ts = Array.from(para.getElementsByTagNameNS(W, 't'));
  if (!ts.length) {
    const r = xml.createElementNS(W, 'w:r');
    const t = xml.createElementNS(W, 'w:t');
    t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    t.textContent = text;
    r.appendChild(t);
    para.appendChild(r);
  } else {
    let remaining = offset;
    let target = ts[ts.length - 1];
    let at = (target.textContent ?? '').length;
    for (const t of ts) {
      const len = (t.textContent ?? '').length;
      if (remaining <= len) {
        target = t;
        at = remaining;
        break;
      }
      remaining -= len;
    }
    const cur = target.textContent ?? '';
    target.textContent = cur.slice(0, at) + text + cur.slice(at);
    target.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  }

  zip.file('word/document.xml', new XMLSerializer().serializeToString(xml));
  return zip.generateAsync({ type: 'arraybuffer' });
}

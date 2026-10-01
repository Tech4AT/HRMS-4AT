// Regenerates every <NAME>.html in this folder from its <NAME>.md (the canonical copy).
//   node docs/payroll/build-html.mjs
// Dependency-free: handles the Markdown subset the docs use (headings, paragraphs,
// lists, tables, code fences, blockquotes, rules, inline code/bold/italic/links).
// ```mermaid fences become diagrams rendered by Mermaid in the browser.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const docs = readdirSync(here).filter((f) => f.endsWith('.md'));
// Page <title>s: a short name per document (the H1 is shown in the page itself).
const TITLES = {
  'PAYROLL-MODULE.md': 'Payroll Module Guide',
  'PAYROLL-ARCHITECTURE.md': 'Payroll Architecture',
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s).replace(/&lt;br\/&gt;/g, '<br/>');
  s = s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
}

function render(md) {
  const lines = md.split('\n');
  const out = [];
  const toc = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const body = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      out.push(lang === 'mermaid'
        ? `<figure class="diagram"><pre class="mermaid">${esc(body.join('\n'))}</pre></figure>`
        : `<pre class="code"><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const html = inline(h[2]);
      const id = slug(h[2]);
      if (level === 2) toc.push({ id, html });
      out.push(`<h${level} id="${id}">${html}</h${level}>`);
      i++;
      continue;
    }
    if (/^---\s*$/.test(line)) { out.push('<hr/>'); i++; continue; }
    if (/^\|/.test(line)) {
      const rows = [];
      for (; i < lines.length && /^\|/.test(lines[i]); i++) rows.push(lines[i]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => inline(c.trim().replace(/\\\|/g, '|')));
      const [head, , ...body] = rows;
      out.push(`<div class="table"><table><thead><tr>${cells(head).map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body
        .map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]); i++) body.push(lines[i].replace(/^>\s?/, ''));
      out.push(`<aside class="note">${inline(body.join(' '))}</aside>`);
      continue;
    }
    const list = line.match(/^(\s*)([-*]|\d+\.)\s+/);
    if (list) {
      const ordered = /\d/.test(list[2]);
      const items = [];
      for (; i < lines.length; i++) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (m) items.push(m[3]);
        else if (/^\s{2,}\S/.test(lines[i]) && items.length) items[items.length - 1] += ' ' + lines[i].trim();
        else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    const para = [];
    for (; i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\||>|---|\s*([-*]|\d+\.)\s)/.test(lines[i]); i++) para.push(lines[i].trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return { body: out.join('\n'), toc };
}

const STYLE = `
  :root { --bg:#f8fafc; --panel:#ffffff; --text:#0f172a; --muted:#64748b; --line:#e2e8f0;
          --accent:#1d4ed8; --accent-soft:#eff6ff; --code:#f1f5f9; --note:#fefce8; --note-line:#facc15; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
          --bg:#0b1120; --panel:#111827; --text:#e5e7eb; --muted:#94a3b8; --line:#1f2937;
          --accent:#60a5fa; --accent-soft:#172554; --code:#1e293b; --note:#292524; --note-line:#ca8a04; } }
  :root[data-theme="dark"] { --bg:#0b1120; --panel:#111827; --text:#e5e7eb; --muted:#94a3b8; --line:#1f2937;
          --accent:#60a5fa; --accent-soft:#172554; --code:#1e293b; --note:#292524; --note-line:#ca8a04; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .layout { display:grid; grid-template-columns:260px minmax(0,1fr); max-width:1400px; margin:0 auto; }
  nav { position:sticky; top:0; height:100vh; overflow:auto; padding:24px 16px; border-right:1px solid var(--line); }
  nav .brand { font-weight:700; margin-bottom:12px; }
  nav .docs { margin-top:20px; padding-top:12px; border-top:1px solid var(--line); font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
  nav a { display:block; padding:5px 10px; border-radius:6px; color:var(--muted); text-decoration:none; font-size:14px; }
  nav a:hover, nav a.current { background:var(--accent-soft); color:var(--accent); }
  main { padding:32px 40px 80px; min-width:0; }
  h1 { font-size:30px; margin:0 0 12px; }
  h2 { font-size:22px; margin:40px 0 12px; padding-top:8px; border-top:1px solid var(--line); }
  h3 { font-size:17px; margin:24px 0 8px; }
  a { color:var(--accent); }
  hr { display:none; }
  code { background:var(--code); padding:1px 5px; border-radius:4px; font-size:.88em; }
  pre.code { background:var(--code); padding:14px 16px; border-radius:8px; overflow:auto; }
  pre.code code { background:none; padding:0; }
  .table { overflow-x:auto; margin:12px 0; border:1px solid var(--line); border-radius:8px; background:var(--panel); }
  table { border-collapse:collapse; width:100%; font-size:14px; }
  th, td { text-align:left; padding:8px 12px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { background:var(--accent-soft); font-weight:600; white-space:nowrap; }
  tr:last-child td { border-bottom:0; }
  .diagram { margin:16px 0; padding:16px; background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow-x:auto; text-align:center; }
  .diagram pre.mermaid { margin:0; background:none; }
  aside.note { background:var(--note); border-left:4px solid var(--note-line); padding:10px 14px; border-radius:6px; margin:12px 0; }
  li { margin:3px 0; }
  @media (max-width: 860px) {
    .layout { grid-template-columns:1fr; }
    nav { position:static; height:auto; border-right:0; border-bottom:1px solid var(--line); padding:16px; }
    main { padding:20px 16px 60px; }
  }`;

function build(file) {
  const md = readFileSync(join(here, file), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^[ \t]+(```)/gm, '$1'); // code fences nested under list items
  const { body, toc } = render(md);
  const heading = md.match(/^#\s+(.*)$/m)[1];
  const docLinks = docs
    .map((d) => `<a href="${d.replace(/\.md$/, '.html')}"${d === file ? ' class="current"' : ''}>${TITLES[d] ?? d}</a>`)
    .join('');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${TITLES[file] ?? file.replace(/\.md$/, '')}</title>
<!-- Generated from ${file} by build-html.mjs — edit the .md, then regenerate. -->
<style>${STYLE}
</style>
</head>
<body>
<div class="layout">
<nav><div class="brand">${inline(heading)}</div>${toc.map((t) => `<a href="#${t.id}">${t.html}</a>`).join('')}<div class="docs">Payroll docs</div>${docLinks}</nav>
<main>
${body}
</main>
</div>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  mermaid.initialize({ startOnLoad: true, theme: dark ? 'dark' : 'default', securityLevel: 'strict' });
</script>
</body>
</html>
`;
  const target = file.replace(/\.md$/, '.html');
  writeFileSync(join(here, target), html);
  console.log(`wrote ${target} (${toc.length} sections)`);
}

docs.forEach(build);

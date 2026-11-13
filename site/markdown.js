// Minimal, escape-first markdown renderer for model replies.
// Security contract (ADR-0002 QST-KEY-PERSIST A): model output is untrusted —
// a reply containing <script> or <img onerror> must never become live HTML,
// because any script on this page can read the stored API key. So ALL input
// text is HTML-escaped first, and only tags this file emits ever appear.
// Links are emitted only for http(s) URLs. Covered by tests/markdown.test.js.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ESC[c]);
}

function inlineText(raw) {
  let s = escapeHtml(raw);
  s = s.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>');
  return s;
}

/** Inline formatting; code spans are cut out first so nothing inside them is formatted. */
export function renderInline(raw) {
  return String(raw)
    .split(/(`[^`\n]+`)/)
    .map((part, i) => (i % 2 === 1 ? `<code>${escapeHtml(part.slice(1, -1))}</code>` : inlineText(part)))
    .join('');
}

export function renderMarkdown(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(renderInline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.type}>${list.items.map((it) => `<li>${renderInline(it)}</li>`).join('')}</${list.type}>`);
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*(```|~~~)\s*([\w+#.-]*)\s*$/);
    if (fence) {
      flushPara();
      flushList();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) code.push(lines[i++]);
      // an unclosed fence (reply still streaming) runs to the end — that's fine
      const lang = fence[2] ? ` data-lang="${escapeHtml(fence[2])}"` : '';
      out.push(`<pre><code${lang}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      flushList();
      const n = heading[1].length;
      out.push(`<h${n}>${renderInline(heading[2])}</h${n}>`);
      continue;
    }
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const type = ul ? 'ul' : 'ol';
      if (list && list.type !== type) flushList();
      if (!list) list = { type, items: [] };
      list.items.push((ul || ol)[1]);
      continue;
    }
    if (line.trim() === '') {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return out.join('\n');
}

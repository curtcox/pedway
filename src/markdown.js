// Markdown for pin notes: parsed by marked, then sanitised by DOMPurify.
// Links open outside the app. Images become links, because remote images could
// track whoever opens a shared map (and the page's policy blocks them anyway).
import { Marked } from '../vendor/marked-18.1.2/marked.esm.js';
import createDOMPurify from '../vendor/dompurify-3.4.17/purify.es.mjs';

const marked = new Marked({ gfm: true, breaks: true, async: false });
const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'img',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input'];
const SAFE_URL = /^(?:https?:|mailto:|tel:)/i;
const purifiers = new WeakMap();

function purifier(window) {
  if (!purifiers.has(window)) purifiers.set(window, createDOMPurify(window));
  return purifiers.get(window);
}

/** Returns a sanitised DocumentFragment for the given markdown. */
export function renderMarkdown(md, { window = globalThis.window } = {}) {
  const document = window.document;
  const html = marked.parse(String(md ?? ''));
  const fragment = purifier(window).sanitize(html, {
    ALLOWED_TAGS, ALLOWED_ATTR: ['href', 'title', 'alt', 'src', 'checked'],
    ALLOWED_URI_REGEXP: SAFE_URL, RETURN_DOM_FRAGMENT: true,
  });
  // The only inputs marked emits are GFM task-list boxes. Rebuild each one as a
  // read-only checkbox (DOMPurify drops `type`, since its value is not a safe URL).
  for (const input of fragment.querySelectorAll('input')) {
    const box = document.createElement('input');
    box.type = 'checkbox'; box.disabled = true; box.checked = input.hasAttribute('checked');
    box.setAttribute('aria-label', box.checked ? 'Done' : 'Not done');
    input.replaceWith(box);
  }
  for (const image of fragment.querySelectorAll('img')) {
    const src = image.getAttribute('src'), label = image.getAttribute('alt') || 'Image';
    if (src && SAFE_URL.test(src)) {
      const link = document.createElement('a');
      link.setAttribute('href', src); link.textContent = `🖼 ${label}`;
      image.replaceWith(link);
    } else image.replaceWith(document.createTextNode(label));
  }
  for (const link of fragment.querySelectorAll('a')) {
    const href = link.getAttribute('href');
    if (!href || !SAFE_URL.test(href)) { link.replaceWith(...link.childNodes); continue; }
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  }
  return fragment;
}

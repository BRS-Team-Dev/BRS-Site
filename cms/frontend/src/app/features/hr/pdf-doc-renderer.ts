import { PdfDocBlock, PdfDocPage } from '../../core/models';
import { environment } from '@env/environment';

/**
 * Pure function that renders a list of pages to a PDF Blob in the browser.
 *
 * Used by:
 *   • PdfDocBuilder — to produce the unsigned template at create / edit time.
 *   • The signing flows (onboarding portal, /hr/me) — to bake the employee's
 *     signature into the standard sign zone after they sign.
 *
 * The DOM is mounted under document.body (not inside a component view) so
 * Angular's view-encapsulation attributes can't accidentally strip styles,
 * and html2canvas always sees a fully-styled, normally-positioned tree.
 */
export interface PdfRenderOpts {
  title?: string;
  /** Base64 PNG data URL — when present, stamps the image into each page's signature slot. */
  signatureDataUrl?: string;
  /** Optional date label (defaults to today) shown alongside the signature. */
  signedAt?: string;
  /** Optional name printed under the signature. */
  signerName?: string;
  /**
   * Map of token key → value used to substitute `[[token]]` placeholders
   * inside heading / text / bullet block bodies. The map is also used to
   * fill `variable` blocks (keyed by the block's `label` slugged to
   * lower-snake-case). Missing tokens render as a yellow highlighted
   * fillable box so the recipient knows exactly what still needs
   * supplying.
   */
  tokens?: Record<string, string>;
}

const A4_W_PX = 794;
const A4_H_PX = 1123;
const A4_W_PT = 595.28;
const A4_H_PT = 841.89;
const FONT = 'Arial, Helvetica, sans-serif';

export async function renderPdfDocBlob(pages: PdfDocPage[], opts: PdfRenderOpts = {}): Promise<Blob> {
  const wrap = document.createElement('div');
  wrap.style.cssText = `
    position: absolute; left: -10000px; top: 0;
    width: ${A4_W_PX}px;
    background: #ffffff;
    z-index: -1;
  `;
  document.body.appendChild(wrap);
  const sections: HTMLElement[] = [];

  try {
    const total = pages.length;
    pages.forEach((page, idx) => {
      const sec = buildPageSection(page, idx, total, opts);
      wrap.appendChild(sec);
      sections.push(sec);
    });
    // After all blocks are wired up, walk the DOM once and substitute
    // [[token]] placeholders inside heading/text/bullet text nodes. We
    // do this post-build (rather than in blockToNode) so the substitution
    // can also see variable-block contents.
    applyTokenSubstitution(wrap, opts.tokens || {});

    await waitForImages(wrap);
    await new Promise(res => requestAnimationFrame(() => res(null)));

    const [{ default: html2canvas }, jsPdfMod] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);
    const JsPDFCtor = (jsPdfMod as any).jsPDF ?? (jsPdfMod as any).default;
    const pdf = new JsPDFCtor({ unit: 'pt', format: 'a4', orientation: 'portrait' });

    for (let i = 0; i < sections.length; i++) {
      const canvas = await html2canvas(sections[i], {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        windowWidth: A4_W_PX,
      });
      const img = canvas.toDataURL('image/jpeg', 0.95);
      if (i > 0) pdf.addPage('a4', 'portrait');
      pdf.addImage(img, 'JPEG', 0, 0, A4_W_PT, A4_H_PT);
    }
    return pdf.output('blob') as Blob;
  } finally {
    document.body.removeChild(wrap);
  }
}

function buildPageSection(page: PdfDocPage, idx: number, total: number, opts: PdfRenderOpts): HTMLElement {
  const sec = document.createElement('section');
  sec.style.cssText = `
    width: ${A4_W_PX}px; height: ${A4_H_PX}px;
    padding: 64px 56px 120px;
    background: #ffffff; color: #111;
    font-family: ${FONT}; font-size: 13px; line-height: 1.55;
    position: relative;
    box-sizing: border-box;
    overflow: hidden;
  `;
  page.blocks.forEach(b => sec.appendChild(blockToNode(b)));

  // Per-page sign-zone gating: honour an explicit boolean on the page,
  // otherwise fall back to "last page only" for legacy docs that pre-date
  // the flag.
  const signOn = typeof page.show_sign_zone === 'boolean'
    ? page.show_sign_zone
    : idx === total - 1;

  if (signOn) {
    const sign = document.createElement('div');
    sign.style.cssText = `
      position: absolute; left: 56px; right: 56px; bottom: 56px;
      display: flex; gap: 24px; align-items: flex-start;
    `;

    const dateText = opts.signedAt || (opts.signatureDataUrl ? new Date().toISOString().slice(0, 10) : '');

    sign.appendChild(buildSignField({
      flex: '1',
      image: opts.signatureDataUrl,
      label: 'Signature',
      caption: opts.signerName,
    }));
    sign.appendChild(buildSignField({
      flex: '0 0 200px',
      text: dateText,
      label: 'Date',
    }));

    sec.appendChild(sign);
  }

  const foot = document.createElement('div');
  foot.style.cssText = `
    position: absolute; left: 56px; right: 56px; bottom: 24px;
    font-size: 10px; color: #777;
    display: flex; justify-content: space-between;
  `;
  const left = document.createElement('span');
  left.textContent = opts.title || 'Document';
  const right = document.createElement('span');
  right.textContent = `Page ${idx + 1} of ${total}`;
  foot.appendChild(left);
  foot.appendChild(right);
  sec.appendChild(foot);

  return sec;
}

/**
 * One column of the standard signature block. The content slot is a fixed-height
 * area whose contents sit at the bottom right above a horizontal rule, with a
 * small caption label underneath. Fixing the slot height keeps the rules in the
 * Signature and Date columns horizontally aligned regardless of which one has
 * a tall signature image vs. a short date string.
 */
function buildSignField(opts: { flex: string; image?: string; text?: string; label: string; caption?: string }): HTMLElement {
  const col = document.createElement('div');
  col.style.cssText = `flex: ${opts.flex}; display: flex; flex-direction: column; gap: 4px;`;

  const slot = document.createElement('div');
  slot.style.cssText = `
    height: 56px;
    display: flex; align-items: flex-end; justify-content: flex-start;
    border-bottom: 1px solid #111;
    padding: 0 4px 4px;
  `;
  if (opts.image) {
    const img = document.createElement('img');
    img.src = opts.image;
    img.style.cssText = 'max-height: 52px; max-width: 100%; object-fit: contain; display: block;';
    slot.appendChild(img);
  } else if (opts.text) {
    const t = document.createElement('span');
    t.style.cssText = 'font-size: 12px; color: #111; line-height: 1;';
    t.textContent = opts.text;
    slot.appendChild(t);
  }
  col.appendChild(slot);

  const label = document.createElement('div');
  label.style.cssText = 'font-size: 10px; color: #555; padding: 0 4px;';
  label.textContent = opts.label;
  col.appendChild(label);

  if (opts.caption) {
    const cap = document.createElement('div');
    cap.style.cssText = 'font-size: 11px; color: #111; padding: 0 4px;';
    cap.textContent = opts.caption;
    col.appendChild(cap);
  }
  return col;
}

function blockToNode(b: PdfDocBlock): HTMLElement {
  if (b.kind === 'heading') {
    const lvl = b.level ?? 2;
    const el = document.createElement('h' + lvl);
    const sizes: Record<number, string> = { 1: '26px', 2: '20px', 3: '16px' };
    const margins: Record<number, string> = { 1: '0 0 12px', 2: '14px 0 8px', 3: '12px 0 6px' };
    el.style.cssText = `font-size: ${sizes[lvl]}; margin: ${margins[lvl]}; font-weight: 700; color: #111;`;
    el.textContent = b.body || '';
    return el;
  }
  if (b.kind === 'text') {
    const el = document.createElement('p');
    el.style.cssText = 'margin: 0 0 10px; white-space: pre-wrap; color: #111;';
    el.textContent = b.body || '';
    return el;
  }
  if (b.kind === 'bullet') {
    const ul = document.createElement('ul');
    ul.style.cssText = 'margin: 6px 0 12px 20px; padding: 0; color: #111;';
    const lines = (b.body || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const li = document.createElement('li');
      li.style.cssText = 'margin: 0 0 4px; line-height: 1.55;';
      li.textContent = line;
      ul.appendChild(li);
    }
    return ul;
  }
  if (b.kind === 'variable') {
    // A variable block is a labelled fillable region. At render time the
    // token map (keyed by slug(label)) supplies the per-attachment value;
    // otherwise we fall back to the stored default body so the template
    // still reads end-to-end. The wrapper carries `data-token` so the
    // post-build substitution pass can swap content in.
    const wrap = document.createElement('div');
    const slug = labelSlug(b.label || '');
    wrap.setAttribute('data-token', slug);
    wrap.setAttribute('data-token-label', b.label || '');
    wrap.style.cssText = 'margin: 6px 0 12px; color: #111;';
    if (b.label) {
      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 2px;';
      lbl.textContent = b.label;
      wrap.appendChild(lbl);
    }
    const body = document.createElement('div');
    body.style.cssText = 'white-space: pre-wrap; line-height: 1.55;';
    body.setAttribute('data-token-body', '');
    body.textContent = b.body || '';
    wrap.appendChild(body);
    return wrap;
  }
  if (b.kind === 'image' && b.url) {
    const el = document.createElement('img');
    el.style.cssText = 'max-width: 100%; height: auto; margin: 6px 0; display: block;';
    el.src = `${environment.basePath}/` + b.url.replace(/^\//, '');
    el.alt = b.alt || '';
    el.crossOrigin = 'anonymous';
    return el;
  }
  if (b.kind === 'spacer') {
    const el = document.createElement('div');
    el.style.cssText = 'height: 24px;';
    return el;
  }
  return document.createElement('span');
}

/** Lower-snake-case slug for a variable-block label. "Total Price (£)"
 *  → "total_price". Keeps the token map keys stable across renames that
 *  only change punctuation/case. */
export function labelSlug(label: string): string {
  return (label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Walk every text-bearing node under `host` and substitute occurrences of
 * `[[token]]`. Filled tokens (key present in `map`) become inline plain
 * text — they read as part of the surrounding sentence. Unfilled tokens
 * render as a yellow `[ token ]` highlight so a reviewer can immediately
 * see what's still pending.
 *
 * Also fills variable-block bodies from the same token map, keyed by the
 * label's slug.
 */
function applyTokenSubstitution(host: HTMLElement, map: Record<string, string>): void {
  // Replace variable-block bodies first so subsequent inline substitution
  // can still see (or skip past) them.
  host.querySelectorAll<HTMLElement>('[data-token]').forEach(wrap => {
    const key = wrap.getAttribute('data-token') || '';
    const body = wrap.querySelector<HTMLElement>('[data-token-body]');
    if (!body) return;
    const val = map[key];
    if (typeof val === 'string' && val.trim() !== '') {
      body.textContent = val;
    }
  });

  // Inline [[token]] substitution. We walk the text nodes manually so we
  // can replace matches with mixed text + span nodes (for unfilled
  // highlights) without nuking ancestor styling.
  const re = /\[\[([a-z0-9_]+)\]\]/gi;
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let n: Node | null;
  // eslint-disable-next-line no-cond-assign
  while ((n = walker.nextNode())) {
    const text = (n as Text).nodeValue || '';
    if (re.test(text)) targets.push(n as Text);
    re.lastIndex = 0;
  }
  for (const node of targets) {
    const parent = node.parentNode;
    if (!parent) continue;
    const text = node.nodeValue || '';
    const frag = document.createDocumentFragment();
    let cursor = 0;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(text))) {
      if (m.index > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, m.index)));
      const key = m[1].toLowerCase();
      const val = map[key];
      if (typeof val === 'string' && val !== '') {
        frag.appendChild(document.createTextNode(val));
      } else {
        const chip = document.createElement('span');
        chip.style.cssText = 'background: #fff3b0; color: #5a4500; padding: 0 4px; border-radius: 3px; font-weight: 600;';
        chip.textContent = key;
        frag.appendChild(chip);
      }
      cursor = m.index + m[0].length;
    }
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
    parent.replaceChild(frag, node);
  }
}

function waitForImages(host: HTMLElement): Promise<void> {
  const imgs = Array.from(host.querySelectorAll('img'));
  if (imgs.length === 0) return Promise.resolve();
  return Promise.all(imgs.map(img => img.complete
    ? Promise.resolve()
    : new Promise<void>(res => { img.onload = img.onerror = () => res(); })
  )).then(() => undefined);
}

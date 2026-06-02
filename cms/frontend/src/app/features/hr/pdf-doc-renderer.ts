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

function waitForImages(host: HTMLElement): Promise<void> {
  const imgs = Array.from(host.querySelectorAll('img'));
  if (imgs.length === 0) return Promise.resolve();
  return Promise.all(imgs.map(img => img.complete
    ? Promise.resolve()
    : new Promise<void>(res => { img.onload = img.onerror = () => res(); })
  )).then(() => undefined);
}

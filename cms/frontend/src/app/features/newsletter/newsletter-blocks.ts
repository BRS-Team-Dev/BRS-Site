/**
 * Newsletter block types + email-client-safe HTML renderer.
 *
 * Compose UX presents the campaign body as a sequence of blocks (heading,
 * paragraph, image, button, divider, spacer, raw HTML). Each block has its
 * own editor; the renderer below converts the block list into inline-styled
 * HTML that survives Gmail / Outlook 365 / Apple Mail rendering (no <style>
 * blocks, no external CSS, no float/grid, conservative widths).
 *
 * The builder serialises the block list to `blocks_json` on save (so the
 * draft round-trips back into the editor) AND stores the rendered HTML in
 * `body_html` (so the send path stays unchanged). On load, if `blocks_json`
 * is null we fall back to a single `html` block containing `body_html` so
 * legacy textarea-era drafts still open cleanly.
 */

export type NewsletterBlockKind =
  | 'heading'
  | 'paragraph'
  | 'image'
  | 'button'
  | 'divider'
  | 'spacer'
  | 'html';

export interface NewsletterBlock {
  /** Stable per-instance id used as @for track key. Local-only, never sent. */
  id: string;
  kind: NewsletterBlockKind;
  // Heading + paragraph
  text?: string;
  level?: 1 | 2 | 3;
  align?: 'left' | 'center' | 'right';
  // Image
  url?: string;
  alt?: string;
  href?: string; // optional click-through
  // Button
  label?: string;
  // Spacer
  height?: number;
  // Raw HTML escape hatch
  html?: string;
}

export const BLOCK_LABELS: Record<NewsletterBlockKind, string> = {
  heading:   'Heading',
  paragraph: 'Paragraph',
  image:     'Image',
  button:    'Button',
  divider:   'Divider',
  spacer:    'Spacer',
  html:      'Raw HTML',
};

let _blockSeq = 1;
const nextId = () => `b${Date.now().toString(36)}${(_blockSeq++).toString(36)}`;

/** Sensible defaults per block kind. */
export function makeBlock(kind: NewsletterBlockKind): NewsletterBlock {
  const id = nextId();
  switch (kind) {
    case 'heading':   return { id, kind, text: 'Section heading', level: 2, align: 'left' };
    case 'paragraph': return { id, kind, text: 'Write something useful here…', align: 'left' };
    case 'image':     return { id, kind, url: '', alt: '', href: '' };
    case 'button':    return { id, kind, label: 'Learn more', url: 'https://example.com', align: 'left' };
    case 'divider':   return { id, kind };
    case 'spacer':    return { id, kind, height: 24 };
    case 'html':      return { id, kind, html: '<p style="font-size:14px;line-height:1.6;color:#333;margin:10px 0">Custom HTML…</p>' };
  }
}

const escHtml = (s: string): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Rendering helpers — all styles inline so email clients don't strip them. */
function renderHeading(b: NewsletterBlock): string {
  const level = b.level ?? 2;
  const sizes: Record<number, string> = { 1: '24px', 2: '20px', 3: '16px' };
  const align = b.align ?? 'left';
  const text = escHtml(b.text ?? '').replace(/\n/g, '<br>');
  return `<h${level} style="font-family:Arial,Helvetica,sans-serif;font-size:${sizes[level]};margin:18px 0 10px 0;color:#222;font-weight:700;text-align:${align};">${text}</h${level}>`;
}

function renderParagraph(b: NewsletterBlock): string {
  const align = b.align ?? 'left';
  const text  = escHtml(b.text ?? '').replace(/\n/g, '<br>');
  return `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#333;margin:10px 0;text-align:${align};">${text}</p>`;
}

function renderImage(b: NewsletterBlock): string {
  const url = (b.url ?? '').trim();
  if (!url) return '<p style="color:#999;font-size:12px;text-align:center;font-family:Arial,Helvetica,sans-serif;">[ Image — set a URL ]</p>';
  const alt = escHtml(b.alt ?? '');
  const img = `<img src="${escHtml(url)}" alt="${alt}" style="max-width:100%;height:auto;display:block;margin:14px auto;border:0;outline:none;" />`;
  return b.href
    ? `<a href="${escHtml(b.href)}" style="text-decoration:none">${img}</a>`
    : img;
}

function renderButton(b: NewsletterBlock): string {
  const label = escHtml(b.label ?? 'Click here');
  const url   = escHtml(b.url ?? '#');
  const align = b.align ?? 'left';
  const wrapStyle = `text-align:${align};margin:18px 0;`;
  const btnStyle  = `display:inline-block;padding:11px 22px;background:#0a0a0a;color:#ffffff;text-decoration:none;border-radius:4px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;`;
  return `<div style="${wrapStyle}"><a href="${url}" style="${btnStyle}">${label}</a></div>`;
}

function renderDivider(): string {
  return '<hr style="border:none;border-top:1px solid #ddd;margin:22px 0;" />';
}

function renderSpacer(b: NewsletterBlock): string {
  const h = Math.max(0, Math.min(200, b.height ?? 24));
  return `<div style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</div>`;
}

function renderHtmlBlock(b: NewsletterBlock): string {
  return b.html ?? '';
}

/** Render a block list to inline-styled HTML, wrapped in an email-safe container. */
export function renderBlocksToHtml(blocks: NewsletterBlock[]): string {
  const parts = blocks.map(b => {
    switch (b.kind) {
      case 'heading':   return renderHeading(b);
      case 'paragraph': return renderParagraph(b);
      case 'image':     return renderImage(b);
      case 'button':    return renderButton(b);
      case 'divider':   return renderDivider();
      case 'spacer':    return renderSpacer(b);
      case 'html':      return renderHtmlBlock(b);
    }
  });
  const inner = parts.join('\n');
  return `<div style="max-width:600px;margin:0 auto;padding:24px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#333;">${inner}</div>`;
}

/** Parse a serialized blocks_json string back into the typed array. Tolerant
 *  of malformed input — returns an empty array instead of throwing. */
export function parseBlocksJson(json: string | null | undefined): NewsletterBlock[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((b: any) => b && typeof b === 'object' && typeof b.kind === 'string')
      .map((b: any) => ({ ...b, id: typeof b.id === 'string' && b.id ? b.id : nextId() }));
  } catch {
    return [];
  }
}

import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { environment } from '@env/environment';
import { ContractAudience, PdfDocBlock, PdfDocBlockKind, PdfDocPage } from '../../core/models';
import { labelSlug, renderPdfDocBlob } from './pdf-doc-renderer';

/**
 * Page-based PDF authoring tool used to compose docusign-style templates.
 * Each page holds an ordered list of text/image/spacer blocks and ends with a
 * "standard sign zone" footer so every page is signable.
 *
 * Mirrors the slide-builder pattern in HrLearning: a signal-backed draft list
 * that ngModel mutations stick to in zoneless mode.
 *
 * The builder stores its source as JSON (PdfDocPage[]) and renders an A4-styled
 * DOM that the parent can pipe through html2pdf.js to upload as the template
 * file alongside the JSON.
 */
@Component({
  selector: 'app-pdf-doc-builder',
  imports: [FormsModule],
  template: `
    <div class="builder">
      <div class="page-list">
        <h4 class="muted small">Pages</h4>
        @for (p of pages(); track p.id; let pi = $index; let last = $last) {
          <button class="page-tab" [class.active]="activeIdx() === pi" (click)="setPage(pi)" type="button">
            <span>Page {{ pi + 1 }}</span>
            <span class="muted small">{{ p.blocks.length }} block{{ p.blocks.length === 1 ? '' : 's' }}</span>
          </button>
        }
        <button class="add-page" type="button" (click)="addPage()">+ Add page</button>
      </div>

      @if (active(); as p) {
        <div class="page-editor">
          <div class="page-toolbar">
            <strong>Page {{ activeIdx() + 1 }} of {{ pages().length }}</strong>
            <label class="sign-toggle" title="When ticked, this page includes the standard signature/date footer.">
              <input type="checkbox"
                     [checked]="showsSignZone(activeIdx())"
                     (change)="setShowSignZone(activeIdx(), $any($event.target).checked)" />
              <span>Signature footer</span>
            </label>
            <span class="spacer"></span>
            <button class="ghost icon-btn" type="button" (click)="movePage(-1)" [disabled]="activeIdx() === 0" title="Move up">↑</button>
            <button class="ghost icon-btn" type="button" (click)="movePage(1)" [disabled]="activeIdx() >= pages().length - 1" title="Move down">↓</button>
            <button class="ghost icon-btn danger" type="button" (click)="removePage()" [disabled]="pages().length <= 1" title="Remove page">✕</button>
          </div>

          <div class="blocks">
            @for (b of p.blocks; track b.id; let bi = $index; let last = $last) {
              <div class="block">
                <div class="block-head">
                  <span class="kind-pill kind-{{ b.kind }}">{{ b.kind }}</span>
                  <span class="spacer"></span>
                  <button class="block-icon" type="button" (click)="moveBlock(bi, -1)" [disabled]="bi === 0" title="Move up">↑</button>
                  <button class="block-icon" type="button" (click)="moveBlock(bi, 1)" [disabled]="last" title="Move down">↓</button>
                  <button class="block-icon danger" type="button" (click)="removeBlock(bi)" title="Remove">✕</button>
                </div>

                @if (b.kind === 'heading') {
                  <div class="row">
                    <select [(ngModel)]="b.level" name="lvl_{{ b.id }}">
                      <option [ngValue]="1">H1</option>
                      <option [ngValue]="2">H2</option>
                      <option [ngValue]="3">H3</option>
                    </select>
                    <input #fld [(ngModel)]="b.body" name="hd_{{ b.id }}" placeholder="Heading text"
                           (focus)="lastFocused = fld" />
                  </div>
                  <div class="token-bar">
                    @for (t of tokenList(); track t.key) {
                      <button type="button" class="token-chip" (click)="insertToken(fld, b, t.key)" [title]="t.label">
                        [[{{ t.key }}]]
                      </button>
                    }
                  </div>
                }
                @if (b.kind === 'text') {
                  <textarea #fld rows="6" [(ngModel)]="b.body" name="tx_{{ b.id }}"
                            placeholder="Paragraph text. Plain text — line breaks preserved. Use [[token]] to insert a placeholder."
                            (focus)="lastFocused = fld"></textarea>
                  <div class="token-bar">
                    @for (t of tokenList(); track t.key) {
                      <button type="button" class="token-chip" (click)="insertToken(fld, b, t.key)" [title]="t.label">
                        [[{{ t.key }}]]
                      </button>
                    }
                  </div>
                }
                @if (b.kind === 'bullet') {
                  <textarea #fld rows="6" [(ngModel)]="b.body" name="bl_{{ b.id }}"
                            placeholder="One bullet per line. Use [[token]] to insert a placeholder."
                            (focus)="lastFocused = fld"></textarea>
                  <div class="token-bar">
                    @for (t of tokenList(); track t.key) {
                      <button type="button" class="token-chip" (click)="insertToken(fld, b, t.key)" [title]="t.label">
                        [[{{ t.key }}]]
                      </button>
                    }
                  </div>
                }
                @if (b.kind === 'variable') {
                  <div class="row">
                    <input [(ngModel)]="b.label" name="vlbl_{{ b.id }}"
                           placeholder="Variable label, e.g. Price, Obligations, Term length" />
                  </div>
                  <textarea rows="5" [(ngModel)]="b.body" name="vbody_{{ b.id }}"
                            placeholder="Default text shown when no override is supplied. Editable per attachment."></textarea>
                  <p class="muted small" style="margin: 0;">
                    Reference this block elsewhere with
                    <code>[[{{ variableTokenSlug(b) || 'label' }}]]</code>.
                    At attach time the assigned person's admin can override this value.
                  </p>
                }
                @if (b.kind === 'image') {
                  @if (b.url) {
                    <img class="block-img" [src]="assetUrl(b.url)" [alt]="b.alt || ''" />
                    <input class="block-alt" [(ngModel)]="b.alt" name="alt_{{ b.id }}" placeholder="Alt text (optional)" />
                  } @else {
                    <label class="block-img-pick">
                      <input type="file" accept="image/*" hidden (change)="uploadImage(b, $event)" />
                      <span>Choose image…</span>
                    </label>
                  }
                }
                @if (b.kind === 'spacer') {
                  <p class="muted small" style="margin: 0;">Adds vertical whitespace between blocks.</p>
                }
              </div>
            }
            @if (p.blocks.length === 0) {
              <p class="muted small">No blocks yet — add a heading, text, bullet list, variable, image, or spacer to start building this page.</p>
            }
          </div>

          <div class="add-row">
            <button type="button" class="add-btn" (click)="addBlock('heading')">+ Heading</button>
            <button type="button" class="add-btn" (click)="addBlock('text')">+ Text</button>
            <button type="button" class="add-btn" (click)="addBlock('bullet')">+ Bullets</button>
            <button type="button" class="add-btn" (click)="addBlock('variable')">+ Variable</button>
            <button type="button" class="add-btn" (click)="addBlock('image')">+ Image</button>
            <button type="button" class="add-btn" (click)="addBlock('spacer')">+ Spacer</button>
          </div>

          @if (showsSignZone(activeIdx())) {
            <div class="sign-preview">
              <span class="muted small">Signature footer on this page</span>
              <div class="sign-row">
                <div class="sign-line"><span class="muted small">Signature</span></div>
                <div class="sign-line short"><span class="muted small">Date</span></div>
              </div>
            </div>
          } @else {
            <div class="sign-preview empty">
              <span class="muted small">
                No signature footer on this page.
                @if (activeIdx() === pages().length - 1) { (Tick "Signature footer" above to add one.) }
                @else { (By default only the last page is signed.) }
              </span>
            </div>
          }
        </div>
      }
    </div>

  `,
  styles: [`
    :host { display: block; }
    .builder {
      display: grid; grid-template-columns: 200px 1fr;
      gap: 12px;
      border: 1px solid var(--line); border-radius: var(--radius-sm);
      background: var(--bg-3);
      min-height: 360px;
    }
    .page-list {
      display: flex; flex-direction: column; gap: 4px;
      padding: 10px; border-right: 1px solid var(--line);
      background: var(--bg-2);
    }
    .page-list h4 { margin: 0 0 4px; }
    .page-tab {
      display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
      text-align: left; padding: 8px 10px;
      background: transparent; border: 1px solid transparent; border-radius: var(--radius-sm);
      cursor: pointer; color: var(--fg);
    }
    .page-tab.active { background: var(--bg-3); border-color: var(--primary); }
    .page-tab:hover { background: var(--bg-3); }
    .add-page {
      margin-top: 6px; padding: 8px 10px; text-align: left;
      background: transparent; border: 1px dashed var(--line); border-radius: var(--radius-sm);
      color: var(--muted); cursor: pointer;
    }
    .add-page:hover { color: var(--primary); border-color: var(--primary); }

    .page-editor { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    .page-toolbar { display: flex; align-items: center; gap: 6px; }
    .page-toolbar .spacer { flex: 1; }
    .blocks { display: flex; flex-direction: column; gap: 8px; }
    .block { background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 8px; }
    .block-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    .block-head .spacer { flex: 1; }
    .kind-pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px;
      background: var(--bg-3); color: var(--muted); border: 1px solid var(--line);
    }
    .kind-pill.kind-heading { color: var(--primary); border-color: var(--primary); }
    .block-icon {
      background: transparent; border: 1px solid var(--line); border-radius: 4px;
      width: 22px; height: 22px; padding: 0; cursor: pointer; color: var(--muted);
    }
    .block-icon:hover { color: var(--primary); border-color: var(--primary); }
    .block-icon.danger:hover { color: #ef4444; border-color: #ef4444; }
    .block-img { display: block; max-width: 100%; max-height: 280px; margin-bottom: 6px; border-radius: 4px; }
    .block-img-pick {
      display: inline-block; padding: 8px 12px; cursor: pointer;
      background: var(--bg-3); border: 1px dashed var(--line); border-radius: var(--radius-sm);
      color: var(--muted);
    }
    .block-img-pick:hover { color: var(--primary); border-color: var(--primary); }
    .block-alt { width: 100%; }

    .row { display: flex; gap: 6px; align-items: center; }
    .row select { width: 80px; }
    .row input { flex: 1; }

    .add-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .add-btn {
      padding: 6px 10px; font-size: 12px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      cursor: pointer; color: var(--fg);
    }
    .add-btn:hover { color: var(--primary); border-color: var(--primary); }

    .token-bar {
      display: flex; flex-wrap: wrap; gap: 4px;
      margin-top: 6px; padding: 6px 8px;
      background: var(--bg-2); border: 1px dashed var(--line); border-radius: var(--radius-sm);
    }
    .token-chip {
      padding: 2px 8px; font-size: 11px;
      background: rgba(212, 169, 58, 0.10); color: var(--primary);
      border: 1px solid var(--primary); border-radius: 999px;
      cursor: pointer; font-family: ui-monospace, Menlo, Consolas, monospace;
    }
    .token-chip:hover { background: rgba(212, 169, 58, 0.22); }
    code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; color: var(--primary); }

    .sign-toggle {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 10px; margin-left: 10px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: 999px;
      font-size: 12px; color: var(--muted); cursor: pointer;
      user-select: none;
    }
    .sign-toggle input { margin: 0; cursor: pointer; }
    .sign-toggle:hover { border-color: var(--primary); color: var(--primary); }

    .sign-preview {
      margin-top: 6px; padding: 10px;
      border-top: 1px dashed var(--line);
      display: flex; flex-direction: column; gap: 6px;
    }
    .sign-preview.empty { opacity: 0.55; font-style: italic; }
    .sign-row { display: flex; gap: 16px; }
    .sign-line { flex: 1; border-bottom: 1px solid var(--fg); padding-bottom: 18px; padding-left: 4px; display: flex; align-items: flex-end; }
    .sign-line.short { flex: 0 0 180px; }

  `],
})
export class PdfDocBuilder {
  private api = inject(Api);

  /** Document title — used in the page footer. */
  @Input() title = '';

  /** Audience the contract is being authored for (employee / client /
   *  partner / candidate / …). Drives the token chip palette so the
   *  author only sees placeholders that resolve against that audience's
   *  entity record at render time. */
  @Input() audience: ContractAudience | null = null;

  /** The most recently focused input/textarea on the active page. The
   *  token chips use this to know where to insert `[[token]]` text at the
   *  caret. Cleared on page change so chips can't write into a stale
   *  element that no longer matches the visible page. */
  lastFocused: HTMLInputElement | HTMLTextAreaElement | null = null;

  /**
   * Optional initial state. When the parent passes a JSON string (e.g. edit flow),
   * the builder hydrates synchronously as the input is set, avoiding any
   * ViewChild-vs-template-render timing issues.
   */
  private _hydratedFrom: string | null | undefined;
  @Input() set initialBlocksJson(v: string | null | undefined) {
    if (v === this._hydratedFrom) return;
    this._hydratedFrom = v;
    if (!v) { this.reset(); return; }
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed) && parsed.length > 0) {
        this.loadPages(parsed);
      } else {
        this.reset();
      }
    } catch { this.reset(); }
  }

  pages = signal<PdfDocPage[]>([{ id: this.uid(), blocks: [] }]);
  activeIdx = signal(0);
  active = computed(() => this.pages()[this.activeIdx()] ?? null);

  @Output() pagesChange = new EventEmitter<PdfDocPage[]>();

  /** Stable per-audience token catalogue. The base set (name, email,
   *  phone, address, today) is shared across every audience because every
   *  contract recipient has those fields. The audience-specific tail
   *  surfaces fields the renderer can resolve against that audience's
   *  primary entity record at attach time. Keep keys snake_case so they
   *  match the slugifier the renderer uses for variable blocks. */
  private static readonly BASE_TOKENS = [
    { key: 'name',         label: 'Full name of the recipient' },
    { key: 'first_name',   label: 'First name' },
    { key: 'last_name',    label: 'Last name' },
    { key: 'email',        label: 'Email address' },
    { key: 'phone',        label: 'Phone number' },
    { key: 'address',      label: 'Postal address' },
    { key: 'today',        label: "Today's date" },
    { key: 'company_name', label: 'Your company name' },
  ];
  private static readonly AUDIENCE_TOKENS: Record<ContractAudience, { key: string; label: string }[]> = {
    employee:   [{ key: 'role',        label: 'Job title' },
                 { key: 'start_date',  label: 'Employment start date' },
                 { key: 'salary',      label: 'Annual salary' }],
    applicant:  [{ key: 'role',        label: 'Role applied for' },
                 { key: 'start_date',  label: 'Proposed start date' }],
    client:     [{ key: 'company',     label: 'Client company' },
                 { key: 'project',     label: 'Project / engagement name' }],
    lead:       [{ key: 'company',     label: 'Lead company' },
                 { key: 'source',      label: 'Lead source' }],
    partner:    [{ key: 'company',     label: 'Partner company' },
                 { key: 'partner_type',label: 'Partner type' }],
    affiliate:  [{ key: 'company',     label: 'Affiliate company' },
                 { key: 'commission',  label: 'Commission rate' }],
    contractor: [{ key: 'company',     label: 'Contractor company' },
                 { key: 'day_rate',    label: 'Day rate' },
                 { key: 'start_date',  label: 'Engagement start date' }],
    candidate:  [{ key: 'role',        label: 'Role placed for' },
                 { key: 'client_name', label: 'Placement client name' },
                 { key: 'start_date',  label: 'Placement start date' }],
    supplier:   [{ key: 'company',     label: 'Supplier company' },
                 { key: 'category',    label: 'Supply category' }],
    investor:   [{ key: 'company',     label: 'Investor company' },
                 { key: 'stake',       label: 'Stake / shareholding' }],
  };

  /** Token chips shown above each text-bearing block. Combines the base
   *  set with the audience-specific extras and any `[[label]]` slugs
   *  declared by variable blocks on any page. */
  tokenList(): { key: string; label: string }[] {
    const list = [...PdfDocBuilder.BASE_TOKENS];
    if (this.audience) {
      const extras = PdfDocBuilder.AUDIENCE_TOKENS[this.audience] || [];
      list.push(...extras);
    }
    // Pull in variable blocks declared anywhere in the document so they're
    // insertable from any other block. Dedupe by key.
    const seen = new Set(list.map(t => t.key));
    for (const p of this.pages()) {
      for (const b of p.blocks) {
        if (b.kind !== 'variable') continue;
        const key = labelSlug(b.label || '');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        list.push({ key, label: `Variable: ${b.label || key}` });
      }
    }
    return list;
  }

  /** Slug that other blocks reference this variable by — shown next to
   *  the variable block as a hint so the author knows what `[[…]]` to
   *  type. */
  variableTokenSlug(b: PdfDocBlock): string { return labelSlug(b.label || ''); }

  /** Insert `[[key]]` into the focused field at the caret position. We
   *  mutate the textarea/input value directly (not via ngModel) because
   *  setting `b.body` in a zoneless world would race the input's pending
   *  change event. After splicing we dispatch an `input` event so ngModel
   *  picks up the new value and the rest of the form stays in sync. */
  insertToken(fld: HTMLInputElement | HTMLTextAreaElement, b: PdfDocBlock, key: string): void {
    const token = `[[${key}]]`;
    const target = fld || this.lastFocused;
    if (!target) {
      // No focused field — append to the block body as a fallback.
      b.body = (b.body || '') + token;
      this.emit();
      return;
    }
    const start = target.selectionStart ?? target.value.length;
    const end   = target.selectionEnd   ?? target.value.length;
    target.value = target.value.slice(0, start) + token + target.value.slice(end);
    const caret = start + token.length;
    target.setSelectionRange(caret, caret);
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.focus();
  }

  /** Switch the active page from the sidebar. Clears `lastFocused`
   *  because the chip-target field belongs to the page we're leaving. */
  setPage(i: number) {
    this.activeIdx.set(i);
    this.lastFocused = null;
  }

  addPage() {
    this.pages.update(list => [...list, { id: this.uid(), blocks: [] }]);
    this.activeIdx.set(this.pages().length - 1);
    this.lastFocused = null;
    this.emit();
  }
  removePage() {
    if (this.pages().length <= 1) return;
    if (!confirm(`Remove page ${this.activeIdx() + 1}?`)) return;
    this.pages.update(list => list.filter((_, i) => i !== this.activeIdx()));
    this.activeIdx.update(i => Math.max(0, Math.min(i, this.pages().length - 1)));
    this.emit();
  }
  /**
   * Does the page at index `i` render the Signature/Date footer?
   *
   * Resolution rules:
   *   • If the page has an explicit `show_sign_zone` boolean → honour it.
   *   • Otherwise (new pages / legacy docs) → default to the LAST page only.
   *
   * Keeping the field optional means we don't need a migration of existing
   * stored templates: they keep rendering exactly as before (last page
   * signed) but new docs surface the per-page toggle in the toolbar.
   */
  showsSignZone(i: number): boolean {
    const p = this.pages()[i];
    if (!p) return false;
    if (typeof p.show_sign_zone === 'boolean') return p.show_sign_zone;
    return i === this.pages().length - 1;
  }

  setShowSignZone(i: number, on: boolean) {
    this.pages.update(list => list.map((p, idx) => idx === i ? { ...p, show_sign_zone: !!on } : p));
    this.emit();
  }

  movePage(dir: -1 | 1) {
    const i = this.activeIdx();
    const j = i + dir;
    this.pages.update(list => {
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    if (j >= 0 && j < this.pages().length) this.activeIdx.set(j);
    this.emit();
  }

  addBlock(kind: PdfDocBlockKind) {
    const block: PdfDocBlock = { id: this.uid(), kind };
    if (kind === 'heading')  { block.body = ''; block.level = 2; }
    if (kind === 'text')     { block.body = ''; }
    if (kind === 'bullet')   { block.body = ''; }
    if (kind === 'variable') { block.body = ''; block.label = ''; }
    this.updateActive(p => ({ ...p, blocks: [...p.blocks, block] }));
  }
  removeBlock(idx: number) {
    if (!confirm('Remove this block?')) return;
    this.updateActive(p => ({ ...p, blocks: p.blocks.filter((_, i) => i !== idx) }));
  }
  moveBlock(idx: number, dir: -1 | 1) {
    this.updateActive(p => {
      const next = [...p.blocks];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return p;
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...p, blocks: next };
    });
  }
  uploadImage(b: PdfDocBlock, ev: Event) {
    const inp = ev.target as HTMLInputElement;
    const file = inp.files?.[0];
    if (!file) return;
    this.api.uploadHrTemplateImage(file).subscribe({
      next: r => {
        this.updateActive(p => ({
          ...p,
          blocks: p.blocks.map(x => x.id === b.id ? { ...x, url: r.url } : x),
        }));
        inp.value = '';
      },
      error: e => { alert(e?.error?.error || 'Image upload failed'); inp.value = ''; },
    });
  }

  assetUrl(rel: string): string { return `${environment.basePath}/` + rel.replace(/^\//, ''); }

  async renderToPdfBlob(_filename = 'document.pdf'): Promise<Blob> {
    return renderPdfDocBlob(this.pages(), { title: this.title });
  }

  serialize(): string { return JSON.stringify(this.pages()); }
  isEmpty(): boolean {
    const ps = this.pages();
    return ps.length === 0 || ps.every(p => p.blocks.length === 0);
  }
  /** Replace the current draft with the given pages (used when editing an existing template). */
  loadPages(pages: PdfDocPage[]) {
    if (!Array.isArray(pages) || pages.length === 0) return;
    this.pages.set(pages.map(p => ({
      id: p.id || this.uid(),
      blocks: (p.blocks || []).map(b => ({ ...b, id: b.id || this.uid() })),
    })));
    this.activeIdx.set(0);
  }
  reset() {
    this.pages.set([{ id: this.uid(), blocks: [] }]);
    this.activeIdx.set(0);
  }

  private updateActive(fn: (p: PdfDocPage) => PdfDocPage) {
    const i = this.activeIdx();
    this.pages.update(list => list.map((p, idx) => idx === i ? fn(p) : p));
    this.emit();
  }
  private emit() { this.pagesChange.emit(this.pages()); }
  private uid(): string { return Math.random().toString(36).slice(2, 10); }
}

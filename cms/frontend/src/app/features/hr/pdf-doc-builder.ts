import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { environment } from '@env/environment';
import { PdfDocBlock, PdfDocBlockKind, PdfDocPage } from '../../core/models';
import { renderPdfDocBlob } from './pdf-doc-renderer';

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
          <button class="page-tab" [class.active]="activeIdx() === pi" (click)="activeIdx.set(pi)" type="button">
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
                    <input [(ngModel)]="b.body" name="hd_{{ b.id }}" placeholder="Heading text" />
                  </div>
                }
                @if (b.kind === 'text') {
                  <textarea rows="6" [(ngModel)]="b.body" name="tx_{{ b.id }}" placeholder="Paragraph text. Plain text — line breaks preserved."></textarea>
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
              <p class="muted small">No blocks yet — add a heading, text, image, or spacer to start building this page.</p>
            }
          </div>

          <div class="add-row">
            <button type="button" class="add-btn" (click)="addBlock('heading')">+ Heading</button>
            <button type="button" class="add-btn" (click)="addBlock('text')">+ Text</button>
            <button type="button" class="add-btn" (click)="addBlock('image')">+ Image</button>
            <button type="button" class="add-btn" (click)="addBlock('spacer')">+ Spacer</button>
          </div>

          <div class="sign-preview">
            <span class="muted small">Standard sign zone (added to every page)</span>
            <div class="sign-row">
              <div class="sign-line"><span class="muted small">Signature</span></div>
              <div class="sign-line short"><span class="muted small">Date</span></div>
            </div>
          </div>
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

    .sign-preview {
      margin-top: 6px; padding: 10px;
      border-top: 1px dashed var(--line);
      display: flex; flex-direction: column; gap: 6px;
    }
    .sign-row { display: flex; gap: 16px; }
    .sign-line { flex: 1; border-bottom: 1px solid var(--fg); padding-bottom: 18px; padding-left: 4px; display: flex; align-items: flex-end; }
    .sign-line.short { flex: 0 0 180px; }

  `],
})
export class PdfDocBuilder {
  private api = inject(Api);

  /** Document title — used in the page footer. */
  @Input() title = '';

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

  addPage() {
    this.pages.update(list => [...list, { id: this.uid(), blocks: [] }]);
    this.activeIdx.set(this.pages().length - 1);
    this.emit();
  }
  removePage() {
    if (this.pages().length <= 1) return;
    if (!confirm(`Remove page ${this.activeIdx() + 1}?`)) return;
    this.pages.update(list => list.filter((_, i) => i !== this.activeIdx()));
    this.activeIdx.update(i => Math.max(0, Math.min(i, this.pages().length - 1)));
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
    if (kind === 'heading') { block.body = ''; block.level = 2; }
    if (kind === 'text')    { block.body = ''; }
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

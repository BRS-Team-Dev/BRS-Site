import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { environment } from '@env/environment';

export interface ViewableDoc {
  id?: number;
  title?: string;
  file_path?: string | null;
  mime_type?: string | null;
  uploaded_at?: string;
  uploaded_by_name?: string | null;
  reference_number?: string | null;
  issued_at?: string | null;
  expires_at?: string | null;
  category?: string | null;
}

/**
 * Modal file viewer used across the HR app. Renders images, PDFs, and plain
 * text inline; falls back to a download link for everything else.
 *
 * Usage:
 *   <app-document-viewer
 *     [doc]="viewing()"
 *     (closed)="viewing.set(null)"
 *   ></app-document-viewer>
 */
@Component({
  selector: 'app-document-viewer',
  template: `
    @if (doc) {
      <div class="backdrop" (click)="close()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="head">
            <div class="title">
              <strong>{{ doc.title || 'Document' }}</strong>
              <span class="muted small">
                @if (doc.category) { {{ doc.category }} · }
                @if (doc.uploaded_at) { Uploaded {{ doc.uploaded_at }} }
                @if (doc.uploaded_by_name) { · by {{ doc.uploaded_by_name }} }
              </span>
            </div>
            <a class="ghost" [href]="rawUrl()" download target="_blank" rel="noopener">⇩ Download</a>
            <button class="ghost icon-btn" (click)="close()" title="Close">✕</button>
          </div>

          @if (doc.reference_number || doc.issued_at || doc.expires_at) {
            <div class="meta">
              @if (doc.reference_number) { <span><span class="muted small">Ref</span> <strong>{{ doc.reference_number }}</strong></span> }
              @if (doc.issued_at)        { <span><span class="muted small">Issued</span> <strong>{{ doc.issued_at }}</strong></span> }
              @if (doc.expires_at)       { <span><span class="muted small">Expires</span> <strong>{{ doc.expires_at }}</strong></span> }
            </div>
          }

          <div class="body">
            @switch (kind()) {
              @case ('image') {
                <img [src]="rawUrl()" [alt]="doc.title || ''" />
              }
              @case ('pdf') {
                <iframe [src]="safeUrl()" frameborder="0"></iframe>
              }
              @case ('text') {
                <iframe class="text-frame" [src]="safeUrl()" frameborder="0"></iframe>
              }
              @default {
                <div class="fallback">
                  <p>Inline preview isn't available for this file type ({{ doc.mime_type || 'unknown' }}).</p>
                  <a class="primary" [href]="rawUrl()" download target="_blank" rel="noopener">⇩ Download to view</a>
                </div>
              }
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .backdrop {
      position: fixed; inset: 0; z-index: 200;
      background: rgba(0, 0, 0, 0.78);
      display: flex; align-items: center; justify-content: center;
    }
    .modal {
      width: 90vw; max-width: 1100px;
      height: 88vh; max-height: 900px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
      display: flex; flex-direction: column;
      overflow: hidden;
    }
    .head {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--line);
    }
    .title { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
    .title strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .meta {
      display: flex; gap: 20px; flex-wrap: wrap;
      padding: 10px 16px; border-bottom: 1px solid var(--line);
      background: var(--bg-3);
    }
    .meta span { display: flex; flex-direction: column; gap: 2px; }
    .body {
      flex: 1; min-height: 0;
      display: flex; align-items: stretch; justify-content: center;
      background: #1a1a1a;
      overflow: auto;
    }
    .body img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .body iframe { width: 100%; height: 100%; border: 0; background: #fff; }
    .body iframe.text-frame { background: #ffffff; padding: 0; }
    .fallback {
      display: flex; flex-direction: column; gap: 12px; align-items: center; justify-content: center;
      width: 100%; padding: 40px; color: var(--muted);
    }
  `],
})
export class DocumentViewer {
  private sanitizer = inject(DomSanitizer);

  @Input() doc: ViewableDoc | null = null;
  @Output() closed = new EventEmitter<void>();

  rawUrl(): string {
    if (!this.doc?.file_path) return '';
    // Static file served from the project root (not via /api router).
    const p = this.doc.file_path.replace(/^\//, '');
    return `${environment.basePath}/${p}`;
  }
  safeUrl(): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.rawUrl());
  }
  kind(): 'image' | 'pdf' | 'text' | 'other' {
    const m = (this.doc?.mime_type || '').toLowerCase();
    const path = (this.doc?.file_path || '').toLowerCase();
    if (m.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(path)) return 'image';
    if (m === 'application/pdf' || path.endsWith('.pdf')) return 'pdf';
    if (m.startsWith('text/') || m === 'application/json' || /\.(txt|md|csv|log|json|html?|xml)$/i.test(path)) return 'text';
    return 'other';
  }

  close() { this.closed.emit(); }
}

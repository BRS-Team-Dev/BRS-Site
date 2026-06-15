import { Component, effect, inject, input, signal } from '@angular/core';
import { environment } from '@env/environment';
import { Api } from '../core/api';
import { EntityContract, EntityContractsSummary } from '../core/models';

/**
 * Reusable "Contracts" tab for any entity that the multi-audience contracts
 * system (076+) targets — client / lead / partner / affiliate / contractor /
 * candidate / applicant. Lists the contract documents rolled out to this
 * record with their **required** status (read live from the template) and a
 * "N of M required signed" gate. Admin marks them signed (no portal yet).
 *
 * Usage: <app-entity-contracts audience="client" [entityId]="client.id!" />
 */
@Component({
  selector: 'app-entity-contracts',
  template: `
    @if (loading()) {
      <p class="muted small">Loading contracts…</p>
    } @else if (summary(); as s) {
      @if (s.total === 0) {
        <p class="muted small">No contracts rolled out to this {{ audience() }} yet. Add a
          contract template for this class on the Operations → Contracts page.</p>
      } @else {
        <div class="ec-summary">
          <span class="ec-gate" [class.ok]="s.required_outstanding === 0" [class.warn]="s.required_outstanding > 0">
            {{ s.required_signed }} / {{ s.required }} required signed
          </span>
          @if (s.required_outstanding > 0) {
            <span class="muted small">· {{ s.required_outstanding }} outstanding</span>
          }
          <span class="spacer"></span>
          <span class="muted small">{{ s.signed }} / {{ s.total }} total signed</span>
        </div>

        <ul class="ec-list">
          @for (d of docs(); track d.id) {
            <li class="ec-row" [class.is-required]="d.is_required && !d.signed_at">
              <strong>{{ d.type_name || d.title }}</strong>
              @if (d.is_required) {
                <span class="pill req">Required</span>
              } @else {
                <span class="pill opt">Optional</span>
              }
              @if (d.file_path) {
                <a class="file-link" [href]="fileUrl(d)" target="_blank" rel="noopener">View</a>
              }
              <span class="spacer"></span>
              @if (d.signed_at) {
                <span class="sig signed" [title]="'Signed ' + d.signed_at">✓ Signed</span>
                <button class="ghost icon-btn" (click)="toggleSign(d)" title="Mark as not signed">↺</button>
              } @else {
                <span class="sig pending">Pending</span>
                <button class="ghost small" (click)="toggleSign(d)">Mark signed</button>
              }
            </li>
          }
        </ul>
      }
    }
  `,
  styles: [`
    .ec-summary { display: flex; align-items: center; gap: 8px; margin: 4px 0 14px; }
    .ec-gate {
      display: inline-block; padding: 3px 12px; border-radius: 999px; font-size: 12px; font-weight: 600;
      border: 1px solid var(--line);
    }
    .ec-gate.ok   { color: #56c98a; border-color: #56c98a; background: rgba(86,201,138,0.12); }
    .ec-gate.warn { color: #f0a85a; border-color: #c2873b; background: rgba(194,135,59,0.12); }
    .ec-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .ec-row {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg-3);
    }
    .ec-row.is-required { border-left: 3px solid #c2873b; }
    .pill { font-size: 11px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--line); }
    .pill.req { color: #f0a85a; border-color: #c2873b; background: rgba(194,135,59,0.12); }
    .pill.opt { color: var(--muted); }
    .sig { font-size: 12px; }
    .sig.signed  { color: #56c98a; }
    .sig.pending { color: var(--muted); }
    .spacer { flex: 1; }
  `],
})
export class EntityContracts {
  private api = inject(Api);

  audience = input.required<string>();
  entityId = input.required<number>();

  docs = signal<EntityContract[]>([]);
  summary = signal<EntityContractsSummary | null>(null);
  loading = signal(false);
  basePath = environment.basePath;

  constructor() {
    // Reload whenever the bound entity changes.
    effect(() => {
      const aud = this.audience();
      const id = this.entityId();
      if (aud && id) this.load(aud, id);
    });
  }

  private load(aud: string, id: number) {
    this.loading.set(true);
    this.api.listEntityContracts(aud, id).subscribe({
      next: r => { this.docs.set(r.documents); this.summary.set(r.summary); this.loading.set(false); },
      error: () => { this.docs.set([]); this.summary.set(null); this.loading.set(false); },
    });
  }

  fileUrl(d: EntityContract): string { return `${this.basePath}/${d.file_path}`; }

  toggleSign(d: EntityContract) {
    const aud = this.audience(); const id = this.entityId();
    const obs = d.signed_at
      ? this.api.unsignEntityContract(aud, id, d.id)
      : this.api.signEntityContract(aud, id, d.id);
    obs.subscribe(() => this.load(aud, id));
  }
}

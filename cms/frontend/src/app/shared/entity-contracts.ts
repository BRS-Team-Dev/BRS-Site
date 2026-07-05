import { Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { environment } from '@env/environment';
import { Api } from '../core/api';
import { DialogService } from '../core/dialog';
import { ClientService, ContractTemplate, EntityContract, EntityContractsSummary } from '../core/models';

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
  imports: [FormsModule],
  template: `
    <div class="ec-toolbar">
      <span class="spacer"></span>
      <button class="primary small" (click)="openAttach()"
              [disabled]="attachLoading()">
        + Attach contract
      </button>
    </div>

    @if (loading()) {
      <p class="muted small">Loading contracts…</p>
    } @else if (summary(); as s) {
      @if (s.total === 0) {
        <p class="muted small">No contracts rolled out to this {{ audience() }} yet. Use
          <strong>+ Attach contract</strong> to pick one from your templates.</p>
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
              @if (audience() === 'client' && d.service_name) {
                <span class="pill svc" [title]="'Linked to ' + d.service_name">🔗 {{ d.service_name }}</span>
              }
              @if (d.file_path) {
                <a class="file-link" [href]="fileUrl(d)" target="_blank" rel="noopener">View</a>
              }
              <span class="spacer"></span>
              @if (audience() === 'client' && services().length > 0) {
                <select class="ec-svc-pick"
                        [ngModel]="d.client_service_offering_id ?? null"
                        (ngModelChange)="linkContractToService(d, $event)"
                        [title]="'Link to a service'">
                  <option [ngValue]="null">— no service —</option>
                  @for (s of services(); track s.service_link_id) {
                    <option [ngValue]="s.service_link_id">{{ s.form_title || s.name }}</option>
                  }
                </select>
              }
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

    @if (attachOpen()) {
      <div class="modal-backdrop" (click)="closeAttach()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h3>Attach contract</h3>
            <button class="ghost icon-btn" (click)="closeAttach()">✕</button>
          </div>
          <div class="modal-body">
            @if (attachLoading()) {
              <p class="muted small">Loading templates…</p>
            } @else if (templates().length === 0) {
              <p class="muted small">
                No contract templates for the <strong>{{ audience() }}</strong> audience yet.
                Create one on the Operations → Contracts page.
              </p>
            } @else {
              <label>Template <span class="req">★</span></label>
              <select [(ngModel)]="attachDraft.doc_type_id" name="tpl">
                <option [ngValue]="null">— pick a template —</option>
                @for (t of templates(); track t.id) {
                  <option [ngValue]="t.id">
                    {{ t.name }}{{ t.audience ? ' [' + t.audience + ']' : '' }}{{ t.is_required ? ' (required)' : '' }}
                  </option>
                }
              </select>

              @if (audience() === 'client' && services().length > 0) {
                <label style="margin-top: 12px;">Link to service <span class="muted small">(optional)</span></label>
                <select [(ngModel)]="attachDraft.client_service_offering_id" name="svc">
                  <option [ngValue]="null">— client-wide —</option>
                  @for (s of services(); track s.service_link_id) {
                    <option [ngValue]="s.service_link_id">{{ s.form_title || s.name }}</option>
                  }
                </select>
                <p class="muted small">
                  When set, this contract shows up on the service row as a chip
                  and belongs to that specific engagement.
                </p>
              }

              @if (attachError()) { <div class="error-msg" style="margin-top: 10px;">{{ attachError() }}</div> }
            }
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="closeAttach()">Cancel</button>
            <button class="primary" (click)="saveAttach()"
                    [disabled]="attachSaving() || !attachDraft.doc_type_id">
              {{ attachSaving() ? 'Attaching…' : 'Attach' }}
            </button>
          </div>
        </div>
      </div>
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
    /* Service-link pill on client contracts. */
    .pill.svc { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .sig { font-size: 12px; }
    .sig.signed  { color: #56c98a; }
    .sig.pending { color: var(--muted); }
    .spacer { flex: 1; }
    /* Toolbar above the list — houses the + Attach contract button. */
    .ec-toolbar { display: flex; align-items: center; margin-bottom: 10px; }
    .ec-toolbar .primary { padding: 6px 14px; background: var(--primary); color: var(--bg); border: none; border-radius: var(--radius-sm); cursor: pointer; font-weight: 600; font-size: 12px; }
    .ec-toolbar .primary[disabled] { opacity: 0.55; cursor: not-allowed; }
    /* Inline "link to service" picker on each contract row. */
    .ec-svc-pick { padding: 3px 8px; background: var(--bg-2); border: 1px solid var(--line); color: var(--fg); border-radius: 4px; font-size: 11px; max-width: 160px; }
  `],
})
export class EntityContracts {
  private api = inject(Api);
  private dialog = inject(DialogService);

  audience = input.required<string>();
  entityId = input.required<number>();
  /** Client audience only — the parent (clients-admin) passes the
   *  client's catalogue services so the attach flow can offer the
   *  "link to service" dropdown. Empty for other audiences. */
  services = input<ClientService[]>([]);
  /** Pre-selects a service in the attach picker (and inline row
   *  dropdowns via the parent-side default binding). Used by
   *  service-client-detail so opening Attach from the service page
   *  auto-fills "link to service" with the service you're viewing. */
  defaultServiceLinkId = input<number | null>(null);

  docs = signal<EntityContract[]>([]);
  summary = signal<EntityContractsSummary | null>(null);
  loading = signal(false);
  basePath = environment.basePath;

  // ── Attach modal state ─────────────────────────────────────────────
  attachOpen = signal(false);
  attachLoading = signal(false);
  attachSaving = signal(false);
  attachError = signal<string | null>(null);
  templates = signal<ContractTemplate[]>([]);
  attachDraft: { doc_type_id: number | null; client_service_offering_id: number | null } = {
    doc_type_id: null, client_service_offering_id: null,
  };

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

  openAttach() {
    this.attachDraft = {
      doc_type_id: null,
      // Seed with the parent's default so a caller like the per-service
      // client page auto-links the new contract to the service they're
      // viewing. Null (no default) keeps the picker unselected.
      client_service_offering_id: this.defaultServiceLinkId() ?? null,
    };
    this.attachError.set(null);
    this.attachOpen.set(true);
    this.attachLoading.set(true);
    this.api.listContractTemplates(this.audience(), this.entityId()).subscribe({
      next: r => { this.templates.set(r.templates || []); this.attachLoading.set(false); },
      error: () => { this.templates.set([]); this.attachLoading.set(false); },
    });
  }
  closeAttach() { this.attachOpen.set(false); this.attachError.set(null); }

  saveAttach() {
    if (this.attachSaving() || !this.attachDraft.doc_type_id) return;
    this.attachSaving.set(true);
    this.attachError.set(null);
    this.api.attachEntityContract(this.audience(), this.entityId(), {
      doc_type_id: this.attachDraft.doc_type_id,
      client_service_offering_id: this.attachDraft.client_service_offering_id,
    }).subscribe({
      next: () => {
        this.attachSaving.set(false);
        this.attachOpen.set(false);
        this.load(this.audience(), this.entityId());
      },
      error: (e: any) => {
        this.attachSaving.set(false);
        this.attachError.set(e?.error?.error || 'Attach failed');
      },
    });
  }

  /** Called when the user picks a service from the inline dropdown on
   *  a contract row. Persists the link and reloads so the pill updates. */
  linkContractToService(d: EntityContract, csoId: number | null) {
    if (this.audience() !== 'client') return;
    this.api.setContractService(this.entityId(), d.id, csoId).subscribe({
      next: () => this.load(this.audience(), this.entityId()),
      error: (e: any) => this.dialog.alert(
        e?.error?.error || 'Failed to link contract to service',
        { title: 'Contract', variant: 'danger' }
      ),
    });
  }
}

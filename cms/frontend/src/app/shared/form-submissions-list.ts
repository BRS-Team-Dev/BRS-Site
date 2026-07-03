import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { DialogService } from '../core/dialog';
import { FormSubmissionCandidateGroup, FormSubmissionLinkGroup } from '../core/models';

/**
 * Renders every form + multipart-form submission linked to a given
 * record (client / lead / service offering). Groups by form, splits
 * into "Service" vs "Default" buckets, and expands each row on click
 * to show the captured field data.
 *
 *   <app-form-submissions-list type="client" [recordId]="clientId()" />
 *
 * Backed by `/api/form-submission-links/for/:type/:id`. Detach action
 * removes the linkage without deleting the underlying submission.
 */

@Component({
  selector: 'app-form-submissions-list',
  imports: [FormsModule],
  template: `
    <div class="list-head">
      <span class="spacer"></span>
      <button class="ghost small" (click)="openAttach()" data-testid="fsl-btn-attach">+ Attach submission</button>
    </div>

    @if (loading()) {
      <p class="muted small">Loading submissions…</p>
    } @else if (groups().length === 0) {
      <p class="muted small">No form submissions linked to this {{ type() }} yet.</p>
    } @else {
      @for (bucket of buckets(); track bucket.key) {
        <section class="bucket">
          <h4>{{ bucket.label }}</h4>
          @for (g of bucket.groups; track g.form.id) {
            <div class="form-group">
              <div class="form-head">
                <span class="form-type-pill" [class.multipart]="g.form.form_type === 'onboarding'">
                  {{ g.form.form_type === 'onboarding' ? 'Multipart' : 'Form' }}
                </span>
                <strong>{{ g.form.title }}</strong>
                <span class="muted small">{{ g.submissions.length }} submission{{ g.submissions.length === 1 ? '' : 's' }}</span>
              </div>
              <ul class="submissions">
                @for (s of g.submissions; track s.link_id) {
                  <li [class.open]="isOpen(s.link_id)" [attr.data-testid]="'fsl-sub-' + s.link_id">
                    <button type="button" class="sub-toggle" (click)="toggle(s.link_id)"
                            [attr.data-testid]="'fsl-sub-' + s.link_id + '-toggle'">
                      <span class="caret">{{ isOpen(s.link_id) ? '▾' : '▸' }}</span>
                      <span class="submitted-at">{{ fmtDate(s.submitted_at) }}</span>
                      <span class="source-pill" [attr.data-source]="s.link_source">{{ s.link_source }}</span>
                      <span class="spacer"></span>
                      @if (s.is_compulsory) {
                        <span class="required-pill" title="This onboarding is required by the linked service. Cancel the service to detach.">
                          🔒 Required
                        </span>
                      } @else {
                        <button type="button" class="ghost small danger"
                                (click)="detach(s.link_id, $event)"
                                title="Detach — keeps the submission but removes the link"
                                [attr.data-testid]="'fsl-sub-' + s.link_id + '-detach'">✕ Detach</button>
                      }
                    </button>
                    @if (isOpen(s.link_id)) {
                      <div class="captured">
                        @if (!s.data) {
                          <p class="muted small">Submission data missing (row deleted?)</p>
                        } @else {
                          <table class="captured-tbl">
                            @for (row of dataRows(s.data); track row.key) {
                              <tr>
                                <th>{{ prettyKey(row.key) }}</th>
                                <td>{{ formatValue(row.value) }}</td>
                              </tr>
                            }
                          </table>
                        }
                      </div>
                    }
                  </li>
                }
              </ul>
            </div>
          }
        </section>
      }
    }

    <!-- Attach-submission picker modal. Lists every form in the tenant
         with its recent submissions; already-linked rows are disabled.
         Click any row to POST /form-submission-links + refresh. -->
    @if (attachOpen()) {
      <div class="modal-backdrop" (click)="closeAttach()">
        <div class="modal wide" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>Attach an existing submission</h2>
            <button class="ghost icon-btn" (click)="closeAttach()">✕</button>
          </div>
          <div class="modal-body">
            <input class="picker-search"
                   placeholder="Filter by form title, name or email…"
                   [(ngModel)]="attachFilter"
                   name="attach_filter" />

            @if (attachLoading()) {
              <p class="muted small">Loading…</p>
            } @else if (attachCandidates().length === 0) {
              <p class="muted small">No submissions exist yet.</p>
            } @else {
              @for (g of filteredCandidates(); track g.form.id) {
                <div class="cand-form">
                  <div class="cand-head">
                    <span class="form-type-pill" [class.multipart]="g.form.form_type === 'onboarding'">
                      {{ g.form.form_type === 'onboarding' ? 'Multipart' : 'Form' }}
                    </span>
                    <strong>{{ g.form.title }}</strong>
                    <span class="muted small">{{ g.submissions.length }} submissions</span>
                  </div>
                  <ul class="cand-subs">
                    @for (s of g.submissions; track s.submission_id) {
                      <li>
                        <button type="button"
                                class="cand-row"
                                [disabled]="s.already_linked || attachSaving()"
                                (click)="attach(g.form, s.submission_id)"
                                [attr.data-testid]="'fsl-picker-' + g.form.id + '-sub-' + s.submission_id">
                          <span class="cand-label">{{ s.label }}</span>
                          <span class="cand-when muted small">{{ fmtDate(s.submitted_at) }}</span>
                          @if (s.already_linked) { <span class="already">Already linked</span> }
                        </button>
                      </li>
                    }
                  </ul>
                </div>
              }
            }
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="closeAttach()">Close</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .bucket { margin-bottom: 20px; }
    .bucket h4 {
      margin: 0 0 10px; font-size: 12px; text-transform: uppercase;
      letter-spacing: 0.5px; color: var(--muted); font-weight: 700;
    }
    .form-group {
      background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius); margin-bottom: 10px; padding: 10px 12px;
    }
    .form-head {
      display: flex; align-items: center; gap: 10px; margin-bottom: 6px;
    }
    .form-head strong { font-size: 14px; }
    .form-type-pill {
      padding: 2px 8px; border-radius: 999px;
      background: var(--bg-3); color: var(--muted);
      font-size: 10px; font-weight: 700; letter-spacing: 0.5px;
      text-transform: uppercase; white-space: nowrap;
    }
    .form-type-pill.multipart {
      background: color-mix(in oklab, var(--primary), transparent 78%);
      color: var(--primary);
    }
    .submissions { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
    .submissions li {
      background: var(--bg-3); border-radius: var(--radius-sm);
      overflow: hidden;
    }
    .sub-toggle {
      display: flex; align-items: center; gap: 10px;
      width: 100%; padding: 8px 10px;
      background: transparent; border: none; color: var(--fg);
      cursor: pointer; text-align: left; font: inherit;
    }
    .sub-toggle:hover { background: color-mix(in oklab, var(--primary), transparent 92%); }
    .caret { width: 12px; opacity: 0.6; }
    .submitted-at { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 12px; }
    .source-pill {
      padding: 1px 8px; border-radius: 999px; font-size: 10px; font-weight: 600;
      letter-spacing: 0.3px; text-transform: uppercase;
      background: var(--bg); color: var(--muted);
    }
    .source-pill[data-source="token"]  { background: color-mix(in oklab, var(--success), transparent 78%); color: var(--success); }
    .source-pill[data-source="manual"] { background: color-mix(in oklab, var(--warning), transparent 78%); color: var(--warning); }
    /* "Required by service" indicator that replaces the Detach button
       when a link is compulsory. Muted styling so it doesn't scream
       — but reads clearly as a status, not an action. */
    .required-pill {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 600; letter-spacing: 0.3px;
      background: var(--bg); color: var(--muted);
      border: 1px solid var(--line);
      white-space: nowrap;
    }
    .spacer { flex: 1; }
    .captured { padding: 8px 12px 12px; background: var(--bg-3); border-top: 1px solid var(--line); }
    .captured-tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
    .captured-tbl th, .captured-tbl td { padding: 4px 8px; vertical-align: top; border-bottom: 1px dashed var(--line); }
    .captured-tbl th { color: var(--muted); font-weight: 600; text-align: left; width: 30%; white-space: nowrap; }
    .captured-tbl td { color: var(--fg); word-break: break-word; }

    /* +Attach button row above the list */
    .list-head {
      display: flex; align-items: center; margin-bottom: 10px;
    }
    .list-head .spacer { flex: 1; }
    .list-head button { flex-shrink: 0; }

    /* Picker modal styles */
    .modal.wide { max-width: 640px; }
    .picker-search {
      width: 100%; margin-bottom: 14px;
      padding: 8px 12px; font-size: 13px;
    }
    .cand-form { margin-bottom: 14px; }
    .cand-head {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 6px;
    }
    .cand-head strong { font-size: 13px; }
    .cand-subs { list-style: none; padding: 0; margin: 0;
      display: flex; flex-direction: column; gap: 4px; }
    .cand-row {
      display: flex; align-items: center; gap: 10px;
      width: 100%; padding: 8px 12px;
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); color: var(--fg);
      cursor: pointer; text-align: left; font: inherit;
      transition: border-color .12s, background .12s;
    }
    .cand-row:hover:not(:disabled) {
      border-color: var(--primary);
      background: color-mix(in oklab, var(--primary), transparent 92%);
    }
    .cand-row:disabled { opacity: 0.55; cursor: not-allowed; }
    .cand-label { flex: 1; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-size: 13px; }
    .cand-when { flex-shrink: 0; font-family: "JetBrains Mono", ui-monospace, monospace; }
    .already {
      padding: 1px 8px; border-radius: 999px;
      font-size: 10px; font-weight: 600; letter-spacing: 0.3px; text-transform: uppercase;
      background: color-mix(in oklab, var(--success), transparent 78%);
      color: var(--success); flex-shrink: 0;
    }
  `],
})
export class FormSubmissionsList {
  private api = inject(Api);
  private dialog = inject(DialogService);

  type      = input.required<'client' | 'lead' | 'service'>();
  recordId  = input.required<number>();

  groups  = signal<FormSubmissionLinkGroup[]>([]);
  loading = signal(true);
  openIds = signal<Set<number>>(new Set());

  // ─── Attach-submission picker ────────────────────────────
  // Modal state — loaded lazily on open so the parent tab doesn't pay
  // the cost of fetching every form's submissions upfront.
  attachOpen       = signal(false);
  attachLoading    = signal(false);
  attachSaving     = signal(false);
  attachCandidates = signal<FormSubmissionCandidateGroup[]>([]);
  attachFilter     = '';

  /** Case-insensitive filter over form title, submission label, and
   *  submitted_at date. Runs against `attachCandidates()`; groups
   *  with zero matches are hidden. */
  filteredCandidates = computed<FormSubmissionCandidateGroup[]>(() => {
    const q = this.attachFilter.trim().toLowerCase();
    const cands = this.attachCandidates();
    if (!q) return cands;
    return cands
      .map(g => ({
        ...g,
        submissions: g.submissions.filter(s =>
          (s.label || '').toLowerCase().includes(q)
          || (s.submitted_at || '').toLowerCase().includes(q)
          || (g.form.title || '').toLowerCase().includes(q)
        ),
      }))
      .filter(g => g.submissions.length > 0);
  });

  /** Bucket the groups into "Service" and "Default" sections so the UI
   *  can label them clearly. */
  buckets = computed(() => {
    const gs = this.groups();
    return [
      { key: 'service',   label: 'Linked via service',           groups: gs.filter(g => g.bucket === 'service') },
      { key: 'default',   label: 'Direct',                        groups: gs.filter(g => g.bucket === 'default') },
      { key: 'broadcast', label: 'Broadcast (attached to all)',   groups: gs.filter(g => g.bucket === 'broadcast') },
    ].filter(b => b.groups.length > 0);
  });

  ngOnInit() { this.load(); }

  ngOnChanges() { this.load(); }

  private load() {
    if (!this.recordId()) return;
    this.loading.set(true);
    this.api.listFormSubmissionsFor(this.type(), this.recordId()).subscribe({
      next: r => { this.groups.set(r.groups ?? []); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  isOpen(linkId: number): boolean { return this.openIds().has(linkId); }
  toggle(linkId: number) {
    this.openIds.update(s => {
      const next = new Set(s);
      if (next.has(linkId)) next.delete(linkId); else next.add(linkId);
      return next;
    });
  }

  async detach(linkId: number, ev: Event) {
    ev.stopPropagation();
    const ok = await this.dialog.confirm(
      'Detach this submission from the record? The submission itself is preserved.',
      { title: 'Detach submission', confirmLabel: 'Detach', variant: 'danger' }
    );
    if (!ok) return;
    this.api.detachFormSubmission(linkId).subscribe({
      next: () => this.load(),
      error: async e => {
        // 409 = onboarding is required for a service the client is
        // currently on. Offer a force-detach with a clear warning.
        if (e?.status === 409) {
          const msg = e?.error?.error || 'This onboarding is required for a service the client is currently on.';
          const force = await this.dialog.confirm(
            `${msg}\n\nDetach anyway? The client will still be on the service but the onboarding record will be gone.`,
            {
              title: 'Compulsory onboarding',
              confirmLabel: 'Detach anyway',
              cancelLabel: 'Keep link',
              variant: 'danger',
            }
          );
          if (!force) return;
          this.api.detachFormSubmission(linkId, true).subscribe(() => this.load());
        } else {
          this.dialog.alert(
            e?.error?.error || 'Detach failed',
            { title: 'Detach failed', variant: 'danger' }
          );
        }
      },
    });
  }

  /** Flatten a submission data blob into ordered [key, value] rows,
   *  stripping housekeeping columns. */
  dataRows(data: Record<string, any>): { key: string; value: any }[] {
    const skip = new Set(['ip_address', 'submitted_at', 'created_at', 'updated_at']);
    return Object.entries(data)
      .filter(([k, v]) => !skip.has(k) && v !== null && v !== '')
      .map(([key, value]) => ({ key, value }));
  }

  /** Turn snake_case column names into a readable label. */
  prettyKey(k: string): string {
    return k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
  }

  formatValue(v: any): string {
    if (v == null) return '—';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  fmtDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString();
  }

  // ─── Attach picker ────────────────────────────────────────
  openAttach() {
    this.attachOpen.set(true);
    this.attachFilter = '';
    this.attachLoading.set(true);
    this.api.listAttachCandidates(this.type(), this.recordId()).subscribe({
      next: r => { this.attachCandidates.set(r.forms ?? []); this.attachLoading.set(false); },
      error: () => this.attachLoading.set(false),
    });
  }
  closeAttach() { this.attachOpen.set(false); }

  /** Row click in the picker. Fires POST /form-submission-links with
   *  the right record type, then refreshes both the linked list and
   *  the picker's `already_linked` markers without closing the modal
   *  (so the admin can attach multiple in one flow). */
  attach(form: FormSubmissionCandidateGroup['form'], submissionId: number) {
    if (this.attachSaving()) return;
    this.attachSaving.set(true);
    const payload: any = { form_id: form.id, submission_id: submissionId };
    const t = this.type();
    if (t === 'client')  payload.client_id           = this.recordId();
    if (t === 'lead')    payload.lead_id             = this.recordId();
    if (t === 'service') payload.service_offering_id = this.recordId();

    this.api.attachFormSubmission(payload).subscribe({
      next: () => {
        this.attachSaving.set(false);
        // Optimistically flip the row's already_linked flag so the
        // user doesn't need to wait for a full refetch.
        this.attachCandidates.update(gs => gs.map(g =>
          g.form.id !== form.id ? g : {
            ...g,
            submissions: g.submissions.map(s =>
              s.submission_id !== submissionId ? s : { ...s, already_linked: true }
            ),
          }
        ));
        this.load();
      },
      error: e => {
        this.attachSaving.set(false);
        this.dialog.alert(
          e?.error?.error || 'Attach failed',
          { title: 'Attach failed', variant: 'danger' }
        );
      },
    });
  }
}

import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { MailerOutcome, MailerSentEmail, MailerSentEmailDetail, MailerSentGroup } from '../../core/models';

/**
 * Mailer - sent emails.
 *
 *   /admin/mailer/sent
 *
 * Everything the Mailer produced, grouped by send batch (one collapsible
 * group per `mailer_sends` row) with every email of that batch listed
 * underneath. Filters apply to the emails; a batch shows only while at least
 * one of its emails matches, and then shows only those.
 *
 * Two things can be done from here besides reading:
 *  - Outcome: what happened after delivery (replied, interested, meeting
 *    booked ...). Set per email in the detail modal, or in bulk for the ticked
 *    ones. Distinct from the delivery status, which never changes.
 *  - Follow-up: tick emails (or a whole group, or open one) and send a
 *    follow-up. That opens the composer with those exact recipients preloaded
 *    (?followup=<ids>), addressed to the inbox each was originally mailed at.
 *    Sending marks the originals "followed up".
 */
@Component({
  selector: 'app-mailer-sent',
  standalone: true,
  host: { '(document:click)': 'pickerFor.set(null)' },
  imports: [FormsModule, RouterLink],
  template: `
    <div class="toolbar">
      <h1>Sent emails</h1>
      <span class="spacer"></span>
      <input type="text" class="ms-search" placeholder="Search email, name or subject…"
             [ngModel]="q()" (ngModelChange)="q.set($event); search()" />
      <select class="ms-pick" [ngModel]="outcome()" (ngModelChange)="outcome.set($event); search()" title="After-delivery outcome">
        <option value="">Any outcome</option>
        <option value="none">No outcome yet</option>
        @for (o of outcomes(); track o.key) { <option [value]="o.key">{{ o.label }}</option> }
      </select>
      <select class="ms-pick ms-pick-sm" [ngModel]="status()" (ngModelChange)="status.set($event); search()" title="Delivery result">
        <option value="">Any delivery</option>
        <option value="sent">Delivered</option>
        <option value="failed">Failed</option>
        <option value="skipped">Skipped</option>
      </select>
      <select class="ms-pick ms-pick-sm" [ngModel]="kind()" (ngModelChange)="kind.set($event); search()">
        <option value="">Leads &amp; clients</option>
        <option value="lead">Leads only</option>
        <option value="client">Clients only</option>
      </select>
      <button class="ghost" (click)="load()" [disabled]="loading()">Refresh</button>
      <button class="primary" routerLink="/admin/mailer/compose">Compose</button>
    </div>

    <p class="muted small ms-sub">
      Every email sent through the Mailer, grouped by send. Tick emails or whole groups to follow them up
      or set an outcome in bulk. Click an email to read it.
    </p>

    @if (error()) { <div class="error-msg ms-err">{{ error() }}</div> }

    <div class="ms-stats">
      <div class="ms-stat"><span class="ms-stat-n">{{ total() }}</span><span class="ms-stat-l">emails</span></div>
      <div class="ms-stat"><span class="ms-stat-n">{{ batches() }}</span><span class="ms-stat-l">sends</span></div>
      <div class="ms-stat ok"><span class="ms-stat-n">{{ summary().sent }}</span><span class="ms-stat-l">delivered</span></div>
      <div class="ms-stat bad"><span class="ms-stat-n">{{ summary().failed }}</span><span class="ms-stat-l">failed</span></div>
      <div class="ms-stat"><span class="ms-stat-n">{{ summary().skipped }}</span><span class="ms-stat-l">skipped</span></div>
      <div class="ms-stat gold"><span class="ms-stat-n">{{ summary().positive }}</span><span class="ms-stat-l">replied / interested</span></div>
    </div>

    <!-- Bulk bar: appears once anything is ticked. -->
    @if (selectedCount() > 0) {
      <div class="ms-bulk">
        <strong>{{ selectedCount() }} selected</strong>
        <button class="primary small" (click)="followUpSelected()">Send follow-up to {{ selectedCount() }}</button>
        <span class="ms-bulk-sep"></span>
        <span class="muted small ms-nowrap">Outcome:</span>
        <span class="ms-chips">
          @for (o of outcomes(); track o.key) {
            <button type="button" class="badge ms-chip" [attr.data-outcome]="o.key"
                    [disabled]="saving()" (click)="setBulkOutcome(o.key)">{{ o.label }}</button>
          }
        </span>
        <span class="spacer"></span>
        <button class="ghost small" (click)="clearSelection()">Clear selection</button>
      </div>
    }

    @if (loading() && !groups().length) {
      <p class="muted small ms-sub">Loading…</p>
    } @else if (!groups().length) {
      <div class="empty">
        @if (hasFilter()) { Nothing matches this filter. }
        @else { No emails have been sent through the Mailer yet. }
      </div>
    } @else {
      <div class="ms-groups">
        @for (g of groups(); track g.id) {
          <section class="ms-group" [class.open]="isOpen(g.id)">
            <!-- Group header: the batch. Click anywhere to expand; the
                 controls inside stop the click so they do not also toggle. -->
            <div class="ms-ghead" (click)="toggleOpen(g.id)">
              <span class="ms-caret">›</span>
              <input type="checkbox" class="ms-check" title="Select every email in this send"
                     [checked]="groupAllSelected(g)" [indeterminate]="groupSomeSelected(g)"
                     (click)="$event.stopPropagation()" (change)="toggleGroup(g, $event)" />
              <div class="ms-gmain">
                <div class="ms-gtitle">
                  <strong>{{ g.subject || '(no subject)' }}</strong>
                  @if (g.parent_send_id) {
                    <span class="ms-fu-pill" [title]="'Follow-up to: ' + (g.parent_subject || 'send #' + g.parent_send_id)">↩ follow-up</span>
                  }
                </div>
                <div class="muted small ms-gsub">
                  {{ fmtDate(g.created_at) }} · {{ g.sent_by || 'System' }}
                  · {{ g.audience }}@if (g.industry) { · {{ g.industry }} }
                  @if (g.emails.length !== g.total) { · showing {{ g.emails.length }} of {{ g.total }} }
                </div>
              </div>
              <div class="ms-gcounts">
                <span class="badge success" title="Delivered">{{ g.sent_count }}</span>
                @if (g.failed_count) { <span class="badge warning" title="Failed">{{ g.failed_count }}</span> }
                @if (g.skipped_count) { <span class="badge" title="Skipped (unsubscribed)">{{ g.skipped_count }}</span> }
                <span class="muted small ms-nowrap">{{ g.total }} email{{ g.total === 1 ? '' : 's' }}</span>
              </div>
              <button class="ghost small ms-nowrap" (click)="followUpGroup(g, $event)"
                      [disabled]="!deliverable(g).length" title="Follow up every delivered email in this send">
                Follow up group
              </button>
            </div>

            @if (isOpen(g.id)) {
              <div class="table-wrap ms-table">
                <table class="data">
                  <thead>
                    <tr>
                      <th class="ms-col-check"></th>
                      <th>To</th>
                      <th class="ms-col-kind">Record</th>
                      <th class="ms-col-outcome">Outcome</th>
                      <th class="ms-col-status">Delivery</th>
                      <th class="ms-col-act"></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (e of g.emails; track e.id) {
                      <tr (click)="open(e)" [class.is-failed]="e.status === 'failed'">
                        <td class="ms-col-check">
                          <input type="checkbox" class="ms-check" [checked]="isSelected(e.id)"
                                 [disabled]="e.status === 'skipped'"
                                 (click)="$event.stopPropagation()" (change)="toggleOne(e.id, $event)" />
                        </td>
                        <td>
                          <div class="ms-to">
                            <strong>{{ e.name || e.email }}</strong>
                            @if (e.name) { <span class="muted small">{{ e.email }}</span> }
                          </div>
                        </td>
                        <td class="ms-nowrap">
                          <span class="ms-kind" [attr.data-kind]="e.entity_type">{{ e.entity_type === 'manual' ? 'one-off' : e.entity_type }}</span>
                          @if (e.entity_id) { <span class="muted small"> #{{ e.entity_id }}</span> }
                        </td>
                        <td class="ms-outcome-cell" (click)="$event.stopPropagation()">
                          @if (pickerFor() === e.id) {
                            <span class="ms-chips">
                              @for (o of outcomes(); track o.key) {
                                <button type="button" class="badge ms-chip" [attr.data-outcome]="o.key"
                                        [class.is-on]="e.outcome === o.key" [disabled]="saving()"
                                        (click)="setOutcome(e, o.key)">{{ o.label }}</button>
                              }
                            </span>
                          } @else {
                            <button type="button" class="badge ms-chip ms-current" [class.is-on]="!!e.outcome"
                                    [attr.data-outcome]="e.outcome || 'unset'"
                                    [title]="e.outcome ? 'Set ' + fmtDate(e.outcome_at) + ' · click to change' : 'Click to set an outcome'"
                                    (click)="togglePicker(e.id)">{{ e.outcome ? outcomeLabel(e.outcome) : '+ outcome' }}</button>
                            @if (e.follow_ups) { <span class="ms-fu-count" title="Follow-ups sent">↩ {{ e.follow_ups }}</span> }
                          }
                        </td>
                        <td class="ms-nowrap">
                          <span class="badge" [class.success]="e.status === 'sent'" [class.warning]="e.status === 'failed'"
                                [title]="e.error || ''">{{ e.status === 'sent' ? 'delivered' : e.status }}</span>
                        </td>
                        <td class="ms-col-act ms-nowrap">
                          @if (e.entity_id) {
                            <button class="ghost small" [routerLink]="recordLink(e)" (click)="$event.stopPropagation()"
                                    title="Open the {{ e.entity_type }} profile">Open {{ e.entity_type }} →</button>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>
        }
      </div>

      <div class="ms-pager">
        <span class="muted small">
          {{ batches() }} send{{ batches() === 1 ? '' : 's' }}, {{ total() }} email{{ total() === 1 ? '' : 's' }}
        </span>
        <span class="spacer"></span>
        <button class="ghost small" (click)="goto(page() - 1)" [disabled]="page() <= 1 || loading()">‹ Prev</button>
        <span class="muted small ms-nowrap">Page {{ page() }} of {{ pages() }}</span>
        <button class="ghost small" (click)="goto(page() + 1)" [disabled]="page() >= pages() || loading()">Next ›</button>
      </div>
    }

    <!-- ── Email detail ───────────────────────────────────────── -->
    @if (detailOpen()) {
      <div class="modal-backdrop" (click)="closeDetail()">
        <div class="modal modal-wide ms-modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ detail()?.subject || '(no subject)' }}</h2>
            <button class="ghost" (click)="closeDetail()">✕</button>
          </div>
          <div class="modal-body">
            @if (detailLoading()) {
              <p class="muted small">Loading…</p>
            } @else if (detail(); as d) {
              <div class="ms-meta">
                <div><span class="ms-meta-l">To</span><span>{{ d.name || d.email }} &lt;{{ d.email }}&gt;</span></div>
                <div><span class="ms-meta-l">Sent</span><span>{{ fmtDate(d.created_at) }} · {{ d.sent_by || 'System' }}</span></div>
                <div>
                  <span class="ms-meta-l">Delivery</span>
                  <span>
                    <span class="badge" [class.success]="d.status === 'sent'" [class.warning]="d.status === 'failed'">{{ d.status === 'sent' ? 'delivered' : d.status }}</span>
                    @if (d.error) { <span class="ms-error"> {{ d.error }}</span> }
                  </span>
                </div>
                <div>
                  <span class="ms-meta-l">Outcome</span>
                  <span class="ms-record">
                    <span class="ms-chips">
                      @for (o of outcomes(); track o.key) {
                        <button type="button" class="badge ms-chip" [attr.data-outcome]="o.key"
                                [class.is-on]="d.outcome === o.key" [disabled]="saving()"
                                (click)="setOutcome(d, o.key)">{{ o.label }}</button>
                      }
                    </span>
                    @if (d.outcome_at) { <span class="muted small ms-nowrap">set {{ fmtDate(d.outcome_at) }}</span> }
                  </span>
                </div>
                <div>
                  <span class="ms-meta-l">Record</span>
                  <span class="ms-record">
                    <span class="ms-kind" [attr.data-kind]="d.entity_type">{{ d.entity_type === 'manual' ? 'one-off' : d.entity_type }}</span>
                    @if (d.entity_id) {
                      <button class="ghost small" [routerLink]="recordLink(d)" (click)="closeDetail()">Open {{ d.entity_type }} profile →</button>
                    } @else if (d.entity_type === 'manual') {
                      <span class="muted small">typed in by hand, no CRM record</span>
                    } @else {
                      <span class="muted small">no longer on file</span>
                    }
                  </span>
                </div>
                <div>
                  <span class="ms-meta-l">Send</span>
                  <span class="muted small">
                    #{{ d.send_id }} · {{ d.sent_count }} delivered, {{ d.failed_count }} failed, {{ d.skipped_count }} skipped of {{ d.total }}
                    · {{ d.audience }}@if (d.industry) { · {{ d.industry }} }
                    @if (d.follow_up_of_recipient_id) { · <span class="ms-fu-pill">↩ this is a follow-up</span> }
                    @if (d.follow_ups) { · {{ d.follow_ups }} follow-up{{ d.follow_ups === 1 ? '' : 's' }} sent }
                  </span>
                </div>
              </div>

              <p class="muted small ms-note">
                @if (d.is_rendered) { The copy this recipient received. }
                @else { Shown as authored. Placeholders were filled in for this recipient at send time. }
              </p>
              <div class="ms-html" [innerHTML]="d.body_html || ''"></div>
            }
          </div>
          <div class="modal-foot">
            @if (detail(); as d) {
              @if (d.status !== 'skipped' && (d.entity_id || d.entity_type === 'manual')) {
                <button class="primary" (click)="followUpOne(d)">Send follow-up</button>
              }
            }
            <span class="spacer"></span>
            <button class="ghost" (click)="closeDetail()">Close</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); flex-wrap: nowrap; }
    .toolbar h1 { margin: 0; font-size: 22px; white-space: nowrap; }
    .spacer { flex: 1; }
    .toolbar button { white-space: nowrap; }
    /* The global 'input, select { width: 100% }' would wrap the toolbar row. */
    .ms-search { width: 240px; }
    .ms-pick { width: 160px; }
    .ms-pick-sm { width: 140px; }

    .ms-sub { padding: 0 20px; margin: 10px 0 0; }
    .ms-err { margin: 12px 20px; }

    .ms-stats { display: flex; gap: 12px; padding: 14px 20px 0; flex-wrap: wrap; }
    .ms-stat {
      display: flex; align-items: baseline; gap: 6px;
      padding: 8px 14px; border: 1px solid var(--line); border-radius: var(--radius-sm);
      background: var(--bg-2); white-space: nowrap;
    }
    .ms-stat-n { font-size: 18px; font-weight: 600; }
    .ms-stat-l { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
    .ms-stat.ok .ms-stat-n { color: var(--success); }
    .ms-stat.bad .ms-stat-n { color: var(--danger); }
    .ms-stat.gold .ms-stat-n { color: var(--primary); }

    .ms-bulk {
      display: flex; align-items: center; gap: 10px; flex-wrap: nowrap;
      margin: 14px 20px 0; padding: 8px 14px;
      border: 1px solid var(--primary); border-radius: var(--radius-sm); background: var(--bg-2);
    }
    .ms-bulk button, .ms-bulk strong { white-space: nowrap; }
    .ms-bulk-sep { width: 1px; height: 22px; background: var(--line); }

    /* Global CSS stretches bare checkboxes to width: 100%. */
    .ms-check { width: 16px; height: 16px; flex: 0 0 16px; padding: 0; margin: 0; cursor: pointer; }

    .ms-groups { display: flex; flex-direction: column; gap: 10px; padding: 14px 20px 0; }
    .ms-group { border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg-2); overflow: hidden; }
    .ms-ghead { display: flex; align-items: center; gap: 12px; padding: 10px 14px; cursor: pointer; }
    .ms-ghead:hover { background: var(--bg-3); }
    .ms-caret { display: inline-block; width: 12px; color: var(--muted); transition: transform .15s; font-size: 18px; line-height: 1; }
    .ms-group.open .ms-caret { transform: rotate(90deg); }
    .ms-gmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .ms-gtitle { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .ms-gtitle strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ms-gsub { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ms-gcounts { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
    .ms-ghead button { white-space: nowrap; }
    .ms-fu-pill {
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      padding: 1px 6px; border-radius: 4px; border: 1px solid var(--primary); color: var(--primary); white-space: nowrap;
    }
    .ms-fu-count { font-size: 11px; color: var(--primary); margin-left: 6px; white-space: nowrap; }

    .ms-table { margin: 0; border-top: 1px solid var(--line); }
    .ms-col-check { width: 32px; }
    .ms-col-kind { width: 110px; }
    .ms-col-outcome { width: 170px; }
    .ms-outcome-cell { cursor: default; }
    .ms-chips { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; }
    /* A badge that is also a button. Each outcome owns a colour (--oc):
       outlined in that colour while idle, filled with it once chosen, so a
       set of chips reads as a radio group with exactly one lit. */
    button.ms-chip {
      --oc: var(--muted);
      cursor: pointer; font: inherit; font-size: 11px; line-height: 1.4;
      padding: 2px 8px; margin: 0; white-space: nowrap;
      color: var(--oc); border-color: var(--oc); background: transparent;
    }
    button.ms-chip:hover:not(:disabled) { box-shadow: 0 0 0 1px var(--oc); }
    button.ms-chip:disabled { opacity: 0.5; cursor: wait; }
    button.ms-chip.is-on { background: var(--oc); color: #14130f; font-weight: 600; }
    button.ms-chip[data-outcome="replied"]        { --oc: var(--success); }
    button.ms-chip[data-outcome="interested"]     { --oc: var(--primary); }
    button.ms-chip[data-outcome="meeting_booked"] { --oc: #3b82f6; }
    button.ms-chip[data-outcome="followed_up"]    { --oc: #a78bfa; }
    button.ms-chip[data-outcome="bounced"]        { --oc: var(--warning); }
    button.ms-chip[data-outcome="not_interested"] { --oc: var(--danger); }
    button.ms-chip[data-outcome="no_response"]    { --oc: var(--muted); }
    /* Row badge with nothing set yet: a dashed invitation, never filled. */
    button.ms-current[data-outcome="unset"] { border-style: dashed; }
    .ms-col-status { width: 100px; }
    .ms-col-act { width: 130px; text-align: right; }
    .ms-col-act button { white-space: nowrap; }
    .ms-nowrap { white-space: nowrap; }
    .ms-to { display: flex; flex-direction: column; min-width: 0; }
    .ms-to span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    tr.is-failed td:first-child { box-shadow: inset 3px 0 0 var(--danger); }

    .ms-kind {
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      padding: 1px 6px; border-radius: 4px; border: 1px solid; white-space: nowrap;
    }
    .ms-kind[data-kind="lead"]   { color: var(--primary); border-color: var(--primary); }
    .ms-kind[data-kind="client"] { color: var(--success); border-color: var(--success); }
    .ms-kind[data-kind="manual"] { color: var(--muted); border-color: var(--muted); }

    .ms-pager { display: flex; align-items: center; gap: 10px; padding: 12px 20px 20px; }
    .ms-pager button { white-space: nowrap; }

    .ms-modal .modal-body { overflow-y: auto; padding: 16px 18px; }
    .ms-modal .modal-foot { display: flex; align-items: center; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--line); }
    .ms-modal .modal-foot button { white-space: nowrap; }
    .ms-meta { display: grid; grid-template-columns: 90px 1fr; row-gap: 8px; column-gap: 12px; font-size: 13px; }
    .ms-meta > div { display: contents; }
    .ms-meta-l { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); align-self: center; }
    .ms-record { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .ms-record button { white-space: nowrap; }
    .ms-error { color: var(--danger); font-size: 12px; }
    .ms-note { margin: 14px 0 6px; }
    .ms-html { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 12px; font-size: 13px; white-space: pre-wrap; word-break: break-word; }
  `],
})
export class MailerSent {
  private api = inject(Api);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  readonly q = signal('');
  readonly status = signal<'' | 'sent' | 'failed' | 'skipped'>('');
  readonly kind = signal<'' | 'lead' | 'client'>('');
  readonly outcome = signal('');
  readonly page = signal(1);
  readonly pages = signal(1);
  readonly total = signal(0);
  readonly batches = signal(0);
  readonly summary = signal<{ sent: number; failed: number; skipped: number; positive: number }>({ sent: 0, failed: 0, skipped: 0, positive: 0 });
  readonly groups = signal<MailerSentGroup[]>([]);
  readonly outcomes = signal<MailerOutcome[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  /** Expanded groups (send ids). Replaced, never mutated - zoneless. */
  readonly open_ = signal<Set<number>>(new Set());
  /** Ticked emails (recipient row ids), across groups and pages. */
  readonly selected = signal<Set<number>>(new Set());
  readonly selectedCount = computed(() => this.selected().size);
  /** Email whose inline outcome chips are open (recipient row id). */
  readonly pickerFor = signal<number | null>(null);

  readonly detailOpen = signal(false);
  readonly detailLoading = signal(false);
  readonly detail = signal<MailerSentEmailDetail | null>(null);

  readonly hasFilter = computed(() =>
    this.q().trim() !== '' || this.status() !== '' || this.kind() !== '' || this.outcome() !== '');

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Deep links from the overview (?outcome=none, ?status=failed, ?q=subject).
    const qp = this.route.snapshot.queryParamMap;
    const st = qp.get('status'), kd = qp.get('kind');
    if (qp.get('q')) this.q.set(qp.get('q')!);
    if (st === 'sent' || st === 'failed' || st === 'skipped') this.status.set(st);
    if (kd === 'lead' || kd === 'client') this.kind.set(kd);
    if (qp.get('outcome')) this.outcome.set(qp.get('outcome')!);
    this.api.mailerOutcomes().subscribe({ next: r => this.outcomes.set(r.outcomes || []) });
    this.load();
  }

  /** Debounced: typing in the search box should not fire a request per keystroke. */
  search() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => { this.page.set(1); this.load(); }, 250);
  }

  goto(p: number) {
    if (p < 1 || p > this.pages()) return;
    this.page.set(p);
    this.load();
  }

  load() {
    this.loading.set(true);
    this.error.set(null);
    this.api.listMailerSent({
      q: this.q().trim() || undefined,
      status: this.status() || undefined,
      kind: this.kind() || undefined,
      outcome: this.outcome() || undefined,
      page: this.page(),
    }).subscribe({
      next: r => {
        const gs = r.groups || [];
        this.groups.set(gs);
        this.total.set(r.total || 0);
        this.batches.set(r.batches || 0);
        this.page.set(r.page || 1);
        this.pages.set(r.pages || 1);
        this.summary.set(r.summary || { sent: 0, failed: 0, skipped: 0, positive: 0 });
        // A search is looking for specific emails, so show them; otherwise
        // open just the newest send and leave the rest folded.
        if (this.hasFilter()) this.open_.set(new Set(gs.map(g => g.id)));
        else if (!this.open_().size && gs.length) this.open_.set(new Set([gs[0].id]));
        this.loading.set(false);
      },
      error: e => {
        this.error.set(e?.error?.error || 'Failed to load sent emails.');
        this.loading.set(false);
      },
    });
  }

  // ── Groups ──────────────────────────────────────────────────────
  isOpen(id: number) { return this.open_().has(id); }
  toggleOpen(id: number) {
    const next = new Set(this.open_());
    next.has(id) ? next.delete(id) : next.add(id);
    this.open_.set(next);
  }

  /** Emails in a group that can be followed up: anything actually attempted
   *  whose record still exists. Skipped rows were unsubscribed. */
  deliverable(g: MailerSentGroup): MailerSentEmail[] {
    return g.emails.filter(e => e.status !== 'skipped' && (!!e.entity_id || e.entity_type === 'manual'));
  }

  // ── Selection ───────────────────────────────────────────────────
  isSelected(id: number) { return this.selected().has(id); }
  toggleOne(id: number, ev: Event) {
    const on = (ev.target as HTMLInputElement).checked;
    const next = new Set(this.selected());
    on ? next.add(id) : next.delete(id);
    this.selected.set(next);
  }
  groupAllSelected(g: MailerSentGroup): boolean {
    const d = this.deliverable(g);
    return d.length > 0 && d.every(e => this.selected().has(e.id));
  }
  groupSomeSelected(g: MailerSentGroup): boolean {
    const d = this.deliverable(g);
    const n = d.filter(e => this.selected().has(e.id)).length;
    return n > 0 && n < d.length;
  }
  toggleGroup(g: MailerSentGroup, ev: Event) {
    const on = (ev.target as HTMLInputElement).checked;
    const next = new Set(this.selected());
    for (const e of this.deliverable(g)) { on ? next.add(e.id) : next.delete(e.id); }
    this.selected.set(next);
    if (on && !this.isOpen(g.id)) this.toggleOpen(g.id);
  }
  clearSelection() { this.selected.set(new Set()); }

  // ── Follow-ups ──────────────────────────────────────────────────
  /** Hand the picked log rows to the composer; it loads them back through
   *  /api/mailer/followup so nothing about the recipients comes from here. */
  private composeFollowUp(ids: number[]) {
    if (!ids.length) return;
    this.router.navigate(['/admin/mailer/compose'], { queryParams: { followup: ids.join(',') } });
  }
  followUpSelected() { this.composeFollowUp([...this.selected()]); }
  followUpGroup(g: MailerSentGroup, ev: Event) {
    ev.stopPropagation();
    this.composeFollowUp(this.deliverable(g).map(e => e.id));
  }
  followUpOne(d: MailerSentEmailDetail) {
    this.closeDetail();
    this.composeFollowUp([d.id]);
  }

  // ── Outcomes ────────────────────────────────────────────────────
  outcomeLabel(key: string | null): string {
    if (!key) return '';
    return this.outcomes().find(o => o.key === key)?.label ?? key;
  }
  isPositive(key: string | null): boolean {
    return key === 'replied' || key === 'interested' || key === 'meeting_booked';
  }
  togglePicker(id: number) {
    this.pickerFor.set(this.pickerFor() === id ? null : id);
  }

  /** Save an outcome the moment a chip is clicked, for one email. Patches
   *  the row (and the open modal) in place so nothing has to reload. */
  setOutcome(e: { id: number; outcome: string | null }, outcome: string | null) {
    this.pickerFor.set(null);
    if (e.outcome === outcome) return;
    this.saving.set(true);
    this.api.setMailerOutcome([e.id], outcome).subscribe({
      next: () => {
        this.saving.set(false);
        this.patchOutcome(new Set([e.id]), outcome);
      },
      error: err => { this.saving.set(false); this.error.set(err?.error?.error || 'Could not set the outcome.'); },
    });
  }

  /** Same, for every ticked email. */
  setBulkOutcome(outcome: string | null) {
    const ids = [...this.selected()];
    if (!ids.length) return;
    this.saving.set(true);
    this.api.setMailerOutcome(ids, outcome).subscribe({
      next: () => {
        this.saving.set(false);
        this.patchOutcome(new Set(ids), outcome);
        // Refresh the tiles + any outcome filter; keeps the selection so a
        // second click (e.g. follow-up) still has it.
        this.load();
      },
      error: err => { this.saving.set(false); this.error.set(err?.error?.error || 'Could not set the outcome.'); },
    });
  }

  private patchOutcome(ids: Set<number>, outcome: string | null) {
    const at = outcome ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null;
    this.groups.set(this.groups().map(g => ({
      ...g, emails: g.emails.map(e => ids.has(e.id) ? { ...e, outcome, outcome_at: at } : e),
    })));
    const d = this.detail();
    if (d && ids.has(d.id)) this.detail.set({ ...d, outcome, outcome_at: at });
  }

  // ── Detail ──────────────────────────────────────────────────────
  open(e: MailerSentEmail) {
    this.detailOpen.set(true);
    this.detailLoading.set(true);
    this.detail.set(null);
    this.api.getMailerSentEmail(e.id).subscribe({
      next: r => {
        this.detail.set(r.email);
        this.detailLoading.set(false);
      },
      error: err => {
        this.detailLoading.set(false);
        this.detailOpen.set(false);
        this.error.set(err?.error?.error || 'Could not load that email.');
      },
    });
  }

  closeDetail() {
    this.detailOpen.set(false);
    this.detail.set(null);
  }

  recordLink(d: { entity_type: string; entity_id: number | null }): string[] {
    return [d.entity_type === 'client' ? '/admin/clients' : '/admin/leads', String(d.entity_id)];
  }

  fmtDate(s: string | null | undefined): string {
    if (!s) return '—';
    const d = new Date(s.replace(' ', 'T'));
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
}

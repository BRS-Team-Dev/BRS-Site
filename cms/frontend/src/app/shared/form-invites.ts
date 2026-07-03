import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { DialogService } from '../core/dialog';
import { Client, FormInvite, Lead } from '../core/models';

/**
 * Reusable invitations panel for any form (standard or multipart).
 * Backed by the same `onboarding_clients` table + client_token pattern
 * the multipart flow already uses — no new invite mechanism.
 *
 * Usage:
 *   <app-form-invites [formId]="formId" [formSlug]="slug" />
 */

@Component({
  selector: 'app-form-invites',
  imports: [FormsModule],
  template: `
    <div class="invite-panel">
      <div class="invite-toolbar">
        <button class="primary small" (click)="openAdd()">+ Invite a client</button>
        <button class="ghost small" (click)="openAdd('lead')">+ Invite a lead</button>
      </div>

      @if (loading()) {
        <p class="muted small">Loading…</p>
      } @else if (invites().length === 0) {
        <p class="muted small">No invitations yet. Invite a client or lead to send them a personalised URL.</p>
      } @else {
        <ul class="invite-list">
          @for (i of invites(); track i.id) {
            <li class="invite-row">
              <div class="row-head">
                <strong class="recipient">{{ recipientName(i) }}</strong>
                <span class="row-pills">
                  @if (i.parent_client_id) { <span class="kind-pill client">Client</span> }
                  @else if (i.parent_lead_id) { <span class="kind-pill lead">Lead</span> }
                  @else { <span class="kind-pill">Email</span> }
                  @if (i.status === 'submitted') {
                    <span class="status-pill done">Submitted</span>
                  } @else {
                    <span class="status-pill pending">Pending</span>
                  }
                </span>
              </div>
              <div class="row-email">{{ i.client_email }}</div>
              <div class="row-foot">
                <span class="row-when">{{ fmtDate(i.started_at) }}</span>
                <span class="spacer"></span>
                <button type="button" class="ghost small copy-btn" (click)="copy(i.url)">Copy URL</button>
                <button type="button" class="ghost icon-btn danger" (click)="del(i)" title="Revoke invite">✕</button>
              </div>
            </li>
          }
        </ul>
      }
    </div>

    @if (addOpen()) {
      <div class="modal-backdrop" (click)="closeAdd()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>Invite a {{ addKind }}</h2>
            <button class="ghost icon-btn" (click)="closeAdd()">✕</button>
          </div>
          <div class="modal-body">
            @if (addError()) { <p class="error-msg">{{ addError() }}</p> }

            <label>{{ addKind === 'client' ? 'Client' : 'Lead' }}</label>
            <select [(ngModel)]="addTargetId" name="target_id">
              <option [ngValue]="null">— pick one —</option>
              @if (addKind === 'client') {
                @for (c of clients(); track c.id) {
                  <option [ngValue]="c.id">{{ c.name }}{{ c.email ? ' <' + c.email + '>' : '' }}</option>
                }
              } @else {
                @for (l of leads(); track l.id) {
                  <option [ngValue]="l.id">{{ l.name }}{{ l.email ? ' <' + l.email + '>' : '' }}</option>
                }
              }
            </select>

            <label>Email override (optional)</label>
            <input [(ngModel)]="addEmail" name="email"
                   placeholder="Falls back to the record's email if empty" />

            <p class="muted small">
              A unique tokenised URL is created. When they submit, the
              record auto-attaches — same mechanism as multipart onboarding.
            </p>
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="closeAdd()">Cancel</button>
            <button class="primary" (click)="save()" [disabled]="!addTargetId || saving()">
              {{ saving() ? 'Sending…' : 'Create invite' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .invite-panel {
      border: 1px solid var(--line); border-radius: var(--radius);
      background: var(--bg-2); padding: 12px 14px; margin-top: 6px;
      min-width: 0;
    }
    .invite-toolbar { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
    .invite-toolbar button { flex-shrink: 0; }

    /* Stacked cards - render one invite per card instead of a table so
       the panel fits inside the 380px meta column without overflowing. */
    .invite-list { list-style: none; padding: 0; margin: 0;
      display: flex; flex-direction: column; gap: 8px; }
    .invite-row {
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 8px 10px;
      display: flex; flex-direction: column; gap: 4px;
      min-width: 0;
    }
    .row-head {
      display: flex; align-items: center; gap: 8px;
      flex-wrap: wrap; min-width: 0;
    }
    .recipient {
      flex: 1; min-width: 0;
      font-size: 13px; color: var(--fg);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .row-pills { display: inline-flex; gap: 6px; flex-shrink: 0; }
    .row-email {
      font-size: 12px; color: var(--muted);
      overflow-wrap: break-word; word-break: break-word;
      font-family: "JetBrains Mono", ui-monospace, monospace;
    }
    .row-foot {
      display: flex; align-items: center; gap: 6px;
      margin-top: 2px; flex-wrap: wrap;
    }
    .row-when {
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 11px; color: var(--muted); white-space: nowrap;
    }
    .row-foot .spacer { flex: 1; }
    .copy-btn { flex-shrink: 0; white-space: nowrap; }

    .kind-pill, .status-pill {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 10px; font-weight: 700; letter-spacing: 0.4px;
      text-transform: uppercase; white-space: nowrap;
      background: var(--bg-2); color: var(--muted);
    }
    .kind-pill.client { background: color-mix(in oklab, var(--primary), transparent 78%); color: var(--primary); }
    .kind-pill.lead   { background: color-mix(in oklab, var(--warning), transparent 78%); color: var(--warning); }
    .status-pill.done    { background: color-mix(in oklab, var(--success), transparent 78%); color: var(--success); }
    .status-pill.pending { background: var(--bg-2); color: var(--muted); }
    .icon-btn { width: 28px; height: 28px; padding: 0; flex-shrink: 0;
      display: inline-flex; align-items: center; justify-content: center; }
    .icon-btn.danger:hover { color: var(--danger); border-color: var(--danger); }
  `],
})
export class FormInvites {
  private api = inject(Api);
  private dialog = inject(DialogService);

  formId   = input.required<number>();
  formSlug = input<string>('');

  invites = signal<FormInvite[]>([]);
  loading = signal(true);
  clients = signal<Client[]>([]);
  leads   = signal<Lead[]>([]);

  addOpen    = signal(false);
  saving     = signal(false);
  addError   = signal<string | null>(null);
  addKind: 'client' | 'lead' = 'client';
  addTargetId: number | null = null;
  addEmail = '';

  ngOnInit() {
    this.load();
    this.api.listClients().subscribe(r => this.clients.set(r.clients));
    this.api.listLeads().subscribe(r => this.leads.set(r.leads));
  }

  private load() {
    this.loading.set(true);
    this.api.listFormInvites(this.formId()).subscribe({
      next: r => { this.invites.set(r.invites ?? []); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  recipientName(i: FormInvite): string {
    return i.client_name_resolved || i.lead_name_resolved || i.client_name || i.client_email;
  }

  openAdd(kind: 'client' | 'lead' = 'client') {
    this.addKind = kind;
    this.addTargetId = null;
    this.addEmail = '';
    this.addError.set(null);
    this.addOpen.set(true);
  }
  closeAdd() { this.addOpen.set(false); }

  save() {
    if (!this.addTargetId) return;
    this.saving.set(true);
    this.addError.set(null);
    const payload: any = { client_email: this.addEmail || undefined };
    if (this.addKind === 'client') payload.parent_client_id = this.addTargetId;
    else                            payload.parent_lead_id   = this.addTargetId;

    this.api.createFormInvite(this.formId(), payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.addOpen.set(false);
        this.load();
      },
      error: e => {
        this.saving.set(false);
        this.addError.set(e?.error?.error || 'Could not create invite');
      },
    });
  }

  copy(url: string) {
    navigator.clipboard?.writeText(url).then(
      () => this.dialog.alert('Invite URL copied to clipboard.', { title: 'Copied', variant: 'success' }),
      () => this.dialog.alert('Could not copy — select the URL and copy manually.', { title: 'Copy failed', variant: 'warning' }),
    );
  }

  async del(i: FormInvite) {
    const ok = await this.dialog.confirm(
      `Revoke invite for ${this.recipientName(i)}? Their existing URL will stop working.`,
      { title: 'Revoke invite', confirmLabel: 'Revoke', variant: 'danger' }
    );
    if (!ok) return;
    this.api.deleteFormInvite(this.formId(), i.id).subscribe(() => this.load());
  }

  fmtDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString();
  }
}

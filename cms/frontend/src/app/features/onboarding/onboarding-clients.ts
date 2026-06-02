import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Client, FormDef, FormSection, OnboardingClient } from '../../core/models';
import { ComboBox, ComboOption } from '../../shared/combo-box';

@Component({
  selector: 'app-onboarding-clients',
  imports: [RouterLink, FormsModule, ComboBox],
  template: `
    @if (mode() === 'all') {
      <div class="toolbar breadcrumb-bar">
        <a routerLink="/admin/onboarding" class="crumb">Onboarding</a>
        <span class="sep">›</span>
        <h1>Clients</h1>
        <span class="spacer"></span>
        <span class="muted small">{{ allClients().length }} client(s) across all templates</span>
        <button class="primary" (click)="toggleInvite()" [disabled]="templates().length === 0">
          {{ showInvite() ? '× Cancel' : '+ Invite client' }}
        </button>
      </div>

      @if (showInvite()) {
        <div class="invite-card card">
          <div class="invite-row">
            <select [(ngModel)]="inviteFormId" name="if" class="invite-template">
              <option [ngValue]="null">— pick a template —</option>
              @for (t of templates(); track t.id) {
                <option [ngValue]="t.id">{{ t.title }}</option>
              }
            </select>
            <app-combo-box
              class="invite-combo"
              [items]="clientOptions()"
              [selectedValue]="inviteEmail || null"
              [allowCustom]="true"
              [customLabel]="inviteEmail || null"
              name="ie"
              placeholder="Search clients or type a new email"
              (valueChange)="onEmailChange($event)" />
            <button class="primary" (click)="inviteFromAll()" [disabled]="inviting()">
              {{ inviting() ? 'Creating…' : 'Generate link' }}
            </button>
            <button (click)="inviteAndOpenFromAll()" [disabled]="inviting()" title="Create the client and open the portal in a new tab so you can fill it in on their behalf">
              Open & fill in
            </button>
          </div>

          @if (inviteError()) { <div class="error-msg">{{ inviteError() }}</div> }
          @if (lastInvited()) {
            <div class="success-msg">
              ✓ Invitation created. Share this link:
              <pre class="code-block">{{ lastInvited()!.url }}</pre>
              <button class="ghost" (click)="copyText(lastInvited()!.url)">{{ copied() ? '✓ Copied' : 'Copy link' }}</button>
            </div>
          }
        </div>
      }

      @if (allClients().length === 0) {
        <div class="empty">
          @if (templates().length === 0) {
            <p class="muted">No onboarding templates yet. Create one first.</p>
            <button class="primary" routerLink="/admin/onboarding">Go to templates</button>
          } @else {
            <p class="muted">No clients yet.</p>
            <button class="primary" (click)="showInvite.set(true)">Invite your first client</button>
          }
        </div>
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th>Client</th><th>Template</th><th>Progress</th><th>Status</th><th>Started</th><th></th>
            </tr></thead>
            <tbody>
              @for (c of allClients(); track c.id) {
                <tr (click)="openClient(c)">
                  <td>
                    <strong>{{ c.client_name || c.client_email }}</strong>
                    @if (c.client_name) { <div class="muted small">{{ c.client_email }}</div> }
                  </td>
                  <td>{{ c.form_title }}</td>
                  <td>
                    <div class="progress-bar"><div class="bar" [style.width.%]="progressPct(c)"></div></div>
                    <span class="muted small">{{ progressPct(c) }}%</span>
                  </td>
                  <td>{{ statusLabel(c) }}</td>
                  <td class="muted small">{{ c.started_at }}</td>
                  <td class="actions">
                    <button class="ghost icon-btn" (click)="copyUrl(c, $event)" title="Copy invite link">⎘</button>
                    <button class="ghost icon-btn danger" (click)="del(c, $event)" title="Delete" aria-label="Delete client">✕</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }

    @if (mode() === 'form') {
      <div class="toolbar breadcrumb-bar">
        <a routerLink="/admin/onboarding" class="crumb">Onboarding</a>
        <span class="sep">›</span>
        <h1>{{ form()?.title }}</h1>
        <span class="spacer"></span>
        <button class="primary" (click)="toggleInvite()" [disabled]="hasParentProcess() && parentForm()?.title === undefined">
          {{ showInvite() ? '× Cancel' : (hasParentProcess() ? '+ Add ' + (parentForm()?.title || '') : '+ Invite client') }}
        </button>
      </div>

      @if (showInvite()) {
        <div class="invite-card card">
          @if (hasParentProcess()) {
            <h3>Add from {{ parentForm()?.title || 'parent process' }}</h3>
            <label>Pick a qualified {{ parentForm()?.title || 'client' }}</label>
            <select [(ngModel)]="addParentClientId" name="apc">
              <option [ngValue]="null">— pick one —</option>
              @for (pc of parentQualified(); track pc.id) {
                <option [ngValue]="pc.id">{{ pc.client_name || pc.client_email }} ({{ pc.client_email }})</option>
              }
            </select>
            @if (parentQualified().length === 0) {
              <div class="muted small" style="margin-top: 8px;">
                No qualified entries in {{ parentForm()?.title }} yet. Qualify one there first.
              </div>
            }
            <div class="row" style="margin-top: 12px;">
              <button class="primary" (click)="invite()" [disabled]="inviting() || !addParentClientId">
                {{ inviting() ? 'Creating…' : 'Add' }}
              </button>
              <button (click)="inviteAndOpen()" [disabled]="inviting() || !addParentClientId" title="Create the entry and open the portal in a new tab so you can fill it in on their behalf">
                Open & fill in
              </button>
            </div>
          } @else {
            <div class="invite-row">
              <app-combo-box
                class="invite-combo"
                [items]="clientOptions()"
                [selectedValue]="inviteEmail || null"
                [allowCustom]="true"
                [customLabel]="inviteEmail || null"
                name="ie"
                placeholder="Search clients or type a new email"
                (valueChange)="onEmailChange($event)" />
              <button class="primary" (click)="invite()" [disabled]="inviting()">
                {{ inviting() ? 'Creating…' : 'Generate link' }}
              </button>
              <button (click)="inviteAndOpen()" [disabled]="inviting()" title="Create the entry and open the portal in a new tab so you can fill it in on their behalf">
                Open & fill in
              </button>
            </div>
          }
          @if (inviteError()) { <div class="error-msg">{{ inviteError() }}</div> }
          @if (lastInvited()) {
            <div class="success-msg">
              ✓ Created. Share this link:
              <pre class="code-block">{{ lastInvited()!.url }}</pre>
              <button class="ghost" (click)="copyText(lastInvited()!.url)">{{ copied() ? '✓ Copied' : 'Copy link' }}</button>
            </div>
          }
        </div>
      }

      @if (formClients().length === 0) {
        <div class="empty">
          <p class="muted">No clients invited yet.</p>
          <button class="primary" (click)="showInvite.set(true)">Invite your first client</button>
        </div>
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th>Client</th><th>Progress</th><th>Status</th><th>Started</th><th>Last edit</th><th></th>
            </tr></thead>
            <tbody>
              @for (c of formClients(); track c.id) {
                <tr (click)="openClient(c)">
                  <td>
                    <strong>{{ c.client_name || c.client_email }}</strong>
                    @if (c.client_name) { <div class="muted small">{{ c.client_email }}</div> }
                  </td>
                  <td>
                    <div class="progress-bar"><div class="bar" [style.width.%]="progressPct(c)"></div></div>
                    <span class="muted small">{{ progressPct(c) }}%</span>
                  </td>
                  <td>
                    <span [class]="statusBadgeClass(c)">{{ statusLabel(c) }}</span>
                  </td>
                  <td class="muted small">{{ c.started_at }}</td>
                  <td class="muted small">{{ c.last_edited_at || '—' }}</td>
                  <td class="actions">
                    <button class="ghost icon-btn" (click)="copyUrl(c, $event)" title="Copy invite link">⎘</button>
                    <button class="ghost icon-btn" (click)="del(c, $event)" title="Delete">✕</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }

    @if (mode() === 'detail') {
      <div class="toolbar breadcrumb-bar">
        <a routerLink="/admin/onboarding" class="crumb">Onboarding</a>
        <span class="sep">›</span>
        <a [routerLink]="['/admin/onboarding', formId(), 'clients']" class="crumb">{{ form()?.title }}</a>
        <span class="sep">›</span>
        <h1>{{ client()?.client_name || client()?.client_email }}</h1>
      </div>

      @if (client(); as c) {
        <div class="detail-grid">
          <section class="card">
            <h3>Client</h3>
            <div class="kv"><label>Email</label><div>{{ c.client_email }}</div></div>
            @if (c.client_name) { <div class="kv"><label>Name</label><div>{{ c.client_name }}</div></div> }
            <div class="kv"><label>Started</label><div>{{ c.started_at }}</div></div>
            @if (c.last_edited_at) { <div class="kv"><label>Last edit</label><div>{{ c.last_edited_at }}</div></div> }
            @if (c.submitted_at) {
              <div class="kv"><label>Submitted</label><div>{{ c.submitted_at }}</div></div>
            } @else {
              <div class="kv"><label>Status</label><div>In progress</div></div>
            }
            @if (c.edited_after_submit) {
              <div class="warn-msg">
                <span>⚠ Client edited responses after submission</span>
                <button class="ghost" (click)="acknowledge()">Mark reviewed</button>
              </div>
            }

            <hr />
            <label>Invite link</label>
            <pre class="code-block">{{ c.url }}</pre>
            <button class="ghost" (click)="copyText(c.url || '')">{{ copied() ? '✓ Copied' : 'Copy link' }}</button>

            <hr />
            @if (c.qualified_at) {
              <div class="success-msg" style="margin-bottom: 12px;">
                ✓ Qualified on {{ c.qualified_at }}
              </div>
              <button class="ghost" (click)="qualify(true)">Move back to onboarding</button>
            } @else {
              <button class="primary" (click)="qualify(false)" style="width:100%;">
                ✓ Qualify client
              </button>
              <div class="muted small" style="margin-top: 8px;">
                Moves them out of the onboarding list and into "{{ form()?.main_section_label || form()?.title }}".
              </div>
            }
          </section>

          <section class="card">
            <h3>Responses</h3>
            @if (!submission()) {
              <p class="muted">Client hasn't saved any responses yet.</p>
            } @else {
              @for (s of sections(); track s.id) {
                <div class="section-block">
                  <h4>{{ s.title }}</h4>
                  @for (f of s.fields; track f.id) {
                    <div class="kv">
                      <label>{{ f.label }}</label>
                      <div>{{ formatValue(submission()?.[f.name], f.type) }}</div>
                    </div>
                  }
                </div>
              }
            }
          </section>
        </div>
      }
    }
  `,
  styles: [`
    .progress-bar { width: 120px; height: 6px; background: rgba(255, 255, 255, 0.12); border-radius: 999px; overflow: hidden; display: inline-block; vertical-align: middle; }
    .bar { height: 100%; background: var(--primary); transition: width 0.2s; }
    td.actions { text-align: right; white-space: nowrap; }
    td.actions .icon-btn + .icon-btn { margin-left: 4px; }
    .icon-btn {
      width: 32px; height: 32px; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 15px; line-height: 1;
    }
    .icon-btn:hover { color: var(--primary); border-color: var(--primary); }
    .icon-btn.danger:hover { color: var(--danger); border-color: var(--danger); background: rgba(255,100,100,0.08); }
    .breadcrumb-bar .crumb { color: var(--muted); font-size: 13px; text-decoration: none; }
    .breadcrumb-bar .crumb:hover { color: var(--primary); }
    .breadcrumb-bar .sep { color: var(--muted); font-size: 14px; }
    .breadcrumb-bar h1 { margin: 0; }
    .invite-card { margin: 16px 24px; padding: 20px; }
    .invite-card label { margin-top: 12px; }
    .invite-card .row { gap: 12px; }
    .invite-row { display: flex; align-items: center; gap: 8px; }
    .invite-combo { flex: 1; min-width: 240px; }
    .invite-template { width: auto; min-width: 200px; }
    .detail-grid { display: grid; grid-template-columns: 320px 1fr; gap: 20px; padding: 20px; align-items: start; }
    @media (max-width: 1100px) { .detail-grid { grid-template-columns: 1fr; } }
    .kv { margin-bottom: 10px; }
    .kv label { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
    .kv > div { color: var(--fg); font-size: 14px; word-break: break-word; }
    .section-block { padding: 16px 0; border-bottom: 1px solid var(--line); }
    .section-block:last-child { border-bottom: none; }
    .section-block h4 { margin: 0 0 12px 0; font-size: 14px; color: var(--primary); text-transform: uppercase; letter-spacing: 0.5px; }
    .warn-msg {
      padding: 10px 12px; background: rgba(255, 159, 67, 0.1);
      color: var(--warning); border-radius: var(--radius-sm);
      margin: 12px 0; font-size: 13px;
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
    }
    .warn-msg button { font-size: 12px; padding: 4px 10px; color: var(--warning); border-color: var(--warning); }
    .warn-msg button:hover { background: rgba(255, 159, 67, 0.15); }
    .badge.danger { color: var(--danger); border-color: var(--danger); }
  `],
})
export class OnboardingClients {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  mode = signal<'all' | 'form' | 'detail'>('all');
  formId = signal<number | null>(null);
  clientId = signal<number | null>(null);

  allClients = signal<OnboardingClient[]>([]);
  formClients = signal<OnboardingClient[]>([]);
  totalSections = signal(0);
  form = signal<FormDef | null>(null);
  sections = signal<FormSection[]>([]);
  client = signal<OnboardingClient | null>(null);
  submission = signal<any>(null);

  showInvite = signal(false);
  inviteEmail = '';
  inviteName = '';
  // Canonical clients (clients table) feeding the invite picker. Display
  // shows "Name — Company"; underlying value stays the email so the
  // invite endpoint has what it needs. De-duped by email.
  clientPool = signal<Client[]>([]);
  clientOptions = computed<ComboOption[]>(() => {
    const seen = new Set<string>();
    const opts: ComboOption[] = [];
    for (const c of this.clientPool()) {
      const email = (c.email || '').trim();
      if (!email || seen.has(email.toLowerCase())) continue;
      seen.add(email.toLowerCase());
      const name = c.name?.trim() || email;
      const company = c.company?.trim();
      const label = company ? `${name} — ${company}` : name;
      opts.push({ value: email, label });
    }
    return opts;
  });
  inviteFormId: number | null = null;
  addParentClientId: number | null = null;
  parentForm = signal<FormDef | null>(null);
  parentQualified = signal<OnboardingClient[]>([]);
  hasParentProcess = computed(() => !!this.form()?.parent_process_form_id);
  templates = signal<FormDef[]>([]);
  inviting = signal(false);
  inviteError = signal<string | null>(null);
  lastInvited = signal<{ url: string } | null>(null);
  copied = signal(false);

  ngOnInit() {
    this.route.url.subscribe(() => this.detectMode());
    this.detectMode();
    this.api.listClients().subscribe({
      next: r => this.clientPool.set(r.clients),
      error: () => this.clientPool.set([]),
    });
  }

  onEmailChange(v: string | number | null) {
    this.inviteEmail = (v ?? '').toString();
    // Auto-fill the name field when the user picks an existing client and
    // hasn't already typed a name.
    const match = this.clientPool().find(c => (c.email || '').toLowerCase() === this.inviteEmail.toLowerCase());
    if (match?.name && !this.inviteName.trim()) {
      this.inviteName = match.name;
    }
  }

  private detectMode() {
    const url = this.router.url;
    // Singular /client/:cid → detail; plural /clients (no id) → per-form list
    const detailMatch = url.match(/\/admin\/onboarding\/(\d+)\/client\/(\d+)/);
    if (detailMatch) {
      const fid = +detailMatch[1], cid = +detailMatch[2];
      this.formId.set(fid);
      this.clientId.set(cid);
      this.mode.set('detail');
      this.loadDetail(fid, cid);
      return;
    }
    const listMatch = url.match(/\/admin\/onboarding\/(\d+)\/clients(?:$|\?)/);
    if (listMatch) {
      const fid = +listMatch[1];
      this.formId.set(fid);
      this.mode.set('form');
      this.loadFormClients(fid);
      return;
    }
    this.mode.set('all');
    this.api.listAllOnboardingClients().subscribe(r => this.allClients.set(r.clients));
    this.api.listOnboardingForms().subscribe(r => this.templates.set(r.forms));
  }

  private loadFormClients(formId: number) {
    this.api.getOnboardingForm(formId).subscribe(r => {
      this.form.set(r.form);
      this.totalSections.set(r.sections.length);
      // If this form has a parent process, fetch the parent's metadata + its
      // qualified clients so the "Add" picker has options.
      const parentId = r.form.parent_process_form_id;
      if (parentId) {
        this.api.getOnboardingForm(parentId).subscribe(p => this.parentForm.set(p.form));
        this.api.listOnboardingClients(parentId, true).subscribe(p => this.parentQualified.set(p.clients));
      } else {
        this.parentForm.set(null);
        this.parentQualified.set([]);
      }
    });
    this.api.listOnboardingClients(formId).subscribe(r => {
      this.formClients.set(r.clients);
      this.totalSections.set(r.total_sections);
    });
  }

  private loadDetail(formId: number, clientId: number) {
    this.api.getOnboardingForm(formId).subscribe(r => {
      this.form.set(r.form);
      this.sections.set(r.sections);
    });
    this.api.getOnboardingClient(formId, clientId).subscribe(r => {
      this.client.set(r.client);
      this.submission.set(r.submission);
    });
  }

  /** Build invite payload — parent_client_id when child process, email/name otherwise. */
  private invitePayload(): { client_email?: string; client_name?: string; parent_client_id?: number } | null {
    if (this.hasParentProcess()) {
      if (!this.addParentClientId) { this.inviteError.set(`Pick a ${this.parentForm()?.title || 'parent'} entry`); return null; }
      return { parent_client_id: this.addParentClientId };
    }
    if (!this.inviteEmail) { this.inviteError.set('Email is required'); return null; }
    return { client_email: this.inviteEmail, client_name: this.inviteName || undefined };
  }

  invite() {
    this.inviteError.set(null);
    this.lastInvited.set(null);
    const payload = this.invitePayload();
    if (!payload) return;
    this.inviting.set(true);
    this.api.inviteOnboardingClient(this.formId()!, payload).subscribe({
      next: r => {
        this.inviting.set(false);
        this.lastInvited.set({ url: r.url });
        this.inviteEmail = '';
        this.inviteName = '';
        this.addParentClientId = null;
        this.loadFormClients(this.formId()!);
      },
      error: e => {
        this.inviting.set(false);
        this.inviteError.set(e?.error?.error || 'Failed to invite');
      },
    });
  }
  inviteAndOpen() {
    this.inviteError.set(null);
    this.lastInvited.set(null);
    const payload = this.invitePayload();
    if (!payload) return;
    this.inviting.set(true);
    this.api.inviteOnboardingClient(this.formId()!, payload).subscribe({
      next: r => {
        this.inviting.set(false);
        this.inviteEmail = '';
        this.inviteName = '';
        this.addParentClientId = null;
        this.loadFormClients(this.formId()!);
        window.open(r.url, '_blank');
        this.closeInvite();
      },
      error: e => {
        this.inviting.set(false);
        this.inviteError.set(e?.error?.error || 'Failed to invite');
      },
    });
  }
  closeInvite() {
    this.showInvite.set(false);
    this.lastInvited.set(null);
    this.inviteError.set(null);
    this.addParentClientId = null;
  }
  toggleInvite() {
    if (this.showInvite()) this.closeInvite();
    else this.showInvite.set(true);
  }

  inviteFromAll() {
    this.inviteError.set(null);
    this.lastInvited.set(null);
    if (!this.inviteFormId) { this.inviteError.set('Pick a template'); return; }
    if (!this.inviteEmail) { this.inviteError.set('Email is required'); return; }
    this.inviting.set(true);
    this.api.inviteOnboardingClient(this.inviteFormId, {
      client_email: this.inviteEmail,
      client_name: this.inviteName || undefined,
    }).subscribe({
      next: r => {
        this.inviting.set(false);
        this.lastInvited.set({ url: r.url });
        this.inviteEmail = '';
        this.inviteName = '';
        // Refresh the cross-form list so the new client shows up immediately
        this.api.listAllOnboardingClients().subscribe(res => this.allClients.set(res.clients));
      },
      error: e => {
        this.inviting.set(false);
        this.inviteError.set(e?.error?.error || 'Failed to invite');
      },
    });
  }
  inviteAndOpenFromAll() {
    this.inviteError.set(null);
    this.lastInvited.set(null);
    if (!this.inviteFormId) { this.inviteError.set('Pick a template'); return; }
    if (!this.inviteEmail) { this.inviteError.set('Email is required'); return; }
    this.inviting.set(true);
    this.api.inviteOnboardingClient(this.inviteFormId, {
      client_email: this.inviteEmail,
      client_name: this.inviteName || undefined,
    }).subscribe({
      next: r => {
        this.inviting.set(false);
        this.inviteEmail = '';
        this.inviteName = '';
        this.api.listAllOnboardingClients().subscribe(res => this.allClients.set(res.clients));
        window.open(r.url, '_blank');
        this.closeInvite();
      },
      error: e => {
        this.inviting.set(false);
        this.inviteError.set(e?.error?.error || 'Failed to invite');
      },
    });
  }

  openClient(c: OnboardingClient) {
    this.router.navigate(['/admin/onboarding', c.form_id, 'client', c.id]);
  }
  del(c: OnboardingClient, e: Event) {
    e.stopPropagation();
    if (!confirm(`Delete client ${c.client_email}? This also drops their saved responses.`)) return;
    this.api.deleteOnboardingClient(c.form_id, c.id).subscribe(() => {
      if (this.mode() === 'all') {
        this.api.listAllOnboardingClients().subscribe(r => this.allClients.set(r.clients));
      } else if (this.mode() === 'form' && this.formId()) {
        this.loadFormClients(this.formId()!);
      }
    });
  }

  acknowledge() {
    const c = this.client(); if (!c) return;
    this.api.acknowledgeOnboardingClient(c.form_id, c.id).subscribe(() => {
      this.client.set({ ...c, edited_after_submit: 0 });
    });
  }
  qualify(unqualify: boolean) {
    const c = this.client(); if (!c) return;
    const verb = unqualify ? 'move back to onboarding' : 'qualify';
    if (!confirm(`Are you sure you want to ${verb} this client?`)) return;
    this.api.qualifyOnboardingClient(c.form_id, c.id, unqualify).subscribe(() => {
      if (unqualify) {
        this.client.set({ ...c, qualified_at: null });
      } else {
        // Client moved out of onboarding — switch to the main-section detail page.
        this.router.navigate(['/admin/main', c.form_id, 'client', c.id]);
      }
    });
  }

  copyUrl(c: OnboardingClient, e: Event) {
    e.stopPropagation();
    const base = document.baseURI.replace(/\/$/, '');
    const url = c.url || `${base}/onboarding/${c.form_id}/${c.client_token}`;
    this.copyText(url);
  }
  copyText(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    });
  }

  progressPct(c: OnboardingClient): number {
    // Prefer required-field progress when the list endpoint provided counts.
    if (typeof c.total_required === 'number' && c.total_required > 0) {
      const filled = c.filled_required ?? 0;
      return Math.round((filled / c.total_required) * 100);
    }
    // Fallback: section-completion ratio (used when the form has no required fields).
    const total = c.total_sections ?? this.totalSections();
    if (!total) return 0;
    let done = 0;
    try {
      const arr = c.completed_sections ? JSON.parse(c.completed_sections) : [];
      if (Array.isArray(arr)) done = arr.length;
    } catch {}
    return Math.round((done / total) * 100);
  }
  statusLabel(c: OnboardingClient): string {
    if (c.edited_after_submit) return 'Edited after submit';
    if (c.submitted_at) return 'Submitted';
    if (c.last_edited_at) return 'In progress';
    return 'Not started';
  }
  statusBadgeClass(c: OnboardingClient): string {
    if (c.edited_after_submit) return 'badge warning';
    if (c.submitted_at) return 'badge success';
    if (c.last_edited_at) return 'badge';
    return 'badge';
  }

  formatValue(val: any, type: string): string {
    if (val === null || val === undefined || val === '') return '—';
    if (type === 'checkbox' || type === 'multi_file') {
      try { const arr = JSON.parse(val); if (Array.isArray(arr)) return arr.join(', ') || '—'; } catch {}
    }
    return String(val);
  }
}

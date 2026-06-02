import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Client, FormDef, OnboardingClient } from '../../core/models';
import { ComboBox, ComboOption } from '../../shared/combo-box';

@Component({
  selector: 'app-main-section',
  imports: [RouterLink, FormsModule, ComboBox],
  template: `
    <div class="toolbar breadcrumb-bar">
      <a routerLink="/admin/onboarding" class="crumb">Onboarding</a>
      <span class="sep">›</span>
      <h1>{{ sectionLabel() }}</h1>
      <span class="spacer"></span>
      <span class="muted small">{{ clients().length }} qualified client(s)</span>
      <button class="primary" (click)="toggleInvite()">
        {{ showInvite() ? '× Cancel' : '+ Invite client' }}
      </button>
    </div>

    @if (showInvite()) {
      <div class="invite-card card">
        <div class="invite-row">
          <app-combo-box
            class="invite-combo"
            [items]="qualifiedOptions()"
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

    @if (clients().length === 0 && !showInvite()) {
      <div class="empty">
        <p class="muted">No qualified clients yet for this section.</p>
        <button class="ghost" [routerLink]="['/admin/onboarding', formId(), 'clients']">Go to onboarding clients</button>
      </div>
    } @else if (clients().length > 0) {
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th>Client</th><th>Submitted</th><th>Qualified</th><th></th>
          </tr></thead>
          <tbody>
            @for (c of clients(); track c.id) {
              <tr (click)="open(c)">
                <td>
                  <strong>{{ c.client_name || c.client_email }}</strong>
                  @if (c.client_name) { <div class="muted small">{{ c.client_email }}</div> }
                </td>
                <td class="muted small">{{ c.submitted_at || '—' }}</td>
                <td class="muted small">{{ c.qualified_at }}</td>
                <td class="actions">
                  <button class="ghost icon-btn" (click)="open(c, $event)" title="View" aria-label="View">→</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: [`
    .breadcrumb-bar .crumb { color: var(--muted); font-size: 13px; text-decoration: none; }
    .breadcrumb-bar .crumb:hover { color: var(--primary); }
    .breadcrumb-bar .sep { color: var(--muted); font-size: 14px; }
    .breadcrumb-bar h1 { margin: 0; }
    td.actions { text-align: right; white-space: nowrap; }
    .icon-btn {
      width: 32px; height: 32px; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 15px; line-height: 1;
    }
    .icon-btn:hover { color: var(--primary); border-color: var(--primary); }

    .invite-card { margin: 16px 24px; }
    .invite-row {
      display: flex; align-items: center; gap: 8px;
    }
    .invite-combo { flex: 1; }
  `],
})
export class MainSection {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  formId = signal<number | null>(null);
  form = signal<FormDef | null>(null);
  clients = signal<OnboardingClient[]>([]);

  // Invite state — mirrors the onboarding-clients pattern.
  showInvite = signal(false);
  inviteEmail = '';
  inviteName = '';
  inviting = signal(false);
  inviteError = signal<string | null>(null);
  lastInvited = signal<{ id: number; token: string; url: string } | null>(null);
  copied = signal(false);

  // Canonical clients (clients table) fed into the email picker. Display
  // shows "Name — Company"; the underlying value stays the email so the
  // invite endpoint has what it needs. De-duped by email.
  clientPool = signal<Client[]>([]);
  qualifiedOptions = computed<ComboOption[]>(() => {
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

  sectionLabel = computed(() => {
    const f = this.form();
    return f?.main_section_label || f?.title || 'Main section';
  });

  ngOnInit() {
    this.route.paramMap.subscribe(p => {
      const id = +p.get('id')!;
      this.formId.set(id);
      this.api.getOnboardingForm(id).subscribe(r => this.form.set(r.form));
      this.refreshClients();
    });
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

  private refreshClients() {
    const id = this.formId();
    if (!id) return;
    this.api.listOnboardingClients(id, true).subscribe(r => this.clients.set(r.clients));
  }

  open(c: OnboardingClient, e?: Event) {
    e?.stopPropagation();
    this.router.navigate(['/admin/main', this.formId(), 'client', c.id]);
  }

  // ----- Invite -----
  toggleInvite() {
    if (this.showInvite()) this.closeInvite();
    else this.showInvite.set(true);
  }
  closeInvite() {
    this.showInvite.set(false);
    this.inviteEmail = '';
    this.inviteName = '';
    this.inviteError.set(null);
    this.lastInvited.set(null);
    this.copied.set(false);
  }

  invite() {
    const id = this.formId();
    if (!id) return;
    const email = this.inviteEmail.trim();
    if (!email) { this.inviteError.set('Email is required'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { this.inviteError.set('Invalid email'); return; }

    this.inviteError.set(null);
    this.inviting.set(true);
    this.api.inviteOnboardingClient(id, {
      client_email: email,
      client_name: this.inviteName.trim() || null,
    } as any).subscribe({
      next: r => {
        this.inviting.set(false);
        this.lastInvited.set({ id: r.id, token: (r as any).token, url: (r as any).url });
        this.refreshClients();
      },
      error: e => {
        this.inviting.set(false);
        this.inviteError.set(e?.error?.error || 'Failed to invite');
      },
    });
  }

  inviteAndOpen() {
    const id = this.formId();
    if (!id) return;
    const email = this.inviteEmail.trim();
    if (!email) { this.inviteError.set('Email is required'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { this.inviteError.set('Invalid email'); return; }

    this.inviteError.set(null);
    this.inviting.set(true);
    this.api.inviteOnboardingClient(id, {
      client_email: email,
      client_name: this.inviteName.trim() || null,
    } as any).subscribe({
      next: r => {
        this.inviting.set(false);
        const url = (r as any).url as string;
        if (url) window.open(url, '_blank');
        this.closeInvite();
        this.refreshClients();
      },
      error: e => {
        this.inviting.set(false);
        this.inviteError.set(e?.error?.error || 'Failed to invite');
      },
    });
  }

  copyText(s: string) {
    navigator.clipboard?.writeText(s || '');
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }
}

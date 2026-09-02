import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '@env/environment';

/**
 * Settings → Bookings tab.
 *
 * Two panels:
 *   1. Default notification recipients — the internal team list emailed
 *      when a booking is scheduled through EITHER the admin CMS or the
 *      public marketing form. Per-booking overrides on the booking
 *      detail overlay take precedence; an empty list here (explicit `[]`)
 *      deliberately suppresses internal emails; unset falls back to
 *      every active admin_user in the tenant.
 *   2. Microsoft Teams integration — Azure app credentials that let
 *      the notifier auto-create a Teams meeting per booking. See
 *      `docs/teams-meeting-setup.md` for the one-time Azure setup.
 *
 * Both panels save via the generic PUT /api/settings endpoint. Secrets
 * (keys ending in `_secret`) come back masked as ●●●●●●●● from GET; the
 * server ignores writes of the masked placeholder so re-saving without
 * retyping the secret is safe.
 */
@Component({
  selector: 'app-settings-bookings',
  imports: [FormsModule],
  template: `
    <section>
      <h2>Bookings</h2>
      <p class="muted small">
        Notification recipients and Microsoft Teams integration for
        consultation-call bookings.
      </p>

      @if (loading()) {
        <p class="muted small">Loading…</p>
      } @else {
        <!-- Panel 1: default recipients -->
        <div class="panel">
          <h3>Default notification recipients</h3>
          <p class="muted small">
            Comma-separated. Every booking (admin OR public) emails this list.
            Leave blank to fall back to every active admin user in the tenant;
            enter a single space and save to <strong>deliberately suppress</strong>
            internal emails (only the client will be emailed).
          </p>
          <input [(ngModel)]="recipients" name="reci"
                 placeholder="you@builtrightstudio.com, sean.dzwairo@builtrightstudio.com" />

          <div class="actions">
            <button class="primary" (click)="saveRecipients()" [disabled]="savingR()">
              {{ savingR() ? 'Saving…' : 'Save recipients' }}
            </button>
            @if (savedR())   { <span class="success-msg small">✓ Saved</span> }
            @if (errorR())   { <span class="error-msg small">{{ errorR() }}</span> }
          </div>
        </div>

        <!-- Panel 2: Teams -->
        <div class="panel">
          <h3>Microsoft Teams integration</h3>
          <p class="muted small">
            When configured, each new booking auto-creates a Teams meeting
            on the organiser's calendar and puts the join URL in the
            notification email. Follow the walkthrough in
            <code>docs/teams-meeting-setup.md</code> to obtain these values.
            Never paste secrets outside this panel.
          </p>

          <label>Tenant ID</label>
          <input [(ngModel)]="teamsTenantId" name="tti"
                 placeholder="GUID from Azure — Directory (tenant) ID" />

          <label>Client ID</label>
          <input [(ngModel)]="teamsClientId" name="tci"
                 placeholder="GUID from Azure — Application (client) ID" />

          <label>Client secret value</label>
          <input type="password" [(ngModel)]="teamsClientSecret" name="tcs"
                 [placeholder]="secretPlaceholder()" />
          <p class="muted small">
            The <em>Value</em> column of the client secret (~40 chars), not the
            Secret ID GUID. Leave the field empty (or as the ●●● placeholder)
            to keep the value already stored.
          </p>

          <label>Organiser (email OR Object ID GUID)</label>
          <input [(ngModel)]="teamsOrganizer" name="tor"
                 placeholder="sean.dzwairo@builtrightstudio.com  —  or  —  748d2cbb-3b55-40ed-8c34-2eae5932b22a" />
          <p class="muted small">
            The M365 user whose calendar the auto-created meetings land on.
            Must have a Teams-enabled licence.<br>
            <strong>Recommended:</strong> paste the user's <em>Object ID</em>
            (a GUID) rather than the email — Graph's onlineMeetings
            endpoint needs a GUID, and pasting one skips an internal
            lookup that would need an extra <code>User.Read.All</code>
            Graph permission. Get the GUID from Entra ID → Users →
            click the user → <em>Object ID</em>.
          </p>

          <div class="actions">
            <button class="primary" (click)="saveTeams()" [disabled]="savingT()">
              {{ savingT() ? 'Saving…' : 'Save Teams config' }}
            </button>
            @if (savedT())   { <span class="success-msg small">✓ Saved</span> }
            @if (errorT())   { <span class="error-msg small">{{ errorT() }}</span> }
          </div>
        </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    section h2 { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
    section > p.muted.small { margin-top: 0; margin-bottom: 20px; }
    .panel {
      padding: 16px 18px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: var(--bg-2);
      margin-bottom: 16px;
    }
    .panel h3 { margin: 0 0 4px; font-size: 14px; font-weight: 600; }
    .panel > p.muted.small { margin: 0 0 12px; }
    .panel label {
      display: block; margin: 12px 0 4px;
      color: var(--muted); font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .panel input {
      width: 100%;
      font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 13px;
    }
    .panel input[type="password"] { font-family: sans-serif; }
    .actions {
      display: flex; align-items: center; gap: 12px;
      margin-top: 14px;
      white-space: nowrap;
    }
  `],
})
export class SettingsBookings {
  private http = inject(HttpClient);
  private readonly MASK = '••••••••';
  private readonly BASE = `${environment.basePath}/api`;

  loading = signal(true);

  recipients        = '';
  teamsTenantId     = '';
  teamsClientId     = '';
  teamsClientSecret = '';
  teamsOrganizer    = '';

  savingR = signal(false);
  savedR  = signal(false);
  errorR  = signal<string | null>(null);

  savingT = signal(false);
  savedT  = signal(false);
  errorT  = signal<string | null>(null);

  private secretIsSet = false;

  ngOnInit() {
    this.http.get<{ settings: Record<string, string> }>(`${this.BASE}/settings`).subscribe({
      next: r => {
        const s = r.settings || {};
        // Recipients stored as JSON array; render as comma-separated.
        const raw = (s['booking_notify_default_recipients'] || '').trim();
        if (raw !== '') {
          try {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) this.recipients = arr.join(', ');
            else this.recipients = raw;
          } catch { this.recipients = raw; }
        }
        this.teamsTenantId     = s['teams_tenant_id']       || '';
        this.teamsClientId     = s['teams_client_id']       || '';
        this.teamsOrganizer    = s['teams_organizer_email'] || '';
        // Secret comes back masked. Track whether one is on file so the
        // placeholder can hint "leave blank to keep existing".
        this.secretIsSet       = (s['teams_client_secret']  || '') === this.MASK;
        this.teamsClientSecret = ''; // never prefill the actual value
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  secretPlaceholder(): string {
    return this.secretIsSet
      ? '●●●●●●●●   (leave blank to keep the value on file)'
      : 'Paste the "Value" column from Azure';
  }

  saveRecipients() {
    this.savingR.set(true); this.savedR.set(false); this.errorR.set(null);

    // Empty box means: unset (fall back to admin users).
    // A single space (visible in the placeholder guidance) means: explicit
    // suppression — store `[]`, which the notifier reads as "skip internal
    // emails" and is distinguishable from an unset key.
    const raw = this.recipients;
    let value: string;
    if (raw.trim() === '' && raw !== ' ') {
      // Unset — but the settings PUT endpoint has no "delete" verb; we
      // store the empty string, which the server treats as "no default"
      // (falls back to admin users). To deliberately suppress, the user
      // types a single space.
      value = '';
    } else if (raw === ' ') {
      value = '[]';
    } else {
      const emails = raw.split(/[,;\n]/).map(s => s.trim()).filter(Boolean);
      value = JSON.stringify(emails);
    }

    this.http.put(`${this.BASE}/settings`, { booking_notify_default_recipients: value }).subscribe({
      next: () => {
        this.savingR.set(false); this.savedR.set(true);
        setTimeout(() => this.savedR.set(false), 2500);
      },
      error: e => {
        this.savingR.set(false);
        this.errorR.set(e?.error?.error || 'Save failed');
      },
    });
  }

  saveTeams() {
    this.savingT.set(true); this.savedT.set(false); this.errorT.set(null);

    const payload: Record<string, string> = {
      teams_tenant_id:       this.teamsTenantId.trim(),
      teams_client_id:       this.teamsClientId.trim(),
      teams_organizer_email: this.teamsOrganizer.trim(),
    };
    const secret = this.teamsClientSecret.trim();
    if (secret !== '' && secret !== this.MASK) {
      payload['teams_client_secret'] = secret;
    }

    this.http.put(`${this.BASE}/settings`, payload).subscribe({
      next: () => {
        this.savingT.set(false); this.savedT.set(true);
        // Post-save the secret is now on file if we sent one.
        if (secret !== '' && secret !== this.MASK) this.secretIsSet = true;
        this.teamsClientSecret = '';
        setTimeout(() => this.savedT.set(false), 2500);
      },
      error: e => {
        this.savingT.set(false);
        this.errorT.set(e?.error?.error || 'Save failed');
      },
    });
  }
}

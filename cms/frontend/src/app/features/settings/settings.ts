import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { AppSettings } from '../../core/models';
import { SettingsService } from '../../core/settings.service';

@Component({
  selector: 'app-settings',
  imports: [FormsModule],
  template: `
    <div class="toolbar"><h1>Settings</h1></div>

    @if (!loaded()) {
      <div class="empty">Loading settings…</div>
    } @else {
    <div class="layout">
      <section class="card">
        <h2>SMTP — outgoing email</h2>
        <label>Host</label>
        <input [(ngModel)]="s.smtp_host" name="smtp_host" placeholder="smtp.gmail.com" />
        <label>Port</label>
        <input [(ngModel)]="s.smtp_port" name="smtp_port" placeholder="587" />
        <label>Security</label>
        <select [(ngModel)]="s.smtp_secure" name="smtp_secure">
          <option value="tls">STARTTLS (port 587)</option>
          <option value="ssl">SSL (port 465)</option>
          <option value="none">None</option>
        </select>
        <label>Username</label>
        <input [(ngModel)]="s.smtp_user" name="smtp_user" />
        <label>Password</label>
        <input type="password" [(ngModel)]="s.smtp_pass" name="smtp_pass" placeholder="(unchanged)" />
        <label>From email</label>
        <input [(ngModel)]="s.smtp_from_email" name="smtp_from_email" />
        <label>From name</label>
        <input [(ngModel)]="s.smtp_from_name" name="smtp_from_name" />

        <hr />
        <label>Send test email to</label>
        <div class="row">
          <input [(ngModel)]="testTo" name="testTo" placeholder="you@example.com" />
          <button (click)="testMail()" [disabled]="testing()">{{ testing() ? 'Sending…' : 'Send test' }}</button>
        </div>
        @if (testResult()) {
          <div [class]="testResult()!.ok ? 'success-msg' : 'error-msg'">
            {{ testResult()!.ok ? '✓ Sent' : ('✗ ' + testResult()!.error) }}
          </div>
        }
      </section>

      <section class="card">
        <h2>Branding</h2>
        <label>Brand name</label>
        <input [(ngModel)]="s.brand_name" name="brand_name" />
        <label>Logo URL</label>
        <input [(ngModel)]="s.brand_logo_url" name="brand_logo_url" />

        <label>Public form background</label>
        <div class="color-row">
          <input type="color" [(ngModel)]="s.public_form_bg_color" name="public_form_bg_color_picker" class="color-swatch" />
          <input type="text" [(ngModel)]="s.public_form_bg_color" name="public_form_bg_color" placeholder="#0a0a0a" class="color-text" />
          <button type="button" class="ghost" (click)="s.public_form_bg_color = ''" title="Reset to default">↺</button>
        </div>

        <hr />
        <h2>Uploads</h2>
        <label>Max upload size (MB)</label>
        <input [(ngModel)]="s.upload_max_mb" name="upload_max_mb" />
      </section>

      <section class="card">
        <h2>Account</h2>
        <label>Current password</label>
        <input type="password" [(ngModel)]="cur" name="cur" />
        <label>New password (min 8)</label>
        <input type="password" [(ngModel)]="newp" name="newp" />
        <div style="height:12px;"></div>
        <button (click)="changePass()">Change password</button>
        @if (passResult()) {
          <div [class]="passResult()!.ok ? 'success-msg' : 'error-msg'">
            {{ passResult()!.msg }}
          </div>
        }
      </section>

      <div class="row sticky-save">
        <span class="spacer"></span>
        @if (savedAt()) { <span class="muted small">Saved {{ savedAt() }}</span> }
        <button class="primary" (click)="save()" [disabled]="saving()">
          {{ saving() ? 'Saving…' : 'Save settings' }}
        </button>
      </div>
    </div>
    }
  `,
  styles: [`
    .layout { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; padding: 20px; }
    .card label { margin-top: 10px; }
    .card hr { border: none; border-top: 1px solid var(--line); margin: 16px 0 10px 0; }
    .sticky-save { grid-column: 1 / -1; }
    .color-row { display: flex; gap: 8px; align-items: center; }
    .color-row .color-swatch {
      width: 44px; height: 36px; padding: 2px;
      flex-shrink: 0;
      cursor: pointer;
    }
    .color-row .color-text { flex: 1; font-family: "JetBrains Mono", monospace; }
  `],
})
export class Settings {
  private api = inject(Api);
  private svc = inject(SettingsService);
  s: AppSettings = {};
  loaded = signal(false);
  testTo = '';
  cur = ''; newp = '';
  saving = signal(false);
  testing = signal(false);
  testResult = signal<{ ok: boolean; error?: string } | null>(null);
  passResult = signal<{ ok: boolean; msg: string } | null>(null);
  savedAt = signal<string | null>(null);

  ngOnInit() {
    this.svc.load().subscribe(r => {
      this.s = { ...r.settings };
      this.loaded.set(true);
    });
  }
  save() {
    this.saving.set(true);
    this.svc.update(this.s).subscribe({
      next: () => { this.saving.set(false); this.savedAt.set(new Date().toLocaleTimeString()); },
      error: () => this.saving.set(false),
    });
  }
  testMail() {
    this.testing.set(true);
    this.testResult.set(null);
    this.api.testMail(this.testTo).subscribe({
      next: r => { this.testing.set(false); this.testResult.set(r); },
      error: e => { this.testing.set(false); this.testResult.set({ ok: false, error: e?.error?.error || 'Failed' }); },
    });
  }
  changePass() {
    this.passResult.set(null);
    this.api.changePassword(this.cur, this.newp).subscribe({
      next: () => { this.passResult.set({ ok: true, msg: 'Password updated' }); this.cur = ''; this.newp = ''; },
      error: e => this.passResult.set({ ok: false, msg: e?.error?.error || 'Failed' }),
    });
  }
}

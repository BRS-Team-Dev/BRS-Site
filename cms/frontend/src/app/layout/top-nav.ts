import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Auth } from '../core/auth';
import { SettingsService } from '../core/settings.service';
import { SystemService, SystemKey } from '../core/system.service';
import { ThemeService } from '../core/theme.service';

@Component({
  selector: 'app-top-nav',
  imports: [RouterLink],
  template: `
    <nav>
      <div class="system-switcher" (click)="open.set(!open())">
        <span class="title">{{ system.currentDef().label }}</span>
        <span class="caret">▾</span>
        @if (open()) {
          <div class="picker-backdrop" (click)="open.set(false); $event.stopPropagation()"></div>
          <div class="picker-pop" (click)="$event.stopPropagation()">
            @for (s of pickerSystems(); track s.key) {
              <button class="picker-opt"
                      [class.selected]="system.current() === s.key"
                      [class.placeholder]="s.placeholder"
                      (click)="switch(s.key)">
                <span class="sys-dot" [attr.data-sys]="s.key"></span>
                <span class="sys-label">{{ s.label }}</span>
                @if (s.placeholder) { <span class="muted small">soon</span> }
              </button>
            }
          </div>
        }
      </div>
      <span class="spacer"></span>
      <button
        class="ghost theme-btn"
        (click)="theme.toggle()"
        [title]="theme.theme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
        [attr.aria-label]="theme.theme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'">
        {{ theme.theme() === 'dark' ? '☀' : '☾' }}
      </button>
      @if (auth.user(); as u) {
        <div class="user-menu" (click)="userOpen.set(!userOpen()); $event.stopPropagation()">
          <span class="user-avatar">{{ initials(u.display_name || u.email) }}</span>
          <span class="user-label muted small">{{ u.display_name || u.email }}</span>
          <span class="caret">▾</span>
          @if (userOpen()) {
            <div class="picker-backdrop" (click)="userOpen.set(false); $event.stopPropagation()"></div>
            <div class="user-pop" (click)="$event.stopPropagation()">
              <div class="user-head">
                <strong>{{ u.display_name || u.email }}</strong>
                @if (u.display_name) { <span class="muted small">{{ u.email }}</span> }
              </div>
              <div class="divider"></div>
              <a class="user-opt" routerLink="/me" (click)="userOpen.set(false)">
                <span class="opt-icon">⚙</span>
                <span class="opt-label">My Account</span>
              </a>
              <div class="divider"></div>
              <button class="user-opt logout" (click)="userOpen.set(false); auth.logout()">
                <span class="opt-icon">⎋</span>
                <span class="opt-label">Logout</span>
              </button>
            </div>
          }
        </div>
      }
    </nav>
  `,
  styles: [`
    nav {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 20px;
      background: var(--bg);
      border-bottom: 1px solid var(--line);
      height: 52px;
    }
    .system-switcher {
      position: relative;
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      cursor: pointer;
      background: var(--bg-2);
      transition: border-color 0.15s;
    }
    .system-switcher:hover { border-color: var(--primary); }
    .title { font-weight: 700; letter-spacing: 0.4px; color: var(--fg); font-size: 13px; }
    .caret { color: var(--muted); font-size: 11px; }
    .spacer { flex: 1; }
    .picker-backdrop {
      position: fixed; inset: 0;
      z-index: 100;
    }
    .picker-pop {
      position: absolute; top: calc(100% + 6px); left: 0;
      min-width: 200px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      box-shadow: var(--shadow);
      padding: 4px;
      z-index: 101;
      display: flex; flex-direction: column; gap: 2px;
    }
    .picker-opt {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px;
      background: transparent; border: 0; border-radius: var(--radius-sm);
      color: var(--fg); cursor: pointer; text-align: left;
      font-size: 13px;
    }
    .picker-opt:hover { background: var(--bg-3); }
    .picker-opt.selected { background: var(--bg-3); color: var(--primary); }
    .picker-opt.placeholder { opacity: 0.55; }
    .sys-label { flex: 1; }
    .sys-dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: var(--muted);
      flex-shrink: 0;
    }
    .sys-dot[data-sys="cms"]        { background: var(--primary); }
    .sys-dot[data-sys="hr"]         { background: #10b981; }
    .sys-dot[data-sys="management"] { background: #a78bfa; }
    .sys-dot[data-sys="accounting"] { background: #14b8a6; }
    .sys-dot[data-sys="crm"]        { background: #3b82f6; }
    .sys-dot[data-sys="account"]    { background: #f59e0b; }
    .sys-dot[data-sys="support"]    { background: #ef4444; }

    .theme-btn {
      width: 32px; height: 32px; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 18px; line-height: 1;
    }
    .theme-btn:hover { color: var(--primary); border-color: var(--primary); }
    :host-context([data-theme="light"]) .theme-btn { color: var(--primary); }

    .user-menu {
      position: relative;
      display: inline-flex; align-items: center; gap: 8px;
      padding: 4px 10px 4px 4px;
      border: 1px solid var(--line); border-radius: var(--radius-sm);
      background: var(--bg-2); cursor: pointer;
      transition: border-color 0.15s;
    }
    .user-menu:hover { border-color: var(--primary); }
    .user-avatar {
      width: 28px; height: 28px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--primary); color: #0a0a0a;
      font-size: 11px; font-weight: 700; letter-spacing: 0.5px;
    }
    .user-label { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .user-pop {
      position: absolute; top: calc(100% + 6px); right: 0;
      min-width: 260px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      box-shadow: var(--shadow);
      padding: 4px;
      z-index: 101;
      display: flex; flex-direction: column; gap: 2px;
    }
    .user-head {
      padding: 10px 12px 6px;
      display: flex; flex-direction: column; gap: 2px;
    }
    .user-head strong { font-size: 13px; }
    .divider { height: 1px; background: var(--line); margin: 4px 0; }
    .user-opt {
      display: grid; grid-template-columns: 24px 1fr auto; gap: 10px; align-items: center;
      padding: 8px 10px;
      background: transparent; border: 0; border-radius: var(--radius-sm);
      color: var(--fg); cursor: pointer; text-align: left;
      font-size: 13px;
      text-decoration: none;
      width: 100%;
    }
    .user-opt:hover { background: var(--bg-3); }
    .user-opt .opt-icon { color: var(--primary); font-size: 16px; text-align: center; }
    .user-opt.logout { color: #ef4444; }
    .user-opt.logout:hover { background: rgba(239,68,68,0.10); }
    .user-opt.logout .opt-icon { color: #ef4444; }
  `],
})
export class TopNav {
  private svc = inject(SettingsService);
  auth = inject(Auth);
  theme = inject(ThemeService);
  system = inject(SystemService);
  brandName = this.svc.brandName;
  open = signal(false);
  userOpen = signal(false);

  /** Systems shown in the picker — `hidden: true` ones (like 'me') are reached elsewhere. */
  pickerSystems = () => this.system.systems.filter(s => !s.hidden);

  switch(key: SystemKey) {
    this.open.set(false);
    if (this.system.current() !== key) this.system.switchTo(key);
  }

  initials(s: string | null | undefined): string {
    if (!s) return '?';
    const parts = s.includes('@') ? [s.split('@')[0]] : s.trim().split(/\s+/);
    return parts.map(p => p.charAt(0).toUpperCase()).slice(0, 2).join('') || '?';
  }
}

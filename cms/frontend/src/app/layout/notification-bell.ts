import { Component, HostListener, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api } from '../core/api';
import { AppNotification, NotificationSection } from '../core/models';

/**
 * Header notification bell.
 *
 * Collapsed: an icon + red badge showing total unread count.
 * Expanded (click): a dropdown panel with:
 *   - Sub-tab strip for each system section (CRM / HR / Ops / …)
 *   - List of notifications for the active section (unread first, then read)
 *   - "Mark all read" per section
 *   - Row click marks the single item read + navigates to link_url
 *
 * Polls the unread-count endpoint every 60s so badge counts stay fresh
 * without needing WebSocket infrastructure. Full list only loads on open.
 */

const SECTIONS: { key: NotificationSection; label: string; icon: string }[] = [
  { key: 'crm',         label: 'CRM',         icon: '●' },
  { key: 'hr',          label: 'HR',          icon: '👥' },
  { key: 'operations',  label: 'Ops',         icon: '⚒' },
  { key: 'recruitment', label: 'Recruit',     icon: '⇉' },
  { key: 'accounting',  label: 'Finance',     icon: '£' },
  { key: 'management',  label: 'Mgmt',        icon: '★' },
  { key: 'tasks',       label: 'Tasks',       icon: '✓' },
];

@Component({
  selector: 'app-notification-bell',
  imports: [],
  template: `
    <div class="bell-wrap">
      <button type="button" class="bell" (click)="toggle($event)" [class.has-unread]="totalUnread() > 0">
        <span class="icon">🔔</span>
        @if (totalUnread() > 0) {
          <span class="badge">{{ totalUnread() > 99 ? '99+' : totalUnread() }}</span>
        }
      </button>

      @if (open()) {
        <div class="panel" (click)="$event.stopPropagation()">
          <div class="panel-head">
            <strong>Notifications</strong>
            <span class="spacer"></span>
            <button class="ghost small" (click)="markAllRead()"
                    [disabled]="!items().some(n => !n.read_at)">Mark all read</button>
          </div>

          <!-- Section sub-tabs. Each shows its own unread count as a
               small badge so you know where the noise is coming from. -->
          <div class="tabs">
            @for (s of sections; track s.key) {
              <button type="button" class="tab"
                      [class.active]="activeSection() === s.key"
                      (click)="setSection(s.key)">
                <span class="tab-icon">{{ s.icon }}</span>
                <span class="tab-label">{{ s.label }}</span>
                @if ((countBySection()[s.key] ?? 0) > 0) {
                  <span class="tab-badge">{{ countBySection()[s.key] }}</span>
                }
              </button>
            }
          </div>

          <div class="list">
            @if (loading()) {
              <p class="muted small empty">Loading…</p>
            } @else if (items().length === 0) {
              <p class="muted small empty">Nothing here yet.</p>
            } @else {
              @for (n of items(); track n.id) {
                <button type="button" class="row"
                        [class.unread]="!n.read_at"
                        (click)="openItem(n)">
                  <div class="row-body">
                    <div class="row-title">{{ n.title }}</div>
                    @if (n.body) { <div class="row-sub muted small">{{ n.body }}</div> }
                    <div class="row-meta muted small">{{ n.created_at }}</div>
                  </div>
                </button>
              }
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { position: relative; display: inline-block; }
    .bell-wrap { position: relative; }
    .bell {
      background: transparent; border: 1px solid transparent;
      color: var(--fg); cursor: pointer; padding: 6px 10px;
      border-radius: 999px; position: relative;
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 16px;
    }
    .bell:hover { background: var(--bg-3); }
    .bell.has-unread .icon { animation: nudge 1.6s ease-in-out infinite; }
    @keyframes nudge {
      0%, 60%, 100% { transform: rotate(0); }
      70% { transform: rotate(-8deg); }
      80% { transform: rotate(8deg); }
      90% { transform: rotate(-4deg); }
    }
    .badge {
      position: absolute; top: -2px; right: -2px;
      min-width: 18px; height: 18px; padding: 0 5px;
      background: var(--danger); color: #fff;
      border-radius: 999px; font-size: 10px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      line-height: 1;
    }

    /* Dropdown panel */
    .panel {
      position: absolute; top: calc(100% + 6px); right: 0;
      width: 380px; max-height: 520px;
      background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius); box-shadow: var(--shadow);
      z-index: 100; display: flex; flex-direction: column;
    }
    .panel-head {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; border-bottom: 1px solid var(--line);
    }
    .panel-head .spacer { flex: 1; }

    .tabs {
      display: flex; overflow-x: auto; gap: 2px;
      padding: 4px 8px; border-bottom: 1px solid var(--line);
    }
    .tab {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 4px 8px; background: transparent; border: 0;
      cursor: pointer; color: var(--muted); font-size: 12px;
      border-radius: var(--radius-sm); white-space: nowrap;
    }
    .tab:hover { background: var(--bg-3); color: var(--fg); }
    .tab.active { color: var(--primary); background: color-mix(in oklab, var(--primary), transparent 85%); }
    .tab-badge {
      background: var(--danger); color: #fff;
      font-size: 10px; font-weight: 700;
      padding: 0 5px; min-width: 16px; height: 16px;
      border-radius: 999px; display: inline-flex;
      align-items: center; justify-content: center;
    }

    .list { flex: 1; overflow-y: auto; }
    .empty { padding: 24px 12px; text-align: center; margin: 0; }
    .row {
      width: 100%; text-align: left; background: transparent;
      border: 0; border-bottom: 1px solid var(--line);
      padding: 10px 12px; cursor: pointer; color: var(--fg);
      display: block;
    }
    .row:last-of-type { border-bottom: 0; }
    .row:hover { background: var(--bg-3); }
    .row.unread { background: color-mix(in oklab, var(--primary), transparent 92%); }
    .row.unread .row-title { font-weight: 600; }
    .row-title { font-size: 13px; margin-bottom: 2px; }
    .row-sub { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      overflow: hidden; text-overflow: ellipsis; }
    .row-meta { margin-top: 4px; font-size: 11px; }
  `],
})
export class NotificationBell {
  private api    = inject(Api);
  private router = inject(Router);

  readonly sections = SECTIONS;

  open              = signal(false);
  loading           = signal(false);
  totalUnread       = signal(0);
  countBySection    = signal<Partial<Record<NotificationSection, number>>>({});
  activeSection     = signal<NotificationSection>('crm');
  items             = signal<AppNotification[]>([]);

  private pollTimer: number | null = null;

  ngOnInit() {
    // Warm the badge count on boot, then keep it fresh with a 60s poll.
    this.refreshCount();
    this.pollTimer = window.setInterval(() => this.refreshCount(), 60_000);
  }
  ngOnDestroy() {
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
  }

  /** Global click closes the panel — captured via HostListener because
   *  the panel itself stopPropagation()'s so its clicks don't kill it. */
  @HostListener('document:click')
  onDocClick() {
    if (this.open()) this.open.set(false);
  }

  toggle(e: Event) {
    e.stopPropagation();
    const next = !this.open();
    this.open.set(next);
    if (next) this.loadList();
  }

  setSection(s: NotificationSection) {
    this.activeSection.set(s);
    this.loadList();
  }

  private refreshCount() {
    this.api.notificationUnreadCount().subscribe({
      next: r => {
        this.totalUnread.set(r.total);
        this.countBySection.set(r.by_section);
      },
    });
  }

  private loadList() {
    this.loading.set(true);
    this.api.listNotifications(this.activeSection()).subscribe({
      next: r => { this.items.set(r.notifications); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  openItem(n: AppNotification) {
    if (!n.read_at) {
      this.api.markNotificationRead(n.id).subscribe(() => this.refreshCount());
    }
    if (n.link_url) this.router.navigateByUrl(n.link_url).catch(() => {});
    this.open.set(false);
  }

  markAllRead() {
    this.api.markAllNotificationsRead(this.activeSection()).subscribe(() => {
      this.refreshCount();
      this.loadList();
    });
  }
}

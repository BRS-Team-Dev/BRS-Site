import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { NotificationEventDef, NotificationRule, NotificationSection } from '../../core/models';

/**
 * Settings → Notifications tab.
 *
 * Renders the full catalogue of 44 triggerable events grouped by
 * system section (CRM / HR / Ops / …). Each event has its own
 * expandable editor for:
 *   - enabled (master switch)
 *   - recipient scope (role / team / tenant / user / none)
 *   - recipient ref (role slug, team slug, or user id)
 *   - creates_task (whether firing also creates a crm_task row)
 *   - escalate_after_minutes + escalate_to_role
 *
 * Rules PUT hits `PUT /api/notifications/rules/:event_key` which upserts.
 * Rows without a tenant rule use catalog defaults — the editor pre-fills
 * from those, so saving = "adopt these defaults as your override".
 */

const SECTION_LABELS: Record<NotificationSection, string> = {
  crm:         'CRM',
  hr:          'HR',
  operations:  'Operations',
  recruitment: 'Recruitment',
  accounting:  'Accounting',
  management:  'Management',
  tasks:       'Tasks (Projects)',
};

interface Row {
  event: NotificationEventDef;
  draft: NotificationRule;
  saving: boolean;
  saved: boolean;
  error: string | null;
}

@Component({
  selector: 'app-settings-notifications',
  imports: [FormsModule],
  template: `
    <section>
      <h2>Notifications</h2>
      <p class="muted small">
        {{ rows().length }} triggerable events across the whole system.
        Toggle each on/off, pick who receives it, and (optionally) set an
        escalation window. Unedited rows use the catalogue defaults.
      </p>

      @if (loading()) {
        <p class="muted small">Loading…</p>
      } @else {
        @for (section of sectionKeys(); track section) {
          <div class="section-block">
            <button type="button" class="section-head"
                    (click)="toggleSection(section)">
              <span class="caret">›</span>
              <strong>{{ sectionLabels[section] }}</strong>
              <span class="muted small">· {{ rowsForSection(section).length }} events</span>
              <span class="spacer"></span>
              <span class="muted small">{{ enabledCount(section) }} enabled</span>
            </button>
            @if (openSection() === section) {
              <div class="section-body">
                @for (row of rowsForSection(section); track row.event.id) {
                  <div class="event-row" [class.disabled]="!row.draft.enabled">
                    <div class="event-head">
                      <label class="master-toggle">
                        <input type="checkbox"
                               [checked]="!!row.draft.enabled"
                               (change)="setEnabled(row, $any($event.target).checked)" />
                        <div class="event-title">
                          <strong>{{ row.event.label }}</strong>
                          <span class="muted small event-key">{{ row.event.event_key }}</span>
                        </div>
                      </label>
                      @if (row.saving) { <span class="muted small">Saving…</span> }
                      @if (row.saved)  { <span class="success-msg small">✓ Saved</span> }
                      @if (row.error)  { <span class="error-msg small">{{ row.error }}</span> }
                    </div>
                    @if (row.event.description) {
                      <p class="muted small event-desc">{{ row.event.description }}</p>
                    }

                    @if (row.draft.enabled) {
                      <div class="controls">
                        <div class="ctrl">
                          <label>Recipient scope</label>
                          <select [ngModel]="row.draft.recipient_scope"
                                  (ngModelChange)="patch(row, { recipient_scope: $event })"
                                  [name]="'sc_' + row.event.id">
                            <option value="role">Role</option>
                            <option value="team">Team</option>
                            <option value="tenant">Whole organisation</option>
                            <option value="user">Specific user</option>
                            <option value="none">No recipient (skip)</option>
                          </select>
                        </div>

                        @if (row.draft.recipient_scope !== 'tenant' && row.draft.recipient_scope !== 'none') {
                          <div class="ctrl">
                            <label>{{ refLabel(row.draft.recipient_scope) }}</label>
                            <input [ngModel]="row.draft.recipient_ref || ''"
                                   (ngModelChange)="patch(row, { recipient_ref: $event })"
                                   [name]="'ref_' + row.event.id"
                                   [placeholder]="refPlaceholder(row.draft.recipient_scope)" />
                          </div>
                        }

                        <div class="ctrl checkbox-ctrl">
                          <label class="inline-check">
                            <input type="checkbox"
                                   [checked]="!!row.draft.creates_task"
                                   (change)="patch(row, { creates_task: $any($event.target).checked ? 1 : 0 })" />
                            <span>Also create a task</span>
                          </label>
                        </div>

                        <div class="ctrl">
                          <label>Escalate after (minutes)</label>
                          <input type="number" min="0"
                                 [ngModel]="row.draft.escalate_after_minutes"
                                 (ngModelChange)="patch(row, { escalate_after_minutes: toNumberOrNull($event) })"
                                 [name]="'esc_' + row.event.id"
                                 placeholder="e.g. 1440" />
                        </div>

                        @if (row.draft.escalate_after_minutes) {
                          <div class="ctrl">
                            <label>Escalate to role</label>
                            <input [ngModel]="row.draft.escalate_to_role || ''"
                                   (ngModelChange)="patch(row, { escalate_to_role: $event })"
                                   [name]="'esct_' + row.event.id"
                                   placeholder="admin" />
                          </div>
                        }
                      </div>

                      <div class="event-actions">
                        <button class="primary small" [disabled]="row.saving"
                                (click)="save(row)">
                          {{ row.saving ? 'Saving…' : 'Save' }}
                        </button>
                        <button class="ghost small" (click)="resetToDefaults(row)">
                          Reset to defaults
                        </button>
                      </div>
                    }
                  </div>
                }
              </div>
            }
          </div>
        }
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    section h2 { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
    section > p.muted.small { margin-top: 0; margin-bottom: 20px; }

    .section-block {
      border: 1px solid var(--line); border-radius: var(--radius-sm);
      background: var(--bg-2); margin-bottom: 8px; overflow: hidden;
    }
    .section-head {
      width: 100%; display: flex; align-items: center; gap: 8px;
      padding: 10px 14px; background: transparent; border: 0;
      cursor: pointer; text-align: left; color: var(--fg);
    }
    .section-head:hover { background: var(--bg-3); }
    .section-head .caret {
      display: inline-block; transition: transform .12s;
      color: var(--muted); font-size: 14px;
    }
    .section-block:has(.section-body) .section-head .caret { transform: rotate(90deg); }
    .section-head .spacer { flex: 1; }

    .section-body {
      padding: 6px 14px 14px; border-top: 1px solid var(--line);
      background: var(--bg);
    }

    .event-row {
      padding: 10px 0; border-top: 1px solid var(--line);
    }
    .event-row:first-of-type { border-top: 0; padding-top: 6px; }
    .event-row.disabled { opacity: 0.6; }
    .event-head {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    }
    .master-toggle {
      display: flex; align-items: center; gap: 10px; cursor: pointer;
      color: var(--fg); text-transform: none; letter-spacing: normal;
      margin: 0; white-space: nowrap; flex: 1; min-width: 0;
    }
    .master-toggle input { width: auto; margin: 0; flex-shrink: 0; }
    .event-title { display: flex; flex-direction: column; min-width: 0; }
    .event-title strong { font-size: 13px; }
    .event-key { font-family: "JetBrains Mono", ui-monospace, monospace;
      font-size: 10px; }
    .event-desc { margin: 4px 0 8px; padding-left: 28px; }

    .controls {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px 16px; margin: 10px 0 8px; padding-left: 28px;
    }
    .ctrl { display: flex; flex-direction: column; gap: 4px; }
    .ctrl label {
      color: var(--muted); font-size: 11px; margin: 0;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .checkbox-ctrl label.inline-check {
      display: flex; align-items: center; gap: 8px; padding: 8px 0;
      color: var(--fg); font-size: 13px; font-weight: 500; cursor: pointer;
      text-transform: none; letter-spacing: normal; white-space: nowrap;
    }
    .checkbox-ctrl label.inline-check input { width: auto; margin: 0; }

    .event-actions {
      display: flex; gap: 8px; margin-top: 6px; padding-left: 28px;
    }
    .event-actions > * { white-space: nowrap; flex-shrink: 0; }
  `],
})
export class SettingsNotifications {
  private api = inject(Api);
  readonly sectionLabels = SECTION_LABELS;

  loading    = signal(true);
  rows       = signal<Row[]>([]);
  openSection = signal<NotificationSection | null>('crm');

  ngOnInit() {
    // Load catalogue + tenant rules in parallel; merge into one Row[]
    // where each row's draft is either the tenant override or a shape
    // built from the catalogue defaults.
    this.loading.set(true);
    Promise.all([
      new Promise<NotificationEventDef[]>((resolve) => {
        this.api.listNotificationEvents().subscribe({
          next: r => resolve(r.events ?? []),
          error: () => resolve([]),
        });
      }),
      new Promise<NotificationRule[]>((resolve) => {
        this.api.listNotificationRules().subscribe({
          next: r => resolve(r.rules ?? []),
          error: () => resolve([]),
        });
      }),
    ]).then(([events, rules]) => {
      const byKey = new Map(rules.map(r => [r.event_key, r]));
      const rows: Row[] = events.map(event => ({
        event,
        draft: this.buildDraft(event, byKey.get(event.event_key)),
        saving: false, saved: false, error: null,
      }));
      this.rows.set(rows);
      this.loading.set(false);
    });
  }

  /** Merge a tenant rule on top of the catalogue defaults so the editor
   *  starts populated even for events the tenant hasn't customised. */
  private buildDraft(event: NotificationEventDef, rule: NotificationRule | undefined): NotificationRule {
    if (rule) return { ...rule };
    return {
      event_key: event.event_key,
      enabled: 1,
      recipient_scope: event.default_recipient_scope,
      recipient_ref: event.default_recipient_ref ?? null,
      supervisor_role: event.default_supervisor_role,
      creates_task: event.default_creates_task,
      escalate_after_minutes: event.default_escalate_after_minutes ?? null,
      escalate_to_role: event.default_escalate_to_role ?? null,
    };
  }

  sectionKeys = computed<NotificationSection[]>(() => {
    const set = new Set<NotificationSection>();
    for (const r of this.rows()) set.add(r.event.section);
    // Preserve display order.
    return (Object.keys(SECTION_LABELS) as NotificationSection[]).filter(k => set.has(k));
  });

  rowsForSection(section: NotificationSection): Row[] {
    return this.rows().filter(r => r.event.section === section);
  }

  enabledCount(section: NotificationSection): number {
    return this.rowsForSection(section).filter(r => !!r.draft.enabled).length;
  }

  toggleSection(section: NotificationSection) {
    this.openSection.set(this.openSection() === section ? null : section);
  }

  patch(row: Row, changes: Partial<NotificationRule>) {
    row.draft = { ...row.draft, ...changes };
    row.saved = false; row.error = null;
    this.bumpRow(row);
  }

  setEnabled(row: Row, enabled: boolean) {
    row.draft.enabled = enabled ? 1 : 0;
    row.saved = false; row.error = null;
    this.bumpRow(row);
  }

  save(row: Row) {
    row.saving = true; row.saved = false; row.error = null;
    this.bumpRow(row);
    this.api.updateNotificationRule(row.event.event_key, row.draft).subscribe({
      next: () => {
        row.saving = false; row.saved = true;
        this.bumpRow(row);
        setTimeout(() => { row.saved = false; this.bumpRow(row); }, 2500);
      },
      error: e => {
        row.saving = false;
        row.error = e?.error?.error || 'Save failed';
        this.bumpRow(row);
      },
    });
  }

  resetToDefaults(row: Row) {
    row.draft = this.buildDraft(row.event, undefined);
    row.saved = false; row.error = null;
    this.bumpRow(row);
  }

  /** Force the rows() signal to fire so the template re-renders after
   *  a mutation on a Row's fields (Row is a plain object). */
  private bumpRow(_row: Row) {
    this.rows.update(list => [...list]);
  }

  /** Template helper — Angular's template parser can't resolve the JS
   *  `Number()` global (it treats bare identifiers as class members),
   *  so numeric coercion lives here. Returns null for empty inputs so
   *  the DB column stays NULL rather than 0. */
  toNumberOrNull(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  refLabel(scope: string): string {
    switch (scope) {
      case 'role': return 'Role slug';
      case 'team': return 'Team slug';
      case 'user': return 'User ID';
      default:     return 'Ref';
    }
  }
  refPlaceholder(scope: string): string {
    switch (scope) {
      case 'role': return 'admin';
      case 'team': return 'e.g. sales';
      case 'user': return 'e.g. 42';
      default:     return '';
    }
  }
}

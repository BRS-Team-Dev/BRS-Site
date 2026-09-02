import { Component, EventEmitter, Input, Output, SimpleChanges, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { DialogService } from '../../core/dialog';

interface Booking {
  id?: number;
  lead_id: number | null;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  topic: string | null;
  notes: string | null;
  scheduled_at: string | null;
  duration_minutes: number;
  status: 'requested' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  meeting_url: string | null;
  source: string | null;
  assignee_user_id: number | null;
  /** Comma-separated in the UI; converted to a string[] on save. Blank
   *  string means "use the tenant default from Settings". */
  notification_recipients: string;
  notification_sent_at: string | null;
}

const empty = (): Booking => ({
  lead_id: null, name: '', email: '', phone: '', company: '', topic: '', notes: '',
  scheduled_at: '', duration_minutes: 15, status: 'requested',
  meeting_url: '', source: '', assignee_user_id: null,
  notification_recipients: '', notification_sent_at: null,
});

/**
 * Shared booking detail / edit overlay.
 *
 * Parent sets `bookingId` to a number (edit existing), 'new' (create), or
 * null (closed). Emits `closed` when the user dismisses, and `changed`
 * after a successful save or delete so the parent can refetch its list /
 * calendar without needing to know which happened.
 *
 * Used by both `lead-bookings-admin` (list) and `lead-bookings-calendar`.
 */
@Component({
  selector: 'app-booking-detail-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    @if (open()) {
      <div class="modal-backdrop" (click)="close()">
        <div class="modal" (click)="$event.stopPropagation()" style="max-width: 820px;">
          <div class="modal-head">
            <h3>
              {{ isNew() ? 'New booking' : (draft.name || 'Booking') }}
              @if (!isNew() && draft.status) {
                <span class="status-pill" [attr.data-status]="draft.status" style="margin-left: 8px;">
                  {{ statusLabel(draft.status) }}
                </span>
              }
            </h3>
            <button class="ghost icon-btn" (click)="close()" title="Close">✕</button>
          </div>

          <div class="modal-body">
            @if (error()) { <div class="error-msg">{{ error() }}</div> }

            @if (!formReady()) {
              <p class="muted">Loading booking…</p>
            } @else {
              <div class="card">
                <h2>Contact</h2>
                <div class="row two">
                  <div class="field">
                    <label>Name <span class="req">★</span></label>
                    <input [(ngModel)]="draft.name" name="b_name" />
                  </div>
                  <div class="field">
                    <label>Company</label>
                    <input [(ngModel)]="draft.company" name="b_company" />
                  </div>
                </div>
                <div class="row two">
                  <div class="field">
                    <label>Email</label>
                    <input type="email" [(ngModel)]="draft.email" name="b_email" />
                  </div>
                  <div class="field">
                    <label>Phone</label>
                    <input [(ngModel)]="draft.phone" name="b_phone" />
                  </div>
                </div>
              </div>

              <div class="card">
                <h2>Schedule</h2>
                <div class="row three">
                  <div class="field">
                    <label>Scheduled at</label>
                    <input type="datetime-local" [(ngModel)]="draft.scheduled_at" name="b_when" />
                  </div>
                  <div class="field">
                    <label>Duration (minutes)</label>
                    <input type="number" min="5" max="240" step="5" [(ngModel)]="draft.duration_minutes" name="b_dur" />
                  </div>
                  <div class="field">
                    <label>Status</label>
                    <select [(ngModel)]="draft.status" name="b_status">
                      @for (s of statusOptions; track s) { <option [value]="s">{{ statusLabel(s) }}</option> }
                    </select>
                  </div>
                </div>
                <div class="field">
                  <label>Meeting URL</label>
                  <input [(ngModel)]="draft.meeting_url" name="b_url" placeholder="Zoom / Google Meet link" />
                </div>
              </div>

              <div class="card">
                <h2>Context</h2>
                <div class="row two">
                  <div class="field">
                    <label>Topic</label>
                    <input [(ngModel)]="draft.topic" name="b_topic" placeholder="What is this call about?" />
                  </div>
                  <div class="field">
                    <label>Source</label>
                    <input [(ngModel)]="draft.source" name="b_source" placeholder="website, referral, manual…" />
                  </div>
                </div>

                <div class="field">
                  <label>Linked lead <span class="req">★</span></label>

                  @if (!isNew()) {
                    @if (draft.lead_id) {
                      <div class="picked read-only">
                        <span class="type-pill" data-type="lead">Lead</span>
                        <a class="lead-link" [routerLink]="['/admin/leads', draft.lead_id]" (click)="close()">
                          @if (pickedName()) { {{ pickedName() }} } @else { Lead #{{ draft.lead_id }} }
                        </a>
                        <span class="spacer"></span>
                        <span class="muted small">Locked — delete this booking to change.</span>
                      </div>
                    } @else {
                      <div class="picked read-only">
                        <span class="muted small">Linked lead was deleted. Delete this booking to remove it.</span>
                      </div>
                    }
                  } @else if (draft.lead_id && !newLeadOpen()) {
                    <div class="picked">
                      <span class="type-pill" data-type="lead">Lead</span>
                      <a class="lead-link" [routerLink]="['/admin/leads', draft.lead_id]" target="_blank">
                        @if (pickedName()) { {{ pickedName() }} } @else { Lead #{{ draft.lead_id }} }
                      </a>
                      <span class="spacer"></span>
                      <button type="button" class="ghost small" (click)="unlink()">Change</button>
                    </div>
                  } @else if (newLeadOpen()) {
                    <div class="newlead">
                      <p class="muted small" style="margin: 0 0 8px 0;">
                        Creating a new lead. Source will be <strong>call booking</strong>.
                      </p>
                      <div class="row two">
                        <div class="field">
                          <label>Name <span class="req">★</span></label>
                          <input [(ngModel)]="newLead.name" name="nl_name" />
                        </div>
                        <div class="field">
                          <label>Company</label>
                          <input [(ngModel)]="newLead.company" name="nl_company" />
                        </div>
                      </div>
                      <div class="row two">
                        <div class="field">
                          <label>Email</label>
                          <input type="email" [(ngModel)]="newLead.email" name="nl_email" />
                        </div>
                        <div class="field">
                          <label>Phone</label>
                          <input [(ngModel)]="newLead.phone" name="nl_phone" />
                        </div>
                      </div>
                      <div style="display:flex; gap:8px;">
                        <button type="button" class="ghost small" (click)="cancelNewLead()">Cancel</button>
                      </div>
                    </div>
                  } @else {
                    <input class="picker-input"
                           type="text"
                           [(ngModel)]="pickerQuery"
                           (ngModelChange)="onPickerType($event)"
                           (focus)="showPicker.set(true); onPickerType(pickerQuery)"
                           name="b_lead_picker"
                           placeholder="Search leads or contacts by name, email, company…"
                           autocomplete="off" />

                    @if (showPicker()) {
                      <div class="picker-pop">
                        <button type="button" class="picker-row picker-new" (click)="startNewLead()">
                          <span class="type-pill" data-type="new">+ NEW</span>
                          <span class="who"><strong>Create a new lead</strong>
                            <span class="muted small">Fresh lead for this booking</span>
                          </span>
                        </button>
                        @if (pickerLoading()) { <p class="muted small p-8">Searching…</p> }
                        @for (p of pickerResults(); track p.type + ':' + p.id) {
                          <button type="button" class="picker-row" (click)="pickPerson(p)">
                            <span class="type-pill" [attr.data-type]="p.type">{{ p.type }}</span>
                            <span class="who">
                              <strong>{{ p.name }}</strong>
                              <span class="muted small">
                                @if (p.company) { {{ p.company }} }
                                @if (p.email)   { · {{ p.email }} }
                              </span>
                            </span>
                          </button>
                        }
                      </div>
                    }
                  }
                </div>

                <div class="field">
                  <label>Notes</label>
                  <textarea rows="4" [(ngModel)]="draft.notes" name="b_notes"></textarea>
                </div>
              </div>

              <div class="card">
                <h2>Notifications</h2>
                <div class="field">
                  <label>Internal recipients</label>
                  @if (recipientOptions().length === 0) {
                    <p class="muted small">Loading team…</p>
                  } @else {
                    <div class="chip-row">
                      @for (p of recipientOptions(); track p.email) {
                        <label class="chip" [class.on]="pickedRecipients().has(p.email)">
                          <input type="checkbox"
                                 [checked]="pickedRecipients().has(p.email)"
                                 (change)="toggleRecipient(p.email)" />
                          <span class="chip-name">{{ p.display_name || p.email }}</span>
                          <span class="chip-email muted small">{{ p.email }}</span>
                        </label>
                      }
                    </div>
                  }
                  <p class="muted small" style="margin: 6px 0 0 0;">
                    Ticked names get the internal booking email. Untick all to
                    suppress the internal email entirely. The client at
                    <strong>{{ draft.email || '(no email)' }}</strong> is always
                    emailed automatically.
                  </p>
                </div>
                @if (!isNew() && draft.scheduled_at) {
                  <div style="display:flex; align-items:center; gap:10px;">
                    <button type="button" class="ghost" (click)="resend()" [disabled]="resending()">
                      {{ resending() ? 'Sending…' : 'Resend notifications' }}
                    </button>
                    @if (draft.notification_sent_at) {
                      <span class="muted small">Last sent {{ draft.notification_sent_at }}</span>
                    } @else {
                      <span class="muted small">Not yet sent</span>
                    }
                  </div>
                  @if (resendMsg()) {
                    <p class="muted small" style="margin: 8px 0 0 0;">{{ resendMsg() }}</p>
                  }
                }
              </div>
            }
          </div>

          <div class="modal-foot">
            @if (!isNew()) {
              <button class="ghost danger" (click)="del()" [disabled]="saving() || !formReady()">
                Delete
              </button>
            }
            <span class="spacer"></span>
            <button class="ghost" (click)="close()">Cancel</button>
            <button class="primary" (click)="save()" [disabled]="saving() || !formReady()">
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
    .row.two   { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .row.three { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    @media (max-width: 780px) { .row.two, .row.three { grid-template-columns: 1fr; } }
    .card { padding: 16px; }
    .card + .card { margin-top: 12px; }
    .card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin: 0 0 10px 0; font-weight: 600; }
    .req { color: var(--primary); margin-left: 2px; }

    .status-pill[data-status="requested"] { color: var(--warning); border-color: var(--warning); }
    .status-pill[data-status="confirmed"] { color: var(--primary); border-color: var(--primary); }
    .status-pill[data-status="completed"] { color: var(--success); border-color: var(--success); }
    .status-pill[data-status="cancelled"] { color: var(--muted); text-decoration: line-through; }
    .status-pill[data-status="no_show"]   { color: var(--danger);  border-color: var(--danger); }

    .picker-input { width: 100%; }
    .picker-pop {
      position: relative;
      margin-top: 6px;
      background: var(--bg-2);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      max-height: 260px;
      overflow-y: auto;
      z-index: 20;
    }
    .picker-row {
      display: flex; align-items: center; gap: 10px;
      width: 100%;
      padding: 10px 12px;
      background: transparent;
      border: 0;
      border-bottom: 1px solid var(--line);
      color: var(--fg);
      cursor: pointer;
      text-align: left;
    }
    .picker-row:last-child { border-bottom: 0; }
    .picker-row:hover { background: var(--bg-3); }
    .picker-row.picker-new { background: var(--bg-3); color: var(--primary); font-weight: 600; }
    .picker-row .who { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .type-pill {
      display: inline-block; padding: 2px 8px; border-radius: 999px;
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase;
      border: 1px solid var(--line); color: var(--muted); flex: none;
    }
    .type-pill[data-type="lead"]    { color: var(--primary); border-color: var(--primary); }
    .type-pill[data-type="contact"] { color: #56CCF2;        border-color: #56CCF2; }
    .type-pill[data-type="new"]     { color: var(--primary); border-color: var(--primary); }
    .p-8 { padding: 12px; }

    .picked {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px;
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
    }
    .picked .spacer { flex: 1; }
    .picked.read-only { border-style: dashed; }
    .lead-link { color: var(--primary); font-weight: 600; text-decoration: none; }
    .lead-link:hover { text-decoration: underline; }

    .newlead {
      padding: 14px;
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
    }
    .ghost.small { padding: 4px 10px; font-size: 12px; }
    .modal-foot .spacer { flex: 1; }

    .chip-row {
      display: flex; flex-wrap: wrap; gap: 8px;
      margin-top: 4px;
    }
    .chip {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 12px; border-radius: 999px;
      border: 1px solid var(--line);
      background: var(--bg-3);
      cursor: pointer;
      text-transform: none; letter-spacing: normal;
      white-space: nowrap;
      transition: border-color .12s, background .12s;
    }
    .chip:hover { border-color: var(--primary); }
    .chip.on {
      border-color: var(--primary);
      background: color-mix(in srgb, var(--primary) 12%, var(--bg-3));
    }
    .chip input {
      width: auto; margin: 0; flex-shrink: 0;
      accent-color: var(--primary);
    }
    .chip-name  { font-weight: 600; font-size: 13px; }
    .chip-email { font-size: 11px; }
  `],
})
export class BookingDetailModal {
  private api    = inject(Api);
  private dialog = inject(DialogService);

  /** `null` → closed. `'new'` → create. number → load + edit. */
  @Input() bookingId: number | 'new' | null = null;

  @Output() closed  = new EventEmitter<void>();
  /** Fires after a successful save OR delete so the parent can refetch. */
  @Output() changed = new EventEmitter<void>();

  open       = signal(false);
  formReady  = signal(false);
  saving     = signal(false);
  resending  = signal(false);
  resendMsg  = signal<string | null>(null);
  error      = signal<string | null>(null);

  // Team recipient chip picker. Loaded once (options rarely change) and
  // reused across every modal open. `pickedRecipients` is the effective
  // per-booking override — initialized from the tenant default on a new
  // booking OR from the booking's saved override when editing.
  recipientOptions   = signal<Array<{ email: string; display_name: string }>>([]);
  private defaults    = signal<string[]>([]);
  pickedRecipients   = signal<Set<string>>(new Set<string>());
  private optionsLoaded = false;

  draft: Booking = empty();
  pickedName = signal<string | null>(null);

  statusOptions = ['requested','confirmed','completed','cancelled','no_show'] as const;
  statusLabel = (s: string) => ({
    requested: 'Requested', confirmed: 'Confirmed', completed: 'Completed',
    cancelled: 'Cancelled', no_show: 'No-show',
  } as Record<string, string>)[s] ?? s;

  // Lead picker
  pickerQuery = '';
  pickerResults = signal<Array<{ type: 'lead'|'contact'; id: number; name: string; company: string | null; email: string | null; phone: string | null }>>([]);
  pickerLoading = signal(false);
  showPicker    = signal(false);

  newLeadOpen = signal(false);
  newLead = { name: '', company: '', email: '', phone: '' };
  private pickerDebounce: any = null;

  isNew(): boolean { return this.bookingId === 'new'; }

  ngOnChanges(ch: SimpleChanges) {
    if (!('bookingId' in ch)) return;
    const v = this.bookingId;
    if (v == null) {
      this.open.set(false);
      return;
    }
    this.reset();
    this.open.set(true);
    this.ensureRecipientOptions();
    if (v === 'new') {
      this.formReady.set(true);
    } else {
      this.loadOne(v);
    }
  }

  /** Load the team-member chip list once per component instance. Options
   *  don't change often; the tenant default IS re-read on each fetch so
   *  reopening a NEW-booking modal picks up any Settings tweak. */
  private ensureRecipientOptions() {
    this.api.getLeadBookingRecipientOptions().subscribe({
      next: r => {
        this.recipientOptions.set(r.people);
        this.defaults.set(r.defaults);
        // For a new booking, pre-check the tenant defaults immediately.
        // For an edit, loadOne overrides this once the booking arrives.
        if (this.isNew() && this.pickedRecipients().size === 0) {
          this.pickedRecipients.set(new Set(r.defaults));
        }
        this.optionsLoaded = true;
      },
      error: () => { this.optionsLoaded = true; },
    });
  }

  toggleRecipient(email: string) {
    const next = new Set(this.pickedRecipients());
    if (next.has(email)) next.delete(email);
    else next.add(email);
    this.pickedRecipients.set(next);
  }

  private reset() {
    this.draft = empty();
    this.pickedName.set(null);
    this.newLeadOpen.set(false);
    this.newLead = { name: '', company: '', email: '', phone: '' };
    this.pickerQuery = '';
    this.pickerResults.set([]);
    this.showPicker.set(false);
    this.error.set(null);
    this.formReady.set(false);
    this.saving.set(false);
    this.pickedRecipients.set(new Set<string>());
    this.resendMsg.set(null);
  }

  private loadOne(id: number) {
    this.api.getLeadBooking(id).subscribe({
      next: r => {
        const b = r.booking;
        // notification_recipients is stored as a JSON array (per-booking
        // override) or NULL (use tenant default). Feed the chip picker
        // either way.
        let recipientList: string[] | null = null;
        const raw = b.notification_recipients;
        if (typeof raw === 'string' && raw.trim() !== '') {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) recipientList = parsed.map((x: any) => String(x));
          } catch { /* leave null → fall through to defaults */ }
        } else if (Array.isArray(raw)) {
          recipientList = raw.map((x: any) => String(x));
        }
        this.pickedRecipients.set(new Set(recipientList ?? this.defaults()));

        this.draft = {
          id: b.id, lead_id: b.lead_id, name: b.name,
          email: b.email ?? '', phone: b.phone ?? '', company: b.company ?? '',
          topic: b.topic ?? '', notes: b.notes ?? '',
          scheduled_at: (b.scheduled_at ?? '').replace(' ', 'T').substring(0, 16),
          duration_minutes: b.duration_minutes ?? 15,
          status: b.status,
          meeting_url: b.meeting_url ?? '', source: b.source ?? '',
          assignee_user_id: b.assignee_user_id,
          notification_recipients: '', // superseded by pickedRecipients Set
          notification_sent_at: b.notification_sent_at ?? null,
        };
        this.pickedName.set(b.lead_name || null);
        this.formReady.set(true);
      },
      error: e => {
        this.error.set(e?.error?.error || 'Could not load booking.');
        this.formReady.set(true);
      },
    });
  }

  onPickerType(q: string) {
    this.pickerQuery = q;
    clearTimeout(this.pickerDebounce);
    this.pickerLoading.set(true);
    this.pickerDebounce = setTimeout(() => {
      this.api.searchLeadBookingPeople(q || '').subscribe({
        next: r => { this.pickerResults.set(r.people); this.pickerLoading.set(false); },
        error: () => { this.pickerResults.set([]);    this.pickerLoading.set(false); },
      });
    }, 180);
  }

  pickPerson(p: { type: 'lead'|'contact'; id: number; name: string; company: string | null; email: string | null; phone: string | null }) {
    this.showPicker.set(false);
    if (p.type === 'lead') {
      this.draft.lead_id = p.id;
      this.pickedName.set(p.name + (p.company ? ' · ' + p.company : ''));
      if (!this.draft.name)    this.draft.name    = p.name;
      if (!this.draft.company) this.draft.company = p.company || '';
      if (!this.draft.email)   this.draft.email   = p.email   || '';
      if (!this.draft.phone)   this.draft.phone   = p.phone   || '';
    } else {
      this.newLead = { name: p.name, company: p.company || '', email: p.email || '', phone: p.phone || '' };
      this.newLeadOpen.set(true);
      if (!this.draft.name)    this.draft.name    = p.name;
      if (!this.draft.company) this.draft.company = p.company || '';
      if (!this.draft.email)   this.draft.email   = p.email   || '';
    }
  }

  startNewLead() {
    this.showPicker.set(false);
    this.newLead = {
      name:    this.draft.name    || '',
      company: this.draft.company || '',
      email:   this.draft.email   || '',
      phone:   this.draft.phone   || '',
    };
    this.newLeadOpen.set(true);
  }

  cancelNewLead() {
    this.newLeadOpen.set(false);
    this.newLead = { name: '', company: '', email: '', phone: '' };
  }

  unlink() {
    this.draft.lead_id = null;
    this.pickedName.set(null);
    this.newLeadOpen.set(false);
    this.pickerQuery = '';
    this.pickerResults.set([]);
  }

  close() {
    this.open.set(false);
    this.closed.emit();
  }

  save() {
    this.error.set(null);
    if (!(this.draft.name || '').trim()) { this.error.set('Name is required.'); return; }

    const editing = !this.isNew();
    let newLeadPayload: any = null;
    if (!editing) {
      if (this.newLeadOpen()) {
        if (!(this.newLead.name || '').trim()) { this.error.set('New lead name is required.'); return; }
        newLeadPayload = { ...this.newLead, source: 'call booking' };
      } else if (!this.draft.lead_id) {
        this.error.set('Pick a lead / contact, or create a new lead.');
        return;
      }
    }

    this.saving.set(true);
    // Chip picker → JSON array on the wire. Always sent as a per-booking
    // override (including empty [], which the server honours as
    // "no internal emails for this booking").
    const recipients = Array.from(this.pickedRecipients());
    const payload: any = {
      ...this.draft,
      scheduled_at: this.draft.scheduled_at ? this.draft.scheduled_at.replace('T', ' ') + ':00' : null,
      notification_recipients: recipients,
    };
    if (newLeadPayload) { payload.new_lead = newLeadPayload; payload.lead_id = null; }

    const fail = (e: any) => { this.saving.set(false); this.error.set(e?.error?.error || 'Save failed.'); };
    const done = () => {
      this.saving.set(false);
      this.changed.emit();
      this.close();
    };

    if (editing) {
      this.api.updateLeadBooking(this.bookingId as number, payload).subscribe({ next: done, error: fail });
    } else {
      this.api.createLeadBooking(payload).subscribe({ next: done, error: fail });
    }
  }

  async del() {
    if (this.isNew() || this.bookingId == null) return;
    const ok = await this.dialog.confirm(
      `Delete the booking for "${this.draft.name || 'this contact'}"?`,
      { title: 'Delete booking', confirmLabel: 'Delete', variant: 'danger' },
    );
    if (!ok) return;
    this.api.deleteLeadBooking(this.bookingId as number).subscribe({
      next: () => { this.changed.emit(); this.close(); },
      error: e => this.error.set(e?.error?.error || 'Delete failed.'),
    });
  }

  resend() {
    if (this.isNew() || this.bookingId == null) return;
    this.resending.set(true);
    this.resendMsg.set(null);
    this.api.resendLeadBookingNotifications(this.bookingId as number).subscribe({
      next: r => {
        this.resending.set(false);
        this.resendMsg.set(r.message || 'Sent.');
        // Refresh notification_sent_at from the server.
        this.loadOne(this.bookingId as number);
      },
      error: e => {
        this.resending.set(false);
        this.resendMsg.set(e?.error?.error || 'Resend failed.');
      },
    });
  }
}

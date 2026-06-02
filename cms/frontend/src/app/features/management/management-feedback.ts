import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { HrEmployee, HrFeedbackNote, HrFeedbackNoteKind } from '../../core/models';

const KIND_LABELS: Record<HrFeedbackNoteKind, string> = {
  feedback: 'Feedback',
  one_on_one: '1:1',
  coaching: 'Coaching',
  recognition: 'Recognition',
};

@Component({
  selector: 'app-management-feedback',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Feedback &amp; 1:1s</h1>
    </div>

    <div class="layout">
      <aside class="emp-rail">
        <h2 class="rail-title">Direct reports</h2>
        @if (team().length === 0) {
          <p class="muted small" style="padding: 8px 12px;">No direct reports.</p>
        }
        @for (e of team(); track e.id) {
          <button class="emp-item" [class.active]="selectedEmployeeId() === e.id" (click)="selectEmployee(e)">
            <strong>{{ e.first_name }} {{ e.last_name }}</strong>
            <span class="muted small">{{ e.position || '—' }}</span>
          </button>
        }
      </aside>

      <section class="thread">
        @if (selectedEmployee(); as e) {
          <div class="thread-head">
            <h2>{{ e.first_name }} {{ e.last_name }}</h2>
            <span class="muted small">{{ notes().length }} note{{ notes().length === 1 ? '' : 's' }}</span>
          </div>

          <div class="add-form">
            <div class="form-row">
              <select [(ngModel)]="newKind" name="nk" class="kind-select">
                <option value="one_on_one">1:1</option>
                <option value="feedback">Feedback</option>
                <option value="coaching">Coaching</option>
                <option value="recognition">Recognition</option>
              </select>
              <input type="date" [(ngModel)]="newDate" name="nd" />
              <select [(ngModel)]="newVisibility" name="nv">
                <option value="shared">Shared with employee</option>
                <option value="private">Private (manager only)</option>
              </select>
            </div>
            <textarea rows="3" [(ngModel)]="newBody" name="nb" placeholder="What did you discuss / observe?"></textarea>
            <div class="form-actions">
              <button class="primary" [disabled]="!newBody.trim() || busy()" (click)="addNote()">Add note</button>
            </div>
          </div>

          @if (notes().length === 0) {
            <p class="muted small empty">No notes yet for this report.</p>
          } @else {
            <ul class="note-list">
              @for (n of notes(); track n.id) {
                <li class="note-item" [class.private]="n.visibility === 'private'">
                  <div class="note-meta">
                    <span class="kind-pill kind-{{ n.kind }}">{{ kindLabel(n.kind) }}</span>
                    @if (n.visibility === 'private') { <span class="vis-pill">private</span> }
                    @if (n.meeting_date) { <span class="muted small">{{ n.meeting_date }}</span> }
                    <span class="muted small">{{ n.author_name || n.author_email || 'unknown' }}</span>
                    <span class="spacer"></span>
                    <button class="ghost icon-btn danger" (click)="del(n)" title="Delete note">✕</button>
                  </div>
                  <div class="note-body">{{ n.body }}</div>
                </li>
              }
            </ul>
          }
        } @else {
          <p class="muted" style="padding: 24px;">Pick a direct report on the left to start a thread.</p>
        }
      </section>
    </div>
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .layout { display: grid; grid-template-columns: 260px 1fr; min-height: calc(100vh - 120px); }
    .emp-rail { border-right: 1px solid var(--line); padding: 12px; display: flex; flex-direction: column; gap: 4px; overflow-y: auto; }
    .rail-title { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin: 4px 8px 8px; }
    .emp-item {
      display: flex; flex-direction: column; gap: 2px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 10px 12px; text-align: left; color: var(--fg); cursor: pointer;
    }
    .emp-item:hover { border-color: var(--primary); }
    .emp-item.active { border-color: var(--primary); background: var(--bg-3); }

    .thread { padding: 20px; display: flex; flex-direction: column; gap: 12px; }
    .thread-head { display: flex; justify-content: space-between; align-items: baseline; }
    .thread-head h2 { margin: 0; font-size: 18px; }

    .add-form {
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 14px; display: flex; flex-direction: column; gap: 8px;
    }
    .form-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .kind-select { width: 140px; }
    .form-actions { display: flex; justify-content: flex-end; }

    .note-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .note-item {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 10px 14px;
    }
    .note-item.private { border-left: 3px solid #f97316; }
    .note-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .note-meta .spacer { flex: 1; }
    .note-body { white-space: pre-wrap; line-height: 1.5; font-size: 13px; }
    .empty { padding: 12px 0; }
    .kind-pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .kind-pill.kind-feedback     { color: #60a5fa; border-color: #60a5fa; background: rgba(96,165,250,0.12); }
    .kind-pill.kind-one_on_one   { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .kind-pill.kind-coaching     { color: #a78bfa; border-color: #a78bfa; background: rgba(167,139,250,0.12); }
    .kind-pill.kind-recognition  { color: #10b981; border-color: #10b981; background: rgba(16,185,129,0.12); }
    .vis-pill {
      padding: 1px 6px; border-radius: 4px; font-size: 10px;
      text-transform: uppercase; letter-spacing: 0.5px;
      background: rgba(249,115,22,0.18); color: #f97316;
    }
  `],
})
export class ManagementFeedback {
  private api = inject(Api);

  team = signal<HrEmployee[]>([]);
  selectedEmployeeId = signal<number | null>(null);
  notes = signal<HrFeedbackNote[]>([]);
  busy = signal(false);

  newKind: HrFeedbackNoteKind = 'one_on_one';
  newDate: string = new Date().toISOString().slice(0, 10);
  newVisibility: 'shared' | 'private' = 'shared';
  newBody: string = '';

  selectedEmployee = computed(() => this.team().find(e => e.id === this.selectedEmployeeId()) ?? null);

  ngOnInit() {
    this.api.listMyTeam().subscribe(r => {
      this.team.set(r.team);
      if (r.team.length > 0 && this.selectedEmployeeId() === null) this.selectEmployee(r.team[0]);
    });
  }
  selectEmployee(e: HrEmployee) {
    if (!e.id) return;
    this.selectedEmployeeId.set(e.id);
    this.refreshNotes();
  }
  private refreshNotes() {
    const id = this.selectedEmployeeId();
    if (!id) return;
    this.api.listFeedbackNotes(id).subscribe(r => this.notes.set(r.notes));
  }
  addNote() {
    const id = this.selectedEmployeeId();
    if (!id || !this.newBody.trim()) return;
    this.busy.set(true);
    this.api.addFeedbackNote(id, {
      kind: this.newKind,
      body: this.newBody.trim(),
      meeting_date: this.newDate || undefined,
      visibility: this.newVisibility,
    }).subscribe({
      next: () => {
        this.busy.set(false);
        this.newBody = '';
        this.refreshNotes();
      },
      error: () => this.busy.set(false),
    });
  }
  del(n: HrFeedbackNote) {
    if (!n.id) return;
    if (!confirm('Delete this note?')) return;
    this.api.deleteFeedbackNote(n.id).subscribe(() => this.refreshNotes());
  }
  kindLabel(k: HrFeedbackNoteKind) { return KIND_LABELS[k] || k; }
}

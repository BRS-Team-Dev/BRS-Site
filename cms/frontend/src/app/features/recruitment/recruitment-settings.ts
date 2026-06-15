import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { RecruitmentDocGroup, RecruitmentDocType, RecruitmentSkill } from '../../core/models';

type SettingsTab = 'doc-types' | 'skills';

/**
 * /recruitment/settings — manage the compliance document catalogue. Each
 * required type becomes a row in the candidate onboarding checklist; the
 * agency can edit / add / re-order without code changes.
 *
 * Doc-types are bucketed under collapsible groups (Identity / Right to
 * work / Financial / …) so the catalogue stays scannable as it grows.
 * Types without a group fall under an "Ungrouped" pseudo-section that
 * exists in-memory only — there's no `group_id = 0` row in the DB.
 */
@Component({
  selector: 'app-recruitment-settings',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Settings</h1>
      <span class="spacer"></span>
      @if (activeTab() === 'doc-types') {
        <button class="ghost" (click)="openAddGroup()">+ New group</button>
        <button class="primary" (click)="openAdd()">+ New document type</button>
      } @else {
        <button class="primary" (click)="openAddSkill()">+ New skill</button>
      }
    </div>

    <div class="tab-nav">
      <button class="tab-btn" [class.active]="activeTab() === 'doc-types'" (click)="activeTab.set('doc-types')">
        Document types
      </button>
      <button class="tab-btn" [class.active]="activeTab() === 'skills'" (click)="activeTab.set('skills')">
        Skills <span class="badge">{{ skills().length }}</span>
      </button>
    </div>

    @if (activeTab() === 'doc-types') {
      <p class="muted page-sub">Documents candidates need to submit during onboarding. Toggle "Required" to gate the checklist.</p>
    } @else {
      <p class="muted page-sub">Skills the agency tracks against candidates. Ticking "Add as skill" on a document type mirrors it into this list automatically.</p>
    }

    @if (loading() && activeTab() === 'doc-types') {
      <p class="muted">Loading…</p>
    } @else if (activeTab() === 'doc-types') {
      <div class="group-list">
        @for (g of groupedView(); track g.key) {
          <section class="group-card">
            <button class="group-head" type="button" (click)="toggleCollapse(g.key)">
              <span class="caret">{{ collapsed().has(g.key) ? '▸' : '▾' }}</span>
              <strong class="group-title">{{ g.name }}</strong>
              <span class="muted small">({{ g.types.length }})</span>
              <span class="spacer"></span>
              @if (g.id !== null) {
                <button class="ghost icon-btn" (click)="renameGroup(g, $event)" title="Rename group">✎</button>
                <button class="ghost icon-btn danger" (click)="delGroup(g, $event)" title="Delete group">✕</button>
              }
            </button>
            @if (!collapsed().has(g.key)) {
              @if (g.types.length === 0) {
                <p class="muted small no-types">No document types in this group yet.</p>
              } @else {
                <ul class="type-list">
                  @for (t of g.types; track t.id) {
                    <li class="type-item">
                      <div class="type-head">
                        <strong>{{ t.name }}</strong>
                        @if (t.is_required) {
                          <span class="pill required">required</span>
                        } @else {
                          <span class="pill optional">optional</span>
                        }
                        @if (t.add_to_onboarding) { <span class="pill">onboarding</span> }
                        @if (t.submission_type === 'info_only') { <span class="pill info">info only</span> }
                        @if (t.needs_reference)    { <span class="pill">ref #</span> }
                        @if (t.needs_issuing_body) { <span class="pill">issuing body</span> }
                        @if (t.needs_issue_date)   { <span class="pill">issued</span> }
                        @if (t.needs_expiry_date)  { <span class="pill">expires</span> }
                        <span class="spacer"></span>
                        <button class="ghost icon-btn" (click)="edit(t)" title="Edit">✎</button>
                        <button class="ghost icon-btn danger" (click)="del(t)" title="Delete">✕</button>
                      </div>
                      @if (t.description) { <div class="muted small">{{ t.description }}</div> }
                    </li>
                  }
                </ul>
              }
            }
          </section>
        } @empty {
          <p class="muted">No document types yet — add one to start collecting from candidates.</p>
        }
      </div>
    } @else {
      <!-- ── Skills tab ────────────────────────────────────────── -->
      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else {
        <ul class="skill-list">
          @for (s of skills(); track s.id) {
            <li class="skill-item">
              <strong>{{ s.name }}</strong>
              @if (s.doc_type_id) {
                <span class="pill linked" title="Mirrored from a document type">linked</span>
              }
              <span class="spacer"></span>
              <button class="ghost icon-btn" (click)="renameSkill(s)" title="Rename">✎</button>
              <button class="ghost icon-btn danger" (click)="delSkill(s)" title="Delete">✕</button>
            </li>
          } @empty {
            <li class="muted">No skills yet — add one to start tagging candidates.</li>
          }
        </ul>
      }
    }

    @if (showForm()) {
      <div class="modal-backdrop" (click)="closeForm()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ draft.id ? 'Edit document type' : 'New document type' }}</h2>
            <button class="ghost icon-btn" (click)="closeForm()" title="Close">✕</button>
          </div>
          <div class="modal-body">
            <label>Name <span class="required">*</span></label>
            <input [(ngModel)]="draft.name" name="d_name" placeholder="e.g. Right to work" />

            <label>Group</label>
            <select [(ngModel)]="draft.group_id" name="d_group">
              <option [ngValue]="null">— Ungrouped —</option>
              @for (g of groups(); track g.id) { <option [ngValue]="g.id">{{ g.name }}</option> }
            </select>

            <label>Description</label>
            <textarea rows="2" [(ngModel)]="draft.description" name="d_desc" placeholder="Optional helper text shown to the candidate."></textarea>

            <div class="toggle-grid">
              <label class="inline-toggle">
                <input type="checkbox" [(ngModel)]="draft.is_required" name="d_req" />
                <span>Required</span>
              </label>
              <label class="inline-toggle">
                <input type="checkbox" [(ngModel)]="draft.add_to_onboarding" name="d_onb" />
                <span>Add to Onboarding</span>
              </label>
              <label class="inline-toggle">
                <input type="checkbox" [(ngModel)]="draft.needs_issuing_body" name="d_iss_body" />
                <span>Issuing Body Required</span>
              </label>
              <label class="inline-toggle">
                <input type="checkbox" [(ngModel)]="draft.needs_reference" name="d_ref" />
                <span>Reference No. Required</span>
              </label>
              <label class="inline-toggle">
                <input type="checkbox" [(ngModel)]="draft.needs_issue_date" name="d_iss" />
                <span>Issue Date Required</span>
              </label>
              <label class="inline-toggle">
                <input type="checkbox" [(ngModel)]="draft.needs_expiry_date" name="d_exp" />
                <span>Expiry Date Required</span>
              </label>
              <label class="inline-toggle">
                <input type="checkbox" [(ngModel)]="draft.add_as_skill" name="d_skill" />
                <span>Add as skill</span>
              </label>
            </div>

            <h4 class="sub-heading">Submission type</h4>
            <div class="sub-cards">
              <button type="button" class="sub-card" [class.active]="draft.submission_type !== 'info_only'"
                      (click)="draft.submission_type = 'file'">
                <strong>File upload</strong>
                <span class="muted small">Candidate uploads an actual document file (PDF / image).</span>
              </button>
              <button type="button" class="sub-card" [class.active]="draft.submission_type === 'info_only'"
                      (click)="draft.submission_type = 'info_only'">
                <strong>Info only</strong>
                <span class="muted small">No file — just collect dates / reference / issuing-body fields.</span>
              </button>
            </div>

            @if (error()) { <p class="err">{{ error() }}</p> }
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="closeForm()">Cancel</button>
            <button class="primary" (click)="save()">{{ draft.id ? 'Save changes' : 'Add type' }}</button>
          </div>
        </div>
      </div>
    }

    @if (showGroupForm()) {
      <div class="modal-backdrop" (click)="closeGroupForm()">
        <div class="modal modal-narrow" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>New group</h2>
            <button class="ghost icon-btn" (click)="closeGroupForm()" title="Close">✕</button>
          </div>
          <div class="modal-body">
            <label>Name <span class="required">*</span></label>
            <input [(ngModel)]="groupDraft.name" name="g_name" placeholder="e.g. Insurance" />
            @if (groupError()) { <p class="err">{{ groupError() }}</p> }
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="closeGroupForm()">Cancel</button>
            <button class="primary" (click)="saveGroup()">Add group</button>
          </div>
        </div>
      </div>
    }

    @if (showSkillForm()) {
      <div class="modal-backdrop" (click)="closeSkillForm()">
        <div class="modal modal-narrow" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ skillDraft.id ? 'Rename skill' : 'New skill' }}</h2>
            <button class="ghost icon-btn" (click)="closeSkillForm()" title="Close">✕</button>
          </div>
          <div class="modal-body">
            <label>Name <span class="required">*</span></label>
            <input [(ngModel)]="skillDraft.name" name="s_name" placeholder="e.g. Catheter Care" />
            @if (skillError()) { <p class="err">{{ skillError() }}</p> }
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="closeSkillForm()">Cancel</button>
            <button class="primary" (click)="saveSkill()">{{ skillDraft.id ? 'Save changes' : 'Add skill' }}</button>
          </div>
        </div>
      </div>
    }

    @if (showGroupRenameForm()) {
      <div class="modal-backdrop" (click)="closeGroupRenameForm()">
        <div class="modal modal-narrow" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>Rename group</h2>
            <button class="ghost icon-btn" (click)="closeGroupRenameForm()" title="Close">✕</button>
          </div>
          <div class="modal-body">
            <label>Name <span class="required">*</span></label>
            <input [(ngModel)]="groupRenameDraft.name" name="g_rename" />
            @if (groupRenameError()) { <p class="err">{{ groupRenameError() }}</p> }
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="closeGroupRenameForm()">Cancel</button>
            <button class="primary" (click)="saveGroupRename()">Save changes</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .page-sub { margin: 0 24px 12px; }

    .group-list { padding: 0 24px 24px; display: flex; flex-direction: column; gap: 12px; }
    .group-card {
      background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius-sm); overflow: hidden;
    }
    .group-head {
      width: 100%;
      display: flex; align-items: center; gap: 10px;
      background: var(--bg-3); border: 0; border-bottom: 1px solid var(--line);
      padding: 12px 14px; cursor: pointer; color: var(--fg);
      font: inherit; text-align: left;
    }
    .group-head:hover { background: var(--bg-2); }
    .group-card .group-head { border-radius: 0; }
    .group-title { font-size: 14px; }
    .caret { color: var(--muted); width: 14px; display: inline-block; }
    .no-types { padding: 14px; margin: 0; }

    .type-list { list-style: none; margin: 0; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
    .type-item {
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 10px 12px;
      display: flex; flex-direction: column; gap: 4px;
    }
    .type-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .type-head strong { font-size: 14px; }

    .pill {
      display: inline-block; padding: 2px 8px; border-radius: 999px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
      border: 1px solid var(--line); background: var(--bg-2); color: var(--muted);
    }
    .pill.required { color: var(--primary); border-color: var(--primary); background: rgba(255,193,7,0.12); }
    .pill.optional { color: var(--muted); }
    .pill.info { color: #6db4ff; border-color: #4d8edb; background: rgba(77, 142, 219, 0.12); }

    .modal-narrow { width: 420px; }

    .toggle-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px;
    }
    @media (max-width: 540px) { .toggle-grid { grid-template-columns: 1fr; } }
    .inline-toggle {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 12px; background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); cursor: pointer; font-size: 13px; color: var(--fg);
    }
    .inline-toggle input[type="checkbox"] { width: 16px; height: 16px; flex: 0 0 16px; }

    .sub-heading { margin: 18px 0 8px; font-size: 13px; font-weight: 600; color: var(--fg); }
    .sub-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    @media (max-width: 540px) { .sub-cards { grid-template-columns: 1fr; } }
    .sub-card {
      display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 14px;
      cursor: pointer; text-align: left; color: var(--fg);
      transition: border-color 0.15s, background 0.15s;
    }
    .sub-card:hover { border-color: var(--primary); }
    .sub-card.active { border-color: var(--primary); background: rgba(255, 193, 7, 0.08); }
    .sub-card strong { font-size: 14px; color: var(--primary); }

    /* Tab nav between Document types / Skills. */
    .tab-nav {
      display: flex; gap: 4px; padding: 0 24px;
      border-bottom: 1px solid var(--line); margin-bottom: 16px;
    }
    .tab-btn {
      background: transparent; color: var(--muted); border: none;
      padding: 10px 16px; border-bottom: 2px solid transparent;
      cursor: pointer; font-size: 14px; display: inline-flex; align-items: center; gap: 6px;
    }
    .tab-btn:hover { color: var(--fg); }
    .tab-btn.active { color: var(--primary); border-bottom-color: var(--primary); }
    .badge {
      background: var(--bg-3); border: 1px solid var(--line);
      padding: 1px 6px; border-radius: 999px; font-size: 10px; color: var(--muted);
    }

    /* Skills tab — flat list of skill cards matching the type-item shape. */
    .skill-list { list-style: none; margin: 0; padding: 0 24px 24px; display: flex; flex-direction: column; gap: 8px; }
    .skill-item {
      background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 10px 14px;
      display: flex; align-items: center; gap: 8px;
    }
    .skill-item strong { font-size: 14px; }
    .pill.linked { color: #6db4ff; border-color: #4d8edb; background: rgba(77, 142, 219, 0.12); }

    .required { color: #ef4444; }
    .err { color: #ef4444; font-size: 13px; margin: 4px 0 0; }
  `],
})
export class RecruitmentSettings {
  private api = inject(Api);

  activeTab = signal<SettingsTab>('doc-types');

  loading = signal<boolean>(true);
  types  = signal<RecruitmentDocType[]>([]);
  groups = signal<RecruitmentDocGroup[]>([]);
  skills = signal<RecruitmentSkill[]>([]);

  /** Collapsed-group keys; stringified group id, or 'ungrouped' for the
   *  pseudo-section. All groups start collapsed; once the user expands
   *  one, that choice is preserved across edits via `userTouched`. */
  collapsed = signal<Set<string>>(new Set());
  private userTouched = false;

  /** Doc-types bucketed into groups + an "Ungrouped" pseudo-section. */
  groupedView = computed<{ key: string; id: number | null; name: string; types: RecruitmentDocType[] }[]>(() => {
    const buckets = new Map<number | null, RecruitmentDocType[]>();
    for (const t of this.types()) {
      const gid = t.group_id ?? null;
      if (!buckets.has(gid)) buckets.set(gid, []);
      buckets.get(gid)!.push(t);
    }
    const sections = this.groups().map(g => ({
      key: String(g.id), id: g.id ?? null, name: g.name,
      types: buckets.get(g.id ?? null) ?? [],
    }));
    const ungrouped = buckets.get(null) ?? [];
    if (ungrouped.length > 0) {
      sections.push({ key: 'ungrouped', id: null, name: 'Ungrouped', types: ungrouped });
    }
    return sections;
  });

  showForm  = signal<boolean>(false);
  error     = signal<string | null>(null);
  draft: RecruitmentDocType = this.blank();

  showGroupForm = signal<boolean>(false);
  groupError    = signal<string | null>(null);
  groupDraft: RecruitmentDocGroup = { name: '' };

  showSkillForm = signal<boolean>(false);
  skillError    = signal<string | null>(null);
  skillDraft: RecruitmentSkill = { name: '' };

  showGroupRenameForm = signal<boolean>(false);
  groupRenameError    = signal<string | null>(null);
  groupRenameDraft: RecruitmentDocGroup & { id?: number } = { name: '' };

  constructor() { this.refresh(); }

  refresh() {
    this.loading.set(true);
    this.api.listRecruitmentDocTypes().subscribe({
      next: r => {
        this.types.set(r.types ?? []);
        this.loading.set(false);
        if (!this.userTouched) this.collapseAll();
      },
      error: () => this.loading.set(false),
    });
    this.api.listRecruitmentDocGroups().subscribe(r => {
      this.groups.set(r.groups ?? []);
      if (!this.userTouched) this.collapseAll();
    });
    this.refreshSkills();
  }
  refreshSkills() {
    this.api.listRecruitmentSkills().subscribe(r => this.skills.set(r.skills ?? []));
  }

  /** Collapse every group + the Ungrouped pseudo-section. Called on
   *  initial load (and after any refresh until the user expands
   *  something). */
  private collapseAll() {
    const keys = new Set<string>();
    for (const g of this.groups()) if (g.id) keys.add(String(g.id));
    if (this.types().some(t => !t.group_id)) keys.add('ungrouped');
    this.collapsed.set(keys);
  }

  toggleCollapse(key: string) {
    this.userTouched = true;
    const next = new Set(this.collapsed());
    if (next.has(key)) next.delete(key); else next.add(key);
    this.collapsed.set(next);
  }

  // ── Type CRUD ─────────────────────────────────────────────────────
  openAdd() { this.draft = this.blank(); this.error.set(null); this.showForm.set(true); }
  edit(t: RecruitmentDocType) {
    this.draft = { ...t, group_id: t.group_id ?? null };
    this.error.set(null);
    this.showForm.set(true);
  }
  closeForm() { this.showForm.set(false); }

  save() {
    const d = this.draft;
    if (!d.name?.trim()) { this.error.set('Name is required.'); return; }
    const payload: RecruitmentDocType = {
      name: d.name.trim(),
      description: d.description ?? null,
      group_id: d.group_id ?? null,
      is_required: d.is_required ? 1 : 0,
      add_to_onboarding: d.add_to_onboarding ? 1 : 0,
      add_as_skill: d.add_as_skill ? 1 : 0,
      submission_type: d.submission_type === 'info_only' ? 'info_only' : 'file',
      needs_reference: d.needs_reference ? 1 : 0,
      needs_issuing_body: d.needs_issuing_body ? 1 : 0,
      needs_issue_date: d.needs_issue_date ? 1 : 0,
      needs_expiry_date: d.needs_expiry_date ? 1 : 0,
      sort_order: d.sort_order ?? 0,
    };
    const done = () => { this.showForm.set(false); this.refresh(); };
    if (d.id) this.api.updateRecruitmentDocType(d.id, payload).subscribe({ next: done });
    else      this.api.createRecruitmentDocType(payload).subscribe({ next: done });
  }
  del(t: RecruitmentDocType) {
    if (!t.id) return;
    if (!confirm(`Delete "${t.name}"? Existing candidate uploads tagged with this type lose the tag but stay intact.`)) return;
    this.api.deleteRecruitmentDocType(t.id).subscribe(() => this.refresh());
  }

  // ── Group CRUD ────────────────────────────────────────────────────
  openAddGroup() {
    this.groupDraft = { name: '' };
    this.groupError.set(null);
    this.showGroupForm.set(true);
  }
  closeGroupForm() { this.showGroupForm.set(false); }
  saveGroup() {
    const name = this.groupDraft.name?.trim();
    if (!name) { this.groupError.set('Name is required.'); return; }
    this.api.createRecruitmentDocGroup({ name }).subscribe({
      next: () => { this.showGroupForm.set(false); this.refresh(); },
      error: e => this.groupError.set(e?.error?.error ?? 'Failed to create group.'),
    });
  }
  renameGroup(g: { id: number | null; name: string }, ev: Event) {
    ev.stopPropagation();
    if (g.id === null) return;
    this.groupRenameDraft = { id: g.id, name: g.name };
    this.groupRenameError.set(null);
    this.showGroupRenameForm.set(true);
  }
  closeGroupRenameForm() { this.showGroupRenameForm.set(false); }
  saveGroupRename() {
    const d = this.groupRenameDraft;
    const name = d.name?.trim();
    if (!d.id || !name) { this.groupRenameError.set('Name is required.'); return; }
    this.api.updateRecruitmentDocGroup(d.id, { name }).subscribe({
      next: () => { this.showGroupRenameForm.set(false); this.refresh(); },
      error: e => this.groupRenameError.set(e?.error?.error ?? 'Failed to rename group.'),
    });
  }
  delGroup(g: { id: number | null; name: string; types: RecruitmentDocType[] }, ev: Event) {
    ev.stopPropagation();
    if (g.id === null) return;
    const msg = g.types.length
      ? `Delete "${g.name}"? Its ${g.types.length} document type${g.types.length === 1 ? '' : 's'} will become Ungrouped (not deleted).`
      : `Delete "${g.name}"?`;
    if (!confirm(msg)) return;
    this.api.deleteRecruitmentDocGroup(g.id).subscribe(() => this.refresh());
  }

  private blank(): RecruitmentDocType {
    return {
      name: '', description: '',
      group_id: null,
      is_required: true,
      add_to_onboarding: true,
      add_as_skill: false,
      submission_type: 'file',
      needs_reference: false,
      needs_issuing_body: false,
      needs_issue_date: false,
      needs_expiry_date: false,
      sort_order: (this.types().length + 1) * 10,
    };
  }

  // ── Skills CRUD ──────────────────────────────────────────────────
  openAddSkill() {
    this.skillDraft = { name: '' };
    this.skillError.set(null);
    this.showSkillForm.set(true);
  }
  closeSkillForm() { this.showSkillForm.set(false); }
  saveSkill() {
    const d = this.skillDraft;
    const name = d.name?.trim();
    if (!name) { this.skillError.set('Name is required.'); return; }
    const done = () => { this.showSkillForm.set(false); this.refresh(); };
    const fail = (e: any) => this.skillError.set(e?.error?.error ?? 'Failed to save skill.');
    if (d.id) {
      this.api.updateRecruitmentSkill(d.id, { name }).subscribe({ next: done, error: fail });
    } else {
      this.api.createRecruitmentSkill({ name }).subscribe({ next: done, error: fail });
    }
  }
  renameSkill(s: RecruitmentSkill) {
    if (!s.id) return;
    this.skillDraft = { id: s.id, name: s.name };
    this.skillError.set(null);
    this.showSkillForm.set(true);
  }
  delSkill(s: RecruitmentSkill) {
    if (!s.id) return;
    const msg = s.doc_type_id
      ? `Delete "${s.name}"? It is linked to a document type — the type's "Add as skill" checkbox will also un-tick.`
      : `Delete "${s.name}"?`;
    if (!confirm(msg)) return;
    // After delete, refresh both the skill list AND the doc-types so
    // the corresponding "Add as skill" toggle on Document types reflects
    // the unlink (the GET re-derives the flag from EXISTS).
    this.api.deleteRecruitmentSkill(s.id).subscribe(() => this.refresh());
  }
}

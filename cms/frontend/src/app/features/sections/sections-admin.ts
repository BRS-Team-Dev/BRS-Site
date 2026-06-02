import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { AdminSection, FormDef } from '../../core/models';
import { SIDENAV_BUILTIN_PARENTS } from '../../core/sidenav-config';

/**
 * Combined component covering:
 *   /admin/sections           → list + manage
 *   /admin/sections/new       → create
 *   /admin/sections/:id/edit  → edit
 *   /admin/section/:id        → view (the resulting CMS page for that section)
 */
@Component({
  selector: 'app-sections-admin',
  imports: [RouterLink, FormsModule],
  template: `
    @if (mode() === 'list') {
      <div class="toolbar">
        <h1>Admin sections</h1>
        <span class="spacer"></span>
        <button class="primary" routerLink="/admin/sections/new">+ New section</button>
      </div>

      @if (sections().length === 0) {
        <div class="empty">
          <p class="muted">No independent sections yet.</p>
          <button class="primary" routerLink="/admin/sections/new">Create your first section</button>
        </div>
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th>Title</th><th>Slug</th><th>Placement</th><th></th>
            </tr></thead>
            <tbody>
              @for (s of sections(); track s.id) {
                <tr (click)="edit(s)">
                  <td><strong>{{ s.title }}</strong></td>
                  <td><code>{{ s.slug }}</code></td>
                  <td>
                    @if (s.sidenav_placement === 'child') { Child of <code>{{ s.sidenav_parent_key }}</code> }
                    @else { Top-level }
                  </td>
                  <td class="actions">
                    <button class="ghost icon-btn" (click)="edit(s, $event)" title="Edit">✎</button>
                    <button class="ghost icon-btn danger" (click)="del(s, $event)" title="Delete">✕</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }

    @if (mode() === 'edit') {
      <div class="toolbar">
        <button class="ghost" (click)="back()">← Back</button>
        <h1>{{ isNew() ? 'New section' : 'Edit section' }}</h1>
        <span class="spacer"></span>
        @if (saving()) { <span class="muted small">Saving…</span> }
        @if (error()) { <span class="error-msg">{{ error() }}</span> }
        <button class="primary" (click)="save()" [disabled]="saving()">Save</button>
      </div>

      <div class="layout">
        <section class="card">
          <h2>Section details</h2>

          <label>Title</label>
          <input [(ngModel)]="draft.title" (ngModelChange)="autoSlug()" name="t" />

          <label>Slug</label>
          <input [(ngModel)]="draft.slug" name="s" />
          <div class="muted small">Lowercase letters, digits, underscores. Starts with a letter.</div>

          <label>Description (optional)</label>
          <textarea [(ngModel)]="draft.description" name="d" rows="3"></textarea>

          <hr />
          <h2>Sidenav placement</h2>
          <label>Where should this section appear?</label>
          <select [(ngModel)]="draft.sidenav_placement" name="p">
            <option value="top">Top-level</option>
            <option value="child">As a child of another section</option>
          </select>

          @if (draft.sidenav_placement === 'child') {
            <label>Parent</label>
            <select [(ngModel)]="draft.sidenav_parent_key" name="pk">
              <option [ngValue]="null">— pick a parent —</option>
              @for (p of parentChoices(); track p.key) {
                <option [ngValue]="p.key">{{ p.label }}</option>
              }
            </select>
          }
        </section>
      </div>
    }

    @if (mode() === 'view' && section(); as s) {
      <div class="toolbar"><h1>{{ s.title }}</h1></div>
      <div class="empty">
        @if (s.description) { <p>{{ s.description }}</p> }
        <p class="muted">This section is independent of any onboarding form. Add features here later.</p>
        <button class="ghost" [routerLink]="['/admin/sections', s.id, 'edit']">Edit section</button>
      </div>
    }
  `,
  styles: [`
    .layout { display: grid; grid-template-columns: 480px; gap: 20px; padding: 20px; }
    .card h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin: 0 0 12px 0; font-weight: 600; }
    .card label { margin-top: 12px; }
    .card hr { border: none; border-top: 1px solid var(--line); margin: 20px 0 16px 0; }
    td.actions { text-align: right; white-space: nowrap; }
    td.actions .icon-btn + .icon-btn { margin-left: 4px; }
    .icon-btn {
      width: 32px; height: 32px; padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 15px; line-height: 1;
    }
    .icon-btn:hover { color: var(--primary); border-color: var(--primary); }
    .icon-btn.danger:hover { color: var(--danger); border-color: var(--danger); background: rgba(255,100,100,0.08); }
  `],
})
export class SectionsAdmin {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  mode = signal<'list' | 'edit' | 'view'>('list');
  isNew = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);
  sections = signal<AdminSection[]>([]);
  section = signal<AdminSection | null>(null);
  onboardingForms = signal<FormDef[]>([]);

  draft: AdminSection = { slug: '', title: '', description: '', sidenav_placement: 'top', sidenav_parent_key: null };

  parentChoices = computed<{ key: string; label: string }[]>(() => {
    const onb = this.onboardingForms().map(f => ({ key: String(f.id), label: f.main_section_label || f.title }));
    const builtIns = SIDENAV_BUILTIN_PARENTS.map(p => ({ key: p.key, label: `${p.label} (built-in)` }));
    return [...builtIns, ...onb];
  });

  ngOnInit() {
    this.api.listOnboardingForms().subscribe(r => this.onboardingForms.set(r.forms));

    const url = this.router.url;
    if (/\/admin\/sections\/new/.test(url)) {
      this.mode.set('edit');
      this.isNew.set(true);
    } else if (/\/admin\/sections\/\d+\/edit/.test(url)) {
      this.mode.set('edit');
      this.isNew.set(false);
      const id = +this.route.snapshot.paramMap.get('id')!;
      this.api.getSection(id).subscribe(r => this.draft = { ...r.section });
    } else if (/\/admin\/section\/\d+/.test(url)) {
      this.mode.set('view');
      const id = +this.route.snapshot.paramMap.get('id')!;
      this.api.getSection(id).subscribe(r => this.section.set(r.section));
    } else {
      this.mode.set('list');
      this.api.listSections().subscribe(r => this.sections.set(r.sections));
    }
  }

  autoSlug() {
    if (!this.isNew()) return;
    if (!this.draft.title) return;
    const slug = this.draft.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 60);
    if (slug && /^[a-z]/.test(slug)) this.draft.slug = slug;
  }

  edit(s: AdminSection, e?: Event) {
    e?.stopPropagation();
    this.router.navigate(['/admin/sections', s.id, 'edit']);
  }
  del(s: AdminSection, e: Event) {
    e.stopPropagation();
    if (!confirm(`Delete section "${s.title}"?`)) return;
    this.api.deleteSection(s.id!).subscribe(() => this.api.listSections().subscribe(r => this.sections.set(r.sections)));
  }

  save() {
    this.error.set(null);
    if (!this.draft.title || !this.draft.slug) { this.error.set('Title and slug are required'); return; }
    if (!/^[a-z][a-z0-9_]{0,59}$/.test(this.draft.slug)) {
      this.error.set('Slug must be lowercase letters/digits/underscore'); return;
    }
    const payload: AdminSection = {
      ...this.draft,
      sidenav_placement: this.draft.sidenav_placement || 'top',
      sidenav_parent_key: this.draft.sidenav_placement === 'child' ? (this.draft.sidenav_parent_key ?? null) : null,
    };
    this.saving.set(true);
    const handler = {
      next: () => { this.saving.set(false); this.router.navigateByUrl('/admin/sections'); },
      error: (e: any) => { this.saving.set(false); this.error.set(e?.error?.error || 'Save failed'); },
    };
    if (this.isNew()) this.api.createSection(payload).subscribe(handler);
    else this.api.updateSection(this.draft.id!, payload).subscribe(handler);
  }

  back() { this.router.navigateByUrl('/admin/sections'); }
}

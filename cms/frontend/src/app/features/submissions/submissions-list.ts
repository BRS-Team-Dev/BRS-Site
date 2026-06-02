import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { FormDef, FormField } from '../../core/models';
import { SidePanel } from '../../layout/side-panel.service';
import { SubmissionDetail } from './submission-detail';
import { FormDetailPanel } from '../forms/form-detail-panel';

@Component({
  selector: 'app-submissions-list',
  imports: [RouterLink],
  template: `
    @if (!formId()) {
      <div class="toolbar">
        <h1>Submissions</h1>
        <span class="spacer"></span>
        <span class="muted small">{{ totalSubmissions() }} total across {{ forms().length }} form(s)</span>
      </div>

      @if (forms().length === 0) {
        <div class="empty">
          <p>No forms yet.</p>
          <button class="primary" routerLink="/admin/forms/new">Create your first form</button>
        </div>
      } @else {
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th>Title</th><th>Slug</th><th>Submissions</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              @for (f of forms(); track f.id) {
                <tr (click)="goTo(f)">
                  <td><strong>{{ f.title }}</strong></td>
                  <td><code>{{ f.slug }}</code></td>
                  <td>
                    @if ((f.submission_count ?? 0) > 0) {
                      <span class="count-badge">{{ f.submission_count }}</span>
                    } @else {
                      <span class="muted">0</span>
                    }
                  </td>
                  <td>
                    @if (f.is_published) {
                      <span class="badge success">Published</span>
                    } @else {
                      <span class="badge warning">Draft</span>
                    }
                  </td>
                  <td class="actions">
                    <button class="ghost icon-btn" (click)="openDetail(f, $event)" title="Form details" aria-label="Open form details panel">ⓘ</button>
                    <button class="ghost icon-btn" (click)="goTo(f, $event)" title="View submissions" aria-label="View submissions">☰</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    } @else {
      <div class="toolbar breadcrumb-bar">
        @if (context() === 'forms') {
          <a routerLink="/admin/forms" class="crumb">Forms</a>
        } @else {
          <a routerLink="/admin/submissions" class="crumb">Submissions</a>
        }
        <span class="sep">›</span>
        <h1>{{ form()?.title }}</h1>
        <span class="spacer"></span>
        <span class="muted small">{{ total() }} total</span>
      </div>
      <div class="table-wrap">
        @if (rows().length === 0) {
          <div class="empty">No submissions yet.</div>
        } @else {
          <table class="data">
            <thead><tr>
              <th>#</th><th>Submitted</th>
              @for (col of fields(); track col.id) { <th>{{ col.label }}</th> }
            </tr></thead>
            <tbody>
              @for (r of rows(); track r.id) {
                <tr (click)="open(r)">
                  <td>{{ r.id }}</td>
                  <td>{{ r.submitted_at }}</td>
                  @for (col of fields(); track col.id) {
                    <td>{{ truncate(r[col.name]) }}</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    }
  `,
  styles: [`
    td.actions { text-align: right; white-space: nowrap; }
    .icon-btn {
      width: 32px; height: 32px;
      padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 15px; line-height: 1;
    }
    .icon-btn:hover { color: var(--primary); border-color: var(--primary); }
    .count-badge {
      display: inline-block; min-width: 28px; padding: 2px 8px;
      text-align: center;
      border-radius: 999px; font-size: 12px; font-weight: 600;
      background: var(--primary); color: #0a0a0a;
    }
    .breadcrumb-bar .crumb {
      color: var(--muted); font-size: 13px;
      text-decoration: none;
    }
    .breadcrumb-bar .crumb:hover { color: var(--primary); }
    .breadcrumb-bar .sep { color: var(--muted); font-size: 14px; }
    .breadcrumb-bar h1 { margin: 0; }
  `],
})
export class SubmissionsList {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private panel = inject(SidePanel);

  formId = signal<number | null>(null);
  form = signal<FormDef | null>(null);
  fields = signal<FormField[]>([]);
  rows = signal<any[]>([]);
  total = signal(0);
  forms = signal<FormDef[]>([]);
  context = signal<'forms' | 'submissions'>('submissions');
  totalSubmissions = computed(() =>
    this.forms().reduce((sum, f) => sum + (f.submission_count ?? 0), 0)
  );

  ngOnInit() {
    this.context.set(this.router.url.startsWith('/admin/forms/') ? 'forms' : 'submissions');
    this.route.paramMap.subscribe(p => {
      const id = p.get('id');
      if (id) { this.formId.set(+id); this.load(+id); }
      else { this.api.listForms().subscribe(r => this.forms.set(r.forms)); }
    });
  }

  load(id: number) {
    this.api.getForm(id).subscribe(r => { this.form.set(r.form); this.fields.set(r.fields); });
    this.api.listSubmissions(id).subscribe(r => { this.rows.set(r.rows); this.total.set(r.total); });
  }
  open(row: any) {
    this.panel.open(SubmissionDetail, {
      formId: this.formId()!,
      row,
      fields: this.fields(),
      onDeleted: () => { this.load(this.formId()!); this.panel.close(); },
    }, `Submission #${row.id}`);
  }
  truncate(v: any) { const s = String(v ?? ''); return s.length > 60 ? s.slice(0, 60) + '…' : s; }
  back() { this.router.navigateByUrl('/admin/forms'); }
  goTo(f: FormDef, e?: Event) { e?.stopPropagation(); this.router.navigate(['/admin/submissions', f.id]); }
  openDetail(f: FormDef, e: Event) {
    e.stopPropagation();
    this.panel.open(FormDetailPanel, { form: f, onDeleted: () => this.refreshForms() }, f.title);
  }
  refreshForms() {
    this.api.listForms().subscribe(r => this.forms.set(r.forms));
    this.panel.close();
  }
}

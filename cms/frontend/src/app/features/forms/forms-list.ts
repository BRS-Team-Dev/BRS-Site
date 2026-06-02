import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { FormDef } from '../../core/models';
import { SidePanel } from '../../layout/side-panel.service';
import { FormDetailPanel } from './form-detail-panel';

@Component({
  selector: 'app-forms-list',
  imports: [RouterLink],
  template: `
    <div class="toolbar">
      <h1>Forms</h1>
      <span class="spacer"></span>
      <button class="primary" routerLink="/admin/forms/new">+ New form</button>
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
            <th>Title</th><th>Slug</th><th>Fields</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            @for (f of forms(); track f.id) {
              <tr (click)="openDetail(f)">
                <td><strong>{{ f.title }}</strong></td>
                <td><code>{{ f.slug }}</code></td>
                <td>{{ f.field_count }}</td>
                <td>
                  @if (f.is_published) {
                    <span class="badge success">Published</span>
                  } @else {
                    <span class="badge warning">Draft</span>
                  }
                </td>
                <td class="actions">
                  <button class="ghost icon-btn" (click)="edit(f, $event)" title="Edit" aria-label="Edit form">✎</button>
                  <button class="ghost icon-btn" (click)="viewSubs(f, $event)" title="Submissions" aria-label="View submissions">☰</button>
                  <button class="ghost icon-btn" (click)="goToForm(f, $event)" title="Go to form" aria-label="Open public form in new tab">↗</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: [`
    td.actions { text-align: right; white-space: nowrap; }
    td.actions .icon-btn + .icon-btn { margin-left: 4px; }
    .icon-btn {
      width: 32px; height: 32px;
      padding: 0;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 15px; line-height: 1;
    }
    .icon-btn:hover { color: var(--primary); border-color: var(--primary); }
  `],
})
export class FormsList {
  private api = inject(Api);
  private router = inject(Router);
  private panel = inject(SidePanel);
  forms = signal<FormDef[]>([]);

  ngOnInit() {
    this.api.listForms().subscribe(res => this.forms.set(res.forms));
  }

  openDetail(f: FormDef) {
    this.panel.open(FormDetailPanel, { form: f, onDeleted: () => this.refresh() }, f.title);
  }
  edit(f: FormDef, e: Event) { e.stopPropagation(); this.router.navigate(['/admin/forms', f.id, 'edit']); }
  viewSubs(f: FormDef, e: Event) { e.stopPropagation(); this.router.navigate(['/admin/forms', f.id, 'submissions']); }
  goToForm(f: FormDef, e: Event) {
    e.stopPropagation();
    const url = new URL(`forms/${encodeURIComponent(f.slug)}`, document.baseURI).href;
    window.open(url, '_blank');
  }
  refresh() { this.api.listForms().subscribe(res => this.forms.set(res.forms)); this.panel.close(); }
}

import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { FormDef } from '../../core/models';

@Component({
  selector: 'app-onboarding-list',
  imports: [RouterLink],
  template: `
    <div class="toolbar">
      <h1>Onboarding</h1>
      <span class="spacer"></span>
      <button class="primary" routerLink="/admin/onboarding/new">+ New onboarding</button>
    </div>

    @if (forms().length === 0) {
      <div class="empty">
        <p>No onboarding templates yet.</p>
        <button class="primary" routerLink="/admin/onboarding/new">Create your first template</button>
      </div>
    } @else {
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th>Title</th><th>Slug</th><th>Sections</th><th>Clients</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            @for (f of forms(); track f.id) {
              <tr (click)="edit(f)">
                <td><strong>{{ f.title }}</strong></td>
                <td><code>{{ f.slug }}</code></td>
                <td>{{ f.section_count ?? 0 }}</td>
                <td>
                  @if ((f.client_count ?? 0) > 0) {
                    <span class="count-badge">{{ f.client_count }}</span>
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
                  <button class="ghost icon-btn" (click)="edit(f, $event)" title="Edit" aria-label="Edit template">✎</button>
                  <button class="ghost icon-btn" (click)="viewClients(f, $event)" title="Clients" aria-label="View clients">☰</button>
                  <button class="ghost icon-btn danger" (click)="del(f, $event)" title="Delete" aria-label="Delete template">✕</button>
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
    .icon-btn.danger:hover { color: var(--danger); border-color: var(--danger); background: rgba(255,100,100,0.08); }
    .count-badge {
      display: inline-block; min-width: 28px; padding: 2px 8px;
      text-align: center;
      border-radius: 999px; font-size: 12px; font-weight: 600;
      background: var(--primary); color: #0a0a0a;
    }
  `],
})
export class OnboardingList {
  private api = inject(Api);
  private router = inject(Router);
  forms = signal<FormDef[]>([]);

  ngOnInit() {
    this.api.listOnboardingForms().subscribe(r => this.forms.set(r.forms));
  }

  edit(f: FormDef, e?: Event) {
    e?.stopPropagation();
    this.router.navigate(['/admin/onboarding', f.id, 'edit']);
  }
  viewClients(f: FormDef, e: Event) {
    e.stopPropagation();
    this.router.navigate(['/admin/onboarding', f.id, 'clients']);
  }
  del(f: FormDef, e: Event) {
    e.stopPropagation();
    if (!confirm(`Delete template "${f.title}"? This drops the data table form_${f.slug} and removes all clients + responses.`)) return;
    this.api.deleteOnboardingForm(f.id!).subscribe(() => {
      this.api.listOnboardingForms().subscribe(r => this.forms.set(r.forms));
    });
  }
}

import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api } from '../../core/api';
import { FormDef } from '../../core/models';

/**
 * Services section.
 *
 * Reachable at `/admin/services`. Lists every onboarding form whose
 * sidenav placement nests it under Services (`sidenav_placement='child'`
 * and `sidenav_parent_key='services'`) — i.e. the same set the sidenav
 * renders under the Services group via `childrenOfBuiltin('services')`.
 *
 * Click a row → opens that form's qualified-clients (main section) page.
 */
@Component({
  selector: 'app-services-admin',
  template: `
    <div class="toolbar">
      <h1>Services</h1>
      <span class="spacer"></span>
      <span class="muted small">{{ services().length }} onboarding process(es)</span>
    </div>

    @if (services().length === 0) {
      <div class="empty">
        <p class="muted">No onboarding processes attached to Services yet.</p>
        <p class="muted small">
          To attach one: open an onboarding form's settings and set its
          sidenav placement to <em>Child of another section</em> →
          <em>Services</em>.
        </p>
      </div>
    } @else {
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th>Onboarding process</th>
            <th>Slug</th>
            <th>Clients</th>
            <th>Qualified</th>
            <th></th>
          </tr></thead>
          <tbody>
            @for (s of services(); track s.id) {
              <tr (click)="open(s)">
                <td><strong>{{ s.main_section_label || s.title }}</strong></td>
                <td class="muted small">{{ s.slug }}</td>
                <td>{{ s.client_count ?? 0 }}</td>
                <td>{{ s.qualified_count ?? 0 }}</td>
                <td class="actions">
                  <button class="ghost icon-btn" (click)="open(s, $event)" title="Open">→</button>
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
  `],
})
export class ServicesAdmin {
  private api = inject(Api);
  private router = inject(Router);

  forms = signal<FormDef[]>([]);

  services = computed(() =>
    this.forms().filter(f =>
      f.sidenav_placement === 'child' && f.sidenav_parent_key === 'services'
    )
  );

  ngOnInit() {
    this.api.listOnboardingForms().subscribe(r => this.forms.set(r.forms));
  }

  open(s: FormDef, e?: Event) {
    e?.stopPropagation();
    this.router.navigate(['/admin/main', s.id]);
  }
}

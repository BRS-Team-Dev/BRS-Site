import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-system-placeholder',
  template: `
    <div class="wrap">
      <h1>{{ title }} <small>coming soon</small></h1>
      <p class="muted">This module is on the roadmap. Switch back to CMS or HR from the top nav.</p>
    </div>
  `,
  styles: [`
    .wrap { padding: 60px 40px; text-align: center; }
    h1 { font-size: 28px; margin: 0 0 12px; }
    h1 small { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-left: 12px; }
  `],
})
export class SystemPlaceholder {
  private route = inject(ActivatedRoute);
  title = (this.route.snapshot.data?.['title'] as string) || 'Module';
}

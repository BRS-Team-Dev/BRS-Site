import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

/**
 * Lightweight placeholder used for Management pages that haven't been built yet.
 * Title and blurb come from the route's `data` so each route stays a simple entry.
 */
@Component({
  selector: 'app-management-stub',
  template: `
    <div class="toolbar"><h1>{{ data['title'] || 'Coming soon' }}</h1></div>
    <div class="stub">
      <div class="stub-card">
        <h2>Coming soon</h2>
        <p class="muted">{{ data['blurb'] || 'This section is on the roadmap.' }}</p>
        <p class="muted small">Track progress with the team — this section will land in the next pass.</p>
      </div>
    </div>
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .stub { padding: 40px 20px; display: flex; justify-content: center; }
    .stub-card {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 32px; max-width: 520px; text-align: center;
    }
    .stub-card h2 { margin: 0 0 12px; font-size: 16px; color: var(--primary); }
  `],
})
export class ManagementStub {
  private route = inject(ActivatedRoute);
  data: Record<string, any> = this.route.snapshot.data || {};
}

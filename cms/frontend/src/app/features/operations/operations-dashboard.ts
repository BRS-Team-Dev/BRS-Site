import { Component } from '@angular/core';

/**
 * Operations dashboard — scaffolded landing page for the Operations system.
 *
 * Intentionally minimal: shows the section is set up and routable. Features
 * (cards, KPIs, links to sub-pages) will be added as the operations domain
 * is defined.
 */
@Component({
  selector: 'app-operations-dashboard',
  template: `
    <div class="wrap">
      <h1>Operations</h1>
      <p class="muted">Dashboard for the Operations system. Add modules and KPIs here.</p>

      <div class="grid">
        <div class="card">
          <h3>Up next</h3>
          <p class="muted small">No sub-modules yet. Add navigation entries in <code>operations-side-nav.ts</code> and routes in <code>app.routes.ts</code> as features land.</p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .wrap { padding: 24px 28px; }
    h1 { margin: 0 0 4px; font-size: 24px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
      margin-top: 24px;
    }
    .card {
      background: var(--bg-3);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 16px;
    }
    .card h3 {
      font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;
      color: var(--muted); margin: 0 0 12px; font-weight: 600;
    }
    .small { font-size: 12px; }
    code { background: var(--bg-2); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  `],
})
export class OperationsDashboard {}

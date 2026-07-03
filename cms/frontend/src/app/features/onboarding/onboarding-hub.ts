import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { FormDef } from '../../core/models';

/**
 * Onboarding hub (URL `/admin/onboarding`) — the landing page for the
 * Onboarding sidenav group. Shows both surfaces (standard Forms and
 * Multipart forms) as compact overview cards so admins can see at a
 * glance what exists in each and jump straight in.
 *
 * Actual list + admin lives on each dedicated child page:
 *   - Forms          -> /admin/forms
 *   - Multipart forms -> /admin/onboarding/multipart
 */

@Component({
  selector: 'app-onboarding-hub',
  imports: [RouterLink],
  template: `
    <div class="toolbar">
      <h1>Onboarding</h1>
    </div>

    <div class="hub-grid">
      <a class="hub-card" routerLink="/admin/forms">
        <div class="head">
          <span class="badge">Forms</span>
          <h2>Standard forms</h2>
        </div>
        <p class="muted small">
          Single-screen captures — contact, newsletter, quick enquiries.
          Every submission lands in one row of a dedicated table.
        </p>
        <div class="stat">
          <strong>{{ standardCount() }}</strong>
          <span class="muted small">{{ standardCount() === 1 ? 'form' : 'forms' }}</span>
        </div>
        <div class="cta">Open forms →</div>
      </a>

      <a class="hub-card" routerLink="/admin/onboarding/multipart">
        <div class="head">
          <span class="badge primary">Multipart</span>
          <h2>Multipart forms</h2>
        </div>
        <p class="muted small">
          Multi-section flows with an emailed portal link, saved progress,
          per-section completion tracking, and optional service pricing.
        </p>
        <div class="stat">
          <strong>{{ multipartCount() }}</strong>
          <span class="muted small">{{ multipartCount() === 1 ? 'template' : 'templates' }}</span>
        </div>
        <div class="cta">Open multipart →</div>
      </a>
    </div>
  `,
  styles: [`
    .hub-grid {
      display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;
      /* Match .toolbar's horizontal padding (16px 24px) so the cards
         sit under the H1 rather than butting against the pane edges. */
      padding: 20px 24px;
    }
    @media (max-width: 800px) { .hub-grid { grid-template-columns: 1fr; } }

    .hub-card {
      display: flex; flex-direction: column; gap: 12px;
      padding: 20px;
      background: var(--bg-2);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      color: var(--fg); text-decoration: none;
      transition: border-color .15s, transform .15s, box-shadow .15s;
    }
    .hub-card:hover {
      border-color: var(--primary);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0,0,0,0.25);
    }
    .hub-card .head { display: flex; align-items: center; gap: 10px; }
    .hub-card h2 { margin: 0; font-size: 16px; font-weight: 700; }
    .hub-card p { margin: 0; line-height: 1.5; }
    .hub-card .badge {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 10px; font-weight: 700; letter-spacing: 0.5px;
      text-transform: uppercase;
      background: var(--bg-3); color: var(--muted);
    }
    .hub-card .badge.primary {
      background: color-mix(in oklab, var(--primary), transparent 78%);
      color: var(--primary);
    }
    .hub-card .stat {
      display: flex; align-items: baseline; gap: 8px;
      padding: 8px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
    }
    .hub-card .stat strong { font-size: 24px; font-family: "JetBrains Mono", ui-monospace, monospace; }
    .hub-card .cta { color: var(--primary); font-weight: 600; font-size: 13px; }
  `],
})
export class OnboardingHub {
  private api = inject(Api);
  standard = signal<FormDef[]>([]);
  multipart = signal<FormDef[]>([]);

  standardCount = () => this.standard().length;
  multipartCount = () => this.multipart().length;

  ngOnInit() {
    this.api.listForms().subscribe(r => this.standard.set(r.forms));
    this.api.listOnboardingForms().subscribe(r => this.multipart.set(r.forms));
  }
}

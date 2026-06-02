import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { FormDef, FormSection, OnboardingClient } from '../../core/models';

@Component({
  selector: 'app-qualified-client',
  imports: [RouterLink],
  template: `
    <div class="toolbar breadcrumb-bar">
      <a routerLink="/admin/onboarding" class="crumb">Onboarding</a>
      <span class="sep">›</span>
      <a [routerLink]="['/admin/main', formId()]" class="crumb">{{ sectionLabel() }}</a>
      <span class="sep">›</span>
      <h1>{{ client()?.client_name || client()?.client_email }}</h1>
    </div>

    @if (client(); as c) {
      <div class="layout-2col">
        <section class="card">
          <h3>Client</h3>
          <div class="kv"><label>Email</label><div>{{ c.client_email }}</div></div>
          @if (c.client_name) { <div class="kv"><label>Name</label><div>{{ c.client_name }}</div></div> }
          <div class="kv"><label>Started</label><div>{{ c.started_at }}</div></div>
          @if (c.submitted_at) { <div class="kv"><label>Submitted</label><div>{{ c.submitted_at }}</div></div> }
          <div class="kv"><label>Qualified</label><div class="gold">{{ c.qualified_at }}</div></div>
          @if (c.last_edited_at) { <div class="kv"><label>Last edit</label><div>{{ c.last_edited_at }}</div></div> }

          <hr />
          <button class="danger" (click)="del()" style="width:100%;">Delete client</button>
        </section>

        <section class="card">
          <h3>Responses</h3>
          @if (!submission()) {
            <p class="muted">Client hasn't saved any responses.</p>
          } @else {
            @for (s of sections(); track s.id) {
              <div class="section-block">
                <h4>{{ s.title }}</h4>
                @for (f of s.fields; track f.id) {
                  <div class="kv">
                    <label>{{ f.label }}</label>
                    <div>{{ formatValue(submission()?.[f.name], f.type) }}</div>
                  </div>
                }
              </div>
            }
          }
        </section>
      </div>
    }
  `,
  styles: [`
    .breadcrumb-bar .crumb { color: var(--muted); font-size: 13px; text-decoration: none; }
    .breadcrumb-bar .crumb:hover { color: var(--primary); }
    .breadcrumb-bar .sep { color: var(--muted); font-size: 14px; }
    .breadcrumb-bar h1 { margin: 0; }
    .kv { margin-bottom: 10px; }
    .kv label { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
    .kv > div { color: var(--fg); font-size: 14px; word-break: break-word; }
    .kv .gold { color: var(--primary); }
    .section-block { padding: 16px 0; border-bottom: 1px solid var(--line); }
    .section-block:last-child { border-bottom: none; }
    .section-block h4 { margin: 0 0 12px 0; font-size: 14px; color: var(--primary); text-transform: uppercase; letter-spacing: 0.5px; }
    hr { border: none; border-top: 1px solid var(--line); margin: 16px 0; }
  `],
})
export class QualifiedClient {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  formId = signal<number | null>(null);
  clientId = signal<number | null>(null);
  form = signal<FormDef | null>(null);
  sections = signal<FormSection[]>([]);
  client = signal<OnboardingClient | null>(null);
  submission = signal<any>(null);

  sectionLabel = computed(() => {
    const f = this.form();
    return f?.main_section_label || f?.title || 'Main section';
  });

  ngOnInit() {
    this.route.paramMap.subscribe(p => {
      const fid = +p.get('id')!;
      const cid = +p.get('cid')!;
      this.formId.set(fid);
      this.clientId.set(cid);
      this.api.getOnboardingForm(fid).subscribe(r => {
        this.form.set(r.form);
        this.sections.set(r.sections);
      });
      this.api.getOnboardingClient(fid, cid).subscribe(r => {
        this.client.set(r.client);
        this.submission.set(r.submission);
      });
    });
  }

  del() {
    const fid = this.formId(), cid = this.clientId();
    if (!fid || !cid) return;
    const c = this.client();
    if (!confirm(`Delete ${c?.client_email || 'this client'}? This permanently removes their record and saved responses.`)) return;
    this.api.deleteOnboardingClient(fid, cid).subscribe(() => {
      this.router.navigate(['/admin/main', fid]);
    });
  }

  formatValue(val: any, type: string): string {
    if (val === null || val === undefined || val === '') return '—';
    if (type === 'checkbox' || type === 'multi_file') {
      try { const arr = JSON.parse(val); if (Array.isArray(arr)) return arr.join(', ') || '—'; } catch {}
    }
    return String(val);
  }
}

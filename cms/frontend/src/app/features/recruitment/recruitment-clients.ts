import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Client } from '../../core/models';

/**
 * /recruitment/clients — list of clients flagged as recruitment clients
 * (the companies hiring through us). Reuses the shared `clients` table via
 * the `is_recruitment_client` flag so the same company record can also be
 * a CRM client without duplication.
 *
 * Detail / edit is handled by the existing CRM Clients page at
 * /admin/clients/:id — we just deep-link there for now. A toggle on each
 * row lets HR move companies between CRM-only and CRM + Recruitment.
 */
@Component({
  selector: 'app-recruitment-clients',
  imports: [RouterLink, FormsModule],
  template: `
    <div class="toolbar">
      <h1>Clients</h1>
      <span class="spacer"></span>
      <button class="ghost" (click)="showAdd.set(true)">+ Add existing client</button>
      <button class="primary" routerLink="/admin/clients/new">+ New client</button>
    </div>

    <p class="muted page-sub">Companies hiring through us. Same company record as CRM, flagged for Recruitment.</p>

    @if (loading()) {
      <p class="muted">Loading…</p>
    } @else if (rows().length === 0) {
      <div class="empty">
        <p class="muted">No recruitment clients yet.</p>
        <button class="primary" (click)="showAdd.set(true)">+ Add an existing client</button>
      </div>
    } @else {
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th>Client</th>
            <th>Company</th>
            <th>Email</th>
            <th>Phone</th>
            <th class="actions-col"></th>
          </tr></thead>
          <tbody>
            @for (c of rows(); track c.id) {
              <tr [routerLink]="['/recruitment/clients', c.id]">
                <td><strong>{{ c.name }}</strong></td>
                <td>{{ c.company || '—' }}</td>
                <td>{{ c.email || '—' }}</td>
                <td>{{ c.phone || '—' }}</td>
                <td class="actions" (click)="$event.stopPropagation()">
                  <button class="ghost icon-btn" [routerLink]="['/admin/clients', c.id]" title="Open in CRM">↗</button>
                  <button class="ghost icon-btn danger" (click)="unflag(c)" title="Remove from Recruitment">✕</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    @if (showAdd()) {
      <div class="modal-backdrop" (click)="showAdd.set(false)">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>Flag an existing client as Recruitment</h2>
            <button class="ghost icon-btn" (click)="showAdd.set(false)" title="Close">✕</button>
          </div>
          <div class="modal-body">
            <p class="muted small no-notes">Pick a client from CRM. Toggling adds them to the Recruitment list without duplicating the record.</p>
            <input class="search" type="search" placeholder="Search by name…"
                   [(ngModel)]="addSearch" name="add_search" />
            <ul class="add-list">
              @for (c of addCandidates(); track c.id) {
                <li>
                  <strong>{{ c.name }}</strong>
                  <span class="muted small">{{ c.company || c.email || '—' }}</span>
                  <button class="ghost" (click)="flag(c)">+ Add</button>
                </li>
              } @empty {
                <li class="muted small">No matches.</li>
              }
            </ul>
          </div>
          <div class="modal-foot">
            <button class="primary" (click)="showAdd.set(false)">Done</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .page-sub { margin: 0 24px 12px; }
    .empty { padding: 32px 24px; text-align: center; }
    /* table.data styling comes from the global rule in styles.scss
       (separated card-rows + gold thead). Do NOT redeclare here. */
    .actions-col { width: 90px; }
    .actions { text-align: right; white-space: nowrap; }
    .actions .icon-btn { padding: 4px 8px; margin-left: 4px; }

    .add-list { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow-y: auto; }
    .add-list li { display: flex; gap: 12px; align-items: center; padding: 6px 8px; border-radius: var(--radius-sm); }
    .add-list li:hover { background: var(--bg-3); }
    .add-list li strong { flex: 0 0 auto; }
    .add-list li .muted { flex: 1; }
  `],
})
export class RecruitmentClients {
  private api = inject(Api);

  loading = signal<boolean>(true);
  rows = signal<Client[]>([]);
  allClients = signal<Client[]>([]);

  showAdd = signal<boolean>(false);
  addSearch = '';

  addCandidates = computed(() => {
    const q = this.addSearch.trim().toLowerCase();
    const flaggedIds = new Set(this.rows().map(r => r.id));
    return this.allClients()
      .filter(c => !flaggedIds.has(c.id))
      .filter(c => {
        if (!q) return true;
        return `${c.name ?? ''} ${c.company ?? ''} ${c.email ?? ''}`.toLowerCase().includes(q);
      })
      .slice(0, 30);
  });

  constructor() { this.refresh(); }

  refresh() {
    this.loading.set(true);
    this.api.listRecruitmentClients().subscribe({
      next: r => { this.rows.set(r.clients ?? []); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
    this.api.listClients().subscribe(r => this.allClients.set(r.clients ?? []));
  }

  flag(c: Client) {
    if (!c.id) return;
    this.api.updateClient(c.id, { is_recruitment_client: 1 }).subscribe(() => this.refresh());
  }
  unflag(c: Client) {
    if (!c.id) return;
    if (!confirm(`Remove "${c.name}" from Recruitment? Their CRM record stays intact.`)) return;
    this.api.updateClient(c.id, { is_recruitment_client: 0 }).subscribe(() => this.refresh());
  }
}

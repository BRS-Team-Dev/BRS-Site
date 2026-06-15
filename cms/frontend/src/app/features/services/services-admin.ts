import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Api } from '../../core/api';
import { ServiceOffering } from '../../core/models';

/**
 * Services section (`/admin/services`) — a standalone catalogue of the
 * services the company sells (`service_offerings` table). Standard list-page:
 * toolbar + table, with create/edit via the global modal. This is NOT an
 * onboarding template; onboarding forms nested under Services stay in the
 * Services sidenav group.
 */
@Component({
  selector: 'app-services-admin',
  imports: [FormsModule],
  template: `
    <div class="toolbar">
      <h1>Services</h1>
      <span class="spacer"></span>
      <span class="muted small">{{ services().length }} service(s)</span>
      <button class="primary" (click)="openNew()">+ New service</button>
    </div>

    @if (services().length === 0) {
      <div class="empty">
        <p class="muted">No services yet.</p>
        <button class="primary" (click)="openNew()">Add your first service</button>
      </div>
    } @else {
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th>Service</th>
            <th>Price</th>
            <th>Status</th>
            <th></th>
          </tr></thead>
          <tbody>
            @for (s of services(); track s.id) {
              <tr (click)="openEdit(s)">
                <td>
                  <strong>{{ s.name }}</strong>
                  @if (s.description) { <div class="muted small desc">{{ s.description }}</div> }
                </td>
                <td>{{ priceLabel(s) }}</td>
                <td>
                  <span class="pill" [class.muted-pill]="!isActive(s)">
                    {{ isActive(s) ? 'Active' : 'Inactive' }}
                  </span>
                </td>
                <td class="actions">
                  <button class="ghost icon-btn" (click)="openEdit(s, $event)" title="Edit">✎</button>
                  <button class="ghost icon-btn danger" (click)="del(s, $event)" title="Delete">✕</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    @if (modalOpen()) {
      <div class="modal-backdrop" (click)="close()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ draft.id ? 'Edit service' : 'New service' }}</h2>
            <button class="ghost icon-btn" (click)="close()">✕</button>
          </div>
          <div class="modal-body">
            @if (error()) { <p class="error-msg">{{ error() }}</p> }

            <label>Name</label>
            <input [(ngModel)]="draft.name" name="name" placeholder="e.g. Web Design" />

            <label>Description</label>
            <textarea [(ngModel)]="draft.description" name="description" rows="3"
              placeholder="What this service includes…"></textarea>

            <div class="row two-col">
              <div>
                <label>Price ({{ draft.currency || 'GBP' }})</label>
                <input type="number" min="0" step="0.01"
                  [(ngModel)]="draft.price" name="price" placeholder="0.00" />
              </div>
              <div>
                <label>Billing</label>
                <select [(ngModel)]="draft.payment_type" name="payment_type">
                  <option value="one_off">One-off</option>
                  <option value="recurring">Recurring</option>
                </select>
              </div>
            </div>

            @if (draft.payment_type === 'recurring') {
              <label>Repeat every</label>
              <select [(ngModel)]="draft.repeat_duration" name="repeat_duration">
                <option [ngValue]="null">— pick a cadence —</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            }

            <label class="inline-toggle">
              <input type="checkbox" [(ngModel)]="draft.is_active" name="is_active" />
              Active (offered to clients)
            </label>
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="close()">Cancel</button>
            <button class="primary" (click)="save()" [disabled]="saving()">
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    td.actions { text-align: right; white-space: nowrap; }
    td .desc { margin-top: 2px; max-width: 460px; }
    .pill { display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 12px; background: color-mix(in srgb, var(--primary) 18%, transparent);
      color: var(--primary); border: 1px solid color-mix(in srgb, var(--primary) 40%, transparent); }
    .pill.muted-pill { background: transparent; color: var(--muted); border-color: var(--line); }
    .modal-body .inline-toggle { display: flex; align-items: center; gap: 8px; margin-top: 14px;
      color: var(--fg); }
    .modal-body .inline-toggle input { width: auto; }
    .row.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  `],
})
export class ServicesAdmin {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  services = signal<ServiceOffering[]>([]);

  modalOpen = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);

  draft: Partial<ServiceOffering> = this.blank();

  // Sidenav service entries deep-link here as ?service=<id> to open that
  // service's edit modal. Held until the list has loaded, then consumed.
  private pendingOpenId: number | null = null;

  ngOnInit() {
    this.load();
    this.route.queryParamMap.subscribe(p => {
      const raw = p.get('service');
      this.pendingOpenId = raw ? Number(raw) : null;
      this.tryOpenPending();
    });
  }

  private load() {
    this.api.listServiceOfferings().subscribe(r => {
      // Decimal price comes back as a string from PHP/PDO — coerce for binding.
      this.services.set(r.services.map(s => ({
        ...s,
        price: s.price !== null && s.price !== undefined && (s.price as any) !== '' ? Number(s.price) : null,
        is_active: !!s.is_active,
      })));
      this.tryOpenPending();
    });
  }

  /** Open the deep-linked service's edit modal once both the id and the
   *  loaded list are available. */
  private tryOpenPending() {
    if (this.pendingOpenId == null) return;
    const match = this.services().find(s => s.id === this.pendingOpenId);
    if (match) {
      this.pendingOpenId = null;
      this.openEdit(match);
    }
  }

  private blank(): Partial<ServiceOffering> {
    return { name: '', description: '', price: null, currency: 'GBP',
      payment_type: 'one_off', repeat_duration: null, is_active: true };
  }

  isActive(s: ServiceOffering) { return !!s.is_active; }

  priceLabel(s: ServiceOffering): string {
    if (s.price === null || s.price === undefined || (s.price as any) === '') return '—';
    const amount = `£${Number(s.price).toFixed(2)}`;
    if (s.payment_type === 'recurring') {
      const map: Record<string, string> = {
        weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year',
      };
      const per = s.repeat_duration ? map[s.repeat_duration] : null;
      return per ? `${amount} / ${per}` : `${amount} recurring`;
    }
    return `${amount} one-off`;
  }

  openNew() {
    this.draft = this.blank();
    this.error.set(null);
    this.modalOpen.set(true);
  }

  openEdit(s: ServiceOffering, e?: Event) {
    e?.stopPropagation();
    this.draft = { ...s };
    this.error.set(null);
    this.modalOpen.set(true);
  }

  close() {
    this.modalOpen.set(false);
    // Drop the ?service= deep-link param so re-clicking the same sidenav
    // entry fires queryParamMap again and re-opens the modal.
    if (this.route.snapshot.queryParamMap.has('service')) {
      this.router.navigate([], { queryParams: {}, replaceUrl: true });
    }
  }

  save() {
    const name = (this.draft.name || '').trim();
    if (!name) { this.error.set('Name is required'); return; }

    const payload: Partial<ServiceOffering> = {
      name,
      description: (this.draft.description || '').trim() || null,
      price: this.draft.price === null || this.draft.price === undefined || (this.draft.price as any) === ''
        ? null : Number(this.draft.price),
      currency: this.draft.currency || 'GBP',
      payment_type: this.draft.payment_type === 'recurring' ? 'recurring' : 'one_off',
      repeat_duration: this.draft.payment_type === 'recurring' ? (this.draft.repeat_duration ?? null) : null,
      is_active: this.draft.is_active ? 1 : 0,
    };

    this.saving.set(true);
    const done = {
      next: () => { this.saving.set(false); this.load(); this.close(); },
      error: (err: any) => { this.saving.set(false); this.error.set(err?.error?.error || 'Save failed'); },
    };
    if (this.draft.id) this.api.updateServiceOffering(this.draft.id, payload).subscribe(done);
    else this.api.createServiceOffering(payload).subscribe(done);
  }

  del(s: ServiceOffering, e?: Event) {
    e?.stopPropagation();
    if (!s.id || !confirm(`Delete service "${s.name}"?`)) return;
    this.api.deleteServiceOffering(s.id).subscribe(() => this.load());
  }
}

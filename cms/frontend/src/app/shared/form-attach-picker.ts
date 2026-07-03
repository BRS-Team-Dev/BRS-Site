import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { ServiceOffering } from '../core/models';

/**
 * Mutually-exclusive "Attach to" picker — same shape as the tested
 * feedback-builder scope picker but reusable across every form-editing
 * surface (standard form builder, multipart onboarding builder,
 * whatever comes next).
 *
 * Four options:
 *   - none              → all four fields cleared
 *   - all_clients       → broadcast_to_all_clients = 1
 *   - all_leads         → broadcast_to_all_leads   = 1
 *   - service           → service_offering_id      = X (dropdown)
 *
 * The component emits its full canonical state on every change so the
 * parent form-model stays in sync without needing to know which flag
 * is currently active.
 */

export interface AttachScopeValue {
  scope: 'none' | 'all_clients' | 'all_leads' | 'service';
  broadcast_to_all_clients: 0 | 1;
  broadcast_to_all_leads:   0 | 1;
  service_offering_id: number | null;
}

@Component({
  selector: 'app-form-attach-picker',
  imports: [FormsModule],
  template: `
    <div class="attach-panel">
      @for (o of options; track o.value) {
        <label class="opt" [class.selected]="scope === o.value">
          <input type="radio" name="attach_scope"
                 [value]="o.value"
                 [(ngModel)]="scope"
                 (ngModelChange)="onScopeChange()" />
          <span class="opt-label">
            <strong>{{ o.label }}</strong>
            <span class="opt-hint">{{ o.hint }}</span>
          </span>
        </label>
      }

      @if (scope === 'service') {
        <select class="svc-select"
                [ngModel]="serviceId ?? null"
                (ngModelChange)="onServiceChange($event)"
                name="attach_service_id">
          <option [ngValue]="null">— pick a service —</option>
          @for (s of services(); track s.id) {
            <option [ngValue]="s.id">{{ s.name }}</option>
          }
        </select>
      }
    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; }
    .attach-panel {
      display: flex; flex-direction: column; gap: 6px;
      padding: 10px 12px; background: var(--bg-2);
      border: 1px solid var(--line); border-radius: var(--radius);
      min-width: 0;
    }
    /* Override the global label styles cleanly - the opt row is a full
       row, not a form-field label. */
    label.opt {
      display: flex; align-items: flex-start; gap: 12px;
      margin: 0;
      cursor: pointer; padding: 6px 8px;
      border-radius: var(--radius-sm);
      font-size: 13px; font-weight: 400;
      text-transform: none; letter-spacing: 0;
      color: var(--fg);
      transition: background .1s;
    }
    label.opt:hover { background: color-mix(in oklab, var(--primary), transparent 92%); }
    label.opt.selected { background: color-mix(in oklab, var(--primary), transparent 88%); }

    /* Custom-drawn radio so checked / unchecked look consistent
       across browsers - native rendering with accent-color leaves
       the unchecked ring as a thick white outline in Chrome. */
    label.opt input[type="radio"] {
      appearance: none; -webkit-appearance: none;
      width: 16px; height: 16px;
      flex-shrink: 0; margin: 2px 0 0 0;
      border: 2px solid var(--muted);
      border-radius: 50%;
      background: transparent;
      cursor: pointer;
      display: inline-block;
      position: relative;
      transition: border-color .12s, background .12s;
    }
    label.opt input[type="radio"]:hover { border-color: var(--fg); }
    label.opt input[type="radio"]:checked {
      border-color: var(--primary);
      background: var(--bg);
    }
    label.opt input[type="radio"]:checked::after {
      content: '';
      position: absolute; inset: 2px;
      border-radius: 50%;
      background: var(--primary);
    }
    label.opt input[type="radio"]:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }

    /* Label body: flex:1 + min-width:0 so the hint can't shrink to
       its longest-word min-content and wrap letter-by-letter. */
    .opt-label {
      flex: 1; min-width: 0;
      display: flex; flex-direction: column; gap: 2px;
      line-height: 1.35;
    }
    .opt-label strong { font-weight: 600; color: var(--fg); }
    .opt-hint {
      color: var(--muted); font-size: 12px;
      overflow-wrap: break-word;
    }
    /* Align the service dropdown with the label text (radio 16 + gap 12 = 28). */
    .svc-select { margin: 6px 0 4px 28px; max-width: 400px; }
  `],
})
export class FormAttachPicker implements OnChanges {
  private api = inject(Api);

  @Input() value: AttachScopeValue = {
    scope: 'none',
    broadcast_to_all_clients: 0,
    broadcast_to_all_leads:   0,
    service_offering_id: null,
  };
  @Output() valueChange = new EventEmitter<AttachScopeValue>();

  services = signal<ServiceOffering[]>([]);
  scope: AttachScopeValue['scope'] = 'none';
  serviceId: number | null = null;

  readonly options: { value: AttachScopeValue['scope']; label: string; hint: string }[] = [
    { value: 'none',        label: 'None',              hint: 'Submissions link only via individual invite tokens.' },
    { value: 'all_clients', label: 'All clients',       hint: "Appears on every client's Onboarding tab." },
    { value: 'all_leads',   label: 'All leads',         hint: "Appears on every lead's Onboarding tab." },
    { value: 'service',     label: 'A specific service', hint: 'Everyone on that service sees it.' },
  ];

  ngOnInit() {
    this.api.listServiceOfferings().subscribe(r => this.services.set(r.services));
  }

  /** Sync internal fields when the parent updates `value`. Trust
   *  `value.scope` when present — deriving from the flag fields is
   *  ambiguous while the user has picked 'service' but not yet picked
   *  which service (service_offering_id would be null and derivation
   *  falls back to 'none', dropping the dropdown mid-selection). */
  ngOnChanges(changes: SimpleChanges) {
    if (!changes['value']) return;
    const v = this.value;
    this.serviceId = v.service_offering_id ?? null;
    if (v.scope) {
      this.scope = v.scope;
    } else if (v.broadcast_to_all_clients) {
      this.scope = 'all_clients';
    } else if (v.broadcast_to_all_leads) {
      this.scope = 'all_leads';
    } else if (v.service_offering_id) {
      this.scope = 'service';
    } else {
      this.scope = 'none';
    }
  }

  /** Fired by [(ngModel)] on any radio change. Clears the service
   *  selection when switching away from 'service' so the payload
   *  matches the visible state. */
  onScopeChange() {
    if (this.scope !== 'service') this.serviceId = null;
    this.emit();
  }

  onServiceChange(id: number | null) {
    this.serviceId = id;
    this.emit();
  }

  private emit() {
    this.valueChange.emit({
      scope: this.scope,
      broadcast_to_all_clients: this.scope === 'all_clients' ? 1 : 0,
      broadcast_to_all_leads:   this.scope === 'all_leads'   ? 1 : 0,
      service_offering_id:      this.scope === 'service' ? (this.serviceId ?? null) : null,
    });
  }
}

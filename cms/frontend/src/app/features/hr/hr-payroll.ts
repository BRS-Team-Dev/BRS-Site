import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api } from '../../core/api';
import { HrEmployee, HrPayrollPeriod, HrPayslip } from '../../core/models';

@Component({
  selector: 'app-hr-payroll',
  imports: [FormsModule, DecimalPipe],
  template: `
    <div class="toolbar">
      <h1>Payroll</h1>
      <span class="spacer"></span>
      <button class="primary" (click)="newPeriod()">+ New period</button>
    </div>

    <div class="layout">
      <aside class="period-list">
        @for (p of periods(); track p.id) {
          <button class="period-item" [class.active]="selectedId() === p.id" (click)="select(p)">
            <strong>{{ p.name }}</strong>
            <span class="muted small">{{ p.start_date }} → {{ p.end_date }}</span>
            <span class="status status-{{ p.status }}">{{ p.status }}</span>
            @if (p.payslip_count) { <span class="muted small">{{ p.payslip_count }} payslips · net {{ p.net_total | number:'1.2-2' }}</span> }
          </button>
        }
        @if (periods().length === 0) { <p class="muted small" style="padding: 12px;">No pay periods yet.</p> }
      </aside>

      <section class="period-detail">
        @if (selected(); as p) {
          <div class="period-card">
            <div class="meta-row">
              <div class="meta-field">
                <label>Period name</label>
                <input [ngModel]="p.name" (blur)="patchPeriod({ name: $any($event.target).value })" name="pn_{{ p.id }}" />
              </div>
              <div class="meta-field meta-narrow">
                <label>Start date</label>
                <input type="date" [ngModel]="p.start_date" (change)="patchPeriod({ start_date: $any($event.target).value })" name="ps_{{ p.id }}" />
              </div>
              <div class="meta-field meta-narrow">
                <label>End date</label>
                <input type="date" [ngModel]="p.end_date" (change)="patchPeriod({ end_date: $any($event.target).value })" name="pe_{{ p.id }}" />
              </div>
              <div class="meta-field meta-narrow">
                <label>Status</label>
                <select [ngModel]="p.status" (ngModelChange)="patchPeriod({ status: $event })" name="pst_{{ p.id }}">
                  <option value="draft">Draft</option>
                  <option value="approved">Approved</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
            </div>

            <h3 class="sec">
              Payslips
              <span class="muted small" style="font-weight: 400; text-transform: none; letter-spacing: 0;">· {{ employees().length }} employee{{ employees().length === 1 ? '' : 's' }} · net {{ totalNet() | number:'1.2-2' }}</span>
              <span class="spacer"></span>
              <button class="ghost autofill" type="button" (click)="autofillAll()">⇨ Auto-fill from salaries</button>
            </h3>

            <ul class="slip-list">
              @for (e of employees(); track e.id) {
                @let s = slipFor(e.id!);
                <li class="slip-card" [class.expanded]="expandedSlipId() === e.id">
                  <button class="slip-head" type="button" (click)="toggleSlip(e.id)">
                    <span class="caret">{{ expandedSlipId() === e.id ? '▾' : '▸' }}</span>
                    <strong>{{ e.first_name }} {{ e.last_name }}</strong>
                    <span class="muted small">{{ e.position || '—' }}</span>
                    <span class="muted small">{{ s ? 'net' : 'gross' }}</span>
                    <span class="net-val" [class.suggested]="!s">{{ (s?.net_amount ?? defaultGross(e)) | number:'1.2-2' }}</span>
                    @if (s) {
                      <button class="ghost icon-btn" type="button" (click)="$event.stopPropagation(); printSlip(s)" title="Print this payslip">🖨</button>
                      <button class="ghost icon-btn danger" type="button" (click)="$event.stopPropagation(); delSlip(s)" title="Reset">✕</button>
                    }
                  </button>
                  @if (expandedSlipId() === e.id) {
                    <div class="slip-body">
                      <div class="ref-row">
                        <span class="ref"><span class="muted small">Tax code</span><strong>{{ e.tax_code || '—' }}</strong></span>
                        <span class="ref"><span class="muted small">NI number</span><strong>{{ e.national_insurance_number || '—' }}</strong></span>
                        <span class="ref"><span class="muted small">{{ salaryLabel(e) }}</span><strong>{{ currencySymbol(e.salary_currency) }}{{ (e.salary_amount ?? 0) | number:'1.2-2' }}</strong></span>
                      </div>
                      <div class="meta-row">
                        <div class="meta-field">
                          <label>Gross</label>
                          <input type="number" step="0.01"
                                 [ngModel]="s?.gross_amount ?? defaultGross(e)"
                                 (blur)="upsert(e, { gross_amount: +$any($event.target).value })"
                                 name="g_{{ e.id }}" />
                        </div>
                        <div class="meta-field">
                          <label>Tax</label>
                          <input type="number" step="0.01" [ngModel]="s?.tax_amount ?? 0" (blur)="upsert(e, { tax_amount: +$any($event.target).value })" name="t_{{ e.id }}" />
                        </div>
                        <div class="meta-field">
                          <label>NI</label>
                          <input type="number" step="0.01" [ngModel]="s?.ni_amount ?? 0" (blur)="upsert(e, { ni_amount: +$any($event.target).value })" name="n_{{ e.id }}" />
                        </div>
                        <div class="meta-field">
                          <label>Bonus</label>
                          <input type="number" step="0.01" [ngModel]="s?.bonus_amount ?? 0" (blur)="upsert(e, { bonus_amount: +$any($event.target).value })" name="b_{{ e.id }}" />
                        </div>
                        <div class="meta-field">
                          <label>Other deductions</label>
                          <input type="number" step="0.01" [ngModel]="s?.other_deduct ?? 0" (blur)="upsert(e, { other_deduct: +$any($event.target).value })" name="o_{{ e.id }}" />
                        </div>
                        <div class="meta-field">
                          <label>Pension {{ e.pension_opt_in ? '(opted in)' : '(opted out)' }}</label>
                          <input type="number" step="0.01" [ngModel]="s?.pension_amount ?? 0" (blur)="upsert(e, { pension_amount: +$any($event.target).value })" name="p_{{ e.id }}" />
                        </div>
                      </div>

                      <div class="net-summary">
                        <button class="ghost autofill" type="button" (click)="autoCalcRow(e)">🧮 Auto-calc tax / NI / student loan</button>
                        <span class="spacer"></span>
                        <span class="net-line">
                          <span class="muted small">Net pay</span>
                          <span class="net-amt">{{ s?.net_amount ?? projectNet(e, s) | number:'1.2-2' }}</span>
                        </span>
                      </div>
                    </div>
                  }
                </li>
              }
            </ul>

            <div class="card-footer">
              <button class="ghost" (click)="exportCsv(p)" title="Download CSV of all payslips in this period">⇩ Export CSV</button>
              <span class="spacer"></span>
              <button class="ghost danger" (click)="delPeriod(p)">✕ Delete period</button>
            </div>
          </div>
        } @else {
          <p class="muted small" style="padding: 24px;">Select a pay period on the left, or create one.</p>
        }
      </section>
    </div>
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .layout { display: grid; grid-template-columns: 280px 1fr; min-height: calc(100vh - 120px); }
    .period-list { border-right: 1px solid var(--line); padding: 12px; display: flex; flex-direction: column; gap: 6px; overflow-y: auto; }
    .period-item {
      display: flex; flex-direction: column; gap: 2px;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 10px 12px; text-align: left; color: var(--fg); cursor: pointer;
    }
    .period-item:hover { border-color: var(--primary); }
    .period-item.active { border-color: var(--primary); background: var(--bg-3); }
    .status {
      align-self: flex-start; padding: 2px 8px; border-radius: 999px;
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .status-draft    { color: var(--muted); }
    .status-approved { color: var(--primary); border-color: var(--primary); }
    .status-paid     { color: var(--primary); border-color: var(--primary); }
    .period-detail { padding: 20px; }
    .period-card {
      background: var(--bg-3);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 18px;
    }
    .meta-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
    .meta-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 160px; }
    .meta-field.meta-narrow { flex: 0 0 180px; }
    .meta-field label { margin: 0; }
    .meta-field input, .meta-field select { width: 100%; }
    h3.sec {
      font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px;
      margin: 18px 0 10px;
      display: flex; align-items: center; gap: 8px;
    }
    .autofill { text-transform: none; letter-spacing: normal; font-size: 12px; padding: 4px 10px; }
    .net-val.suggested { color: var(--muted); font-weight: 500; }
    table.data input[type="number"] { width: 100%; }
    .actions { text-align: right; white-space: nowrap; }
    .card-footer {
      margin-top: 18px; padding-top: 14px;
      border-top: 1px solid var(--line);
      display: flex; align-items: center; gap: 8px;
    }
    .group-head {
      display: flex; align-items: center; gap: 10px;
      width: 100%; padding: 10px 0; margin: 16px 0 10px;
      background: transparent; border: 0; border-bottom: 1px solid var(--line);
      color: var(--fg); cursor: pointer; text-align: left; font: inherit;
    }
    .group-head:hover { color: var(--primary); border-color: var(--primary); background: transparent; }
    .group-head .caret { color: var(--muted); font-size: 12px; min-width: 14px; }
    .group-head .group-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .group-head .muted { margin-left: auto; }
    .spacer { flex: 1; }

    .slip-list { list-style: none !important; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .slip-card { list-style: none; display: block; width: 100%; background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm); overflow: hidden; }
    .slip-card::marker { content: ''; }
    .slip-card.expanded { border-color: var(--primary); }
    .slip-head {
      display: grid;
      grid-template-columns: 16px auto 1fr auto auto auto auto;
      gap: 12px; align-items: center;
      width: 100%; padding: 10px 14px;
      background: transparent; border: 0; color: var(--fg);
      cursor: pointer; text-align: left; font: inherit;
    }
    .slip-head:hover { background: rgba(212,169,58,0.04); border: 0; }
    .slip-head .caret { color: var(--muted); font-size: 12px; }
    .slip-head .net-val { color: var(--primary); font-weight: 700; font-variant-numeric: tabular-nums; min-width: 80px; text-align: right; }
    .slip-head .icon-btn { padding: 4px 8px; }
    .slip-head .icon-btn.danger { color: #ef4444; }
    .slip-body { padding: 12px 14px 14px; border-top: 1px solid var(--line); background: var(--bg-3); }
    .ref-row {
      display: flex; gap: 24px; flex-wrap: wrap;
      padding-bottom: 10px; margin-bottom: 12px;
      border-bottom: 1px solid var(--line);
    }
    .ref { display: flex; flex-direction: column; gap: 2px; }
    .ref strong { font-variant-numeric: tabular-nums; }

    .net-summary {
      display: flex; align-items: center; gap: 12px;
      margin-top: 14px; padding-top: 12px;
      border-top: 1px solid var(--line);
    }
    .net-line { display: flex; align-items: baseline; gap: 8px; }
    .net-amt { font-size: 22px; font-weight: 700; color: var(--primary); font-variant-numeric: tabular-nums; }
  `],
})
export class HrPayroll {
  private api = inject(Api);
  private router = inject(Router);

  periods = signal<HrPayrollPeriod[]>([]);
  employees = signal<HrEmployee[]>([]);
  selectedId = signal<number | null>(null);
  payslips = signal<HrPayslip[]>([]);
  payslipsOpen = signal(true);
  expandedSlipId = signal<number | null>(null);

  selected = computed(() => this.periods().find(p => p.id === this.selectedId()) ?? null);
  totalNet = computed(() => this.payslips().reduce((sum, s) => sum + (Number(s.net_amount) || 0), 0));

  toggleSlip(employeeId: number | null | undefined) {
    if (!employeeId) return;
    this.expandedSlipId.set(this.expandedSlipId() === employeeId ? null : employeeId);
  }

  /**
   * Default gross for one pay period, derived from the employee's salary record.
   * Annual salaries divide by 12; monthly is taken as-is; hourly defaults to 0
   * since we don't track hours yet — HR fills that in manually.
   */
  defaultGross(e: HrEmployee): number {
    const amt = Number(e.salary_amount) || 0;
    if (!amt) return 0;
    switch (e.salary_period) {
      case 'annual':  return Math.round((amt / 12) * 100) / 100;
      case 'monthly': return amt;
      default:        return 0;
    }
  }

  /**
   * Simple UK PAYE / NI / student-loan calc for one monthly pay period.
   * Uses 2024-25 thresholds as an approximation — the cumulative HMRC method
   * is more accurate but this gets HR to ~95% of the right number for review.
   *
   * Tax codes:
   *   - Standard 1257L (or any 4-digit + 'L') → personal allowance × 10
   *   - 'BR' / '0T' → no allowance (everything taxed)
   *   - 'NT' → tax-free
   *   - 'D0' → all 40%, 'D1' → all 45%
   * Anything else falls back to 1257L.
   */
  computeDeductions(grossMonthly: number, taxCode: string | null | undefined, studentLoan: string | null | undefined): { tax: number; ni: number; studentLoan: number } {
    if (grossMonthly <= 0) return { tax: 0, ni: 0, studentLoan: 0 };
    const code = (taxCode || '1257L').toUpperCase().trim();
    const annual = grossMonthly * 12;

    // Personal allowance
    let allowance = 12570;
    if (code === 'NT') return { tax: 0, ni: this.computeNI(grossMonthly), studentLoan: this.computeStudentLoan(grossMonthly, studentLoan) };
    if (code === 'BR') allowance = 0;
    if (code === '0T') allowance = 0;
    if (code === 'D0' || code === 'D1') allowance = 0;
    const m = code.match(/^(\d+)L$/);
    if (m) allowance = parseInt(m[1], 10) * 10;

    const taxable = Math.max(0, annual - allowance);
    let annualTax = 0;
    if (code === 'BR') {
      annualTax = annual * 0.20;
    } else if (code === 'D0') {
      annualTax = annual * 0.40;
    } else if (code === 'D1') {
      annualTax = annual * 0.45;
    } else {
      const basicBand    = Math.min(taxable, 37700);                          // 20% on first £37,700 above allowance
      const higherBand   = Math.min(Math.max(taxable - 37700, 0), 87430);     // 40% on next slice up to £125,140
      const additional   = Math.max(taxable - 37700 - 87430, 0);              // 45% on the rest
      annualTax = basicBand * 0.20 + higherBand * 0.40 + additional * 0.45;
    }
    const tax = Math.round((annualTax / 12) * 100) / 100;
    return {
      tax,
      ni: this.computeNI(grossMonthly),
      studentLoan: this.computeStudentLoan(grossMonthly, studentLoan),
    };
  }
  private computeNI(grossMonthly: number): number {
    // Class 1 employee, 2024-25: 0% to £1,048 / 8% to £4,189 / 2% above (per month).
    if (grossMonthly <= 1048) return 0;
    let ni = 0;
    const mid = Math.min(grossMonthly, 4189) - 1048;
    ni += mid * 0.08;
    if (grossMonthly > 4189) ni += (grossMonthly - 4189) * 0.02;
    return Math.round(ni * 100) / 100;
  }
  private computeStudentLoan(grossMonthly: number, plan: string | null | undefined): number {
    const annual = grossMonthly * 12;
    let threshold = 0; let rate = 0.09;
    switch (plan) {
      case 'plan_1':       threshold = 24990; break;
      case 'plan_2':       threshold = 27295; break;
      case 'plan_4':       threshold = 31395; break;
      case 'postgraduate': threshold = 21000; rate = 0.06; break;
      default: return 0;
    }
    if (annual <= threshold) return 0;
    return Math.round(((annual - threshold) * rate / 12) * 100) / 100;
  }
  salaryLabel(e: HrEmployee): string {
    switch (e.salary_period) {
      case 'annual':  return 'Annual salary';
      case 'monthly': return 'Monthly salary';
      case 'hourly':  return 'Hourly rate';
      default:        return 'Salary';
    }
  }
  currencySymbol(code?: string | null): string {
    switch ((code || 'GBP').toUpperCase()) {
      case 'GBP': return '£';
      case 'USD': return '$';
      case 'EUR': return '€';
      default:    return (code || 'GBP') + ' ';
    }
  }

  /**
   * Pension contribution for one period. The employer simply matches the
   * employee's chosen contribution rate, so we use a single percentage clamped
   * to 0–14%. Defaults to 5% if the employee's record doesn't specify one.
   */
  defaultPension(gross: number, e: HrEmployee): { employee: number; employer: number } {
    if (!e.pension_opt_in || gross <= 0) return { employee: 0, employer: 0 };
    const pct = Math.max(0, Math.min(14, Number(e.pension_employee_pct ?? 5)));
    const amount = Math.round(gross * (pct / 100) * 100) / 100;
    return { employee: amount, employer: amount };
  }

  /** Project net for a slip / employee, used in the expanded card. */
  projectNet(e: HrEmployee, s: HrPayslip | undefined): number {
    const gross   = Number(s?.gross_amount   ?? this.defaultGross(e)) || 0;
    const tax     = Number(s?.tax_amount     ?? 0) || 0;
    const ni      = Number(s?.ni_amount      ?? 0) || 0;
    const bonus   = Number(s?.bonus_amount   ?? 0) || 0;
    const other   = Number(s?.other_deduct   ?? 0) || 0;
    const pension = Number(s?.pension_amount ?? 0) || 0;
    return Math.round((gross - tax - ni + bonus - other - pension) * 100) / 100;
  }
  autoCalcRow(e: HrEmployee) {
    const periodId = this.selectedId();
    if (!periodId || !e.id) return;
    const slip = this.slipFor(e.id);
    const gross = Number(slip?.gross_amount ?? this.defaultGross(e)) || 0;
    if (gross <= 0) { alert('No salary on file — set the gross amount manually first.'); return; }
    const calc = this.computeDeductions(gross, e.tax_code, e.student_loan_plan);
    const pen  = this.defaultPension(gross, e);
    const otherExisting = slip ? Number(slip.other_deduct ?? 0) : 0;
    const otherWithLoan = slip ? otherExisting : calc.studentLoan;
    this.api.upsertHrPayslip(periodId, {
      employee_id: e.id,
      gross_amount: gross,
      tax_amount: calc.tax,
      ni_amount: calc.ni,
      other_deduct: otherWithLoan,
      pension_amount: pen.employee,
      employer_pension_amount: pen.employer,
    }).subscribe(() => {
      this.api.listHrPayslips(periodId).subscribe(rr => this.payslips.set(rr.payslips));
    });
  }
  autofillAll() {
    const periodId = this.selectedId();
    if (!periodId) return;
    const targets = this.employees().filter(e => e.id && this.defaultGross(e) > 0 && !this.slipFor(e.id!));
    if (targets.length === 0) {
      alert('Every employee already has a payslip in this period. Reset a slip with ✕ if you want to re-fill it.');
      return;
    }
    if (!confirm(`Auto-fill ${targets.length} payslip${targets.length === 1 ? '' : 's'} with gross, PAYE tax, NI, student-loan, and pension deductions calculated from each employee's record? Bonuses and other one-off deductions still need to be entered manually.`)) return;
    let pending = targets.length;
    for (const e of targets) {
      const gross = this.defaultGross(e);
      const calc = this.computeDeductions(gross, e.tax_code, e.student_loan_plan);
      const pen  = this.defaultPension(gross, e);
      this.api.upsertHrPayslip(periodId, {
        employee_id: e.id!,
        gross_amount: gross,
        tax_amount: calc.tax,
        ni_amount: calc.ni,
        other_deduct: calc.studentLoan,
        pension_amount: pen.employee,
        employer_pension_amount: pen.employer,
      }).subscribe({
        next: () => { if (--pending === 0) this.api.listHrPayslips(periodId).subscribe(rr => this.payslips.set(rr.payslips)); },
        error: () => { if (--pending === 0) this.api.listHrPayslips(periodId).subscribe(rr => this.payslips.set(rr.payslips)); },
      });
    }
  }

  ngOnInit() {
    this.api.listHrPayrollPeriods().subscribe(r => {
      this.periods.set(r.periods);
      if (r.periods.length > 0 && this.selectedId() === null) this.select(r.periods[0]);
    });
    this.api.listHrEmployees().subscribe(r => {
      this.employees.set(r.employees.filter(e => e.status !== 'terminated'));
    });
  }

  newPeriod() {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
    const name = today.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
    this.api.createHrPayrollPeriod({ name, start_date: start, end_date: end, status: 'draft' }).subscribe(r => {
      this.api.listHrPayrollPeriods().subscribe(rr => {
        this.periods.set(rr.periods);
        const created = rr.periods.find(p => p.id === r.id);
        if (created) this.select(created);
      });
    });
  }
  select(p: HrPayrollPeriod) {
    this.selectedId.set(p.id ?? null);
    if (p.id) this.api.listHrPayslips(p.id).subscribe(rr => this.payslips.set(rr.payslips));
  }
  patchPeriod(p: Partial<HrPayrollPeriod>) {
    const id = this.selectedId();
    if (!id) return;
    this.api.updateHrPayrollPeriod(id, p).subscribe(() => {
      this.api.listHrPayrollPeriods().subscribe(r => this.periods.set(r.periods));
    });
  }
  delPeriod(p: HrPayrollPeriod) {
    if (!p.id) return;
    if (!confirm(`Delete period "${p.name}"? All payslips will be removed.`)) return;
    this.api.deleteHrPayrollPeriod(p.id).subscribe(() => {
      this.selectedId.set(null);
      this.api.listHrPayrollPeriods().subscribe(r => this.periods.set(r.periods));
    });
  }

  slipFor(employeeId: number): HrPayslip | undefined {
    return this.payslips().find(s => s.employee_id === employeeId);
  }
  upsert(e: HrEmployee, p: Partial<HrPayslip>) {
    const periodId = this.selectedId();
    if (!periodId || !e.id) return;
    const current = this.slipFor(e.id) || {} as HrPayslip;
    this.api.upsertHrPayslip(periodId, { ...current, ...p, employee_id: e.id }).subscribe(() => {
      this.api.listHrPayslips(periodId).subscribe(rr => this.payslips.set(rr.payslips));
    });
  }
  delSlip(s: HrPayslip) {
    const periodId = this.selectedId();
    if (!periodId || !s.id) return;
    this.api.deleteHrPayslip(periodId, s.id).subscribe(() => {
      this.api.listHrPayslips(periodId).subscribe(rr => this.payslips.set(rr.payslips));
    });
  }

  exportCsv(p: HrPayrollPeriod) {
    if (!p.id) return;
    this.api.exportHrPayrollCsv(p.id).subscribe(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payroll-${(p.name || 'period').replace(/[^A-Za-z0-9_-]+/g, '_')}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  printSlip(s: HrPayslip) {
    const periodId = this.selectedId();
    if (!periodId || !s.id) return;
    this.router.navigate(['/hr/payslip', periodId, s.id]);
  }
}

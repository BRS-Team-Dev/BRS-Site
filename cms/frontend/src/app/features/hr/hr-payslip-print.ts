import { Component, computed, ElementRef, inject, signal, ViewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { Api } from '../../core/api';
import { HrEmployee, HrPayrollPeriod, HrPayslip } from '../../core/models';
import { SettingsService } from '../../core/settings.service';

interface YtdTotals {
  tax_year_start: string;
  taxable_gross: number;
  income_tax: number;
  employee_nic: number;
  employer_nic: number;
  other_deductions: number;
  pension_employee: number;
  pension_employer: number;
  total_payments: number;
  total_deductions: number;
  net_pay: number;
}

/**
 * /hr/payslip/:periodId/:slipId — print-friendly UK payslip.
 * Use the browser's "Save as PDF" from the print dialog to export.
 */
@Component({
  selector: 'app-hr-payslip-print',
  imports: [RouterLink, DecimalPipe],
  template: `
    <div class="no-print toolbar">
      <button class="ghost" routerLink="/me">← Back</button>
      <span class="spacer"></span>
      <button class="ghost" (click)="print()">🖨 Print</button>
      <button class="primary" (click)="downloadPdf()" [disabled]="busy()">{{ busy() ? 'Generating…' : '⇩ Download PDF' }}</button>
    </div>

    @if (slip(); as s) {
      <article class="payslip" #payslip>
        <div class="brand-row">
          <strong class="brand">{{ brandName() }}</strong>
          <span class="muted small">Payslip</span>
        </div>

        <div class="hd-grid">
          <div class="cell hd-cell">
            <div class="cell-label">Employee No.</div>
            <div class="cell-val">{{ padEmpId(employee()?.id) }}</div>
          </div>
          <div class="cell hd-cell wide">
            <div class="cell-label">Employee</div>
            <div class="cell-val">{{ employee()?.first_name }} {{ employee()?.last_name }}</div>
          </div>
          <div class="cell hd-cell">
            <div class="cell-label">Date</div>
            <div class="cell-val">{{ payDate() }}</div>
          </div>
          <div class="cell hd-cell">
            <div class="cell-label">National Insurance No.</div>
            <div class="cell-val">{{ employee()?.national_insurance_number || '—' }}</div>
          </div>
        </div>

        <div class="body-grid">
          <div class="col">
            <div class="col-head">
              <div class="ch ch-wide">Payments</div>
              <div class="ch">Units</div>
              <div class="ch">Rate</div>
              <div class="ch ch-amt">Amount</div>
            </div>
            <div class="line">
              <div class="ch-wide">Basic Pay</div>
              <div></div>
              <div></div>
              <div class="ch-amt">{{ s.gross_amount | number:'1.2-2' }}</div>
            </div>
            @if ((s.bonus_amount ?? 0) > 0) {
              <div class="line">
                <div class="ch-wide">Bonus</div>
                <div></div>
                <div></div>
                <div class="ch-amt">{{ s.bonus_amount | number:'1.2-2' }}</div>
              </div>
            }
            <div class="line total">
              <div class="ch-wide"><strong>Total Payments</strong></div>
              <div></div>
              <div></div>
              <div class="ch-amt"><strong>{{ totalPayments() | number:'1.2-2' }}</strong></div>
            </div>
          </div>

          <div class="col">
            <div class="col-head">
              <div class="ch ch-wide">Deductions</div>
              <div class="ch ch-amt">Amount</div>
            </div>
            <div class="line">
              <div class="ch-wide">Income Tax</div>
              <div class="ch-amt">{{ s.tax_amount | number:'1.2-2' }}</div>
            </div>
            <div class="line">
              <div class="ch-wide">National Insurance</div>
              <div class="ch-amt">{{ s.ni_amount | number:'1.2-2' }}</div>
            </div>
            @if ((s.pension_amount ?? 0) > 0) {
              <div class="line">
                <div class="ch-wide">Pension</div>
                <div class="ch-amt">{{ s.pension_amount | number:'1.2-2' }}</div>
              </div>
            }
            @if ((s.other_deduct ?? 0) > 0) {
              <div class="line">
                <div class="ch-wide">{{ otherDeductionLabel() }}</div>
                <div class="ch-amt">{{ s.other_deduct | number:'1.2-2' }}</div>
              </div>
            }
            <div class="line total">
              <div class="ch-wide"><strong>Total Deductions</strong></div>
              <div class="ch-amt"><strong>{{ totalDeductions() | number:'1.2-2' }}</strong></div>
            </div>
            @if ((s.employer_pension_amount ?? 0) > 0) {
              <div class="line subtle">
                <div class="ch-wide muted small">Employer pension <em>(informational)</em></div>
                <div class="ch-amt muted small">{{ s.employer_pension_amount | number:'1.2-2' }}</div>
              </div>
            }
          </div>
        </div>

        <div class="foot-grid">
          <div class="cell address">
            <strong>{{ employee()?.first_name }} {{ employee()?.last_name }}</strong>
            @if (employee()?.address_line1) { <div>{{ employee()?.address_line1 }}</div> }
            @if (employee()?.address_line2) { <div>{{ employee()?.address_line2 }}</div> }
            <div>
              {{ employee()?.city }}{{ employee()?.region ? ', ' + employee()?.region : '' }}
            </div>
            @if (employee()?.postcode) { <div>{{ employee()?.postcode }}</div> }
            @if (employee()?.country) { <div>{{ employee()?.country }}</div> }
          </div>

          <div class="cell totals-block">
            <div class="totals-title">Totals This Period</div>
            <div class="totals-row"><span>Total Payments</span><span class="amt"><strong>{{ totalPayments() | number:'1.2-2' }}</strong></span></div>
            <div class="totals-row"><span>Total Deductions</span><span class="amt"><strong>{{ totalDeductions() | number:'1.2-2' }}</strong></span></div>
          </div>

          <div class="cell totals-block">
            <div class="totals-title">Totals Year To Date</div>
            @if (ytd(); as y) {
              <div class="totals-row"><span>Taxable Gross Pay</span><span class="amt">{{ y.taxable_gross | number:'1.2-2' }}</span></div>
              <div class="totals-row"><span>Income Tax</span><span class="amt">{{ y.income_tax | number:'1.2-2' }}</span></div>
              <div class="totals-row"><span>Employee NIC</span><span class="amt">{{ y.employee_nic | number:'1.2-2' }}</span></div>
              <div class="totals-row"><span>Employer NIC</span><span class="amt">{{ y.employer_nic | number:'1.2-2' }}</span></div>
              @if (y.pension_employee > 0) {
                <div class="totals-row"><span>Pension (you)</span><span class="amt">{{ y.pension_employee | number:'1.2-2' }}</span></div>
              }
              @if (y.pension_employer > 0) {
                <div class="totals-row"><span>Pension (employer)</span><span class="amt">{{ y.pension_employer | number:'1.2-2' }}</span></div>
              }
            } @else {
              <div class="muted small">Loading…</div>
            }
          </div>
        </div>

        <div class="net-bar">
          <div class="net-label">Net Pay</div>
          <div class="net-amt">{{ currencySymbol(s.currency) }}{{ s.net_amount | number:'1.2-2' }}</div>
        </div>

        @if (s.notes) { <p class="notes"><em>{{ s.notes }}</em></p> }

        <footer class="ft">
          <span class="muted small">Tax code: <strong>{{ employee()?.tax_code || '—' }}</strong></span>
          <span class="muted small">Period: {{ period()?.name }} · {{ period()?.start_date }} → {{ period()?.end_date }}</span>
          <span class="muted small">Generated {{ today }} · {{ brandName() }}</span>
        </footer>
      </article>
    } @else {
      <div class="empty"><p class="muted">Loading…</p></div>
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .spacer { flex: 1; }
    .empty { padding: 60px; text-align: center; }

    .payslip {
      max-width: 880px;
      margin: 24px auto;
      background: #ffffff;
      color: #1f2a3d;
      padding: 24px;
      border: 1px solid #d4d4d4;
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 13px;
    }

    .brand-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; padding: 0 6px; }
    .brand { font-size: 18px; letter-spacing: 0.4px; }

    .hd-grid {
      display: grid;
      grid-template-columns: 1fr 2fr 1.2fr 1.4fr;
      gap: 0;
      border: 1px solid #2c3e57;
      border-radius: 6px;
      overflow: hidden;
    }
    .hd-cell { background: #fff; }
    .hd-cell .cell-label { background: #6b7d9a; color: #fff; padding: 8px 10px; font-weight: 600; text-align: center; font-size: 12px; }
    .hd-cell .cell-val   { background: #aab7cb; color: #1f2a3d; padding: 14px 10px; font-weight: 700; text-align: center; }
    .hd-cell + .hd-cell { border-left: 1px solid #2c3e57; }

    .body-grid {
      display: grid; grid-template-columns: 1.6fr 1fr;
      border: 1px solid #2c3e57; border-top: 0;
    }
    .col + .col { border-left: 1px solid #2c3e57; }
    .col-head {
      display: grid;
      align-items: center;
      background: #2c3e57; color: #fff; font-weight: 600;
    }
    .col:first-child .col-head { grid-template-columns: 2fr 1fr 1fr 1fr; }
    .col:last-child  .col-head { grid-template-columns: 2fr 1fr; }
    .ch { padding: 8px 10px; font-size: 12px; }
    .ch.ch-amt { text-align: right; }
    .ch-wide { padding: 8px 10px; }
    .ch-amt { padding: 8px 10px; text-align: right; font-variant-numeric: tabular-nums; }

    .line {
      display: grid; align-items: center;
      border-top: 1px solid #e3e8ef;
      min-height: 28px;
    }
    .col:first-child .line { grid-template-columns: 2fr 1fr 1fr 1fr; }
    .col:last-child  .line { grid-template-columns: 2fr 1fr; }
    .line.total { border-top: 1px solid #2c3e57; }

    .foot-grid {
      display: grid;
      grid-template-columns: 1.4fr 1fr 1.2fr;
      border: 1px solid #2c3e57; border-top: 0;
    }
    .foot-grid .cell + .cell { border-left: 1px solid #2c3e57; }
    .address { padding: 14px; background: #aab7cb; color: #1f2a3d; line-height: 1.5; }
    .totals-block { padding: 14px; }
    .totals-title { background: #6b7d9a; color: #fff; padding: 6px 10px; margin: -14px -14px 10px; font-weight: 600; text-align: center; font-size: 12px; }
    .totals-row { display: flex; justify-content: space-between; padding: 4px 0; font-variant-numeric: tabular-nums; }
    .totals-row .amt { font-weight: 600; }

    .net-bar {
      display: flex; justify-content: flex-end; align-items: stretch;
      margin-top: 16px;
    }
    .net-label { background: #2c3e57; color: #fff; padding: 16px 24px; font-weight: 700; border-radius: 999px 0 0 999px; }
    .net-amt   { background: #fff; border: 1px solid #2c3e57; border-left: 0; padding: 16px 28px; font-size: 24px; font-weight: 800; border-radius: 0 999px 999px 0; font-variant-numeric: tabular-nums; }

    .notes { font-size: 13px; color: #555; margin-top: 16px; }
    .ft {
      margin-top: 22px; padding-top: 14px; border-top: 1px solid #d4d4d4;
      display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap;
    }
    .muted { color: #555; }
    .small { font-size: 12px; }

    @media print {
      .no-print { display: none !important; }
      .payslip { margin: 0; border: 0; box-shadow: none; }
      :host { background: #ffffff; }
    }
  `],
})
export class HrPayslipPrint {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private settings = inject(SettingsService);

  brandName = this.settings.brandName;
  today = new Date().toLocaleDateString();

  @ViewChild('payslip') payslipEl!: ElementRef<HTMLElement>;

  slip = signal<HrPayslip | null>(null);
  period = signal<HrPayrollPeriod | null>(null);
  employee = signal<HrEmployee | null>(null);
  ytd = signal<YtdTotals | null>(null);
  busy = signal(false);

  ngOnInit() {
    this.route.paramMap.subscribe(p => {
      const periodId = +p.get('periodId')!;
      const slipId   = +p.get('slipId')!;
      this.api.listHrPayslips(periodId).subscribe(r => {
        const found = r.payslips.find(s => s.id === slipId) ?? null;
        this.slip.set(found);
        if (found?.employee_id) {
          this.api.getHrEmployee(found.employee_id).subscribe(rr => this.employee.set(rr.employee));
          this.api.getHrPayrollYtd(found.employee_id, periodId).subscribe(rr => this.ytd.set(rr));
        }
      });
      this.api.listHrPayrollPeriods().subscribe(rr => this.period.set(rr.periods.find(x => x.id === periodId) ?? null));
    });
  }

  print() { window.print(); }

  async downloadPdf() {
    if (this.busy() || !this.payslipEl?.nativeElement) return;
    this.busy.set(true);
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const e = this.employee();
      const p = this.period();
      const safe = (s?: string | null) => (s || '').replace(/[^A-Za-z0-9_-]+/g, '_');
      const filename = `payslip-${safe(e?.last_name)}-${safe(p?.name)}.pdf`;
      const opts: any = {
        margin:       [10, 10, 10, 10],
        filename,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, backgroundColor: '#ffffff', useCORS: true },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] },
      };
      await html2pdf().set(opts).from(this.payslipEl.nativeElement).save();
    } catch (err) {
      console.error(err);
      alert('PDF generation failed — falling back to the print dialog.');
      window.print();
    } finally {
      this.busy.set(false);
    }
  }

  padEmpId(id: number | undefined): string {
    if (!id) return '—';
    return String(id).padStart(3, '0');
  }
  payDate(): string {
    const p = this.period();
    const date = p?.pay_date || p?.end_date;
    if (!date) return '—';
    const d = new Date(date + 'T00:00:00');
    if (isNaN(d.getTime())) return date;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
  }
  totalPayments(): number {
    const s = this.slip();
    if (!s) return 0;
    return Math.round(((Number(s.gross_amount) || 0) + (Number(s.bonus_amount) || 0)) * 100) / 100;
  }
  totalDeductions(): number {
    const s = this.slip();
    if (!s) return 0;
    return Math.round((
      (Number(s.tax_amount) || 0)
      + (Number(s.ni_amount) || 0)
      + (Number(s.other_deduct) || 0)
      + (Number(s.pension_amount) || 0)
    ) * 100) / 100;
  }
  otherDeductionLabel(): string {
    const e = this.employee();
    if (e?.student_loan_plan && e.student_loan_plan !== 'none') return 'Student Loan';
    return 'Other deductions';
  }
  currencySymbol(code?: string | null): string {
    switch ((code || 'GBP').toUpperCase()) {
      case 'GBP': return '£';
      case 'USD': return '$';
      case 'EUR': return '€';
      default:    return (code || 'GBP') + ' ';
    }
  }
}

import { Component, computed, inject, signal } from '@angular/core';
import { Api } from '../../core/api';
import { HrCertification, HrCourseAssignment } from '../../core/models';

interface CertWithStatus extends HrCertification {
  daysToExpiry: number | null;
  alertLevel: 'expired' | 'expiring' | 'ok';
}

@Component({
  selector: 'app-management-compliance',
  template: `
    <div class="toolbar">
      <h1>Compliance alerts</h1>
      <span class="spacer"></span>
      <span class="muted small">{{ totalAlerts() }} item{{ totalAlerts() === 1 ? '' : 's' }} need attention</span>
    </div>

    <div class="summary">
      <div class="metric"><span class="m-label">Expired certifications</span><span class="m-val danger">{{ expiredCerts().length }}</span></div>
      <div class="metric"><span class="m-label">Expiring ≤ 60 days</span><span class="m-val warn">{{ expiringCerts().length }}</span></div>
      <div class="metric"><span class="m-label">Overdue learning</span><span class="m-val danger">{{ overdueLearning().length }}</span></div>
    </div>

    <h2 class="sec-title">Certifications</h2>
    @if (certs().length === 0) {
      <p class="muted small empty-line">No certifications recorded for your team.</p>
    } @else {
      <table class="data">
        <thead><tr><th>Employee</th><th>Certification</th><th>Issuer</th><th>Issued</th><th>Expires</th><th>Status</th></tr></thead>
        <tbody>
          @for (c of certs(); track c.id) {
            <tr [class.row-warn]="c.alertLevel === 'expiring'" [class.row-danger]="c.alertLevel === 'expired'">
              <td><strong>{{ c.first_name }} {{ c.last_name }}</strong></td>
              <td>{{ c.name }}</td>
              <td class="muted small">{{ c.issuer || '—' }}</td>
              <td class="muted small">{{ c.issued_at || '—' }}</td>
              <td class="muted small">{{ c.expires_at || '— no expiry —' }}</td>
              <td>
                @switch (c.alertLevel) {
                  @case ('expired')  { <span class="status status-danger">expired</span> }
                  @case ('expiring') { <span class="status status-warn">{{ c.daysToExpiry }} day{{ c.daysToExpiry === 1 ? '' : 's' }}</span> }
                  @default           { <span class="status status-ok">valid</span> }
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    }

    <h2 class="sec-title">Overdue learning</h2>
    @if (overdueLearning().length === 0) {
      <p class="muted small empty-line">Everyone is on track with their assigned courses.</p>
    } @else {
      <table class="data">
        <thead><tr><th>Employee</th><th>Course</th><th>Provider</th><th>Due</th><th>Status</th></tr></thead>
        <tbody>
          @for (a of overdueLearning(); track a.id) {
            <tr class="row-danger">
              <td><strong>{{ a.first_name }} {{ a.last_name }}</strong></td>
              <td>{{ a.title }}</td>
              <td class="muted small">{{ a.provider || '—' }}</td>
              <td class="muted small">{{ a.due_date }}</td>
              <td><span class="status status-danger">{{ a.status?.replace('_', ' ') }}</span></td>
            </tr>
          }
        </tbody>
      </table>
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
    .toolbar h1 { margin: 0; font-size: 22px; }
    .spacer { flex: 1; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; padding: 16px 20px; }
    .metric { padding: 14px; background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius); display: flex; flex-direction: column; gap: 4px; }
    .m-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .m-val { font-size: 24px; font-weight: 700; }
    .m-val.warn   { color: #f97316; }
    .m-val.danger { color: #ef4444; }
    .sec-title { padding: 20px 20px 8px; margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
    .empty-line { padding: 0 20px 16px; }
    table.data { margin: 0 20px 20px; }
    .status {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      border: 1px solid var(--line);
    }
    .status-ok     { color: var(--primary); border-color: var(--primary); }
    .status-warn   { color: #f97316;        border-color: #f97316; }
    .status-danger { color: #ef4444;        border-color: #ef4444; }
    tr.row-warn   td { background: rgba(249,115,22,0.06); }
    tr.row-danger td { background: rgba(239,68,68,0.06); }
  `],
})
export class ManagementCompliance {
  private api = inject(Api);

  rawCerts = signal<HrCertification[]>([]);
  overdueLearning = signal<HrCourseAssignment[]>([]);

  certs = computed<CertWithStatus[]>(() => this.rawCerts().map(c => {
    const daysToExpiry = c.expires_at ? this.daysFromToday(c.expires_at) : null;
    let alertLevel: CertWithStatus['alertLevel'] = 'ok';
    if (daysToExpiry !== null) {
      if (daysToExpiry < 0)       alertLevel = 'expired';
      else if (daysToExpiry <= 60) alertLevel = 'expiring';
    }
    return { ...c, daysToExpiry, alertLevel };
  }).sort((a, b) => {
    const ord = { expired: 0, expiring: 1, ok: 2 } as const;
    if (ord[a.alertLevel] !== ord[b.alertLevel]) return ord[a.alertLevel] - ord[b.alertLevel];
    return (a.daysToExpiry ?? 9999) - (b.daysToExpiry ?? 9999);
  }));
  expiredCerts  = computed(() => this.certs().filter(c => c.alertLevel === 'expired'));
  expiringCerts = computed(() => this.certs().filter(c => c.alertLevel === 'expiring'));
  totalAlerts   = computed(() => this.expiredCerts().length + this.expiringCerts().length + this.overdueLearning().length);

  ngOnInit() {
    this.api.listMyTeamCertifications().subscribe(r => this.rawCerts.set(r.certifications));
    this.api.listMyTeamLearning('overdue').subscribe(r => this.overdueLearning.set(r.assignments));
  }

  private daysFromToday(date: string): number {
    const d = new Date(date + 'T00:00:00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - today.getTime()) / 86400000);
  }
}

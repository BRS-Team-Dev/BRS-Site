import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { MailerOverviewData } from '../../core/models';

/**
 * Mailer - overview.
 *
 *   /admin/mailer
 *
 * The landing page for the Mailer: one hero number (emails delivered), a
 * row of stat tiles, the last 30 days as a column chart, the outcome
 * breakdown of delivered mail, and the most recent sends. Everything links
 * on to the two working pages, Compose (/admin/mailer/compose) and Sent
 * emails (/admin/mailer/sent). Read-only: it never changes anything.
 *
 * The chart is inline SVG driven by signals - no chart library. Columns are
 * thin, rounded at the data end and square on the baseline, with a hairline
 * grid and a hover tooltip; the failed count rides on the same day as a
 * second, darker segment so both stay on one axis.
 */
@Component({
  selector: 'app-mailer-overview',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="toolbar">
      <h1>Mailer</h1>
      <span class="spacer"></span>
      <button class="ghost" (click)="load()" [disabled]="loading()">Refresh</button>
      <button class="ghost" routerLink="/admin/mailer/sent">Sent emails</button>
      <button class="primary" routerLink="/admin/mailer/compose">✎ Compose</button>
    </div>

    @if (error()) { <div class="error-msg mo-err">{{ error() }}</div> }

    @if (data(); as d) {
      <!-- ── Hero + tiles ─────────────────────────────────────── -->
      <div class="mo-hero-row">
        <div class="mo-hero">
          <span class="mo-hero-label">Emails delivered</span>
          <span class="mo-hero-n">{{ compact(d.totals.sent) }}</span>
          <span class="mo-hero-sub muted small">
            across {{ d.totals.sends }} send{{ d.totals.sends === 1 ? '' : 's' }} to {{ compact(d.totals.unique_addresses) }} address{{ d.totals.unique_addresses === 1 ? '' : 'es' }}
            @if (d.totals.last_sent_at) { · last sent {{ fmtDate(d.totals.last_sent_at) }} }
          </span>
          <span class="mo-delta" [attr.data-dir]="deltaDir()">
            {{ d.totals.last_7_days }} in the last 7 days
            @if (deltaText(); as t) { <span class="mo-delta-v">{{ t }}</span> }
          </span>
        </div>

        <div class="mo-tiles">
          <button class="mo-tile" routerLink="/admin/mailer/sent" [queryParams]="{ outcome: 'none' }" title="Delivered emails with no outcome recorded yet">
            <span class="mo-tile-l">Awaiting outcome</span>
            <span class="mo-tile-n">{{ compact(d.totals.awaiting_outcome) }}</span>
          </button>
          <div class="mo-tile">
            <span class="mo-tile-l">Replied or interested</span>
            <span class="mo-tile-n">{{ compact(positive()) }}</span>
            <span class="mo-tile-s muted small">{{ pct(positive(), d.totals.sent) }} of delivered</span>
          </div>
          <div class="mo-tile">
            <span class="mo-tile-l">Follow-ups sent</span>
            <span class="mo-tile-n">{{ compact(d.totals.follow_ups) }}</span>
          </div>
          <button class="mo-tile" routerLink="/admin/mailer/sent" [queryParams]="{ status: 'failed' }" title="Show failed deliveries">
            <span class="mo-tile-l">Failed</span>
            <span class="mo-tile-n" [class.is-bad]="d.totals.failed > 0">{{ compact(d.totals.failed) }}</span>
            <span class="mo-tile-s muted small">{{ d.totals.skipped }} skipped (unsubscribed)</span>
          </button>
          <div class="mo-tile" title="Views of tracked links inserted with the composer's link maker">
            <span class="mo-tile-l">Tracked link views</span>
            <span class="mo-tile-n">{{ compact(d.link_views.views) }}</span>
            <span class="mo-tile-s muted small">{{ d.link_views.records }} record{{ d.link_views.records === 1 ? '' : 's' }} opened a link</span>
          </div>
          <button class="mo-tile" routerLink="/admin/mailer/templates" title="Manage reusable templates">
            <span class="mo-tile-l">Templates</span>
            <span class="mo-tile-n">{{ d.totals.templates }}</span>
          </button>
        </div>
      </div>

      <div class="mo-layout">
        <!-- ── Activity, last 30 days ───────────────────────────── -->
        <section class="mo-card mo-chart-card">
          <div class="mo-card-head">
            <h3>Last 30 days</h3>
            <span class="muted small">{{ last30() }} email{{ last30() === 1 ? '' : 's' }} attempted</span>
          </div>
          <div class="mo-legend">
            <span class="mo-key"><i class="mo-swatch sent"></i> Delivered</span>
            <span class="mo-key"><i class="mo-swatch failed"></i> Failed</span>
          </div>

          @if (last30() === 0) {
            <p class="muted small mo-empty">Nothing sent in the last 30 days.</p>
          }
          <div class="mo-chart" (mouseleave)="hover.set(null)">
            <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" preserveAspectRatio="none" class="mo-svg" role="img"
                 aria-label="Emails per day over the last 30 days">
              <!-- hairline grid + y ticks -->
              @for (t of yTicks(); track t.v) {
                <line [attr.x1]="padL" [attr.x2]="W - padR" [attr.y1]="y(t.v)" [attr.y2]="y(t.v)" class="mo-grid" />
              }
              <line [attr.x1]="padL" [attr.x2]="W - padR" [attr.y1]="y(0)" [attr.y2]="y(0)" class="mo-axis" />
              <!-- columns: delivered on the baseline, failed stacked above with a 2px surface gap -->
              @for (b of bars(); track b.day; let i = $index) {
                <g (mouseenter)="hover.set(i)">
                  <rect [attr.x]="b.x - slotW() / 2" [attr.y]="padT" [attr.width]="slotW()" [attr.height]="H - padT - padB" class="mo-hit" />
                  @if (b.sent > 0) {
                    <path [attr.d]="col(b.x, y(0), y(b.sent), b.failed === 0)" class="mo-col sent" [class.is-hot]="hover() === i" />
                  }
                  @if (b.failed > 0) {
                    <path [attr.d]="col(b.x, y(b.sent) - (b.sent > 0 ? 2 : 0), y(b.sent + b.failed) - (b.sent > 0 ? 2 : 0), true)" class="mo-col failed" [class.is-hot]="hover() === i" />
                  }
                </g>
              }
            </svg>
            <!-- axis labels live in HTML so they keep their font at every width -->
            <div class="mo-yaxis">
              @for (t of yTicks(); track t.v) {
                <span class="muted" [style.top.%]="(y(t.v) / H) * 100">{{ t.v }}</span>
              }
            </div>
            <div class="mo-xaxis muted small">
              @for (b of bars(); track b.day; let i = $index) {
                @if (i === 29 || (i % 7 === 0 && i <= 21)) { <span [style.left.%]="(b.x / W) * 100">{{ shortDay(b.day) }}</span> }
              }
            </div>
            @if (hoverBar(); as hb) {
              <div class="mo-tip" [style.left.%]="(hb.x / W) * 100"
                   [class.at-right]="hb.x / W > 0.8" [class.at-left]="hb.x / W < 0.2">
                <strong>{{ longDay(hb.day) }}</strong>
                <span><i class="mo-swatch sent"></i> {{ hb.sent }} delivered</span>
                @if (hb.failed) { <span><i class="mo-swatch failed"></i> {{ hb.failed }} failed</span> }
              </div>
            }
          </div>
        </section>

        <!-- ── Outcomes ─────────────────────────────────────────── -->
        <section class="mo-card">
          <div class="mo-card-head">
            <h3>Outcomes</h3>
            <span class="muted small">{{ withOutcome() }} of {{ d.totals.sent }} delivered have one</span>
          </div>
          @if (withOutcome() === 0) {
            <p class="muted small mo-empty">No outcomes recorded yet. Set them from <a routerLink="/admin/mailer/sent">Sent emails</a>.</p>
          } @else {
            <div class="mo-bars">
              @for (o of d.outcomes; track o.key) {
                <button class="mo-bar-row" routerLink="/admin/mailer/sent" [queryParams]="{ outcome: o.key }"
                        [title]="'Show emails marked ' + o.label">
                  <span class="mo-bar-l"><i class="mo-swatch" [attr.data-outcome]="o.key"></i>{{ o.label }}</span>
                  <span class="mo-bar-track">
                    <span class="mo-bar-fill" [attr.data-outcome]="o.key" [style.width.%]="barPct(o.count)"></span>
                  </span>
                  <span class="mo-bar-v">{{ o.count }}</span>
                </button>
              }
            </div>
          }
          <div class="mo-split">
            <div class="mo-split-l muted small">Delivery, all time</div>
            <div class="mo-meter" title="Delivered / failed / skipped">
              @if (d.totals.emails) {
                <span class="seg sent"    [style.flex-grow]="d.totals.sent"></span>
                <span class="seg failed"  [style.flex-grow]="d.totals.failed"></span>
                <span class="seg skipped" [style.flex-grow]="d.totals.skipped"></span>
              }
            </div>
            <div class="mo-legend">
              <span class="mo-key"><i class="mo-swatch sent"></i> {{ pct(d.totals.sent, d.totals.emails) }} delivered</span>
              <span class="mo-key"><i class="mo-swatch failed"></i> {{ pct(d.totals.failed, d.totals.emails) }} failed</span>
              <span class="mo-key"><i class="mo-swatch skipped"></i> {{ pct(d.totals.skipped, d.totals.emails) }} skipped</span>
            </div>
          </div>
        </section>

        <!-- ── Recent sends ─────────────────────────────────────── -->
        <section class="mo-card mo-recent">
          <div class="mo-card-head">
            <h3>Recent sends</h3>
            <button class="ghost small" routerLink="/admin/mailer/sent">All sent emails →</button>
          </div>
          @if (!d.recent.length) {
            <p class="muted small mo-empty">Nothing sent yet. <a routerLink="/admin/mailer/compose">Write the first message</a>.</p>
          } @else {
            <table class="data">
              <thead>
                <tr><th>Sent</th><th>Subject</th><th>Audience</th><th>By</th><th class="mo-col-n">Delivered</th><th class="mo-col-n">Failed</th></tr>
              </thead>
              <tbody>
                @for (r of d.recent; track r.id) {
                  <tr routerLink="/admin/mailer/sent" [queryParams]="{ q: r.subject }" title="Open this send">
                    <td class="muted small mo-nowrap">{{ fmtDate(r.created_at) }}</td>
                    <td class="mo-subj">
                      <strong>{{ r.subject || '(no subject)' }}</strong>
                      @if (r.parent_send_id) { <span class="mo-fu-pill">↩ follow-up</span> }
                    </td>
                    <td class="muted small mo-nowrap">{{ r.audience }}@if (r.industry) { · {{ r.industry }} }</td>
                    <td class="muted small mo-nowrap">{{ r.sent_by || 'System' }}</td>
                    <td class="mo-col-n"><span class="badge success">{{ r.sent_count }}</span></td>
                    <td class="mo-col-n">
                      @if (r.failed_count) { <span class="badge warning">{{ r.failed_count }}</span> } @else { <span class="muted small">—</span> }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>
      </div>
    } @else if (loading()) {
      <p class="muted small mo-err">Loading…</p>
    }
  `,
  styles: [`
    .toolbar { padding: 16px 20px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); flex-wrap: nowrap; }
    .toolbar h1 { margin: 0; font-size: 22px; white-space: nowrap; }
    .spacer { flex: 1; }
    .toolbar button { white-space: nowrap; }
    .mo-err { margin: 12px 20px; }

    /* ── hero + tiles ─────────────────────────────────────────── */
    .mo-hero-row { display: grid; grid-template-columns: minmax(260px, 1fr) 2fr; gap: 16px; padding: 20px 20px 0; align-items: stretch; }
    @media (max-width: 1100px) { .mo-hero-row { grid-template-columns: 1fr; } }
    .mo-hero {
      display: flex; flex-direction: column; gap: 4px; justify-content: center;
      padding: 20px 22px; border: 1px solid var(--primary); border-radius: var(--radius-sm); background: var(--bg-2);
    }
    .mo-hero-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--muted); }
    .mo-hero-n { font-size: 52px; font-weight: 600; line-height: 1.05; letter-spacing: -0.5px; }
    .mo-hero-sub { margin-top: 2px; }
    .mo-delta { margin-top: 10px; font-size: 13px; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
    .mo-delta-v { font-size: 12px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
    .mo-delta[data-dir="up"] .mo-delta-v   { color: var(--success); border-color: var(--success); }
    .mo-delta[data-dir="down"] .mo-delta-v { color: var(--warning); border-color: var(--warning); }

    .mo-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    @media (max-width: 700px) { .mo-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    .mo-tile {
      display: flex; flex-direction: column; gap: 2px; align-items: flex-start; text-align: left;
      padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg-2);
      font: inherit; color: inherit; text-transform: none; letter-spacing: normal; min-width: 0;
    }
    button.mo-tile { cursor: pointer; }
    button.mo-tile:hover { border-color: var(--primary); }
    .mo-tile-l { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); white-space: nowrap; }
    .mo-tile-n { font-size: 24px; font-weight: 600; line-height: 1.1; }
    .mo-tile-n.is-bad { color: var(--danger); }
    .mo-tile-s { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }

    /* ── cards ───────────────────────────────────────────────── */
    .mo-layout { display: grid; grid-template-columns: 3fr 2fr; gap: 16px; padding: 16px 20px 24px; align-items: start; }
    @media (max-width: 1100px) { .mo-layout { grid-template-columns: 1fr; } }
    .mo-card { background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 16px; min-width: 0; }
    .mo-card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .mo-card-head h3 { margin: 0; font-size: 15px; flex: 1; }
    .mo-card-head button { white-space: nowrap; }
    .mo-empty { margin: 8px 0; }
    .mo-recent { grid-column: 1 / -1; }

    /* ── chart ────────────────────────────────────────────────── */
    .mo-legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--muted); margin-bottom: 6px; }
    .mo-key { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
    .mo-swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; background: var(--muted); flex: 0 0 10px; }
    .mo-swatch.sent    { background: var(--primary); }
    .mo-swatch.failed  { background: var(--danger); }
    .mo-swatch.skipped { background: var(--muted); }

    .mo-chart { position: relative; height: 220px; padding-left: 34px; padding-bottom: 22px; }
    .mo-svg { width: 100%; height: 100%; display: block; overflow: visible; }
    .mo-grid { stroke: var(--line); stroke-width: 1; vector-effect: non-scaling-stroke; }
    .mo-axis { stroke: var(--muted); stroke-width: 1; vector-effect: non-scaling-stroke; opacity: 0.6; }
    .mo-hit { fill: none; stroke: none; pointer-events: all; }
    .mo-col { transition: opacity .1s; }
    .mo-col.sent   { fill: var(--primary); }
    .mo-col.failed { fill: var(--danger); }
    .mo-col.is-hot { opacity: 0.8; }
    .mo-yaxis { position: absolute; left: 0; top: 0; bottom: 22px; width: 30px; font-size: 11px; }
    .mo-yaxis span { position: absolute; right: 4px; transform: translateY(-50%); }
    .mo-xaxis { position: absolute; left: 34px; right: 0; bottom: 0; height: 18px; }
    .mo-xaxis span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
    .mo-tip {
      position: absolute; top: 4px; transform: translateX(-50%);
      display: flex; flex-direction: column; gap: 2px; padding: 6px 10px; font-size: 12px; white-space: nowrap;
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm); pointer-events: none; z-index: 2;
    }
    .mo-tip span { display: inline-flex; align-items: center; gap: 6px; }
    /* Near either edge the tooltip hangs inward instead of off the card. */
    .mo-tip.at-right { transform: translateX(calc(-100% - 10px)); }
    .mo-tip.at-left  { transform: translateX(10px); }

    /* ── outcome bars ─────────────────────────────────────────── */
    .mo-bars { display: flex; flex-direction: column; gap: 6px; }
    .mo-bar-row {
      display: grid; grid-template-columns: 130px 1fr 36px; align-items: center; gap: 10px;
      padding: 2px 0; background: none; border: 0; font: inherit; color: inherit; text-align: left; cursor: pointer;
      text-transform: none; letter-spacing: normal;
    }
    .mo-bar-row:hover .mo-bar-l { color: var(--text); }
    .mo-bar-l { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); white-space: nowrap; }
    .mo-bar-track { height: 10px; background: var(--bg-3); border-radius: 0 4px 4px 0; overflow: hidden; }
    .mo-bar-fill { display: block; height: 100%; border-radius: 0 4px 4px 0; background: var(--muted); min-width: 0; transition: width .2s; }
    .mo-bar-v { font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; }
    /* One colour per outcome - the same set the Sent emails chips use. */
    [data-outcome="replied"]        { background: var(--success); }
    [data-outcome="interested"]     { background: var(--primary); }
    [data-outcome="meeting_booked"] { background: #3b82f6; }
    [data-outcome="followed_up"]    { background: #a78bfa; }
    [data-outcome="bounced"]        { background: var(--warning); }
    [data-outcome="not_interested"] { background: var(--danger); }
    [data-outcome="no_response"]    { background: var(--muted); }

    .mo-split { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line); }
    .mo-split-l { margin-bottom: 6px; }
    .mo-meter { display: flex; height: 10px; gap: 2px; border-radius: 4px; overflow: hidden; background: var(--bg-3); margin-bottom: 8px; }
    .mo-meter .seg { display: block; flex-basis: 0; }
    .mo-meter .seg.sent    { background: var(--primary); }
    .mo-meter .seg.failed  { background: var(--danger); }
    .mo-meter .seg.skipped { background: var(--muted); }

    /* ── recent sends ─────────────────────────────────────────── */
    .mo-nowrap { white-space: nowrap; }
    .mo-col-n { text-align: right; width: 80px; }
    .mo-subj { max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mo-fu-pill {
      margin-left: 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;
      padding: 1px 6px; border-radius: 4px; border: 1px solid var(--primary); color: var(--primary); white-space: nowrap;
    }
  `],
})
export class MailerOverview {
  private api = inject(Api);

  readonly data = signal<MailerOverviewData | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Index of the hovered day column, for the tooltip. */
  readonly hover = signal<number | null>(null);

  // Chart geometry in viewBox units. Width is stretched to the card
  // (preserveAspectRatio none) so only the ratios matter.
  readonly W = 600;
  readonly H = 200;
  readonly padL = 0;
  readonly padR = 0;
  readonly padT = 8;
  readonly padB = 0;

  constructor() { this.load(); }

  load() {
    this.loading.set(true);
    this.error.set(null);
    this.api.mailerOverview().subscribe({
      next: d => { this.data.set(d); this.loading.set(false); },
      error: e => { this.error.set(e?.error?.error || 'Failed to load the overview.'); this.loading.set(false); },
    });
  }

  // ── derived numbers ──────────────────────────────────────────
  readonly positive = computed(() =>
    (this.data()?.outcomes || [])
      .filter(o => o.key === 'replied' || o.key === 'interested' || o.key === 'meeting_booked')
      .reduce((n, o) => n + o.count, 0));
  readonly withOutcome = computed(() => (this.data()?.outcomes || []).reduce((n, o) => n + o.count, 0));
  readonly maxOutcome = computed(() => Math.max(1, ...(this.data()?.outcomes || []).map(o => o.count)));
  readonly last30 = computed(() => (this.data()?.days || []).reduce((n, d) => n + d.sent + d.failed, 0));

  readonly deltaDir = computed<'up' | 'down' | 'flat'>(() => {
    const t = this.data()?.totals;
    if (!t) return 'flat';
    return t.last_7_days > t.previous_7_days ? 'up' : t.last_7_days < t.previous_7_days ? 'down' : 'flat';
  });
  readonly deltaText = computed(() => {
    const t = this.data()?.totals;
    if (!t || (t.last_7_days === 0 && t.previous_7_days === 0)) return '';
    const diff = t.last_7_days - t.previous_7_days;
    if (diff === 0) return 'same as the 7 days before';
    return (diff > 0 ? '+' : '') + diff + ' vs the 7 days before';
  });

  barPct(count: number): number { return (count / this.maxOutcome()) * 100; }

  // ── chart scales ─────────────────────────────────────────────
  readonly maxDay = computed(() => Math.max(1, ...(this.data()?.days || []).map(d => d.sent + d.failed)));
  /** Clean tick ceiling: 1-2-5 steps so the axis reads 0 / 5 / 10, not 0 / 7 / 14. */
  readonly yMax = computed(() => {
    const m = this.maxDay();
    const mag = Math.pow(10, Math.floor(Math.log10(m)));
    for (const k of [1, 2, 5, 10]) { if (m <= k * mag) return k * mag; }
    return 10 * mag;
  });
  readonly yTicks = computed(() => {
    const top = this.yMax();
    const step = top <= 4 ? 1 : top / (top % 4 === 0 ? 4 : top % 5 === 0 ? 5 : 2);
    const out: { v: number }[] = [];
    for (let v = 0; v <= top; v += step) out.push({ v: Math.round(v) });
    return out;
  });
  y(v: number): number {
    const inner = this.H - this.padT - this.padB;
    return this.padT + inner - (v / this.yMax()) * inner;
  }
  readonly slotW = computed(() => (this.W - this.padL - this.padR) / 30);
  readonly bars = computed(() => {
    const days = this.data()?.days || [];
    const sw = this.slotW();
    return days.map((d, i) => ({ ...d, x: this.padL + sw * (i + 0.5) }));
  });
  readonly hoverBar = computed(() => {
    const i = this.hover();
    return i === null ? null : (this.bars()[i] ?? null);
  });

  /** A column path: <= 14 units wide, 4px-rounded at the data end, square on
   *  the baseline. `yTop` < `yBase` in SVG space. */
  col(cx: number, yBase: number, yTop: number, rounded: boolean): string {
    const w = Math.min(14, this.slotW() - 4);
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const h = yBase - yTop;
    const r = rounded ? Math.min(4, h, w / 2) : 0;
    return `M${x0},${yBase} L${x0},${yTop + r} Q${x0},${yTop} ${x0 + r},${yTop} L${x1 - r},${yTop} Q${x1},${yTop} ${x1},${yTop + r} L${x1},${yBase} Z`;
  }

  // ── formatting ───────────────────────────────────────────────
  compact(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + 'M';
    if (n >= 10_000) return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1) + 'K';
    return n.toLocaleString('en-GB');
  }
  pct(part: number, whole: number): string {
    if (!whole) return '0%';
    return Math.round((part / whole) * 100) + '%';
  }
  shortDay(iso: string): string {
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  }
  longDay(iso: string): string {
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
  }
  fmtDate(s: string | null | undefined): string {
    if (!s) return '—';
    const d = new Date(s.replace(' ', 'T'));
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}

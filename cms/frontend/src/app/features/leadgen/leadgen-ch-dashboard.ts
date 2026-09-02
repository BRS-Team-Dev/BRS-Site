import { Component, computed, input } from '@angular/core';
import { ChMilestones, ChLastRun } from '../../core/models';

/**
 * Companies House pipeline dashboard — a count of the different information
 * gathered across the pipeline. Pure presentational: takes the milestone counts
 * (one stat card per info type, "have / total" + % complete), a multicolour
 * "coverage" bar (one overlapping colour per stat + legend), a dynamic progress
 * bar shown while a Qualify pass runs, and a rolling "last run" summary.
 */
const CARDS: { key: keyof Omit<ChMilestones, 'total'>; label: string; color: string }[] = [
  { key: 'address',   label: 'Address',   color: '#E0B34A' },
  { key: 'directors', label: 'Directors', color: '#5AA9E6' },
  { key: 'industry',  label: 'Industry',  color: '#2D9CDB' },
  { key: 'website',   label: 'Website',   color: '#6FCF97' },
  { key: 'phone',     label: 'Phone',     color: '#F2994A' },
  { key: 'email',     label: 'Email',     color: '#BB6BD9' },
  { key: 'linkedin',  label: 'LinkedIn',  color: '#56CCF2' },
  { key: 'staff',     label: 'Staff',     color: '#EB5757' },
];
const FOUND: { key: keyof ChLastRun['found']; label: string }[] = [
  { key: 'address',   label: 'Address' },
  { key: 'directors', label: 'Directors' },
  { key: 'industry',  label: 'Industry' },
  { key: 'website',   label: 'Website' },
  { key: 'phone',     label: 'Phone' },
  { key: 'email',     label: 'Email' },
  { key: 'linkedin',  label: 'LinkedIn' },
  { key: 'staff',     label: 'Staff' },
];
const EMPTY: ChMilestones = { total: 0, address: 0, directors: 0, industry: 0, website: 0, phone: 0, email: 0, linkedin: 0, staff: 0 };
const EMPTY_RUN: ChLastRun = { checked: 0, enriched: 0, found: { directors: 0, industry: 0, address: 0, website: 0, phone: 0, email: 0, linkedin: 0, staff: 0 }, running: false };
// Gradient of every stat colour — used for the dynamic (running) progress bar
// so the moving fill visually "represents all stats".
const GRAD = 'linear-gradient(90deg,' + CARDS.map(c => c.color).join(',') + ')';

@Component({
  selector: 'app-leadgen-ch-dashboard',
  standalone: true,
  template: `
    <div class="stats-grid">
      <div class="stat-card total">
        <div class="stat-label">Total in pipeline</div>
        <div class="stat-value">{{ m().total }}</div>
        <div class="stat-sub">records</div>
      </div>
      @for (c of cards(); track c.label) {
        <div class="stat-card" [class.done]="m().total > 0 && c.value >= m().total">
          <div class="stat-label">{{ c.label }}</div>
          <div class="stat-value">{{ c.value }}<span class="stat-of"> / {{ m().total }}</span></div>
          <div class="stat-sub">{{ c.pct }}% complete</div>
        </div>
      }
    </div>

    <!-- Coverage bar: one overlapping colour per stat (widest at the back),
         a static picture of how complete each info type is. -->
    <div class="cov">
      <div class="bar-cap"><span>Coverage</span><span class="muted small">what we have across the pipeline</span></div>
      <div class="cov-track">
        @for (s of segments(); track s.key) {
          <div class="cov-seg" [style.width.%]="s.pct" [style.height.%]="s.h"
               [style.z-index]="s.z" [style.background]="s.color"
               [title]="s.label + ' ' + s.pct + '%'"></div>
        }
      </div>
      <div class="cov-legend">
        @for (c of cards(); track c.label) {
          <span class="leg"><i [style.background]="c.color"></i>{{ c.label }} <strong>{{ c.pct }}%</strong></span>
        }
      </div>

      <!-- Dynamic bar: always shown; animates/fills only while Qualify runs. -->
      <div class="bar-cap prog-cap"><span>Qualify progress</span></div>
      <div class="prog" [class.indet]="running() && !progress()" [class.idle]="!running()">
        <div class="prog-track">
          <div class="prog-fill" [style.width.%]="running() ? (progress() ? pct() : 100) : 0" [style.background-image]="grad"></div>
        </div>
        <span class="prog-label">
          @if (running()) {
            @if (progress()) { {{ progress()!.processed }} done · {{ progress()!.remaining }} to go ({{ pct() }}%) }
            @else { Starting… }
          } @else {
            Idle — fills here while Qualify runs
          }
        </span>
      </div>
    </div>

    <div class="last-run" [class.running]="lr().running">
      <div class="lr-head">
        <strong>Last run</strong>
        @if (lr().running) { <span class="lr-state">● running…</span> }
        <span class="spacer"></span>
        @if (hasRun()) {
          <span class="muted small">{{ lr().checked }} checked · {{ lr().enriched }} gained new info</span>
        } @else {
          <span class="muted small">No runs yet — run Qualify to enrich records</span>
        }
      </div>
      <div class="lr-chips">
        @for (f of foundList(); track f.label) {
          <span class="lr-chip" [class.hit]="f.value > 0">{{ f.label }} <strong>+{{ f.value }}</strong></span>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; margin-bottom: 16px; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    @media (max-width: 1000px) { .stats-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 560px)  { .stats-grid { grid-template-columns: 1fr; } }
    .stat-card {
      background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 14px 16px;
      display: flex; flex-direction: column; gap: 4px;
      align-items: center; text-align: center;
      transition: border-color 160ms ease;
    }
    .stat-card.total { border-left: 3px solid var(--primary); }
    .stat-card.done  { border-color: var(--primary); }
    .stat-label { color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; font-size: 11px; }
    .stat-value {
      display: inline-flex; align-items: baseline;
      color: var(--fg); font-variant-numeric: tabular-nums;
      font-size: 28px; font-weight: 700;
    }
    .stat-value .stat-of { color: var(--muted); font-weight: 700; font-size: 16px; margin-left: 2px; }
    .stat-sub { font-size: 12px; color: var(--muted); }

    /* Coverage bar */
    .cov { margin-top: 12px; background: var(--bg-2); border: 1px solid var(--line);
           border-radius: var(--radius-sm); padding: 14px 16px; }
    .cov-track {
      position: relative; height: 30px; border-radius: 6px; overflow: hidden;
      background: color-mix(in srgb, var(--bg-1) 70%, transparent);
      box-shadow: inset 0 0 0 1px var(--line);
    }
    .cov-seg {
      position: absolute; left: 0; top: 50%; transform: translateY(-50%);
      min-width: 2px; border-radius: 0 4px 4px 0;
      transition: width 400ms ease, height 200ms ease;
    }
    .cov-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 10px; }
    .leg { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); white-space: nowrap; }
    .leg i { width: 11px; height: 11px; border-radius: 3px; flex: none; }
    .leg strong { color: var(--fg); font-variant-numeric: tabular-nums; }

    /* Bar captions */
    .bar-cap { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
    .bar-cap > span:first-child { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--fg); }
    .prog-cap { margin-top: 16px; }

    /* Dynamic progress bar (always shown; idle when not running) */
    .prog { display: flex; align-items: center; gap: 12px; }
    .prog-track {
      position: relative; flex: 1; height: 10px; border-radius: 999px; overflow: hidden;
      background: color-mix(in srgb, var(--bg-1) 70%, transparent);
      box-shadow: inset 0 0 0 1px var(--line);
    }
    .prog-fill {
      height: 100%; border-radius: 999px;
      background-size: 200% 100%; animation: prog-slide 1.6s linear infinite;
      transition: width 400ms ease;
    }
    .prog.indet .prog-fill {
      width: 40% !important; animation: prog-slide 1.6s linear infinite, prog-indet 1.4s ease-in-out infinite;
    }
    .prog.idle .prog-fill { animation: none; }
    .prog.idle .prog-label { opacity: 0.7; }
    .prog-label { font-size: 12px; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
    @keyframes prog-slide { from { background-position: 0 0; } to { background-position: -200% 0; } }
    @keyframes prog-indet { 0% { margin-left: 0; } 50% { margin-left: 60%; } 100% { margin-left: 0; } }

    /* Last-run module */
    .last-run {
      margin-top: 12px; background: var(--bg-2); border: 1px solid var(--line);
      border-radius: var(--radius-sm); padding: 12px 16px;
    }
    .last-run.running { border-color: var(--primary); }
    .lr-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .spacer { flex: 1; }
    .lr-state { color: var(--primary); font-size: 12px; font-weight: 600; }
    .lr-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .lr-chip {
      padding: 4px 10px; border: 1px solid var(--line); border-radius: 999px;
      font-size: 12px; color: var(--muted);
    }
    .lr-chip.hit { border-color: var(--primary); color: var(--fg); }
    .lr-chip.hit strong { color: var(--primary); }
  `],
})
export class LeadgenChDashboard {
  milestones = input<ChMilestones | null>(null);
  lastRun = input<ChLastRun | null>(null);
  progress = input<{ processed: number; remaining: number; done?: boolean } | null>(null);
  grad = GRAD;

  m = computed(() => this.milestones() ?? EMPTY);
  cards = computed(() => {
    const m = this.m();
    return CARDS.map(c => ({
      key: c.key,
      label: c.label,
      color: c.color,
      value: m[c.key],
      pct: m.total ? Math.round((m[c.key] / m.total) * 100) : 0,
    }));
  });

  // Overlapping coverage segments: widest (most complete) at the back and
  // tallest, each successive stat a little shorter so its colour still peeks
  // out — so all seven are visible in one bar rather than the top one hiding
  // the rest.
  segments = computed(() => {
    const ranked = this.cards().slice().sort((a, b) => b.pct - a.pct);
    const n = ranked.length;
    return ranked.map((c, i) => ({
      ...c,
      z: i + 1,                             // smaller pct paints on top
      h: Math.round(100 - i * (55 / (n - 1))), // 100% down to ~45%
    }));
  });

  running = computed(() => this.lr().running);
  pct = computed(() => {
    const p = this.progress();
    if (!p) return 0;
    const total = p.processed + p.remaining;
    return total ? Math.round((p.processed / total) * 100) : 0;
  });

  lr = computed(() => this.lastRun() ?? EMPTY_RUN);
  hasRun = computed(() => this.lastRun() !== null);
  foundList = computed(() => {
    const found = this.lr().found;
    return FOUND.map(f => ({ label: f.label, value: found[f.key] ?? 0 }));
  });
}

import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SlicePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { HrJob } from '../../core/models';
import { SettingsService } from '../../core/settings.service';

/** A persisted Responsibilities/Benefits section is `{ summary, bullets }`. */
interface JobSection { summary: string; bullets: string[]; }

/**
 * /jobs/:slug — public single-posting view. Anonymous, no shell, no auth.
 * Renders summary + bulleted Responsibilities and Benefits authored on the
 * admin recruitment screen.
 */
@Component({
  selector: 'app-public-job',
  imports: [RouterLink, SlicePipe, FormsModule],
  template: `
    <div class="page">
      <header class="hd">
        <a class="brand" routerLink="/jobs">{{ brandName() }} · careers</a>
      </header>

      @if (loading()) {
        <p class="muted">Loading…</p>
      } @else if (notFound()) {
        <div class="empty">
          <h1>Position not found</h1>
          <p class="muted">This role isn't open any more, or the link is wrong.</p>
          <a class="primary-link" routerLink="/jobs">← View all open roles</a>
        </div>
      } @else if (job(); as j) {
        <a class="back-link" routerLink="/jobs">← All roles</a>

        <div class="job-head">
          <h1>{{ j.title }}</h1>
          <div class="meta">
            @if (j.department) { <span class="pill primary">{{ j.department }}</span> }
            @if (j.location)   { <span class="pill">📍 {{ j.location }}</span> }
            <span class="pill">{{ etLabel(j.employment_type) }}</span>
            @if (j.salary_min && j.salary_max) {
              <span class="pill salary">{{ formatSalary(j) }}</span>
            }
          </div>
          <div class="apply-cta">
            <button class="primary apply-btn" (click)="scrollToApply()">Apply now</button>
          </div>
        </div>

        @if (j.description) {
          <section class="block">
            <h2>About the role</h2>
            <p class="body">{{ j.description }}</p>
          </section>
        }

        @if (resp().summary || resp().bullets.length > 0) {
          <section class="block">
            <h2>Responsibilities</h2>
            @if (resp().summary) { <p class="body">{{ resp().summary }}</p> }
            @if (resp().bullets.length > 0) {
              <ul class="bullets">
                @for (b of resp().bullets; track $index) { <li>{{ b }}</li> }
              </ul>
            }
          </section>
        }

        @if (benefits().summary || benefits().bullets.length > 0) {
          <section class="block">
            <h2>What's in it for you</h2>
            @if (benefits().summary) { <p class="body">{{ benefits().summary }}</p> }
            @if (benefits().bullets.length > 0) {
              <ul class="bullets">
                @for (b of benefits().bullets; track $index) { <li>{{ b }}</li> }
              </ul>
            }
          </section>
        }

        <section class="block apply-block" #applyBlock>
          <h2>Apply for this role</h2>
          @if (submitted()) {
            <p class="body">{{ successMessage() }}</p>
            <p class="muted small">A copy of your application has been sent to the hiring team. They'll be in touch via email.</p>
          } @else {
            <p class="muted small no-notes">Submit the short form below — we'll get back to you within a couple of working days.</p>
            <div class="apply-grid">
              <label>
                <span class="lbl">First name <span class="req">*</span></span>
                <input [(ngModel)]="form.first_name" name="ap_first" />
              </label>
              <label>
                <span class="lbl">Last name <span class="req">*</span></span>
                <input [(ngModel)]="form.last_name" name="ap_last" />
              </label>
              <label>
                <span class="lbl">Email <span class="req">*</span></span>
                <input type="email" [(ngModel)]="form.email" name="ap_email" />
              </label>
              <label>
                <span class="lbl">Phone</span>
                <input [(ngModel)]="form.phone" name="ap_phone" placeholder="+44 7700 900000" />
              </label>
              <label class="full">
                <span class="lbl">LinkedIn URL</span>
                <input [(ngModel)]="form.linkedin_url" name="ap_li" placeholder="https://linkedin.com/in/…" />
              </label>
              <label class="full">
                <span class="lbl">CV (PDF / DOC)</span>
                <input type="file" #cvInput accept=".pdf,.doc,.docx" (change)="onCvFile($any($event.target).files)" />
              </label>
              <label class="full">
                <span class="lbl">Cover note</span>
                <textarea rows="4" [(ngModel)]="form.notes" name="ap_notes" placeholder="Anything you'd like the hiring team to know…"></textarea>
              </label>
            </div>
            @if (applyError()) { <p class="err">{{ applyError() }}</p> }
            <div class="row">
              <button class="primary" (click)="submitApplication()" [disabled]="busy()">
                {{ busy() ? 'Submitting…' : 'Submit application' }}
              </button>
              <span class="muted small">By applying you consent to {{ brandName() }} processing your details for hiring purposes.</span>
            </div>
          }
        </section>

        <footer class="ft">
          @if (j.posted_at) { <span class="muted small">Posted {{ j.posted_at | slice:0:10 }}</span> }
        </footer>
      }
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; background: #ffffff; color: var(--fg); }
    .page { max-width: 760px; margin: 0 auto; padding: 32px 24px 48px; }
    .hd { padding-bottom: 16px; margin-bottom: 24px; border-bottom: 1px solid var(--line); }
    .hd .brand { font-weight: 700; letter-spacing: 0.4px; color: var(--primary); font-size: 13px; text-decoration: none; }

    .back-link { display: inline-block; margin-bottom: 16px; color: var(--muted); text-decoration: none; font-size: 13px; }
    .back-link:hover { color: var(--primary); }

    /* Hero band — same dark card surface as the .block sections below. */
    .job-head {
      background: var(--bg-3); border: 1px solid var(--line);
      padding: 32px 28px; border-radius: var(--radius);
      margin-bottom: 18px;
    }
    .job-head h1 { margin: 0 0 12px; font-size: 28px; color: var(--fg); }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; }
    .pill {
      padding: 3px 10px; border-radius: 999px; font-size: 12px;
      background: var(--bg-3); color: var(--muted); border: 1px solid var(--line);
    }
    .pill.primary { color: var(--primary); border-color: var(--primary); background: rgba(212,169,58,0.12); }
    .pill.salary  { color: var(--fg); }

    .block { padding: 18px; background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius); margin-bottom: 18px; }
    .block h2 { margin: 0 0 10px; font-size: 16px; color: var(--primary); }
    .block .body { white-space: pre-wrap; line-height: 1.6; margin: 0 0 8px; }
    .bullets { margin: 8px 0 0; padding-left: 20px; line-height: 1.7; }
    .bullets li { margin-bottom: 4px; }

    .empty { padding: 60px 0; text-align: center; }
    .empty h1 { margin: 0 0 8px; }
    .primary-link { color: var(--primary); text-decoration: none; font-weight: 600; }
    .primary-link:hover { text-decoration: underline; }

    .ft { padding-top: 16px; margin-top: 24px; border-top: 1px solid var(--line); text-align: center; }

    /* Apply CTA + form */
    .apply-cta { margin-top: 16px; }
    .apply-btn {
      padding: 10px 22px; font-size: 14px; font-weight: 700;
      letter-spacing: 0.3px; border-radius: var(--radius-sm);
    }
    .apply-block { scroll-margin-top: 16px; }
    .apply-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
      margin-top: 8px;
    }
    .apply-grid label { display: flex; flex-direction: column; gap: 4px; }
    .apply-grid label.full { grid-column: 1 / -1; }
    .apply-grid .lbl {
      color: var(--muted); font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;
    }
    .apply-grid input,
    .apply-grid textarea {
      font-size: 13px; width: 100%;
    }
    .apply-grid .req { color: #ef4444; margin-left: 2px; }
    .apply-block .row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-top: 12px; }
    .apply-block .err { color: #ef4444; font-size: 13px; margin: 8px 0 0; }
  `],
})
export class PublicJob {
  private api = inject(Api);
  private route = inject(ActivatedRoute);
  private svc = inject(SettingsService);
  brandName = this.svc.brandName;

  job = signal<HrJob | null>(null);
  loading = signal(true);
  notFound = signal(false);

  resp = computed<JobSection>(() => this.parseSection(this.job()?.responsibilities));
  benefits = computed<JobSection>(() => this.parseSection(this.job()?.benefits));

  // ── Application form state ────────────────────────────────────────────────
  @ViewChild('applyBlock') applyBlock?: ElementRef<HTMLElement>;
  @ViewChild('cvInput')    cvInput?:    ElementRef<HTMLInputElement>;
  form = { first_name: '', last_name: '', email: '', phone: '', linkedin_url: '', notes: '' };
  cvFile = signal<File | null>(null);
  busy = signal(false);
  submitted = signal(false);
  successMessage = signal<string>('');
  applyError = signal<string | null>(null);

  scrollToApply() {
    this.applyBlock?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  onCvFile(files: FileList | null) {
    this.cvFile.set(files && files.length > 0 ? files[0] : null);
  }
  submitApplication() {
    const j = this.job();
    if (!j?.slug) return;
    const f = this.form;
    if (!f.first_name.trim() || !f.last_name.trim() || !f.email.trim()) {
      this.applyError.set('First name, last name and email are required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) {
      this.applyError.set('Please enter a valid email address.');
      return;
    }
    this.applyError.set(null);
    this.busy.set(true);
    const fd = new FormData();
    fd.append('first_name',   f.first_name.trim());
    fd.append('last_name',    f.last_name.trim());
    fd.append('email',        f.email.trim());
    if (f.phone.trim())        fd.append('phone',        f.phone.trim());
    if (f.linkedin_url.trim()) fd.append('linkedin_url', f.linkedin_url.trim());
    if (f.notes.trim())        fd.append('notes',        f.notes.trim());
    const cv = this.cvFile();
    if (cv) fd.append('cv', cv);
    this.api.applyForPublicJob(j.slug, fd).subscribe({
      next: r => {
        this.busy.set(false);
        this.submitted.set(true);
        this.successMessage.set(
          r.duplicate
            ? (r.message || "You've already applied to this role.")
            : `Thanks ${f.first_name.trim()} — your application for "${j.title}" has been received.`
        );
      },
      error: e => {
        this.busy.set(false);
        this.applyError.set(e?.error?.error || 'Could not submit application — please try again.');
      },
    });
  }

  ngOnInit() {
    this.svc.ensureLoaded();
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    if (!slug) { this.notFound.set(true); this.loading.set(false); return; }
    this.api.getPublicJob(slug).subscribe({
      next: r => { this.job.set(r.job); this.loading.set(false); },
      error: () => { this.notFound.set(true); this.loading.set(false); },
    });
  }

  /** Mirrors the parser in HrRecruitment so the public page reads modern + legacy shapes. */
  private parseSection(raw: string | null | undefined): JobSection {
    if (!raw) return { summary: '', bullets: [] };
    try {
      const v = JSON.parse(raw);
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return {
          summary: typeof v.summary === 'string' ? v.summary : '',
          bullets: Array.isArray(v.bullets) ? v.bullets.map(String) : [],
        };
      }
      if (Array.isArray(v)) return { summary: '', bullets: v.map(String) };
    } catch { /* fall through */ }
    return { summary: String(raw), bullets: [] };
  }

  etLabel(t: HrJob['employment_type'] | undefined): string {
    switch (t) {
      case 'full_time':  return 'Full-time';
      case 'part_time':  return 'Part-time';
      case 'contractor': return 'Contractor';
      case 'intern':     return 'Intern';
      default:           return t || '';
    }
  }
  formatSalary(j: HrJob): string {
    const cur = j.salary_currency || 'GBP';
    const fmt = (n: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n);
    return `${fmt(Number(j.salary_min))} – ${fmt(Number(j.salary_max))}`;
  }
}

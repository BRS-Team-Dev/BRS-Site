import { Component, Input, OnChanges, Output, EventEmitter, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { environment } from '@env/environment';
import { Api } from '../../core/api';
import { HrCourseModule, HrCourseModuleImage, HrCourseModuleProgress, HrCoursePlayerSnapshot, HrQuizQuestion, HrSlideBlock } from '../../core/models';

interface QuizOutcome {
  score: number;
  passed: boolean;
  pass_score: number;
  wrong_ids: string[];
}

/**
 * Multi-step course player. Renders one module at a time. Used by:
 *  - the authenticated employee Learning tab (`mode: 'me'`)
 *  - the public onboarding portal (`mode: 'public'` + token)
 */
@Component({
  selector: 'app-hr-course-player',
  imports: [FormsModule],
  template: `
    @if (loading()) {
      <p class="muted small">Loading course…</p>
    } @else if (!snapshot()) {
      <p class="muted small">Course not found.</p>
    } @else {
      <div class="player">
        <header class="hdr">
          <button class="ghost" (click)="exit.emit()">← Back</button>
          <div class="title-block">
            <h2>{{ snapshot()?.assignment?.title }}</h2>
            <span class="muted small">Module {{ index() + 1 }} of {{ snapshot()?.modules?.length || 0 }}</span>
          </div>
          <div class="bar"><div class="fill" [style.width.%]="completedPct()"></div></div>
        </header>

        <nav class="steps">
          @for (m of snapshot()?.modules || []; track m.id; let i = $index) {
            <button class="step"
                    [class.active]="i === index()"
                    [class.done]="isModuleDone(m.id!)"
                    (click)="goTo(i)">
              <span class="step-num">{{ i + 1 }}</span>
              <span class="step-title">{{ m.title }}</span>
              @if (isModuleDone(m.id!)) { <span class="step-check">✓</span> }
            </button>
          }
        </nav>

        @if (current(); as m) {
          <section class="content">
            <h3>{{ m.title }}</h3>

            @if (m.kind === 'text') {
              @for (b of slideBlocks(m); track b.id) {
                @if (b.kind === 'copy' && b.body) {
                  <div class="body">{{ b.body }}</div>
                }
                @if (b.kind === 'image' && b.url) {
                  <img class="mod-img" [src]="assetUrl(b.url)" [alt]="b.alt || ''" />
                }
                @if (b.kind === 'video' && b.url) {
                  @if (embedUrl(b.url); as embed) {
                    <div class="video-wrap"><iframe [src]="embed" frameborder="0" allowfullscreen></iframe></div>
                  } @else {
                    <div class="video-wrap"><video [src]="b.url" controls></video></div>
                  }
                }
              }
              <!-- Legacy fallback for old text modules saved before blocks_json -->
              @if (slideBlocks(m).length === 0) {
                @for (img of imagesAt(m, 'above'); track img.url) {
                  <img class="mod-img" [src]="assetUrl(img.url)" [alt]="img.alt || ''" />
                }
                @if (m.body) { <div class="body">{{ m.body }}</div> }
                @for (img of imagesAt(m, 'below'); track img.url) {
                  <img class="mod-img" [src]="assetUrl(img.url)" [alt]="img.alt || ''" />
                }
              }
              <div class="actions">
                <button class="primary"
                        [disabled]="busy()"
                        (click)="completeText(m)"
                        [class.done-btn]="isModuleDone(m.id!)">
                  {{ isModuleDone(m.id!) ? '✓ Marked complete' : 'Mark as read' }}
                </button>
                <button class="ghost" (click)="next()" [disabled]="!canAdvance()">Next →</button>
              </div>
            }

            @if (m.kind === 'video') {
              @if (m.video_url) {
                @if (embedUrl(m.video_url); as embed) {
                  <div class="video-wrap"><iframe [src]="embed" frameborder="0" allowfullscreen></iframe></div>
                } @else {
                  <div class="video-wrap"><video [src]="m.video_url" controls></video></div>
                }
              } @else {
                <p class="muted small">No video URL configured for this module.</p>
              }
              @if (m.body) { <div class="body" style="margin-top: 12px;">{{ m.body }}</div> }
              <div class="actions">
                <button class="primary"
                        [disabled]="busy()"
                        (click)="completeText(m)"
                        [class.done-btn]="isModuleDone(m.id!)">
                  {{ isModuleDone(m.id!) ? '✓ Marked complete' : 'Mark as watched' }}
                </button>
                <button class="ghost" (click)="next()" [disabled]="!canAdvance()">Next →</button>
              </div>
            }

            @if (m.kind === 'quiz') {
              <p class="muted small">You must score {{ m.pass_score || 100 }}% to mark this module complete.</p>
              @for (q of quizQuestions(m); track q.id; let qi = $index) {
                <div class="q-card" [class.wrong]="lastResult()?.wrong_ids?.includes(q.id)">
                  <div class="q-prompt"><strong>{{ qi + 1 }}.</strong> {{ q.prompt }}</div>
                  @for (opt of q.options; track $index; let oi = $index) {
                    <label class="opt">
                      <input type="checkbox"
                             [checked]="(answers()[q.id] || []).includes(oi)"
                             (change)="toggleAnswer(q.id, oi)"
                             [disabled]="isModuleDone(m.id!)" />
                      <span>{{ opt }}</span>
                    </label>
                  }
                </div>
              }
              @if (lastResult(); as r) {
                <div class="result" [class.pass]="r.passed" [class.fail]="!r.passed">
                  @if (r.passed) {
                    ✓ {{ r.score }}% — passed.
                  } @else {
                    ✗ {{ r.score }}% — you need {{ r.pass_score }}% to pass. Adjust your answers and try again.
                  }
                </div>
              }
              <div class="actions">
                @if (isModuleDone(m.id!)) {
                  <button class="primary done-btn" disabled>✓ Quiz passed</button>
                } @else {
                  <button class="primary" [disabled]="busy()" (click)="submitQuiz(m)">Submit answers</button>
                }
                <button class="ghost" (click)="next()" [disabled]="!canAdvance()">Next →</button>
              </div>
            }
          </section>
        }

        @if (allDone()) {
          <div class="finished">
            <h3>🎉 Course complete!</h3>
            <p class="muted">You finished every module of "{{ snapshot()?.assignment?.title }}".</p>
            <button class="primary" (click)="exit.emit()">Back to learning</button>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; color: #0a0a0a; }
    .player { display: flex; flex-direction: column; gap: 16px; }
    .hdr { display: grid; grid-template-columns: auto 1fr; gap: 12px; align-items: center; }
    .hdr .title-block h2 { margin: 0; font-size: 18px; color: #0a0a0a; }
    .hdr .title-block .muted, :host .muted { color: #555 !important; }
    .bar { grid-column: 1 / -1; height: 6px; background: rgba(0,0,0,0.08); border-radius: 999px; overflow: hidden; }
    .bar .fill { height: 100%; background: var(--primary); transition: width 0.2s; }

    /* Ghost buttons inside the player live on a white page bg — global ghost
       inherits var(--fg) which is white in dark theme, making the button text
       invisible. Force a dark colour so "← Back" / "Next →" stay readable. */
    :host button.ghost { color: #0a0a0a; }
    :host button.ghost:hover { background: rgba(0,0,0,0.06); }
    :host button.ghost:disabled { color: #999; }

    .steps { display: flex; flex-wrap: wrap; gap: 6px; }
    .step {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 12px; background: var(--bg-2); border: 1px solid var(--line);
      border-radius: 999px; cursor: pointer; font-size: 12px; color: var(--muted);
    }
    .step:hover { border-color: var(--primary); }
    .step.active { background: var(--bg-3); border-color: var(--primary); color: var(--fg); }
    .step.done { color: var(--primary); border-color: var(--primary); }
    .step-num { display: inline-block; min-width: 18px; text-align: center; font-weight: 700; }
    .step-check { color: var(--primary); font-weight: 700; }

    .content {
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 18px; display: flex; flex-direction: column; gap: 12px;
    }
    .content h3 { margin: 0 0 4px; }
    .body { white-space: pre-wrap; line-height: 1.6; color: var(--fg); }
    .mod-img { display: block; max-width: 100%; height: auto; border-radius: 6px; border: 1px solid var(--line); }

    .video-wrap { position: relative; padding-top: 56.25%; background: #000; border-radius: 6px; overflow: hidden; }
    .video-wrap iframe, .video-wrap video {
      position: absolute; inset: 0; width: 100%; height: 100%; border: none; background: #000;
    }

    .q-card {
      background: var(--bg-3); border: 1px solid var(--line); border-radius: var(--radius-sm);
      padding: 12px; display: flex; flex-direction: column; gap: 6px;
    }
    .q-card.wrong { border-color: #ef4444; }
    .q-prompt { font-size: 14px; }
    .opt { display: flex; align-items: center; gap: 8px; padding: 4px 0; cursor: pointer; }

    .result {
      padding: 10px 12px; border-radius: var(--radius-sm); border: 1px solid var(--line);
      font-weight: 600;
    }
    .result.pass { color: var(--primary); border-color: var(--primary); background: rgba(212, 169, 58, 0.1); }
    .result.fail { color: #ef4444; border-color: #ef4444; background: rgba(239, 68, 68, 0.08); }

    .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
    .done-btn { background: var(--primary); color: #000; }

    .finished {
      background: var(--bg-2); border: 1px solid var(--primary); border-radius: var(--radius-sm);
      padding: 24px; text-align: center; display: flex; flex-direction: column; gap: 8px; align-items: center;
    }
  `],
})
export class HrCoursePlayer implements OnChanges {
  private api = inject(Api);
  private sanitizer = inject(DomSanitizer);

  @Input() assignmentId!: number;
  @Input() mode: 'me' | 'public' = 'me';
  @Input() token: string | null = null;
  @Output() exit = new EventEmitter<void>();
  @Output() completed = new EventEmitter<void>();

  loading = signal(true);
  busy = signal(false);
  snapshot = signal<HrCoursePlayerSnapshot | null>(null);
  index = signal(0);
  answers = signal<Record<string, number[]>>({});
  lastResult = signal<QuizOutcome | null>(null);

  current = computed(() => this.snapshot()?.modules?.[this.index()] ?? null);

  completedPct = computed(() => {
    const s = this.snapshot();
    const total = s?.modules?.length || 0;
    if (!total) return 0;
    const done = (s?.progress || []).filter(p => p.completed_at).length;
    return Math.round((done / total) * 100);
  });

  allDone = computed(() => {
    const s = this.snapshot();
    if (!s || !s.modules.length) return false;
    return s.modules.every(m => this.isModuleDone(m.id!));
  });

  canAdvance = computed(() => {
    const s = this.snapshot();
    if (!s) return false;
    return this.index() < s.modules.length - 1;
  });

  ngOnChanges() {
    if (this.assignmentId) this.load();
  }

  private load() {
    this.loading.set(true);
    this.lastResult.set(null);
    this.answers.set({});
    const obs = this.mode === 'public' && this.token
      ? this.api.getOnboardingCourseDetail(this.token, this.assignmentId)
      : this.api.getMyCourseDetail(this.assignmentId);
    obs.subscribe({
      next: snap => {
        this.snapshot.set(snap);
        // Jump to the first incomplete module so the user picks up where they left off.
        const firstUndone = snap.modules.findIndex(m => !this.isModuleDoneIn(snap.progress, m.id!));
        this.index.set(firstUndone === -1 ? 0 : firstUndone);
        this.loading.set(false);
      },
      error: () => { this.snapshot.set(null); this.loading.set(false); },
    });
  }

  goTo(i: number) {
    this.index.set(i);
    this.lastResult.set(null);
    this.answers.set({});
  }

  next() {
    const s = this.snapshot();
    if (!s) return;
    const i = this.index();
    if (i < s.modules.length - 1) {
      this.index.set(i + 1);
      this.lastResult.set(null);
      this.answers.set({});
    }
  }

  isModuleDone(mid: number): boolean {
    return this.isModuleDoneIn(this.snapshot()?.progress || [], mid);
  }
  private isModuleDoneIn(prog: HrCourseModuleProgress[], mid: number): boolean {
    return prog.some(p => p.module_id === mid && !!p.completed_at);
  }

  completeText(m: HrCourseModule) {
    if (this.busy() || !m.id) return;
    this.busy.set(true);
    const obs = this.mode === 'public' && this.token
      ? this.api.completeOnboardingCourseModule(this.token, this.assignmentId, m.id)
      : this.api.completeMyCourseModule(this.assignmentId, m.id);
    obs.subscribe({
      next: () => { this.afterCompletion(); this.busy.set(false); },
      error: () => { this.busy.set(false); },
    });
  }

  toggleAnswer(qid: string, oi: number) {
    const cur = this.answers()[qid] || [];
    const next = cur.includes(oi) ? cur.filter(x => x !== oi) : [...cur, oi];
    this.answers.set({ ...this.answers(), [qid]: next });
  }

  submitQuiz(m: HrCourseModule) {
    if (this.busy() || !m.id) return;
    this.busy.set(true);
    const obs = this.mode === 'public' && this.token
      ? this.api.submitOnboardingCourseQuiz(this.token, this.assignmentId, m.id, this.answers())
      : this.api.submitMyCourseQuiz(this.assignmentId, m.id, this.answers());
    obs.subscribe({
      next: r => {
        this.lastResult.set({ score: r.score, passed: r.passed, pass_score: r.pass_score, wrong_ids: r.wrong_ids });
        this.afterCompletion();
        this.busy.set(false);
      },
      error: () => { this.busy.set(false); },
    });
  }

  slideBlocks(m: HrCourseModule): HrSlideBlock[] {
    if (!m.blocks_json) return [];
    try {
      const v = JSON.parse(m.blocks_json);
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }

  imagesAt(m: HrCourseModule, position: 'above' | 'below'): HrCourseModuleImage[] {
    if (!m.images_json) return [];
    try {
      const v = JSON.parse(m.images_json);
      return Array.isArray(v) ? v.filter((i: any) => i?.position === position) : [];
    } catch { return []; }
  }
  assetUrl(rel: string): string { return `${environment.basePath}/` + rel; }

  quizQuestions(m: HrCourseModule): HrQuizQuestion[] {
    if (m.kind !== 'quiz' || !m.quiz_json) return [];
    try {
      const v = JSON.parse(m.quiz_json);
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }

  embedUrl(url: string | null | undefined): SafeResourceUrl | null {
    if (!url) return null;
    let embed: string | null = null;
    const yt = url.match(/(?:youtu\.be\/|v=)([\w-]+)/);
    if (yt) embed = `https://www.youtube.com/embed/${yt[1]}`;
    const vm = url.match(/vimeo\.com\/(\d+)/);
    if (vm) embed = `https://player.vimeo.com/video/${vm[1]}`;
    return embed ? this.sanitizer.bypassSecurityTrustResourceUrl(embed) : null;
  }

  private afterCompletion() {
    // Refetch so progress + assignment status reflect the latest state.
    const obs = this.mode === 'public' && this.token
      ? this.api.getOnboardingCourseDetail(this.token, this.assignmentId)
      : this.api.getMyCourseDetail(this.assignmentId);
    obs.subscribe(snap => {
      this.snapshot.set(snap);
      if (snap.assignment.status === 'completed') this.completed.emit();
    });
  }
}

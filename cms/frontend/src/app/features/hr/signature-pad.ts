import { Component, ElementRef, EventEmitter, Output, ViewChild, signal } from '@angular/core';

/**
 * Tiny canvas-based signature pad. Emits a base64 PNG data URL via (signed),
 * or null if the user clears the pad.
 */
@Component({
  selector: 'app-signature-pad',
  template: `
    <div class="pad-wrap">
      <canvas #canvas
              width="500" height="180"
              (pointerdown)="start($event)"
              (pointermove)="move($event)"
              (pointerup)="end()"
              (pointerleave)="end()"></canvas>
      <div class="pad-actions">
        <span class="muted small">Sign with mouse, finger, or stylus</span>
        <span class="spacer"></span>
        <button class="ghost" type="button" (click)="clear()" [disabled]="empty()">Clear</button>
        <button class="primary" type="button" (click)="emit()" [disabled]="empty()">Submit signature</button>
      </div>
    </div>
  `,
  styles: [`
    .pad-wrap { background: #ffffff; border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 8px; }
    canvas { display: block; width: 100%; max-width: 500px; height: 180px; touch-action: none; cursor: crosshair; background: #fafafa; border: 1px dashed #d4d4d4; border-radius: 4px; }
    .pad-actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .spacer { flex: 1; }
  `],
})
export class SignaturePad {
  @Output() signed = new EventEmitter<string>();
  @ViewChild('canvas', { static: true }) canvas!: ElementRef<HTMLCanvasElement>;
  empty = signal(true);
  private ctx: CanvasRenderingContext2D | null = null;
  private drawing = false;

  ngAfterViewInit() {
    const c = this.canvas.nativeElement;
    this.ctx = c.getContext('2d');
    if (this.ctx) {
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.lineWidth = 2;
      this.ctx.strokeStyle = '#0a0a0a';
    }
  }

  start(e: PointerEvent) {
    if (!this.ctx) return;
    this.drawing = true;
    const { x, y } = this.coords(e);
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
  }
  move(e: PointerEvent) {
    if (!this.drawing || !this.ctx) return;
    const { x, y } = this.coords(e);
    this.ctx.lineTo(x, y);
    this.ctx.stroke();
    this.empty.set(false);
  }
  end() { this.drawing = false; }

  private coords(e: PointerEvent) {
    const r = this.canvas.nativeElement.getBoundingClientRect();
    const sx = this.canvas.nativeElement.width / r.width;
    const sy = this.canvas.nativeElement.height / r.height;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  }

  clear() {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.canvas.nativeElement.width, this.canvas.nativeElement.height);
    this.empty.set(true);
  }
  emit() {
    if (this.empty()) return;
    this.signed.emit(this.canvas.nativeElement.toDataURL('image/png'));
  }
}

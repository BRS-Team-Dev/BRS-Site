import { Component, Injectable, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

/**
 * Reusable overlay-modal replacement for native `alert()` and
 * `confirm()`. Two pieces:
 *
 *   1. {@link DialogService} — inject anywhere and call
 *      `dialog.alert(msg)` / `dialog.confirm(msg, opts)`. Both return
 *      a Promise you can `await`.
 *
 *   2. {@link DialogHost} — mount once at app root. Consumes the
 *      service's `active` signal and renders the current dialog on
 *      top of everything.
 *
 * Rationale: the project forbids native browser dialogs (see
 * `memory/feedback_no_native_dialogs.md`). Building this once here
 * beats re-authoring an inline overlay in every component. Uses the
 * global `.modal-backdrop` / `.modal` / `.modal-*` classes from
 * `styles.scss` so it matches every other modal in the app.
 */

export interface DialogOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Visual accent — controls the header colour and the primary
   *  button style. Defaults to 'default' (gold primary). */
  variant?: 'default' | 'danger' | 'success' | 'warning';
  /** When true, hides the Cancel button. Used by `alert()`. */
  hideCancel?: boolean;
}

export interface PromptOptions extends DialogOptions {
  /** Pre-fill for the input. */
  defaultValue?: string;
  placeholder?: string;
  /** HTML input type — 'text' | 'number' | 'email' | etc. */
  inputType?: string;
  /** When true, empty submissions are rejected (Confirm stays disabled). */
  required?: boolean;
}

interface DialogEntry extends DialogOptions {
  /** Text-input mode when set. Resolve receives the string value; a
   *  Cancel resolves with null. */
  prompt?: PromptOptions & { value: string };
  resolve: (result: any) => void;
}

@Injectable({ providedIn: 'root' })
export class DialogService {
  /** The currently-visible dialog (or null when idle). Single-slot —
   *  new calls queue up if one is already open. Simpler than a real
   *  queue and covers the 99% case: one dialog at a time. */
  active = signal<DialogEntry | null>(null);

  private queue: DialogEntry[] = [];

  alert(message: string, opts?: Partial<DialogOptions>): Promise<void> {
    return this.confirm(message, {
      confirmLabel: 'OK',
      hideCancel: true,
      ...(opts ?? {}),
    }).then(() => undefined);
  }

  confirm(message: string, opts?: Partial<DialogOptions>): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      const entry: DialogEntry = {
        message,
        confirmLabel: opts?.confirmLabel ?? 'Confirm',
        cancelLabel:  opts?.cancelLabel  ?? 'Cancel',
        variant:      opts?.variant      ?? 'default',
        title:        opts?.title,
        hideCancel:   opts?.hideCancel,
        resolve,
      };
      if (this.active()) this.queue.push(entry);
      else this.active.set(entry);
    });
  }

  /** Text-input replacement for native `prompt()`. Resolves with the
   *  entered string on OK, or null on Cancel / backdrop click. */
  prompt(message: string, opts?: Partial<PromptOptions>): Promise<string | null> {
    return new Promise<string | null>(resolve => {
      const entry: DialogEntry = {
        message,
        confirmLabel: opts?.confirmLabel ?? 'OK',
        cancelLabel:  opts?.cancelLabel  ?? 'Cancel',
        variant:      opts?.variant      ?? 'default',
        title:        opts?.title,
        prompt: {
          message,
          defaultValue: opts?.defaultValue ?? '',
          placeholder:  opts?.placeholder  ?? '',
          inputType:    opts?.inputType    ?? 'text',
          required:     opts?.required     ?? false,
          value:        opts?.defaultValue ?? '',
        },
        resolve,
      };
      if (this.active()) this.queue.push(entry);
      else this.active.set(entry);
    });
  }

  /** Internal — called by the host when the user picks a button.
   *  For confirm/alert: `result` is boolean.
   *  For prompt on OK: result is the string value.
   *  For prompt on Cancel: result is null. */
  _resolve(result: any): void {
    const cur = this.active();
    if (!cur) return;
    cur.resolve(result);
    this.active.set(this.queue.shift() ?? null);
  }
}

@Component({
  selector: 'app-dialog-host',
  imports: [FormsModule],
  template: `
    @if (svc.active(); as d) {
      <div class="modal-backdrop" (click)="onBackdrop(d)">
        <div class="modal modal-narrow"
             role="alertdialog"
             (click)="$event.stopPropagation()">
          @if (d.title) {
            <div class="modal-head" [attr.data-variant]="d.variant">
              <h2>{{ d.title }}</h2>
            </div>
          }
          <div class="modal-body">
            <p class="dialog-message">{{ d.message }}</p>
            @if (d.prompt) {
              <input class="dialog-input"
                     [type]="d.prompt.inputType"
                     [placeholder]="d.prompt.placeholder"
                     [(ngModel)]="d.prompt.value"
                     (keydown.enter)="promptSubmit(d)"
                     autofocus />
            }
          </div>
          <div class="modal-foot">
            @if (!d.hideCancel) {
              <button type="button" class="ghost" (click)="onCancel(d)">
                {{ d.cancelLabel }}
              </button>
            }
            <button type="button"
                    [class]="'primary variant-' + d.variant"
                    (click)="onConfirm(d)"
                    [disabled]="!!d.prompt && !!d.prompt.required && !d.prompt.value.trim()">
              {{ d.confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    /* Slim override for confirm/alert bodies — the shared .modal is
       tuned for forms. Dialogs read cleaner narrow. */
    .modal-narrow { width: 440px; max-width: 92vw; }
    .dialog-message {
      margin: 0; line-height: 1.55; font-size: 14px; color: var(--fg);
      white-space: pre-line;    /* honour \\n in the message string */
    }
    .dialog-input {
      width: 100%; margin-top: 14px;
      padding: 10px 12px; font-size: 14px;
      background: var(--bg-3); color: var(--fg);
      border: 1px solid var(--line); border-radius: var(--radius-sm);
    }
    .dialog-input:focus { outline: none; border-color: var(--primary); }
    /* Variant-specific button colours — matches the app's semantic
       palette. Default keeps the gold primary. */
    .primary.variant-danger  {
      background: var(--danger); border-color: var(--danger); color: var(--bg);
    }
    .primary.variant-danger:hover  {
      background: color-mix(in oklab, var(--danger), black 12%);
    }
    .primary.variant-success {
      background: var(--success); border-color: var(--success); color: var(--bg);
    }
    .primary.variant-warning {
      background: var(--warning); border-color: var(--warning); color: var(--bg);
    }
    .modal-head[data-variant="danger"]  h2 { color: var(--danger); }
    .modal-head[data-variant="warning"] h2 { color: var(--warning); }
    .modal-head[data-variant="success"] h2 { color: var(--success); }
  `],
})
export class DialogHost {
  svc = inject(DialogService);

  /** Confirm click. Prompt mode resolves with the string value; the
   *  disabled state on the button already blocks empty-required
   *  submissions so we can trust the value here. */
  onConfirm(d: DialogEntry) {
    if (d.prompt) this.svc._resolve(d.prompt.value);
    else this.svc._resolve(true);
  }

  /** Cancel click / Esc-equivalent. Prompt resolves null; confirm/alert
   *  resolves false. */
  onCancel(d: DialogEntry) {
    if (d.prompt) this.svc._resolve(null);
    else this.svc._resolve(false);
  }

  /** Enter-key inside the prompt input submits, matching browser prompt UX. */
  promptSubmit(d: DialogEntry) {
    if (!d.prompt) return;
    if (d.prompt.required && !d.prompt.value.trim()) return;
    this.svc._resolve(d.prompt.value);
  }

  /** Backdrop click cancels (same behaviour as native confirm's Esc).
   *  Alerts have no Cancel, so we treat backdrop click as OK for them. */
  onBackdrop(d: DialogEntry) {
    if (d.prompt) this.svc._resolve(null);
    else this.svc._resolve(d.hideCancel ? true : false);
  }
}

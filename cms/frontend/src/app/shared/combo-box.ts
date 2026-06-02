import { Component, ElementRef, EventEmitter, HostListener, Input, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface ComboOption {
  value: string | number | null;
  label: string;
}

/**
 * Compact combobox: click-to-open, type-to-filter dropdown that fills the
 * input width. Supports either a strict choice (allowCustom = false) or a
 * free-text combo where the user can type a value not in the list.
 */
@Component({
  selector: 'app-combo-box',
  imports: [FormsModule],
  template: `
    <div class="combo">
      <input
        type="text"
        [value]="display()"
        (input)="onType($any($event.target).value)"
        (focus)="open()"
        (click)="open()"
        (keydown.escape)="close()"
        (keydown.enter)="commit($event)"
        [placeholder]="placeholder"
        [name]="name"
        autocomplete="off"
      />
      <span class="caret" (mousedown)="toggle($event)">▾</span>
      @if (isOpen()) {
        <div class="popup" (mousedown)="$event.preventDefault()">
          @for (o of filtered(); track o.value) {
            <button type="button"
                    class="opt"
                    [class.active]="o.value === selectedValue"
                    (click)="pick(o)">
              {{ o.label }}
            </button>
          }
          @if (filtered().length === 0) {
            <p class="empty">No matches</p>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; position: relative; }
    .combo { position: relative; }
    input { width: 100%; padding-right: 32px; }
    .caret {
      position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
      color: var(--muted); font-size: 11px; pointer-events: auto;
      cursor: pointer; user-select: none;
    }
    .popup {
      position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 50;
      max-height: 240px; overflow-y: auto;
      background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm);
      box-shadow: var(--shadow);
      padding: 4px;
      display: flex; flex-direction: column; gap: 2px;
    }
    .opt {
      display: block; width: 100%; text-align: left;
      padding: 8px 10px;
      background: transparent; border: 0; border-radius: var(--radius-sm);
      color: var(--fg); cursor: pointer; font-size: 13px;
    }
    .opt:hover { background: var(--bg-3); }
    .opt.active { background: var(--bg-3); color: var(--primary); }
    .empty { padding: 10px; margin: 0; color: var(--muted); font-size: 12px; text-align: center; }
  `],
})
export class ComboBox {
  private host = inject(ElementRef<HTMLElement>);

  @Input() items: ComboOption[] = [];
  @Input() selectedValue: string | number | null = null;
  @Input() placeholder = '';
  @Input() name = '';
  /** Allow the user to keep a typed value that doesn't match any option. */
  @Input() allowCustom = false;
  /** Optional fallback label shown for `selectedValue` when it isn't found in `items` (only used when `allowCustom`). */
  @Input() customLabel: string | null = null;

  @Output() valueChange = new EventEmitter<string | number | null>();

  isOpen = signal(false);
  query = signal<string | null>(null);

  /**
   * Text shown in the input field — either the user's in-progress query or
   * the selected option's label. Plain method (NOT a computed) because it
   * reads the `selectedValue` @Input which isn't a tracked signal; a
   * computed would cache a stale value when the parent changes the input.
   */
  display(): string {
    const q = this.query();
    if (q !== null) return q;
    const match = this.items.find(i => i.value === this.selectedValue);
    if (match) return match.label;
    return this.allowCustom && this.customLabel ? this.customLabel : '';
  }

  filtered = computed(() => {
    const q = (this.query() ?? '').toLowerCase().trim();
    if (!q) return this.items;
    return this.items.filter(i => i.label.toLowerCase().includes(q));
  });

  open()  { this.isOpen.set(true); }
  close() { this.isOpen.set(false); this.query.set(null); }
  toggle(ev: Event) { ev.preventDefault(); this.isOpen.update(v => !v); }

  onType(v: string) {
    this.query.set(v);
    this.isOpen.set(true);
  }
  pick(o: ComboOption) {
    this.valueChange.emit(o.value);
    this.query.set(null);
    this.isOpen.set(false);
  }
  commit(ev: Event) {
    ev.preventDefault();
    const q = this.query();
    if (q === null) { this.close(); return; }
    const direct = this.items.find(i => i.label.toLowerCase() === q.toLowerCase());
    if (direct) { this.pick(direct); return; }
    if (this.allowCustom && q.trim()) {
      this.valueChange.emit(q.trim());
      this.query.set(null);
      this.isOpen.set(false);
      return;
    }
    this.close();
  }

  /** Close the popup when clicking anywhere outside this combobox. */
  @HostListener('document:mousedown', ['$event'])
  onDocClick(ev: MouseEvent) {
    if (!this.isOpen()) return;
    if (!this.host.nativeElement.contains(ev.target as Node)) this.close();
  }
}

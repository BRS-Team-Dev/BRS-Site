import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  constructor() {
    // Project-wide UX: clicking anywhere on a date / time input opens the
    // native picker, not just the calendar icon. Browsers added showPicker()
    // in early 2022 — supported in all evergreen browsers.
    document.addEventListener('click', (e) => {
      const t = e.target as HTMLInputElement | null;
      if (!t || t.tagName !== 'INPUT') return;
      const type = t.type;
      if (type === 'date' || type === 'datetime-local' || type === 'time' || type === 'month' || type === 'week') {
        try { (t as any).showPicker?.(); } catch { /* user-gesture or already-open: ignore */ }
      }
    }, { capture: false });
  }
}

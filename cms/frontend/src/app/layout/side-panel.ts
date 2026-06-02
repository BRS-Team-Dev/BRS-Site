import { Component, computed, inject } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { SidePanel } from './side-panel.service';

@Component({
  selector: 'app-side-panel',
  imports: [NgComponentOutlet],
  template: `
    @if (state(); as s) {
      <div class="overlay" (click)="close()"></div>
      <aside class="panel" role="dialog">
        <header>
          <h2>{{ s.title || '' }}</h2>
          <button class="ghost" (click)="close()" aria-label="Close">✕</button>
        </header>
        <div class="content">
          <ng-container *ngComponentOutlet="s.component; inputs: s.inputs"></ng-container>
        </div>
      </aside>
    }
  `,
  styles: [`
    .overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.5);
      z-index: 100; backdrop-filter: blur(2px);
    }
    .panel {
      position: fixed; top: 0; right: 0; bottom: 0;
      width: min(560px, 95vw);
      background: var(--bg-2); border-left: 1px solid var(--line);
      z-index: 101; display: flex; flex-direction: column;
      box-shadow: var(--shadow);
      animation: slide 0.25s ease-out;
    }
    @keyframes slide { from { transform: translateX(100%); } to { transform: translateX(0); } }
    header {
      display: flex; align-items: center; gap: 12px;
      padding: 16px 20px; border-bottom: 1px solid var(--line);
    }
    header h2 { margin: 0; font-size: 16px; font-weight: 600; flex: 1; }
    .content { flex: 1; overflow-y: auto; padding: 20px; }
  `],
})
export class SidePanelHost {
  private svc = inject(SidePanel);
  state = this.svc.state;
  close() { this.svc.close(); }
}

import { Injectable, signal, Type } from '@angular/core';

export interface SidePanelState {
  component: Type<any>;
  inputs?: Record<string, any>;
  title?: string;
}

@Injectable({ providedIn: 'root' })
export class SidePanel {
  private _state = signal<SidePanelState | null>(null);
  readonly state = this._state.asReadonly();

  open(component: Type<any>, inputs: Record<string, any> = {}, title = '') {
    this._state.set({ component, inputs, title });
  }
  close() {
    this._state.set(null);
  }
}

import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TopNav } from './top-nav';
import { SideNav } from './side-nav';
import { HrSideNav } from './hr-side-nav';
import { ManagementSideNav } from './management-side-nav';
import { MeSideNav } from './me-side-nav';
import { TasksSideNav } from './tasks-side-nav';
import { AccountingSideNav } from './accounting-side-nav';
import { SidePanelHost } from './side-panel';
import { SystemService } from '../core/system.service';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, TopNav, SideNav, HrSideNav, ManagementSideNav, MeSideNav, TasksSideNav, AccountingSideNav, SidePanelHost],
  template: `
    <div class="layout">
      @switch (system.current()) {
        @case ('hr')         { <app-hr-side-nav /> }
        @case ('management') { <app-management-side-nav /> }
        @case ('me')         { <app-me-side-nav /> }
        @case ('tasks')      { <app-tasks-side-nav /> }
        @case ('accounting') { <app-accounting-side-nav /> }
        @default             { <app-side-nav /> }
      }
      <div class="content">
        <app-top-nav />
        <main>
          <router-outlet />
        </main>
      </div>
    </div>
    <app-side-panel />
  `,
  styles: [`
    :host { display: block; height: 100vh; }
    /* Override the global .layout { padding: 20px } in styles.scss — that
       utility is for detail/edit page wrappers, not for the app shell. */
    .layout { display: flex; height: 100%; padding: 0; }
    .content { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    main { flex: 1; overflow-y: auto; min-height: 0; }
  `],
})
export class Shell {
  system = inject(SystemService);
}

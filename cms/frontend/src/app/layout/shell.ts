import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TopNav } from './top-nav';
import { SideNav } from './side-nav';
import { HrSideNav } from './hr-side-nav';
import { ManagementSideNav } from './management-side-nav';
import { OperationsSideNav } from './operations-side-nav';
import { RecruitmentSideNav } from './recruitment-side-nav';
import { MeSideNav } from './me-side-nav';
import { ContractorMeSideNav } from './contractor-me-side-nav';
import { TasksSideNav } from './tasks-side-nav';
import { AccountingSideNav } from './accounting-side-nav';
import { SidePanelHost } from './side-panel';
import { SystemService } from '../core/system.service';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, TopNav, SideNav, HrSideNav, ManagementSideNav, OperationsSideNav, RecruitmentSideNav, MeSideNav, ContractorMeSideNav, TasksSideNav, AccountingSideNav, SidePanelHost],
  template: `
    <div class="layout">
      @switch (system.current()) {
        @case ('hr')         { <app-hr-side-nav /> }
        @case ('management') { <app-management-side-nav /> }
        @case ('operations') { <app-operations-side-nav /> }
        @case ('recruitment') { <app-recruitment-side-nav /> }
        @case ('me')         { <app-me-side-nav /> }
        @case ('contractor-me') { <app-contractor-me-side-nav /> }
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
    :host { display: block; height: 100vh; overflow: hidden; }
    /* Override the global .layout { padding: 20px } in styles.scss — that
       utility is for detail/edit page wrappers, not for the app shell. */
    .layout { display: flex; height: 100%; padding: 0; }
    .content { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    /* min-width: 0 lets a wider-than-viewport child (a long table) scroll
       INSIDE its own container instead of pushing main wider and forcing
       the page to scroll horizontally. overflow-x: hidden is the safety
       net — even if a future child forgets to wrap a scroll region,
       horizontal overflow still can't escape the shell. */
    main {
      flex: 1; min-width: 0; min-height: 0;
      overflow-x: hidden; overflow-y: auto;
    }
  `],
})
export class Shell {
  system = inject(SystemService);
}

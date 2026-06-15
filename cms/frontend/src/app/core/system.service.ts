import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

export type SystemKey = 'cms' | 'hr' | 'management' | 'operations' | 'recruitment' | 'tasks' | 'accounting' | 'crm' | 'me' | 'support';

export interface SystemDef {
  key: SystemKey;
  label: string;
  /** Default landing path for the system. */
  home: string;
  /** Whether the system is fully implemented or shown as a placeholder. */
  placeholder?: boolean;
  /** When true, the system is omitted from the system switcher (e.g. accessed
   *  via a different entry point like the user dropdown). */
  hidden?: boolean;
}

const SYSTEMS: SystemDef[] = [
  { key: 'cms',        label: 'CRM',        home: '/admin/clients' },
  { key: 'hr',         label: 'HR',         home: '/hr/dashboard' },
  { key: 'management', label: 'Management', home: '/management/dashboard' },
  { key: 'operations', label: 'Operations', home: '/operations/dashboard' },
  { key: 'recruitment', label: 'Recruitment', home: '/recruitment/dashboard' },
  { key: 'tasks',      label: 'Tasks',      home: '/tasks/taskboard' },
  { key: 'accounting', label: 'Accounting', home: '/accounting/dashboard' },
  { key: 'crm',        label: 'CMS',        home: '/crm',     placeholder: true },
  { key: 'support',    label: 'Support',    home: '/support', placeholder: true },
  // Per-user area, reached from the user dropdown in the top nav. Hidden from
  // the system switcher so it doesn't sit alongside the functional systems.
  { key: 'me',         label: 'My Account', home: '/me',      hidden: true },
];

@Injectable({ providedIn: 'root' })
export class SystemService {
  private router = inject(Router);

  readonly systems = SYSTEMS;
  /** Current path, kept in sync with the router so signals can react in zoneless mode. */
  private url = signal<string>(this.router.url);

  readonly current = computed<SystemKey>(() => {
    const u = this.url();
    if (u.startsWith('/management')) return 'management';
    if (u.startsWith('/operations'))  return 'operations';
    if (u.startsWith('/recruitment')) return 'recruitment';
    if (u.startsWith('/hr'))         return 'hr';
    if (u.startsWith('/me'))         return 'me';
    if (u.startsWith('/tasks'))      return 'tasks';
    if (u.startsWith('/accounting')) return 'accounting';
    if (u.startsWith('/crm'))        return 'crm';
    if (u.startsWith('/support'))    return 'support';
    return 'cms';
  });

  readonly currentDef = computed(() =>
    this.systems.find(s => s.key === this.current()) ?? this.systems[0]
  );

  constructor() {
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe(e => this.url.set((e as NavigationEnd).urlAfterRedirects));
  }

  switchTo(key: SystemKey) {
    const def = this.systems.find(s => s.key === key);
    if (def) this.router.navigateByUrl(def.home);
  }
}

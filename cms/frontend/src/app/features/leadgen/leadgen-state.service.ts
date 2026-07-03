import { Injectable, signal } from '@angular/core';
import { Lead } from '../../core/models';

/**
 * Lightweight transport for AI-generated leads between the two
 * leadgen pages.
 *
 *   /admin/leadgen        (Lead Gen page) — fires generation, drops
 *                          the result into `pendingAiLeads`, then
 *                          navigates to /admin/leads/import.
 *   /admin/leads/import   (Import Leads)  — on init, pulls anything
 *                          out of `pendingAiLeads` into its own
 *                          local preview/import state and clears
 *                          the buffer.
 *
 * Lives at the root injector so the buffer survives the navigation
 * (the two routes mount the same component but Angular destroys +
 * recreates the instance on each navigation, so a local signal
 * wouldn't carry over).
 */
@Injectable({ providedIn: 'root' })
export class LeadgenStateService {
  /** Holds AI-generated leads waiting to be picked up by the Import
   *  Leads page. Set on the Lead Gen page right before navigation;
   *  cleared by the consumer on first read. Reading is destructive
   *  by convention — call `consumePendingAiLeads()` not `()`. */
  readonly pendingAiLeads = signal<Partial<Lead>[] | null>(null);

  /** Pull-and-clear the buffer. Returns the leads if there were any,
   *  else null. */
  consumePendingAiLeads(): Partial<Lead>[] | null {
    const v = this.pendingAiLeads();
    if (v) this.pendingAiLeads.set(null);
    return v;
  }
}

import { Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { DialogService } from '../../core/dialog';
import { BillingProfile, BillingSummary, PaymentMethod, StripeConfig, SubscriptionInvoice, SubscriptionPlan, SubscriptionTier } from '../../core/models';

/** Stripe.js is loaded from a <script> in index.html. It attaches
 *  a global `Stripe` factory. Declare it here so TS is happy without
 *  pulling the @stripe/stripe-js npm package (unnecessary since we're
 *  using the CDN loader). */
declare const Stripe: undefined | ((key: string) => any);

/**
 * Settings → Billing tab.
 *
 * Three sections in one tab:
 *   1. Plan summary — mirrors what the Account tab shows for the tier,
 *      but read-only. The "Change plan" button jumps to Account where
 *      the upgrade UI lives. One source of truth for cap changes.
 *   2. Billing profile — email / postal address / VAT number. Stored
 *      on `tenants` (migration 129). Used for invoice PDFs.
 *   3. Payment methods — list of saved cards. Add captures the metadata
 *      only (brand + last4 + expiry). Real PAN capture would go through
 *      Stripe Elements; this is the metadata surface.
 *   4. Invoices — SaaS subscription invoices for THIS tenant (us → them).
 *      Distinct from the Accounting module which is tenant → their clients.
 *
 * The three current card brands (Visa/Mastercard/Amex) cover >95% of
 * B2B traffic; "Other" is available for anything else. This keeps the
 * add-card form's brand selector short instead of shipping a dropdown
 * of every issuer network.
 */

const TIER_LABELS: Record<SubscriptionTier, string> = {
  trial:           'Trial',
  starter:         'Starter',
  growth:          'Growth',
  scale:           'Scale',
  business:        'Business',
  enterprise_lite: 'Enterprise Lite',
  enterprise:      'Enterprise',
};

const STATUS_LABELS: Record<SubscriptionInvoice['status'], string> = {
  draft:    'Draft',
  sent:     'Sent',
  paid:     'Paid',
  failed:   'Failed',
  refunded: 'Refunded',
};

interface PmDraft {
  id?: number;
  type: 'card' | 'bank' | 'other';
  brand: string;
  last4: string;
  holder_name: string;
  expires_month: number | null;
  expires_year: number | null;
  is_default: boolean;
}

@Component({
  selector: 'app-settings-billing',
  imports: [FormsModule],
  template: `
    @if (loading()) {
      <p class="muted small">Loading…</p>
    } @else if (summary(); as sum) {
      <!-- ── Current plan strip ─────────────────────────────── -->
      <section class="tier-card">
        <div class="tier-head">
          <div>
            <div class="muted small">Current plan</div>
            <strong>{{ tierLabel(sum.profile.subscription_tier) }}</strong>
          </div>
          @if (stripe()?.tenant?.stripe_current_period_end) {
            <div>
              <div class="muted small">Renews on</div>
              <strong>{{ fmtDate(stripe()!.tenant.stripe_current_period_end) }}</strong>
            </div>
          }
          <button class="ghost" (click)="goAccount()">Manage users →</button>
        </div>
      </section>

      @if (sum.profile.pending_tier) {
        <!-- Pending downgrade banner. Shown between the plan strip
             and the picker so users can't miss it. Cancel restores
             the current tier for future renewals. -->
        <section class="pending-banner">
          <div>
            <strong>Downgrade scheduled: {{ tierLabel(sum.profile.pending_tier) }}</strong>
            <div class="muted small">
              Effective {{ fmtDate(sum.profile.pending_effective_at) }}. You keep {{ tierLabel(sum.profile.subscription_tier) }} access until then.
            </div>
          </div>
          <button class="ghost small" (click)="cancelPending()" [disabled]="pendingCancelling()">
            {{ pendingCancelling() ? 'Cancelling…' : 'Cancel scheduled downgrade' }}
          </button>
        </section>
      }

      <!-- ── Plan picker ──────────────────────────────────────── -->
      <section>
        <div class="section-head">
          <h3>Change plan</h3>
          <span class="spacer"></span>
          <div class="cadence-toggle" role="tablist">
            <button type="button"
                    [class.active]="cadence() === 'monthly'"
                    (click)="cadence.set('monthly')">Monthly</button>
            <button type="button"
                    [class.active]="cadence() === 'yearly'"
                    (click)="cadence.set('yearly')">
              Yearly <span class="pill-inline">save ~17%</span>
            </button>
          </div>
        </div>

        @if (plans().length === 0) {
          <p class="muted small">Loading plans…</p>
        } @else {
          <div class="carousel">
            <button type="button" class="carousel-arrow left"
                    (click)="scrollCarousel(-1)"
                    aria-label="Previous plans">‹</button>

            <div class="carousel-track" #carouselTrack (scroll)="onCarouselScroll()">
              @for (p of visiblePlans(); track p.id) {
                <div class="plan-card"
                     [class.current]="p.tier === sum.profile.subscription_tier"
                     [class.highlight]="p.is_highlight">
                  @if (p.is_highlight) { <span class="badge">Main offer</span> }
                  @if (p.tier === sum.profile.subscription_tier) { <span class="badge current">Your plan</span> }

                  <div class="plan-head">
                    <h4>{{ p.name }}</h4>
                    <p class="muted small">{{ p.tagline }}</p>
                  </div>

                  <div class="plan-price">
                    @if (p.is_contact_sales) {
                      <strong class="price-value">Talk to us</strong>
                      <span class="muted small">Custom pricing</span>
                    } @else {
                      <div class="price-row">
                        <span class="price-value">{{ fmtMoney(planPrice(p), p.currency) }}</span>
                        <span class="muted small price-cadence">/{{ cadence() === 'yearly' ? 'yr' : 'mo' }}</span>
                      </div>
                      @if (cadence() === 'yearly') {
                        <span class="muted small">~{{ fmtMoney(planPrice(p) / 12, p.currency) }}/month billed annually</span>
                      }
                    }
                  </div>

                  <div class="plan-users">
                    <span class="chip">{{ p.user_range_label || (p.max_users == null ? 'Unlimited users' : (p.max_users + ' users')) }}</span>
                  </div>

                  <ul class="plan-features">
                    @for (f of p.features; track f) { <li>{{ f }}</li> }
                  </ul>

                  <div class="plan-cta">
                    @if (p.tier === sum.profile.subscription_tier) {
                      <button class="ghost" disabled>Current plan</button>
                    } @else if (p.is_contact_sales) {
                      <a class="ghost" href="mailto:hello@builtrightstudio.com?subject=Enterprise%20plan%20enquiry">Contact sales</a>
                    } @else if (!stripe()?.configured) {
                      <button class="primary" (click)="subscribeManual(p.tier)">Choose {{ p.name }}</button>
                    } @else {
                      <button class="primary"
                              (click)="subscribeStripe(p)"
                              [disabled]="subscribingTier() === p.tier">
                        {{ subscribingTier() === p.tier ? 'Redirecting…' : 'Choose ' + p.name }}
                      </button>
                    }
                  </div>
                </div>
              }
            </div>

            <button type="button" class="carousel-arrow right"
                    (click)="scrollCarousel(1)"
                    aria-label="Next plans">›</button>
          </div>

          <div class="carousel-dots">
            @for (p of visiblePlans(); track p.id; let i = $index) {
              <button type="button"
                      class="dot"
                      [class.active]="carouselIndex() === i"
                      (click)="scrollTo(i)"
                      [attr.aria-label]="'Show ' + p.name"></button>
            }
          </div>

          @if (sum.profile.subscription_tier !== 'trial' && stripe()?.tenant?.stripe_subscription_id) {
            <p class="muted small cancel-row">
              Need to cancel?
              <button class="link" (click)="cancelSubscription()">Cancel at end of period</button>
            </p>
          }
        }
      </section>

      <!-- ── Billing profile ──────────────────────────────────── -->
      <section>
        <div class="section-head">
          <h3>Billing details</h3>
        </div>
        <p class="muted small">Shown on invoice PDFs and used for tax
          calculations. Keep the address current — VAT-registered
          customers must supply a valid VAT number.</p>

        <label>Billing email</label>
        <input type="email" [(ngModel)]="profile.billing_email" name="be"
               placeholder="finance@yourcompany.com" />

        <label>Billing address</label>
        <textarea [(ngModel)]="profile.billing_address" name="ba" rows="4"
                  placeholder="Line 1&#10;Line 2&#10;City, Postcode&#10;Country"></textarea>

        <label>VAT number (optional)</label>
        <input [(ngModel)]="profile.vat_number" name="vn"
               placeholder="GB123456789" />

        <div class="tab-actions">
          <button class="primary" (click)="saveProfile()" [disabled]="profileSaving()">
            {{ profileSaving() ? 'Saving…' : 'Save billing details' }}
          </button>
          @if (profileSavedAt()) { <span class="muted small">Saved {{ profileSavedAt() }}</span> }
          @if (profileError()) { <span class="error-msg small">{{ profileError() }}</span> }
        </div>
      </section>

      <!-- ── Payment methods ──────────────────────────────────── -->
      <section>
        <div class="section-head">
          <h3>Payment methods</h3>
          <span class="spacer"></span>
          @if (stripe()?.configured) {
            <button class="ghost" (click)="openPortal()" [disabled]="portalLoading()"
                    title="Full Stripe self-service — manage everything (invoices, cards, tax, cancel).">
              {{ portalLoading() ? 'Opening…' : 'Manage on Stripe' }}
            </button>
            <button class="primary" (click)="openAddCard()">+ Add card</button>
            <button class="ghost" (click)="openAddDirectDebit()">+ Direct Debit</button>
          } @else {
            <button class="primary" (click)="openAddPm()">+ Add payment method</button>
          }
        </div>
        @if (stripe()?.configured) {
          <p class="muted small">
            Cards captured by Stripe Elements — the card number never
            touches our servers. Direct Debit uses BACS in the UK / SEPA
            in the EU, with Stripe managing the mandate.
          </p>
        }

        @if (sum.payment_methods.length === 0) {
          <p class="muted small">No payment method on file. Invoices will be sent by email until one is added.</p>
        } @else {
          <div class="table-wrap">
            <table class="data">
              <thead><tr>
                <th>Type</th>
                <th>Details</th>
                <th>Holder</th>
                <th>Expires</th>
                <th>Default</th>
                <th></th>
              </tr></thead>
              <tbody>
                @for (pm of sum.payment_methods; track pm.id) {
                  <tr>
                    <td>
                      <strong>{{ pm.brand || typeLabel(pm.type) }}</strong>
                      @if (pm.type !== 'card') {
                        <div class="muted small">{{ typeLabel(pm.type) }}</div>
                      }
                    </td>
                    <td class="mono">
                      @if (pm.last4) { •••• {{ pm.last4 }} } @else { — }
                    </td>
                    <td>{{ pm.holder_name || '—' }}</td>
                    <td class="mono">
                      @if (pm.type === 'card' && pm.expires_month && pm.expires_year) {
                        {{ pad2(pm.expires_month) }}/{{ pm.expires_year }}
                      } @else { — }
                    </td>
                    <td>
                      @if (pm.is_default) {
                        <span class="status-pill" data-status="ready">Default</span>
                      } @else {
                        <button class="ghost small" (click)="makeDefault(pm)">Make default</button>
                      }
                    </td>
                    <td class="actions">
                      <button class="ghost small" (click)="openEditPm(pm)">Edit</button>
                      <button class="ghost icon-btn danger" (click)="delPm(pm)" title="Remove">✕</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      <!-- ── Invoices ─────────────────────────────────────────── -->
      <section>
        <div class="section-head">
          <h3>Invoice history</h3>
        </div>

        @if (sum.invoices.length === 0) {
          <p class="muted small">No invoices yet. You'll see subscription charges here as they're generated.</p>
        } @else {
          <div class="table-wrap">
            <table class="data">
              <thead><tr>
                <th>Number</th>
                <th>Description</th>
                <th>Issued</th>
                <th class="num">Amount</th>
                <th>Status</th>
                <th></th>
              </tr></thead>
              <tbody>
                @for (inv of sum.invoices; track inv.id) {
                  <tr>
                    <td class="mono"><strong>{{ inv.invoice_number }}</strong></td>
                    <td>{{ inv.description }}</td>
                    <td>{{ fmtDate(inv.issued_at) }}</td>
                    <td class="num mono">{{ fmtMoney(inv.amount_cents, inv.currency) }}</td>
                    <td><span class="status-pill" [attr.data-status]="statusData(inv.status)">{{ statusLabel(inv.status) }}</span></td>
                    <td class="actions">
                      @if (inv.pdf_url) {
                        <a class="ghost small" [href]="inv.pdf_url" target="_blank" rel="noopener">PDF</a>
                      } @else {
                        <span class="muted small">—</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    }

    <!-- ── Stripe: card / direct-debit capture modal ────────── -->
    @if (stripeModalOpen()) {
      <div class="modal-backdrop" (click)="closeStripeModal()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ stripeMode() === 'bacs_debit' ? 'Set up Direct Debit' : 'Add card' }}</h2>
            <button class="ghost icon-btn" (click)="closeStripeModal()">✕</button>
          </div>
          <div class="modal-body">
            @if (stripeError()) { <p class="error-msg">{{ stripeError() }}</p> }

            @if (stripeMode() === 'bacs_debit') {
              <p class="muted small">
                Direct Debit collects payment automatically on the due
                date. By setting one up you authorise BuiltRightStudio
                to instruct your bank via the BACS scheme; you're
                protected by the Direct Debit Guarantee.
              </p>
            } @else {
              <p class="muted small">
                Card details are captured directly by Stripe — the
                number and CVC never touch our servers. We only store
                the brand, last 4 digits and expiry for display.
              </p>
            }

            <!-- Stripe Elements mounts here. The div is present as
                 soon as the modal opens so the ngAfterViewChecked
                 hook can find it before Stripe.js needs it. -->
            <div id="brs-stripe-element" class="stripe-mount"></div>

            <label class="check-inline">
              <input type="checkbox" [(ngModel)]="stripeMakeDefault" name="sd" />
              Use as default payment method
            </label>
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="closeStripeModal()">Cancel</button>
            <button class="primary" (click)="confirmStripe()" [disabled]="stripeSaving() || !stripeReady()">
              {{ stripeSaving() ? 'Saving…' : (stripeMode() === 'bacs_debit' ? 'Confirm mandate' : 'Save card') }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- ── Manual payment method modal (fallback / non-Stripe) ─ -->
    @if (pmModalOpen()) {
      <div class="modal-backdrop" (click)="closePmModal()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">
            <h2>{{ pmDraft.id ? 'Edit payment method' : 'Add payment method' }}</h2>
            <button class="ghost icon-btn" (click)="closePmModal()">✕</button>
          </div>
          <div class="modal-body">
            @if (pmError()) { <p class="error-msg">{{ pmError() }}</p> }

            <label>Type</label>
            <select [(ngModel)]="pmDraft.type" name="pt" (ngModelChange)="onTypeChange($event)">
              <option value="card">Credit / debit card</option>
              <option value="bank">Bank account</option>
              <option value="other">Other</option>
            </select>

            @switch (pmDraft.type) {
              @case ('card') {
                <p class="muted small">
                  We store the brand, last 4 digits and expiry only —
                  the full card number is captured by our payment
                  processor and never touches our servers.
                </p>

                <label>Card network</label>
                <select [(ngModel)]="pmDraft.brand" name="pb">
                  <option value="Visa">Visa</option>
                  <option value="Mastercard">Mastercard</option>
                  <option value="Amex">American Express</option>
                  <option value="Discover">Discover</option>
                  <option value="Other">Other</option>
                </select>

                <label>Last 4 digits</label>
                <input [(ngModel)]="pmDraft.last4" name="pl" maxlength="4"
                       placeholder="4242" inputmode="numeric" />

                <label>Cardholder name</label>
                <input [(ngModel)]="pmDraft.holder_name" name="pn"
                       placeholder="Jane Doe" />

                <div class="row two-col">
                  <div>
                    <label>Expires month</label>
                    <select [(ngModel)]="pmDraft.expires_month" name="pm_m">
                      <option [ngValue]="null">—</option>
                      @for (m of months; track m) {
                        <option [ngValue]="m">{{ pad2(m) }}</option>
                      }
                    </select>
                  </div>
                  <div>
                    <label>Expires year</label>
                    <select [(ngModel)]="pmDraft.expires_year" name="pm_y">
                      <option [ngValue]="null">—</option>
                      @for (y of years; track y) {
                        <option [ngValue]="y">{{ y }}</option>
                      }
                    </select>
                  </div>
                </div>
              }

              @case ('bank') {
                <p class="muted small">
                  We store the bank name and last 4 digits of the
                  account only. The full account number is captured
                  by our payment processor and never touches our servers.
                </p>

                <label>Bank name</label>
                <input [(ngModel)]="pmDraft.brand" name="pb"
                       placeholder="HSBC UK" />

                <label>Account holder</label>
                <input [(ngModel)]="pmDraft.holder_name" name="pn"
                       placeholder="Acme Ltd" />

                <label>Account last 4</label>
                <input [(ngModel)]="pmDraft.last4" name="pl" maxlength="4"
                       placeholder="1234" inputmode="numeric" />
              }

              @case ('other') {
                <p class="muted small">
                  Use this for anything that isn't a card or a bank
                  account — PayPal, Stripe balance, wire transfer,
                  cheque on file, etc.
                </p>

                <label>Method name</label>
                <input [(ngModel)]="pmDraft.brand" name="pb"
                       placeholder="PayPal" />

                <label>Account / reference</label>
                <input [(ngModel)]="pmDraft.holder_name" name="pn"
                       placeholder="finance@yourcompany.com" />

                <label>Reference last 4 (optional)</label>
                <input [(ngModel)]="pmDraft.last4" name="pl" maxlength="4"
                       placeholder="0001" />
              }
            }

            <label class="check-inline">
              <input type="checkbox" [(ngModel)]="pmDraft.is_default" name="pd" />
              Use as default payment method
            </label>
          </div>
          <div class="modal-foot">
            <button class="ghost" (click)="closePmModal()">Cancel</button>
            <button class="primary" (click)="savePm()" [disabled]="pmSaving()">
              {{ pmSaving() ? 'Saving…' : (pmDraft.id ? 'Update' : 'Add') }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    section { margin-bottom: 24px; }
    section h3 { margin: 0; font-size: 14px; text-transform: uppercase;
      letter-spacing: 0.5px; color: var(--muted); font-weight: 700; }

    /* Plan card — same visual treatment as the Account tab so users
       recognise it as the shared subscription surface. */
    .tier-card {
      padding: 14px 16px;
      border: 1px solid var(--line); border-radius: var(--radius);
      background: var(--bg-2);
      overflow: hidden;
    }
    .tier-head {
      display: flex; align-items: center; gap: 20px;
      flex-wrap: wrap; min-width: 0;
    }
    .tier-head > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .tier-head strong { font-size: 15px; }
    .tier-head .muted { font-size: 11px; text-transform: uppercase;
      letter-spacing: 0.5px; font-weight: 600; margin: 0; }
    .tier-head button {
      margin-left: auto; white-space: nowrap; flex-shrink: 0;
      padding: 8px 14px; font-size: 13px;
    }

    .section-head {
      display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .section-head .spacer { flex: 1; }
    .section-head > button {
      white-space: nowrap; flex-shrink: 0;
      padding: 8px 14px; font-size: 13px;
    }

    textarea { width: 100%; min-height: 90px; resize: vertical; }

    /* Table wrapper handles horizontal scroll so long tables don't
       push the whole tab pane out of the layout on narrow viewports. */
    .table-wrap { overflow-x: auto; }
    table.data { table-layout: fixed; width: 100%; min-width: 640px; }
    table.data td.mono, table.data td.num { font-family: "JetBrains Mono", ui-monospace, monospace; }
    table.data td.num, table.data th.num { text-align: right; }
    td.actions {
      display: flex; gap: 4px; white-space: nowrap; justify-content: flex-end;
    }
    td.actions button, td.actions a { white-space: nowrap; flex-shrink: 0; }
    /* Anchors styled as ghost buttons for the PDF download link. */
    td.actions a.ghost {
      display: inline-block; padding: 4px 10px;
      border: 1px solid var(--line); border-radius: var(--radius-sm);
      color: var(--fg); text-decoration: none; font-size: 12px;
    }
    td.actions a.ghost:hover { background: var(--bg-3); border-color: var(--primary); }

    .status-pill { display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 11px; font-weight: 600; letter-spacing: 0.3px;
      background: var(--bg-3); color: var(--muted); white-space: nowrap; }
    .status-pill[data-status="ready"]  { background: color-mix(in oklab, var(--success), transparent 78%); color: var(--success); }
    .status-pill[data-status="paused"] { background: var(--bg-3); color: var(--muted); }
    .status-pill[data-status="danger"] { background: color-mix(in oklab, var(--danger), transparent 78%); color: var(--danger); }
    .status-pill[data-status="warning"]{ background: color-mix(in oklab, var(--warning), transparent 78%); color: var(--warning); }

    .row.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 480px) { .row.two-col { grid-template-columns: 1fr; } }

    .check-inline {
      display: inline-flex; align-items: center; gap: 8px;
      margin-top: 14px; font-size: 13px;
      text-transform: none; letter-spacing: 0; white-space: nowrap;
      color: var(--fg); font-weight: 400;
    }
    .check-inline input {
      margin: 0; width: 16px; height: 16px; flex-shrink: 0; accent-color: var(--primary);
    }

    .tab-actions {
      display: flex; align-items: center; gap: 10px;
      margin-top: 20px; padding-top: 16px;
      border-top: 1px solid var(--line);
    }

    /* Pending-downgrade banner. Warning-tinted so it can't be missed,
       but not danger — user chose this. Sits between plan strip and
       picker. */
    .pending-banner {
      display: flex; align-items: center; gap: 16px;
      padding: 14px 18px; margin-bottom: 20px;
      background: color-mix(in oklab, var(--warning), transparent 82%);
      border: 1px solid color-mix(in oklab, var(--warning), transparent 55%);
      border-radius: var(--radius);
    }
    .pending-banner > div { flex: 1; min-width: 0; }
    .pending-banner strong { color: var(--warning); font-size: 14px; }
    .pending-banner button { flex-shrink: 0; white-space: nowrap; }

    /* Cadence toggle — pill-style segmented control. */
    .cadence-toggle {
      display: inline-flex; border: 1px solid var(--line); border-radius: 999px;
      padding: 3px; background: var(--bg-3);
    }
    .cadence-toggle button {
      background: transparent; color: var(--muted); border: none;
      padding: 6px 14px; border-radius: 999px; font-size: 12px;
      font-weight: 600; letter-spacing: 0.3px; text-transform: uppercase;
      cursor: pointer; transition: background .12s, color .12s;
      white-space: nowrap;
    }
    .cadence-toggle button.active {
      background: var(--primary); color: var(--bg);
    }
    .pill-inline {
      display: inline-block; margin-left: 6px; padding: 1px 8px;
      font-size: 10px; border-radius: 999px;
      background: color-mix(in oklab, var(--success), transparent 70%);
      color: var(--success); text-transform: none; letter-spacing: 0;
    }

    /* ── Plan carousel ─────────────────────────────────────
       Horizontal-scroll track with snap points + prev/next arrows on
       the sides + dot indicators below. Two visible cards at a time
       on desktop, one on mobile. The track scrolls smoothly via
       scrollBy(); the arrow visibility is driven by carouselIndex. */
    .carousel {
      position: relative;
      margin-top: 12px;
      width: 100%;
      /* Arrows overlay the track edges as absolute buttons rather than
         eating flex width. This lets the track use the ENTIRE pane
         width and keeps the right arrow visible even when the last
         card is out-of-view (the whole reason we have arrows). */
    }
    .carousel-track {
      display: flex; gap: 16px;
      overflow-x: auto; overflow-y: hidden;
      scroll-snap-type: x mandatory;
      scroll-behavior: smooth;
      padding: 8px 44px 20px;    /* left/right room for the arrows */
      scrollbar-width: none;     /* Firefox */
    }
    .carousel-track::-webkit-scrollbar { display: none; }

    .carousel-arrow {
      position: absolute; top: 50%; transform: translateY(-50%);
      z-index: 2;
      width: 42px; height: 42px; padding: 0;
      display: flex; align-items: center; justify-content: center;
      background: var(--primary); color: var(--bg);
      border: 1px solid var(--primary); border-radius: 50%;
      font-size: 24px; line-height: 1; font-weight: 700;
      cursor: pointer;
      /* Layered shadow: dark drop below + primary-tinted glow makes
         the button pop against both card and pane backgrounds. */
      box-shadow: 0 4px 14px rgba(0,0,0,0.55),
                  0 0 0 4px color-mix(in oklab, var(--primary), transparent 78%);
      transition: transform .15s, box-shadow .15s, background .15s;
    }
    .carousel-arrow.left  { left: 4px; }
    .carousel-arrow.right { right: 4px; }
    .carousel-arrow:hover {
      background: var(--primary-2); border-color: var(--primary-2);
      transform: translateY(-50%) scale(1.08);
      box-shadow: 0 6px 20px rgba(0,0,0,0.65),
                  0 0 0 6px color-mix(in oklab, var(--primary), transparent 70%);
    }
    .carousel-arrow:disabled {
      opacity: 0.35; cursor: not-allowed;
      background: var(--bg-3); color: var(--muted); border-color: var(--line);
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      transform: translateY(-50%);
    }

    .carousel-dots {
      display: flex; justify-content: center; gap: 6px;
      margin-top: 4px;
    }
    .carousel-dots .dot {
      width: 8px; height: 8px; padding: 0; border: none;
      border-radius: 50%; background: var(--bg-3);
      cursor: pointer; transition: background .12s, transform .12s;
    }
    .carousel-dots .dot:hover  { background: var(--muted); }
    .carousel-dots .dot.active { background: var(--primary); transform: scale(1.3); }

    /* ── Plan card ─────────────────────────────────────────
       Fixed width so the carousel snap points stay predictable. Flex
       column with CTA pinned to the bottom regardless of feature-list
       length. Elevated hover + selected states give visual weight to
       the main-offer / current-plan cards without being screamy. */
    .plan-card {
      position: relative;
      flex: 0 0 300px;
      scroll-snap-align: start;
      display: flex; flex-direction: column; gap: 14px;
      padding: 22px 20px;
      background: var(--bg-2);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      transition: border-color .18s, transform .18s, box-shadow .18s;
    }
    @media (max-width: 640px) { .plan-card { flex-basis: calc(100% - 8px); } }

    .plan-card:hover {
      border-color: var(--primary);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0,0,0,0.25);
    }
    .plan-card.highlight {
      border-color: var(--primary);
      background: linear-gradient(180deg, color-mix(in oklab, var(--primary), var(--bg-2) 92%), var(--bg-2) 50%);
      box-shadow: 0 0 0 2px color-mix(in oklab, var(--primary), transparent 75%);
    }
    .plan-card.current {
      border-color: var(--success);
      background: color-mix(in oklab, var(--success), var(--bg-2) 92%);
    }
    .plan-card .badge {
      position: absolute; top: -10px; left: 50%; transform: translateX(-50%);
      padding: 3px 12px; border-radius: 999px;
      font-size: 10px; font-weight: 700; letter-spacing: 0.5px;
      text-transform: uppercase; background: var(--primary); color: var(--bg);
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      white-space: nowrap;
    }
    .plan-card .badge.current { background: var(--success); left: auto; right: 14px; transform: none; }

    .plan-head h4 {
      margin: 0 0 6px; font-size: 17px; font-weight: 700;
      letter-spacing: -0.2px;
    }
    .plan-head p  { margin: 0; line-height: 1.4; min-height: 2.8em; }

    .plan-price {
      display: flex; flex-direction: column; gap: 4px;
      padding: 12px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
    }
    .price-row {
      display: flex; align-items: baseline; gap: 6px;
    }
    .price-value {
      font-size: 30px; font-weight: 700; letter-spacing: -0.5px;
      color: var(--fg);
      font-family: "JetBrains Mono", ui-monospace, monospace;
    }
    .price-cadence { font-size: 13px; }

    .plan-users .chip {
      display: inline-block; padding: 3px 10px;
      background: var(--bg-3); border: 1px solid var(--line);
      border-radius: 999px;
      font-size: 11px; font-weight: 600; color: var(--muted);
      letter-spacing: 0.3px;
    }

    .plan-features {
      list-style: none; padding: 0; margin: 0;
      display: flex; flex-direction: column; gap: 7px;
      flex: 1;
    }
    .plan-features li {
      position: relative; padding-left: 22px;
      font-size: 13px; line-height: 1.45;
    }
    .plan-features li::before {
      content: '✓'; position: absolute; left: 0; top: 0;
      color: var(--success); font-weight: 700;
    }

    .plan-cta button, .plan-cta a {
      width: 100%; padding: 11px 14px; font-size: 13px;
      text-align: center; text-decoration: none;
      box-sizing: border-box;
    }
    .plan-cta a.ghost {
      display: inline-block;
      border: 1px solid var(--line); border-radius: var(--radius-sm);
      color: var(--fg);
    }

    .cancel-row { margin-top: 14px; text-align: center; }
    button.link {
      background: none; border: none; padding: 0;
      color: var(--primary); cursor: pointer; text-decoration: underline;
      font: inherit;
    }

    /* Stripe Elements mount point — Stripe injects an iframe here.
       Padding + border give the same visual weight as our own inputs
       so the card form doesn't look grafted-on. min-height reserves
       space so the modal doesn't jump when the iframe finishes loading. */
    .stripe-mount {
      margin-top: 14px; padding: 12px;
      background: var(--bg-3);
      border: 1px solid var(--line); border-radius: var(--radius-sm);
      min-height: 200px;
    }
  `],
})
export class SettingsBilling {
  private api = inject(Api);
  private dialog = inject(DialogService);

  loading = signal(true);
  summary = signal<BillingSummary | null>(null);

  // Billing profile is edited in place — bound to the tenants row.
  profile: Partial<BillingProfile> = {};
  profileSaving   = signal(false);
  profileError    = signal<string | null>(null);
  profileSavedAt  = signal<string | null>(null);

  // Payment-method modal (manual entry — kept as fallback when
  // Stripe is not configured, or the tenant records an offline method).
  pmModalOpen = signal(false);
  pmSaving    = signal(false);
  pmError     = signal<string | null>(null);
  pmDraft: PmDraft = this.blankPm();

  // Plan catalogue + picker state. `plans` is the ordered list from
  // /api/billing/plans. `cadence` toggles monthly/yearly across every
  // card. `subscribingTier` disables the CTA on the card currently
  // being processed so a double-click doesn't create two subscriptions.
  plans           = signal<SubscriptionPlan[]>([]);
  cadence         = signal<'monthly' | 'yearly'>('monthly');
  subscribingTier = signal<SubscriptionTier | null>(null);
  pendingCancelling = signal(false);
  carouselIndex   = signal(0);
  private track = viewChild<ElementRef<HTMLDivElement>>('carouselTrack');

  /** Hide the trial from the picker — you can't "buy" a trial. */
  visiblePlans = computed(() => this.plans().filter(p => p.tier !== 'trial'));

  // Stripe state. `stripe` is the /api/billing/stripe/config response
  // — presence of `configured: true` is the switch that flips the UI
  // from manual-entry to Payment Element. All the Element handles
  // (Stripe instance, elements group, mounted card/IBAN element) are
  // held so we can call .confirmSetup() in confirmStripe().
  stripe          = signal<StripeConfig | null>(null);
  stripeModalOpen = signal(false);
  stripeMode      = signal<'card' | 'bacs_debit'>('card');
  stripeReady     = signal(false);       // Element mounted & ready
  stripeSaving    = signal(false);
  stripeError     = signal<string | null>(null);
  stripeMakeDefault = true;
  portalLoading   = signal(false);

  private stripeJs:  any = null;         // Stripe() instance
  private stripeElements: any = null;    // stripe.elements(...)
  private stripePmElement: any = null;   // the payment/iban Element
  private stripeSetupSecret: string | null = null;

  // Year picker range — current year + 15. Static year avoided
  // because Date.now()/new Date() is banned in the workflow harness
  // and we run this in the browser anyway, so it's fine at runtime.
  readonly months = Array.from({ length: 12 }, (_, i) => i + 1);
  readonly years  = (() => {
    const y = new Date().getFullYear();
    return Array.from({ length: 16 }, (_, i) => y + i);
  })();

  ngOnInit() {
    this.load();
    // Fetch Stripe config independently so a mis-configured Stripe
    // account never blocks the summary from rendering.
    this.api.getStripeConfig().subscribe({
      next: r => this.stripe.set(r),
      error: () => this.stripe.set({ configured: false, publishable_key: null, price_ids: {}, tenant: {} }),
    });
    this.api.listPlans().subscribe({
      next: r => {
        this.plans.set(r.plans ?? []);
        this.scrollToInitialCard();
      },
    });
    window.addEventListener('billing:show-tier', this.onShowTier);
  }

  /** Land on the tenant's current plan card. Plans and summary load
   *  in parallel, so this runs from BOTH subscribers — whichever
   *  arrives second triggers the scroll. Trial users (or anything not
   *  in the picker) fall back to the highlighted main-offer card. */
  private initialScrollDone = false;
  private scrollToInitialCard() {
    if (this.initialScrollDone) return;
    const plans = this.visiblePlans();
    const sum = this.summary();
    if (!plans.length || !sum) return;
    this.initialScrollDone = true;

    const currentIdx  = plans.findIndex(p => p.tier === sum.profile.subscription_tier);
    const highlightIdx = plans.findIndex(p => p.is_highlight);
    const target = currentIdx >= 0 ? currentIdx : highlightIdx;
    if (target > 0) setTimeout(() => this.scrollTo(target), 100);
  }

  ngOnDestroy() {
    window.removeEventListener('billing:show-tier', this.onShowTier);
  }

  // ─── Plan picker ──────────────────────────────────────────
  planPrice(p: SubscriptionPlan): number {
    return this.cadence() === 'yearly' ? p.price_yearly_cents : p.price_monthly_cents;
  }

  /** Carousel: scroll by exactly one card width (card + gap). */
  scrollCarousel(dir: -1 | 1) {
    const el = this.track()?.nativeElement;
    if (!el) return;
    const card = el.querySelector<HTMLElement>('.plan-card');
    const step = card ? card.offsetWidth + 16 : el.clientWidth;
    el.scrollBy({ left: dir * step, behavior: 'smooth' });
  }

  /** Direct jump — used by the dots and by the sibling "Upgrade to X"
   *  event fired from settings-account. Scrolls the target card into
   *  view without smearing past intermediate ones. */
  scrollTo(index: number) {
    const el = this.track()?.nativeElement;
    if (!el) return;
    const card = el.querySelectorAll<HTMLElement>('.plan-card')[index];
    if (!card) return;
    el.scrollTo({ left: card.offsetLeft - el.offsetLeft, behavior: 'smooth' });
  }

  /** Track scroll → compute which card is currently "primary" for the
   *  dots highlight. Uses the midpoint of the visible area so an
   *  in-between position still resolves to the closer card. */
  onCarouselScroll() {
    const el = this.track()?.nativeElement;
    if (!el) return;
    const cards = Array.from(el.querySelectorAll<HTMLElement>('.plan-card'));
    const mid = el.scrollLeft + el.clientWidth / 2;
    let closest = 0;
    let closestDist = Infinity;
    cards.forEach((c, i) => {
      const cardMid = c.offsetLeft - el.offsetLeft + c.offsetWidth / 2;
      const d = Math.abs(cardMid - mid);
      if (d < closestDist) { closestDist = d; closest = i; }
    });
    this.carouselIndex.set(closest);
  }

  /** Sibling tab (Account) fires `billing:show-tier` — scroll the
   *  matching card into view. Registered in ngOnInit / removed in
   *  ngOnDestroy. */
  private onShowTier = (e: Event) => {
    const tier = (e as CustomEvent).detail as SubscriptionTier;
    const idx = this.visiblePlans().findIndex(p => p.tier === tier);
    if (idx >= 0) setTimeout(() => this.scrollTo(idx), 100);
  };

  /** No Stripe configured → best we can do is set the tier field on
   *  the tenant row (no billing). Used only in dev / self-hosted
   *  installs; the real path is `subscribeStripe()`. */
  async subscribeManual(tier: SubscriptionTier) {
    const ok = await this.dialog.confirm(
      `Switch to ${TIER_LABELS[tier]}? No payment will be captured — Stripe isn't configured.`,
      { title: 'Change plan', confirmLabel: 'Switch plan', variant: 'warning' }
    );
    if (!ok) return;
    this.api.updateUsersSubscription(tier).subscribe({
      next: () => this.load(),
    });
  }

  subscribeStripe(p: SubscriptionPlan) {
    this.subscribingTier.set(p.tier);
    this.api.stripeSubscribe(p.tier, this.cadence()).subscribe({
      next: (r: any) => {
        this.subscribingTier.set(null);
        // Downgrade path — Stripe scheduled the change; refresh so the
        // pending-change banner appears with a cancel button.
        if (r?.deferred) {
          this.dialog.alert(
            r.message || 'Downgrade scheduled for end of period.',
            { title: 'Downgrade scheduled', variant: 'warning' }
          );
          this.load();
          return;
        }
        // If the subscription requires 3DS / mandate confirmation the
        // API returns a PaymentIntent client_secret — hand it off to
        // Stripe.js to finish the flow. Otherwise we're done.
        if (r?.requires_action && r?.client_secret && this.stripe()?.configured && typeof Stripe !== 'undefined') {
          const stripeJs = Stripe!(this.stripe()!.publishable_key!);
          stripeJs.confirmPayment({
            clientSecret: r.client_secret,
            confirmParams: { return_url: window.location.href },
          }).then(() => this.load());
          return;
        }
        this.load();
      },
      error: e => {
        this.subscribingTier.set(null);
        this.dialog.alert(
          e?.error?.error || 'Could not start subscription',
          { title: 'Subscription error', variant: 'danger' }
        );
      },
    });
  }

  async cancelPending() {
    const ok = await this.dialog.confirm(
      'Cancel the scheduled downgrade? Your current plan will keep renewing normally.',
      { title: 'Cancel scheduled downgrade', confirmLabel: 'Yes, cancel it', variant: 'warning' }
    );
    if (!ok) return;
    this.pendingCancelling.set(true);
    this.api.stripeCancelPending().subscribe({
      next: () => { this.pendingCancelling.set(false); this.load(); },
      error: e => {
        this.pendingCancelling.set(false);
        this.dialog.alert(
          e?.error?.error || 'Could not cancel scheduled downgrade',
          { title: 'Could not cancel', variant: 'danger' }
        );
      },
    });
  }

  async cancelSubscription() {
    const ok = await this.dialog.confirm(
      'Cancel your subscription at the end of the current billing period? You keep access until then.',
      { title: 'Cancel subscription', confirmLabel: 'Cancel subscription', variant: 'danger' }
    );
    if (!ok) return;
    this.api.stripeCancel().subscribe({
      next: () => this.load(),
      error: e => this.dialog.alert(
        e?.error?.error || 'Could not cancel',
        { title: 'Could not cancel', variant: 'danger' }
      ),
    });
  }

  private load() {
    this.loading.set(true);
    this.api.getBillingSummary().subscribe({
      next: r => {
        this.summary.set(r);
        this.profile = { ...r.profile };
        this.loading.set(false);
        // Plans may have landed first; kick the initial-scroll again
        // in case this is the second-to-arrive request.
        this.scrollToInitialCard();
      },
      error: () => this.loading.set(false),
    });
  }

  // ─── Stripe: portal, card, direct debit ───────────────────
  openPortal() {
    this.portalLoading.set(true);
    this.api.stripePortal().subscribe({
      next: r => {
        this.portalLoading.set(false);
        // Full-page redirect — Stripe hosts the portal in their domain.
        window.location.href = r.url;
      },
      error: e => {
        this.portalLoading.set(false);
        this.dialog.alert(
          e?.error?.error || 'Could not open Stripe Customer Portal',
          { title: 'Stripe Portal', variant: 'danger' }
        );
      },
    });
  }

  openAddCard()        { this.openStripeModal('card'); }
  openAddDirectDebit() { this.openStripeModal('bacs_debit'); }

  private openStripeModal(mode: 'card' | 'bacs_debit') {
    const cfg = this.stripe();
    if (!cfg?.configured || !cfg.publishable_key) {
      this.dialog.alert(
        'Stripe is not configured. Set STRIPE_SECRET / STRIPE_PUBLISHABLE in .env.',
        { title: 'Stripe not configured', variant: 'warning' }
      );
      return;
    }
    if (typeof Stripe === 'undefined') {
      this.dialog.alert(
        'Stripe.js failed to load. Check your network connection.',
        { title: 'Stripe.js unavailable', variant: 'danger' }
      );
      return;
    }
    this.stripeMode.set(mode);
    this.stripeError.set(null);
    this.stripeReady.set(false);
    this.stripeMakeDefault = true;
    this.stripeModalOpen.set(true);

    // Kick off SetupIntent + Element mount in the next tick so the
    // #brs-stripe-element div is in the DOM before we mount.
    this.api.createStripeSetupIntent([mode]).subscribe({
      next: r => {
        this.stripeSetupSecret = r.client_secret;
        this.mountStripeElement(cfg.publishable_key!, r.client_secret, mode);
      },
      error: e => this.stripeError.set(e?.error?.error || 'Could not create Stripe SetupIntent'),
    });
  }

  private mountStripeElement(publishable: string, clientSecret: string, mode: 'card' | 'bacs_debit') {
    // setTimeout(0) gives Angular a tick to render the modal + mount div.
    setTimeout(() => {
      if (!this.stripeJs) this.stripeJs = Stripe!(publishable);
      this.stripeElements = this.stripeJs.elements({
        clientSecret,
        appearance: { theme: 'night' },   // matches our dark UI
      });
      // Payment Element supports every method type Stripe returns;
      // filtering to just [mode] on the SetupIntent limits what shows.
      this.stripePmElement = this.stripeElements.create('payment', {
        layout: 'tabs',
      });
      this.stripePmElement.mount('#brs-stripe-element');
      this.stripePmElement.on('ready', () => this.stripeReady.set(true));
      this.stripePmElement.on('change', (e: any) => {
        this.stripeError.set(e.error ? e.error.message : null);
      });
    }, 0);
  }

  closeStripeModal() {
    this.stripeModalOpen.set(false);
    if (this.stripePmElement) {
      try { this.stripePmElement.unmount(); } catch {}
      this.stripePmElement = null;
    }
    this.stripeElements = null;
    this.stripeSetupSecret = null;
    this.stripeReady.set(false);
  }

  confirmStripe() {
    if (!this.stripeJs || !this.stripeElements) return;
    this.stripeSaving.set(true);
    this.stripeError.set(null);
    this.stripeJs.confirmSetup({
      elements: this.stripeElements,
      confirmParams: {
        // Stripe requires a return_url even when we don't redirect;
        // the browser stays on this page thanks to `redirect: 'if_required'`.
        return_url: window.location.href,
      },
      redirect: 'if_required',
    }).then((result: any) => {
      if (result.error) {
        this.stripeSaving.set(false);
        this.stripeError.set(result.error.message || 'Payment method could not be saved');
        return;
      }
      const pmId = result.setupIntent?.payment_method;
      if (!pmId) {
        this.stripeSaving.set(false);
        this.stripeError.set('Stripe did not return a payment method');
        return;
      }
      // Sync back to our DB so the list updates without waiting for
      // the webhook. If the webhook beats us, the upsert is idempotent.
      this.api.syncStripePaymentMethod(pmId, this.stripeMakeDefault).subscribe({
        next: () => {
          this.stripeSaving.set(false);
          this.closeStripeModal();
          this.load();
        },
        error: e => {
          this.stripeSaving.set(false);
          this.stripeError.set(e?.error?.error || 'Sync failed');
        },
      });
    });
  }

  // ─── Profile ──────────────────────────────────────────────
  saveProfile() {
    this.profileError.set(null);
    this.profileSaving.set(true);
    this.api.updateBillingProfile({
      billing_email:   this.profile.billing_email ?? '',
      billing_address: this.profile.billing_address ?? '',
      vat_number:      this.profile.vat_number ?? '',
    }).subscribe({
      next: () => {
        this.profileSaving.set(false);
        this.profileSavedAt.set(new Date().toLocaleTimeString());
      },
      error: e => {
        this.profileSaving.set(false);
        this.profileError.set(e?.error?.error || 'Could not save billing details');
      },
    });
  }

  // ─── Payment methods ──────────────────────────────────────
  openAddPm() {
    this.pmDraft = this.blankPm();
    this.pmError.set(null);
    this.pmModalOpen.set(true);
  }
  openEditPm(pm: PaymentMethod) {
    this.pmDraft = {
      id:            pm.id,
      type:          pm.type,
      brand:         pm.brand || 'Visa',
      last4:         pm.last4 || '',
      holder_name:   pm.holder_name || '',
      expires_month: pm.expires_month ?? null,
      expires_year:  pm.expires_year ?? null,
      is_default:    !!pm.is_default,
    };
    this.pmError.set(null);
    this.pmModalOpen.set(true);
  }
  closePmModal() { this.pmModalOpen.set(false); }

  /** Switching type re-seeds the fields to sensible defaults for the
   *  new kind so a half-filled card doesn't linger under bank/other
   *  labels. Keep the "make default" flag — that's type-agnostic. */
  onTypeChange(t: 'card' | 'bank' | 'other') {
    const keepDefault = this.pmDraft.is_default;
    const keepId      = this.pmDraft.id;
    this.pmDraft = { ...this.blankPm(), type: t, is_default: keepDefault, id: keepId };
    if (t === 'card')  this.pmDraft.brand = 'Visa';
    if (t === 'bank')  this.pmDraft.brand = '';
    if (t === 'other') this.pmDraft.brand = '';
  }

  savePm() {
    const d = this.pmDraft;
    if (d.type === 'card') {
      if (!d.last4 || !/^\d{2,4}$/.test(d.last4)) {
        this.pmError.set('Enter the last 2–4 digits of the card number.');
        return;
      }
      if (!d.holder_name.trim()) {
        this.pmError.set('Cardholder name is required.');
        return;
      }
    } else if (d.type === 'bank') {
      if (!d.brand.trim()) {
        this.pmError.set('Bank name is required.');
        return;
      }
      if (!d.holder_name.trim()) {
        this.pmError.set('Account holder is required.');
        return;
      }
    } else {
      if (!d.brand.trim()) {
        this.pmError.set('Method name is required.');
        return;
      }
    }
    this.pmSaving.set(true);
    this.pmError.set(null);
    const payload: Partial<PaymentMethod> = {
      type:          d.type,
      brand:         d.brand,
      last4:         d.last4,
      holder_name:   d.holder_name,
      expires_month: d.expires_month,
      expires_year:  d.expires_year,
      is_default:    d.is_default ? 1 : 0,
    };
    const onOk = () => {
      this.pmSaving.set(false);
      this.pmModalOpen.set(false);
      this.load();
    };
    const onErr = (e: any) => {
      this.pmSaving.set(false);
      this.pmError.set(e?.error?.error || 'Could not save payment method');
    };
    if (d.id) {
      this.api.updatePaymentMethod(d.id, payload).subscribe({ next: onOk, error: onErr });
    } else {
      this.api.createPaymentMethod(payload).subscribe({ next: onOk, error: onErr });
    }
  }

  makeDefault(pm: PaymentMethod) {
    this.api.makePaymentMethodDefault(pm.id).subscribe({ next: () => this.load() });
  }

  async delPm(pm: PaymentMethod) {
    const label = pm.brand ? `${pm.brand} •••• ${pm.last4}` : `card •••• ${pm.last4}`;
    const ok = await this.dialog.confirm(
      `Remove ${label}? Any invoice charged to it will need to be re-billed manually.`,
      { title: 'Remove payment method', confirmLabel: 'Remove', variant: 'danger' }
    );
    if (!ok) return;
    this.api.deletePaymentMethod(pm.id).subscribe({ next: () => this.load() });
  }

  // ─── Helpers ──────────────────────────────────────────────
  private blankPm(): PmDraft {
    return {
      type: 'card',
      brand: 'Visa',
      last4: '',
      holder_name: '',
      expires_month: null,
      expires_year: null,
      is_default: false,
    };
  }

  tierLabel(t: SubscriptionTier): string { return TIER_LABELS[t]; }
  typeLabel(t: PaymentMethod['type']): string {
    switch (t) {
      case 'card':  return 'Card';
      case 'bank':  return 'Bank account';
      case 'other': return 'Other';
    }
  }
  statusLabel(s: SubscriptionInvoice['status']): string { return STATUS_LABELS[s]; }
  statusData(s: SubscriptionInvoice['status']): string {
    switch (s) {
      case 'paid':     return 'ready';
      case 'failed':   return 'danger';
      case 'refunded': return 'warning';
      case 'sent':     return 'warning';
      default:         return 'paused';
    }
  }

  pad2(n: number | null | undefined): string {
    if (n == null) return '—';
    return String(n).padStart(2, '0');
  }
  fmtMoney(cents: number | null | undefined, currency = 'GBP'): string {
    const v = ((cents ?? 0) / 100).toFixed(2);
    const sym = currency === 'GBP' ? '£' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '';
    return sym ? `${sym}${v}` : `${v} ${currency}`;
  }
  fmtDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString();
  }

  goAccount() {
    // Sibling tab lives in the same Settings shell. Route param handled
    // by the parent's active signal — simplest wire-up is a window
    // event; the parent listens on `settings:go-tab` and switches.
    window.dispatchEvent(new CustomEvent('settings:go-tab', { detail: 'account' }));
  }
}

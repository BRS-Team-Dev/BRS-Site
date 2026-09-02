import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Api } from '../../core/api';
import { DialogService } from '../../core/dialog';
import { Lead, LeadStatus, CompanyLead, CompanyLeadDetail, ChMilestones, ChLastRun, ChFoundCounts } from '../../core/models';
import { AI_MODELS, AiModel } from '../../core/ai-models';
import { LeadgenStateService } from './leadgen-state.service';
import { LeadgenChDashboard } from './leadgen-ch-dashboard';

type LeadField = 'name' | 'email' | 'phone' | 'company' | 'address' | 'url' | 'status' | 'source';
type Mapping = Record<LeadField, number>; // -1 means unmapped

const ALL_FIELDS: { key: LeadField; label: string; required?: boolean }[] = [
  { key: 'name',    label: 'Name', required: true },
  { key: 'email',   label: 'Email' },
  { key: 'phone',   label: 'Phone' },
  { key: 'company', label: 'Company' },
  { key: 'address', label: 'Address' },
  { key: 'url',     label: 'Website / URL' },
  { key: 'status',  label: 'Status' },
  { key: 'source',  label: 'Source' },
];

const FIELD_PATTERNS: Record<LeadField, RegExp[]> = {
  // company picks first so that "Company / Provider" doesn't get grabbed
  // as `name` — auto-mapping iterates fields in this object order.
  company: [/company/i, /provider/i, /organi[sz]ation/i, /business/i],
  email:   [/e-?mail/i],
  phone:   [/phone/i, /\btel(ephone)?\b/i, /mobile/i, /contact\s*(no|number)/i],
  address: [/address/i, /location/i, /\bstreet\b/i],
  url:     [/url/i, /website/i, /\blink\b/i, /profile/i, /\bweb\b/i],
  status:  [/status/i, /\bstage\b/i],
  source:  [/source/i, /origin/i],
  // Run last so it doesn't beat company/etc on ambiguous headers.
  name:    [/\bname\b/i, /agency/i, /branch/i, /\bcontact\b/i, /\blead\b/i],
};

const HEADER_KEYWORDS = ['name', 'email', 'phone', 'company', 'address', 'status', 'source', 'url', 'website', 'agency', 'provider', 'profile'];

const ALLOWED_STATUSES: LeadStatus[] = ['new', 'prospect', 'dead', 'converted'];

/**
 * Lead Gen — bulk-import lists into the Leads table.
 *   /admin/leadgen
 *
 * Frontend parses xlsx/xls/csv via SheetJS (lazy-loaded), auto-detects the
 * header row + column mapping, lets the user override, then POSTs the
 * mapped rows as JSON to /api/leads/bulk for batch insert.
 */
@Component({
  selector: 'app-leadgen-admin',
  imports: [FormsModule, RouterLink, LeadgenChDashboard],
  template: `
    <div class="toolbar">
      <h1>{{ mode() === 'import' ? 'Import Leads' : mode() === 'ch' ? 'Companies House' : mode() === 'li' ? 'LinkedIn' : 'AI prompt' }}</h1>
      <span class="spacer"></span>
      @if (hasInput()) {
        <button class="ghost" (click)="reset()">Start over</button>
      }
    </div>

    @if (mode() === 'ai') {
      <div class="card">
        <h2>AI Generated List</h2>
        <p class="muted small">Describe what kind of leads you want. The search model researches with web access (where supported); the format model coerces the result into the lead schema. Generated rows always go through the preview/review step before being saved — verify before contacting.</p>
        <p class="muted small">🔑 No API keys yet? <a routerLink="/admin/leadgen/settings">Configure provider keys →</a></p>
        <div class="meta-row">
          <div class="meta-field">
            <label>Search model</label>
            <select [(ngModel)]="aiSearchModel" name="ai_search_model">
              @for (m of aiSearchModels; track m.id) {
                <option [value]="m.id">{{ m.label }}{{ m.search ? ' · web search' : '' }}</option>
              }
            </select>
          </div>
          <div class="meta-field">
            <label>Format model</label>
            <select [(ngModel)]="aiFormatModel" name="ai_format_model">
              <option value="">— same as search model —</option>
              @for (m of aiModels; track m.id) {
                <option [value]="m.id">{{ m.label }}</option>
              }
            </select>
          </div>
        </div>
        <label>Prompt</label>
        <textarea [(ngModel)]="aiPrompt" name="ai_prompt" rows="4" placeholder="e.g. Find 50 small homecare agencies registered with the CQC within 10 miles of Camden, London. Include phone, address, and website."></textarea>
        <div class="actions-bar">
          <button class="primary" [disabled]="aiGenerating() || !aiPrompt.trim()" (click)="generateAi()">
            {{ aiGenerating() ? 'Generating…' : '✨ Generate' }}
          </button>
        </div>
        @if (aiError()) { <div class="error-msg">{{ aiError() }}</div> }
      </div>
    }

    @if (isPipeline()) {
      <app-leadgen-ch-dashboard [milestones]="chMilestones()" [lastRun]="chLastRun()" [progress]="chProgress()" />

      <div class="card">
        @if (mode() === 'li') {
          <h2>LinkedIn pull · Stage 1</h2>
          <p class="muted small">Capture a company list from LinkedIn's company search by <strong>keyword + region</strong>, paginating through the results. The shared Qualify flow below then enriches each one (website, phone, email, staff…). Re-running skips companies already stored.</p>
          <div class="meta-row ch-fetch-row">
            <div class="meta-field">
              <label>Keyword / industry (optional)</label>
              <input type="text" [(ngModel)]="liKeyword" name="li_keyword" placeholder="e.g. recruitment (leave blank for all)" />
            </div>
            <div class="meta-field" style="max-width:190px">
              <label>Region geo id{{ !liGeo.trim() && !liSearchUrl.trim() ? ' — ⚠ worldwide' : '' }}</label>
              <input type="text" [(ngModel)]="liGeo" name="li_geo" placeholder="e.g. 90009496 = London" [style.border-color]="!liGeo.trim() && !liSearchUrl.trim() ? '#e5a33a' : ''" />
            </div>
            <button class="primary ch-fetch-btn" [disabled]="chFetching() || (!liGeo.trim() && !liSearchUrl.trim() && !liKeyword.trim() && !liSizes().size)" (click)="doLiFetch()">
              {{ chFetching() ? 'Crawling…' : '① Get LinkedIn companies' }}
            </button>
          </div>
          <div class="cl-filters" style="margin-top:10px">
            <span class="cl-filters-label">Company size</span>
            @for (sz of liSizeOptions; track sz.code) {
              <label class="chk" [class.on]="liSizes().has(sz.code)" style="text-transform:none;letter-spacing:normal;white-space:nowrap;padding:4px 9px;border:1px solid var(--line);border-radius:999px;cursor:pointer;font-size:12px">
                <input type="checkbox" [checked]="liSizes().has(sz.code)" (change)="toggleLiSize(sz.code)" style="width:13px;height:13px;margin-right:5px" /> {{ sz.label }}
              </label>
            }
          </div>
          <div class="meta-field" style="margin-top:10px">
            <label>…or paste a full LinkedIn company-search URL (overrides the fields above)</label>
            <input type="text" [(ngModel)]="liSearchUrl" name="li_url" placeholder="https://www.linkedin.com/search/results/companies/?companyHqGeo=[&quot;90009496&quot;]&companySize=[&quot;C&quot;]" />
          </div>
          @if (chFetching()) {
            <div class="li-prog">
              <div class="li-prog-track"><div class="li-prog-fill"></div></div>
              <span class="muted small">{{ liTotal() ? '≈' + fmtNum(liTotal()) + ' results on LinkedIn · ' : '' }}<strong>{{ liCaptured() }}</strong> captured@if (liPage()) { · crawling page {{ liPage() }}… }</span>
            </div>
          }
          <p class="muted small">The <strong>region</strong> is the <code>companyHqGeo</code> id (London = <code>90009496</code>); get others by setting the Location filter on LinkedIn and copying the number from the URL. A keyword is optional — a geo + size search returns results on its own. It walks <strong>every result page</strong> automatically. Needs your stored <code>li_at</code> cookie (<a routerLink="/admin/leadgen/settings">Settings</a>) and drives your logged-in session against LinkedIn's ToS, so keep it targeted. LinkedIn caps one search at ~1,000 results; split by size/region to go wider.</p>
        } @else {
          <h2>Company pull · Stage 1</h2>
          <p class="muted small">Pull newly registered UK companies from Companies House straight into your leads. Fast — no per-company calls. Re-running skips companies already stored, so you only ever add genuinely new ones.</p>
          <div class="meta-row ch-fetch-row">
            <div class="meta-field">
              <label>Registered in the last</label>
              <select [(ngModel)]="chDays" name="ch_days">
                <option [ngValue]="0">Today</option>
                <option [ngValue]="1">1 day</option>
                <option [ngValue]="7">7 days</option>
                <option [ngValue]="14">14 days</option>
                <option [ngValue]="30">30 days</option>
              </select>
            </div>
            <div class="meta-field">
              <label>Max companies</label>
              <input type="number" min="1" max="1000" [(ngModel)]="chLimit" name="ch_limit" />
            </div>
            <div class="meta-field">
              <label>SIC codes (optional)</label>
              <input type="text" [(ngModel)]="chSector" name="ch_sector" placeholder="e.g. 62012, 62020" />
            </div>
            <button class="primary ch-fetch-btn" [disabled]="chFetching()" (click)="doChFetch()">
              {{ chFetching() ? 'Fetching…' : '① Get company data' }}
            </button>
          </div>
        }
        @if (chFetchMsg()) { <div class="success-msg">✓ {{ chFetchMsg() }}</div> }

        <hr class="stage-divider" />

        <h2>Qualify · Stage 2</h2>
        <p class="muted small">Walks every record and fills any <strong>missing</strong> info — directors, address, website, phone, email, LinkedIn, staff — using the searches we have, one at a time. For LinkedIn-sourced leads it <strong>first loads the company's LinkedIn profile</strong> (website, industry, size, HQ, specialties, locations) using your stored cookie, then enriches from there. Re-run any time: because a company's data appears gradually, a later pass picks up anything new. Fields already present are skipped, so re-runs only chase what's still missing.</p>
        <div class="actions-bar ch-actions">
          <select [(ngModel)]="chQualifyGoogle" name="q_google" class="ch-method" [disabled]="chQualifying()">
            <option value="api">Google: Places API</option>
            <option value="scrape">Google: scraper</option>
          </select>
          <select [(ngModel)]="chQualifyLinkedin" name="q_linkedin" class="ch-method" [disabled]="chQualifying()">
            <option value="scrape">LinkedIn: no cookie</option>
            <option value="cookie">LinkedIn: my cookie</option>
          </select>
          <button class="primary" [disabled]="chQualifying() || companyLeads().length === 0" (click)="doQualify()">
            {{ chQualifying() ? 'Qualifying…' : '② Qualify leads' }}
          </button>
        </div>
        @if (chQualifyMsg()) { <div class="success-msg">{{ chQualifyMsg() }}</div> }
        <p class="muted small"><strong>Google</strong> — Places API needs a key (<a routerLink="/admin/leadgen/settings">Settings</a>); without one it falls back to the free scraper. <strong>LinkedIn</strong> — "my cookie" pulls staff via your stored <code>li_at</code> session (against LinkedIn's ToS — use sparingly); "no cookie" finds the company page only. Runs slowly with a stagger, so give it time and come back.</p>
        <p class="muted small"><a routerLink="/admin/leads">View leads →</a></p>
      </div>

      <div class="card">
        <div class="cl-head">
          <h2>Pipeline <span class="muted">(@if (clRows().length !== companyLeads().length) { {{ clRows().length }} of }{{ companyLeads().length }})</span></h2>
        </div>
        <p class="muted small">Your generated companies live here — staged, kept separate from your Leads. Enrich them across the stages below, then <strong>Promote</strong> a finished one into your Leads funnel.</p>
        <div class="cl-toolbar">
          @if (clSelected().size) {
            <div class="bulk-inline">
              <strong>{{ clSelected().size }} selected</strong>
              <select [(ngModel)]="bulkAction" name="bulk_action" [disabled]="bulkBusy()">
                <option value="">Bulk action…</option>
                <option value="promote">Promote to Leads</option>
                <option value="requalify">Re-qualify</option>
                <option value="delete">Delete</option>
              </select>
              <button class="primary" [disabled]="!bulkAction || bulkBusy()" (click)="runBulk()">{{ bulkBusy() ? 'Working…' : 'Apply' }}</button>
              <button class="ghost" [disabled]="bulkBusy()" (click)="clearSelection()">Clear</button>
            </div>
          }
          <span class="spacer"></span>
          @if (companyLeads().length) {
            <div class="cl-filters" title="Filter by info the record has">
              <span class="cl-filters-label">Has</span>
              @for (fp of clFilterParams; track fp.key) {
                <button type="button" class="fchip" [class.on]="clFilters().has(fp.key)" (click)="toggleFilter(fp.key)" [title]="fp.label">
                  <svg viewBox="0 0 24 24"><path [attr.d]="fp.path" /></svg>
                </button>
              }
              @if (clFilters().size) { <button type="button" class="fchip fchip-clear" (click)="clearFilters()" title="Clear filters">✕</button> }
            </div>
          }
          <input type="text" class="cl-search" [(ngModel)]="clSearch" name="cl_q" placeholder="Search company / number" (keyup.enter)="loadCompanyLeads()" />
          <button class="ghost" (click)="loadCompanyLeads()" title="Refresh">↻</button>
          @if (companyLeads().length) {
            <button class="ghost" [disabled]="chPushing()" (click)="doPush('dev')" title="Push these leads to dev">{{ chPushing() === 'dev' ? 'Syncing…' : 'Sync → dev' }}</button>
            <button class="ghost" [disabled]="chPushing()" (click)="doPush('prod')" title="Push these leads to prod">{{ chPushing() === 'prod' ? 'Syncing…' : 'Sync → prod' }}</button>
            <button class="ghost danger" (click)="purgeCl()">Purge all</button>
          }
        </div>
        @if (clLoading()) { <p class="muted">Loading…</p> }
        @else if (!companyLeads().length) { <p class="muted">No pipeline records yet — run ① Get company data above.</p> }
        @else if (!clRows().length) { <p class="muted">No records have all the selected parameters. <button class="link-btn" (click)="clearFilters()">Clear filters</button></p> }
        @else {
          <div class="table-wrap">
            <table class="data">
              <thead><tr>
                <th class="cl-check"><input type="checkbox" [checked]="allSelected()" [indeterminate]="someSelected()" (change)="toggleAll($event)" title="Select all" /></th>
                <th>Recorded</th><th>State</th><th>Company</th><th>Number</th><th>Industry</th>
              </tr></thead>
              <tbody>
                @for (r of clRows(); track r.id) {
                  <tr class="cl-row" [class.sel]="clSelected().has(r.id)" (click)="viewCl(r.id)">
                    <td class="cl-check" (click)="$event.stopPropagation()">
                      <input type="checkbox" [checked]="clSelected().has(r.id)" (change)="toggleRow(r.id)" />
                    </td>
                    <td class="cl-date">{{ recordedDate(r) }}</td>
                    <td class="cl-info-icons">
                      <div class="cl-ic-row" title="Company: address · website · LinkedIn · email · phone">
                        <svg class="cl-ic-lead" viewBox="0 0 24 24"><title>Company</title><path [attr.d]="leadCompanyPath" /></svg>
                        @for (ic of clIcons; track ic.key) {
                          <svg class="cl-ic" [class.on]="companyHas(r, ic.key)" [class.bad]="companyBad(r, ic.key)" viewBox="0 0 24 24"><title>Company · {{ ic.title }}{{ ic.key === 'website' && companyBad(r, ic.key) ? ' (' + (r.url_status || 'inactive') + ')' : '' }}</title><path [attr.d]="ic.path" /></svg>
                        }
                      </div>
                      <div class="cl-ic-row" title="Directors &amp; staff: address · LinkedIn · email · phone">
                        <svg class="cl-ic-lead" viewBox="0 0 24 24"><title>Directors &amp; staff</title><path [attr.d]="leadPeoplePath" /></svg>
                        @for (ic of clIcons; track ic.key) {
                          @if (ic.key !== 'website') {
                            <svg class="cl-ic" [class.on]="peopleHas(r, ic.key)" viewBox="0 0 24 24"><title>Person · {{ ic.title }}</title><path [attr.d]="ic.path" /></svg>
                          }
                        }
                      </div>
                    </td>
                    <td><strong>{{ r.company || r.name }}</strong></td>
                    <td>{{ r.company_number || '—' }}</td>
                    <td class="cl-industry" [title]="r.industry || ''">{{ r.industry || '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      @if (chError()) { <div class="error-msg">{{ chError() }}</div> }

      @if (clDetail(); as d) {
        <div class="modal-backdrop" (click)="clDetail.set(null)">
          <div class="modal" (click)="$event.stopPropagation()">
            <div class="modal-head">
              <h3>{{ d.company_lead.company || d.company_lead.name }}</h3>
              <button class="ghost" (click)="clDetail.set(null)">✕</button>
            </div>
            <div class="modal-body">
              <p class="muted small">Stage {{ d.company_lead.stage || 1 }} · {{ d.company_lead.company_number || '—' }}@if (d.company_lead.industry) { · {{ d.company_lead.industry }} }</p>

              <h4>Company details</h4>
              <table class="data cl-info"><tbody>
                @for (i of clCompanyFacts(); track $index) {
                  <tr><td class="cl-key">{{ i.label }}</td>
                  <td>@if (i.url) { <a [href]="i.url" target="_blank" rel="noopener">{{ i.value }}</a> } @else { {{ i.value }} }</td></tr>
                }
              </tbody></table>

              @if (clWebFacts().length) {
                <h4>Online presence</h4>
                <table class="data cl-info"><tbody>
                  @for (i of clWebFacts(); track $index) {
                    <tr><td class="cl-key">{{ i.label }}</td>
                    <td>@if (i.url) { <a [href]="i.url" target="_blank" rel="noopener">{{ i.value }}</a> } @else { {{ i.value }} }</td></tr>
                  }
                </tbody></table>
              }

              @if (clPeople().length) {
                <h4>People ({{ clPeople().length }})</h4>
                <ul class="cl-people">
                  @for (p of clPeople(); track $index) {
                    <li>
                      <div class="cl-person-name">{{ p.name }}</div>
                      <dl class="cl-person-detail">
                        @for (f of p.fields; track $index) {
                          <dt>{{ f.label }}</dt>
                          <dd>@if (f.url) { <a [href]="f.url" target="_blank" rel="noopener">{{ f.value }}</a> } @else { {{ f.value }} }</dd>
                        }
                      </dl>
                    </li>
                  }
                </ul>
              }
            </div>
            <div class="modal-foot cl-foot">
              <button class="ghost cl-del" (click)="deleteCl(d.company_lead); clDetail.set(null)">Delete</button>
              <span class="spacer"></span>
              <button class="ghost" (click)="clDetail.set(null)">Close</button>
              <button class="ghost cl-secondary" [disabled]="chQualifying()" (click)="reQualifyCl(d.company_lead)">{{ chQualifying() ? 'Re-qualifying…' : 'Re-qualify' }}</button>
              <button class="primary" (click)="promoteCl(d.company_lead); clDetail.set(null)">Promote to Lead</button>
            </div>
          </div>
        </div>
      }
    }

    @if (mode() === 'import' && !hasInput()) {
      <div class="card upload">
        <h2>Import a list</h2>
        <p class="muted">Upload an Excel (.xlsx, .xls) or CSV file. Each row becomes a lead. Columns are matched automatically — you'll be able to review and override the mapping before importing.</p>
        <label class="file-drop" [class.dragging]="dragging()" (dragover)="onDragOver($event)" (dragleave)="onDragLeave($event)" (drop)="onDrop($event)">
          <input type="file" accept=".xlsx,.xls,.csv" (change)="onFileChange($event)" hidden #fileInput />
          @if (parsing()) {
            <span>Parsing…</span>
          } @else {
            <span>📂 Drop a file here, or <button class="link" type="button" (click)="fileInput.click()">browse</button></span>
          }
        </label>
        @if (parseError()) { <div class="error-msg">{{ parseError() }}</div> }
      </div>
    }

    @if (mode() === 'import' && hasInput()) {
      <div class="card">
        <h2>{{ aiLeads().length > 0 ? 'AI · ' + aiSearchModel : 'File · ' + filename() }}</h2>
        <div class="meta-row">
          <div class="meta-field">
            @if (aiLeads().length > 0) {
              <label>Source</label>
              <div class="value">AI generated · {{ aiLeads().length }} lead{{ aiLeads().length === 1 ? '' : 's' }}</div>
            } @else {
              <label>Detected rows</label>
              <div class="value">{{ rows().length }} data rows ({{ headers().length }} columns)</div>
            }
          </div>
          <div class="meta-field">
            <label>Default source</label>
            <input type="text" [(ngModel)]="defaultSource" name="default_source" placeholder="e.g. CQC London Homecare 2026-05" />
          </div>
          <div class="meta-field">
            <label>Default status</label>
            <select [(ngModel)]="defaultStatus" name="default_status">
              @for (s of allowedStatuses; track s) { <option [value]="s">{{ s }}</option> }
            </select>
          </div>
        </div>
        @if (aiLeads().length > 0) {
          <p class="muted small">⚠ AI-generated. Verify each row before contacting — model may have invented details.</p>
        } @else {
          <p class="muted small">Source is stamped on every imported lead that doesn't already have one in its sheet. Status is used when the row's status cell is empty or unrecognised.</p>
        }
      </div>

      @if (aiLeads().length === 0) {
        <div class="card">
          <h2>Column mapping</h2>
          <p class="muted small">Match each lead field to a column in your sheet. Fields marked with <span class="req">*</span> are required.</p>
          <div class="map-grid">
            @for (f of allFields; track f.key) {
              <div class="map-row">
                <label>{{ f.label }}@if (f.required) { <span class="req">*</span> }</label>
                <select [ngModel]="mapping()[f.key]" (ngModelChange)="setMapping(f.key, $event)" [name]="'map_' + f.key">
                  <option [ngValue]="-1">— (skip) —</option>
                  @for (h of headers(); track $index) {
                    <option [ngValue]="$index">{{ h || '(column ' + ($index + 1) + ')' }}</option>
                  }
                </select>
              </div>
            }
          </div>
        </div>
      }

      <div class="card">
        <h2>Preview</h2>
        <p class="muted small">First {{ previewRows().length }} of {{ validLeadCount() }} valid leads. Rows are kept if they have either a contact name or a company; company-only rows use the company as the lead name.</p>
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              @for (f of activeFields(); track f.key) { <th>{{ f.label }}</th> }
            </tr></thead>
            <tbody>
              @for (l of previewRows(); track $index) {
                <tr>
                  @for (f of activeFields(); track f.key) {
                    <td>{{ leadValue(l, f.key) || '—' }}</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      @if (importError()) { <div class="error-msg">{{ importError() }}</div> }
      @if (importResult(); as r) {
        <div class="success-msg">
          ✓ Imported {{ r.inserted }} lead{{ r.inserted === 1 ? '' : 's' }}.
          @if (r.errors.length > 0) {
            <span> {{ r.errors.length }} row{{ r.errors.length === 1 ? '' : 's' }} skipped:</span>
            <ul class="error-list">
              @for (e of r.errors; track $index) {
                <li>Row {{ e.row }}: {{ e.error }}</li>
              }
            </ul>
          }
        </div>
      }

      <div class="actions-bar">
        <button class="primary" [disabled]="importing() || validLeadCount() === 0" (click)="doImport()">
          {{ importing() ? 'Importing…' : 'Import ' + validLeadCount() + ' lead' + (validLeadCount() === 1 ? '' : 's') }}
        </button>
      </div>
    }
  `,
  styles: [`
    /* Page-level gutter — the shell doesn't inset routed features, so
       every top-level page owns its own left/right padding. Matches
       the .page { padding: 20px } convention used by accounting +
       clients. Applies to all modes (import / ai / ch). */
    :host { display: block; padding: 20px; }
    .upload { text-align: center; }
    .file-drop {
      display: flex; align-items: center; justify-content: center;
      min-height: 140px;
      border: 2px dashed var(--line); border-radius: var(--radius);
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
      margin-top: 16px; padding: 20px;
      color: var(--muted); font-size: 14px;
    }
    .file-drop:hover, .file-drop.dragging {
      border-color: var(--primary);
      background: var(--bg-3);
    }
    button.link {
      background: transparent; border: none; padding: 0;
      color: var(--primary); cursor: pointer;
      text-decoration: underline; font-size: inherit;
    }
    button.link:hover { color: var(--primary-2); background: transparent; border: none; }
    .meta-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: end; }
    .meta-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 200px; }
    /* Company-pull filter parameters: always one row — fields shrink instead of wrapping. */
    .ch-fetch-row { flex-wrap: nowrap; }
    .ch-fetch-row .meta-field { min-width: 0; flex: 1 1 0; }
    .ch-fetch-btn { flex: none; align-self: end; white-space: nowrap; }  /* inline with the fetch inputs */
    .stage-divider { border: none; border-top: 1px solid var(--line); margin: 22px 0; }
    /* LinkedIn crawl progress (indeterminate — retrievable count is unknown up front) */
    .li-prog { display: flex; align-items: center; gap: 12px; margin: 10px 0; }
    .li-prog-track { position: relative; flex: 1; height: 8px; border-radius: 999px; overflow: hidden;
      background: color-mix(in srgb, var(--bg-1) 70%, transparent); box-shadow: inset 0 0 0 1px var(--line); }
    .li-prog-fill { position: absolute; top: 0; left: 0; height: 100%; width: 35%; border-radius: 999px;
      background: var(--primary); animation: li-slide 1.3s ease-in-out infinite; }
    @keyframes li-slide { 0% { left: -35%; } 100% { left: 100%; } }
    .meta-field label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .meta-field .value { color: var(--fg); font-size: 14px; }
    .map-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
    .map-row { display: flex; flex-direction: column; gap: 4px; }
    .map-row label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .actions-bar { display: flex; justify-content: flex-end; padding: 16px 0; }
    .error-list { margin: 8px 0 0 0; padding-left: 18px; max-height: 160px; overflow-y: auto; font-size: 12px; }
    .req { color: var(--primary); margin-left: 2px; }
    .card + .card { margin-top: 16px; }

    /* Companies House pipeline — the stage cards + rail live in the
       standalone <app-leadgen-ch-dashboard>. Here we only style the run
       row so its short labels never wrap to two lines. */
    .ch-actions { justify-content: flex-start; flex-wrap: wrap; gap: 8px; align-items: center; }
    .ch-actions button { white-space: nowrap; }
    /* Inline method picker must not stretch to the global select width:100%. */
    .ch-actions select.ch-method { width: auto; min-width: 150px; }

    /* Pipeline records table */
    .cl-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    /* One controls row: bulk actions (left) + search / filter (right), never wraps. */
    .cl-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; margin-top: 8px; }
    .cl-toolbar .spacer { flex: 1 1 auto; min-width: 8px; }
    .cl-search { flex: 0 1 220px; min-width: 120px; width: auto; }
    /* Info-parameter filter: compact icon chips, inline on the toolbar row. */
    .cl-filters { display: flex; align-items: center; gap: 5px; flex: none; }
    .cl-filters-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-right: 2px; }
    .fchip {
      display: inline-flex; align-items: center; justify-content: center;
      width: 30px; height: 28px; padding: 0; cursor: pointer;
      border: 1px solid var(--line); border-radius: 8px; background: transparent;
    }
    .fchip svg { width: 16px; height: 16px; fill: #5a5a5a; }
    .fchip:hover { border-color: var(--primary); }
    .fchip.on { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 14%, transparent); }
    .fchip.on svg { fill: var(--primary); }
    .fchip-clear { color: var(--muted); font-size: 13px; }
    .link-btn { background: none; border: none; color: var(--primary); cursor: pointer; padding: 0; font: inherit; text-decoration: underline; }
    .bulk-inline { display: flex; align-items: center; gap: 8px; flex: none; }
    .bulk-inline strong { color: var(--primary); white-space: nowrap; }
    .bulk-inline select { width: auto; min-width: 150px; }
    /* Whole pipeline row opens the detail view. */
    .cl-row { cursor: pointer; }
    /* Info icon grid: two rows (company / people), grey = absent, gold = present. */
    .cl-info-icons { white-space: nowrap; }
    .cl-ic-row { display: flex; gap: 7px; align-items: center; }
    .cl-ic-row + .cl-ic-row { margin-top: 5px; }
    .cl-ic { width: 15px; height: 15px; fill: #5a5a5a; flex: none; }
    .cl-ic.on { fill: var(--primary); }
    .cl-ic.bad { fill: #e5484d; }  /* website present but domain parked/dead */
    .cl-ic-lead { width: 13px; height: 13px; fill: var(--muted); flex: none; margin-right: 3px; opacity: 0.7; }
    .cl-date { white-space: nowrap; color: var(--muted); font-variant-numeric: tabular-nums; }
    .cl-check { width: 34px; text-align: center; }
    .cl-check input { cursor: pointer; width: 15px; height: 15px; }
    .cl-row.sel { background: color-mix(in srgb, var(--primary) 12%, transparent); }

    /* Detail-modal footer: destructive Delete isolated on the left; Close /
       Re-qualify (secondary) / Promote (primary) grouped right, all with real
       button affordance rather than bare text. */
    .cl-foot { display: flex; align-items: center; gap: 8px; }
    .cl-foot .spacer { flex: 1; }
    .cl-foot .cl-secondary { box-shadow: inset 0 0 0 1px var(--line); border-radius: var(--radius-sm); }
    .cl-foot .cl-secondary:not([disabled]):hover { box-shadow: inset 0 0 0 1px var(--primary); }
    .cl-foot .cl-del {
      box-shadow: inset 0 0 0 1px color-mix(in srgb, #e5484d 50%, transparent);
      color: #e5484d; border-radius: var(--radius-sm);
    }
    .cl-foot .cl-del:hover { background: color-mix(in srgb, #e5484d 14%, transparent); }
    .cl-industry { max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cl-contact { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cl-actions { display: flex; gap: 6px; justify-content: flex-end; white-space: nowrap; }
    .cl-actions button { white-space: nowrap; }
    .stage-chip {
      display: inline-block; padding: 1px 7px; border: 1px solid var(--primary);
      border-radius: 999px; color: var(--primary); font-size: 10px; font-weight: 700;
    }
    .cl-list { margin: 4px 0 12px; padding-left: 18px; }
    .cl-key { color: var(--muted); white-space: nowrap; width: 1%; vertical-align: top; }
    /* Detail modal — grouped sections */
    .modal-body h4 { margin: 16px 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
    .modal-body h4:first-child { margin-top: 4px; }
    .cl-people { list-style: none; padding: 0; margin: 4px 0 6px; }
    .cl-people li { padding: 8px 0; border-bottom: 1px solid var(--line); }
    .cl-people li:last-child { border-bottom: none; }
    .cl-person-top { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .cl-person-name { font-weight: 600; }
    .cl-role { color: var(--muted); font-size: 12px; text-transform: capitalize; }
    .cl-li { font-size: 12px; }
    .cl-person-detail {
      margin: 4px 0 0; display: grid; grid-template-columns: auto 1fr;
      gap: 2px 14px; font-size: 12px;
    }
    .cl-person-detail dt { color: var(--muted); white-space: nowrap; }
    .cl-person-detail dd { margin: 0; color: var(--fg); }
    .cl-info td { padding: 6px 10px; white-space: normal; word-break: break-word; }
    .cl-info td.cl-key { white-space: nowrap; word-break: normal; }
  `],
})
export class LeadgenAdmin {
  private api    = inject(Api);
  private route  = inject(ActivatedRoute);
  private router = inject(Router);
  private state  = inject(LeadgenStateService);
  private dialog = inject(DialogService);

  /** Which page is being rendered. Two routes mount this same
   *  component:
   *    /admin/leadgen        → 'ai'     (AI Generated List card)
   *    /admin/leads/import   → 'import' (file upload card)
   *  Both share the unified preview/mapping/import flow that fires
   *  once `hasInput()` is true. Detected from the route's `data.mode`
   *  property — set per-route in app.routes.ts. */
  readonly mode = signal<'ai' | 'import' | 'ch' | 'li'>(
    this.route.snapshot.data['mode'] === 'import' ? 'import'
      : this.route.snapshot.data['mode'] === 'ch' ? 'ch'
      : this.route.snapshot.data['mode'] === 'linkedin' ? 'li'
      : 'ai'
  );
  /** 'ch' and 'li' share the entire pipeline UI; only Stage 1's source differs. */
  readonly isPipeline = computed(() => this.mode() === 'ch' || this.mode() === 'li');
  /** The company_leads.source discriminator for the active page. */
  readonly sourceKey = computed(() => this.mode() === 'li' ? 'linkedin' : 'companies-house');

  allFields = ALL_FIELDS;
  allowedStatuses = ALLOWED_STATUSES;

  // File-import state
  filename = signal<string>('');
  rows = signal<any[][]>([]);
  headers = signal<string[]>([]);
  mapping = signal<Mapping>(this.emptyMapping());
  defaultSource = '';
  defaultStatus: LeadStatus = 'new';

  parsing = signal(false);
  parseError = signal<string | null>(null);
  importing = signal(false);
  importError = signal<string | null>(null);
  importResult = signal<{ inserted: number; errors: { row: number; error: string }[] } | null>(null);

  dragging = signal(false);

  // AI-generation state. When `aiLeads()` is non-empty the review screen
  // skips the column-mapping step and feeds the AI rows straight into the
  // shared preview/import flow.
  // Models start with the static built-ins and get replaced once the
  // backend's merged list (built-ins + user-added rows) loads.
  aiModelsSig = signal<AiModel[]>(AI_MODELS);
  get aiModels() { return this.aiModelsSig(); }
  get aiSearchModels(): AiModel[] { return this.aiModelsSig().filter(m => m.search); }
  aiSearchModel = AI_MODELS.find(m => m.search)?.id ?? AI_MODELS[0].id;
  aiFormatModel = '';
  aiPrompt = '';
  aiGenerating = signal(false);
  aiError = signal<string | null>(null);
  aiLeads = signal<Partial<Lead>[]>([]);

  // Companies House pipeline state (mode === 'ch').
  chDays = 1;
  chLimit = 200;
  chSector = '';
  // LinkedIn source-pull (mode === 'li')
  liKeyword = '';
  liLocation = '';
  liSearchUrl = '';   // paste a faceted LinkedIn company-search URL (region encoded)
  liGeo = '90009496'; // companyHqGeo id — pre-filled to London so a size search isn't silently global; change per region
  liCaptured = signal(0);   // live crawl progress
  liTotal = signal(0);
  liPage = signal(0);
  fmtNum(n: number): string { return n.toLocaleString(); }
  liSizes = signal<Set<string>>(new Set<string>());  // companySize facet codes A..I
  // LinkedIn's company-search size facet: buckets B..I (starts at 1-10, no "A").
  readonly liSizeOptions: { code: string; label: string }[] = [
    { code: 'B', label: '1–10' }, { code: 'C', label: '11–50' }, { code: 'D', label: '51–200' },
    { code: 'E', label: '201–500' }, { code: 'F', label: '501–1K' }, { code: 'G', label: '1K–5K' },
    { code: 'H', label: '5K–10K' }, { code: 'I', label: '10K+' },
  ];
  toggleLiSize(code: string): void {
    const s = new Set(this.liSizes());
    s.has(code) ? s.delete(code) : s.add(code);
    this.liSizes.set(s);
  }
  chFetching = signal(false);
  chFetchMsg = signal<string | null>(null);
  chEnriching = signal(false);
  chEnrichMsg = signal<string | null>(null);
  chProfiling = signal(false);
  chProfileMsg = signal<string | null>(null);
  // Stage 3 data source: 'api' = Google Places API (needs a key, no stagger);
  // 'scrape' = free DuckDuckGo website finder (no key, slow, best-effort).
  chProfileMethod: 'api' | 'scrape' = 'api';
  // Stage 5 (LinkedIn): 'scrape' = keyless, company URL only (LinkedIn blocks
  // unauthenticated staff access); 'cookie' = uses the stored li_at session.
  chStaffing = signal(false);
  chStaffMsg = signal<string | null>(null);
  chStaffMethod: 'scrape' | 'cookie' = 'scrape';
  // Qualify — one bundled enrichment pass over every record.
  chQualifying = signal(false);
  chQualifyMsg = signal<string | null>(null);
  chQualifyGoogle: 'api' | 'scrape' = 'api';
  chQualifyLinkedin: 'scrape' | 'cookie' = 'scrape';
  chError = signal<string | null>(null);
  chStages = signal<Record<string, number>>({ '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 });
  chMilestones = signal<ChMilestones | null>(null);
  chLastRun = signal<ChLastRun | null>(null);
  // Which stage is running (feeds the dashboard's active-row shimmer) + the
  // active chunk's progress. Null when idle. Kept as two loose signals for
  // the current runner (one stage at a time); the dashboard consumes them
  // via `chRunning` below in the shape it prefers.
  chActive = signal<number | null>(null);
  chProgress = signal<{ processed: number; remaining: number; done?: boolean } | null>(null);

  /** Adapter over `chActive` + `chProgress` for `<app-leadgen-ch-dashboard>`
   *  which takes a `Record<stage, {processed, total, label?}>` so it can
   *  render multiple concurrent stages independently. Today the runner
   *  only fires one stage at a time so this Record has 0 or 1 entries;
   *  when the runner evolves to concurrent execution the dashboard is
   *  already wired for it — just replace this shim with a real Record
   *  signal keyed by stage. */
  chRunning = computed<Record<string, { processed: number; total: number }>>(() => {
    const stage = this.chActive();
    if (stage == null) return {};
    const p = this.chProgress();
    if (!p) return { [stage]: { processed: 0, total: 0 } };
    return { [stage]: { processed: p.processed, total: p.processed + p.remaining } };
  });

  /** Either source has loaded leads → review/import section is visible. */
  hasInput = computed(() => this.rows().length > 0 || this.aiLeads().length > 0);

  /** Fields the user has actually mapped to a column (file mode), or every
   *  field with at least one non-empty value (AI mode). */
  activeFields = computed(() => {
    if (this.aiLeads().length > 0) {
      const present = new Set<LeadField>();
      for (const l of this.aiLeads()) {
        for (const f of ALL_FIELDS) {
          if ((l as any)[f.key]) present.add(f.key);
        }
      }
      return ALL_FIELDS.filter(f => present.has(f.key) || f.required);
    }
    return ALL_FIELDS.filter(f => this.mapping()[f.key] >= 0);
  });

  /** All leads that would be inserted. Pulls from AI when present, else
   *  builds from the parsed file rows + column mapping. Default source/status
   *  are applied in both paths. */
  validLeads = computed<Partial<Lead>[]>(() => {
    if (this.aiLeads().length > 0) return this.applyDefaultsToAi(this.aiLeads());
    return this.buildLeads(this.rows(), this.mapping());
  });
  validLeadCount = computed(() => this.validLeads().length);
  previewRows = computed(() => this.validLeads().slice(0, 10));

  private applyDefaultsToAi(leads: Partial<Lead>[]): Partial<Lead>[] {
    const ds = this.defaultSource.trim();
    return leads.map(l => ({
      ...l,
      status: ((l.status as LeadStatus) ?? this.defaultStatus),
      source: l.source || ds || undefined,
    }));
  }

  ngOnInit() {
    // Pipeline modes (Companies House / LinkedIn): load counts + list on landing.
    if (this.isPipeline()) {
      this.loadChPipeline();
      return;
    }

    // Pull the merged registry (built-ins + user-added) from the backend.
    // Falls back silently to the static built-in list on error.
    this.api.listAiModels().subscribe({
      next: r => {
        if (r.models?.length) this.aiModelsSig.set(r.models);
      },
      error: () => {/* silent — keep built-in defaults */},
    });

    // When mounted in 'import' mode, check whether the Lead Gen page
    // handed off a batch of AI-generated leads. The buffer lives in
    // LeadgenStateService because Angular tears down the component on
    // route change so the AI page can't pass state directly. Consuming
    // the buffer flips us straight into the preview/import flow.
    if (this.mode() === 'import') {
      const handoff = this.state.consumePendingAiLeads();
      if (handoff && handoff.length > 0) {
        this.aiLeads.set(handoff);
        if (!this.defaultSource) {
          this.defaultSource = `AI · ${new Date().toISOString().slice(0, 10)}`;
        }
      }
    }
  }

  generateAi() {
    const prompt = this.aiPrompt.trim();
    if (!prompt) return;
    this.aiGenerating.set(true);
    this.aiError.set(null);
    this.api.aiGenerateLeads(this.aiSearchModel, this.aiFormatModel || null, prompt).subscribe({
      next: r => {
        this.aiGenerating.set(false);
        const leads = r.leads || [];
        // Drop the result into the cross-route buffer + navigate to
        // Import Leads, which owns the preview/mapping/import flow.
        // The receiving component's ngOnInit pulls the buffer and
        // shows the review UI immediately on landing.
        this.state.pendingAiLeads.set(leads);
        this.router.navigate(['/admin/leads/import']);
      },
      error: e => {
        this.aiGenerating.set(false);
        this.aiError.set(e?.error?.error || 'Generation failed');
      },
    });
  }

  // ---- Companies House pipeline ------------------------------------------

  private loadChPipeline() {
    this.api.chPipeline(this.sourceKey()).subscribe({
      next: r => {
        this.chStages.set(r.stages);
        if (r.milestones) this.chMilestones.set(r.milestones);
        // Hydrate the "last run" module from the persisted summary, but only
        // when we don't already have live/session data (so a running pass or a
        // just-finished run isn't clobbered by the stored value).
        if (r.last_run && this.chLastRun() === null) this.chLastRun.set(r.last_run);
      },
      error: () => {/* leave last-known counts */},
    });
    if (this.isPipeline()) this.loadCompanyLeads();
  }

  // ---- Pipeline records (company_leads) ----------------------------------
  companyLeads = signal<CompanyLead[]>([]);
  clLoading = signal(false);
  clSearch = '';
  clDetail = signal<CompanyLeadDetail | null>(null);

  // Info-parameter filters for the pipeline list (checkboxes). A record shows
  // when it has ALL the ticked parameters.
  readonly clFilterParams: { key: keyof CompanyLead; label: string; path: string }[] = [
    { key: 'f_address',   label: 'Address',   path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z' },
    { key: 'f_directors', label: 'Directors', path: 'M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z' },
    { key: 'f_industry',  label: 'Industry',  path: 'M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2zm0 4h8v8H4v-8h6z' },
    { key: 'f_website',   label: 'Website',   path: 'M12 2a10 10 0 100 20 10 10 0 000-20zm6.92 6h-2.95a15.7 15.7 0 00-1.38-3.56A8.03 8.03 0 0118.92 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14a7.96 7.96 0 010-4h3.38a16.6 16.6 0 000 4H4.26zm.81 2h2.95c.32 1.25.78 2.45 1.38 3.56A8 8 0 015.07 16zm2.95-8H5.07a8 8 0 014.33-3.56A15.7 15.7 0 008.02 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66a14.9 14.9 0 010-4h4.68a14.9 14.9 0 010 4zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 01-4.33 3.56zM16.36 14a16.6 16.6 0 000-4h3.38a7.96 7.96 0 010 4h-3.38z' },
    { key: 'f_phone',     label: 'Phone',     path: 'M6.62 10.79a15.5 15.5 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24 11.4 11.4 0 003.56.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.25 1.02l-2.2 2.2z' },
    { key: 'f_email',     label: 'Email',     path: 'M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z' },
    { key: 'f_linkedin',  label: 'LinkedIn',  path: 'M19 3a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h14zM8.34 9.67H5.67V18h2.67V9.67zM7 6.33a1.55 1.55 0 100 3.1 1.55 1.55 0 000-3.1zM18.33 18v-4.57c0-2.45-1.31-3.59-3.06-3.59-1.41 0-2.04.78-2.39 1.32v-1.13H10.2V18h2.67v-4.53c0-.24.02-.48.09-.65.19-.48.63-.98 1.37-.98.97 0 1.35.74 1.35 1.82V18h2.66z' },
    { key: 'f_staff',     label: 'Staff',     path: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h7v-1.61c0-.83.34-1.6.9-2.19A9.7 9.7 0 008 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.34V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z' },
  ];
  clFilters = signal<Set<string>>(new Set<string>());
  clRows = computed(() => {
    const keys = [...this.clFilters()];
    const rows = this.companyLeads();
    if (!keys.length) return rows;
    return rows.filter(r => keys.every(k => (r as unknown as Record<string, number>)[k] === 1));
  });
  toggleFilter(key: string): void {
    const s = new Set(this.clFilters());
    s.has(key) ? s.delete(key) : s.add(key);
    this.clFilters.set(s);
    // Selection may now include hidden rows — drop any that fell out of view.
    const visible = new Set(this.clRows().map(r => r.id));
    this.clSelected.set(new Set([...this.clSelected()].filter(id => visible.has(id))));
  }
  clearFilters(): void { this.clFilters.set(new Set<string>()); }

  // Group the flat info/contacts of the open record into readable sections.
  private static CL_WEB_KEYS = ['LinkedIn (company)', 'Companies House', 'Google Business', 'Google rating', 'Business status', 'Opening hours', 'Google category'];

  /** Split a stored "Director:" detail string ("Appointed: X; Nationality: Y;
   *  Correspondence address: Z") into labelled fields. Legacy entries stored the
   *  address unlabelled, so an unlabelled part is treated as the correspondence
   *  address. */
  private parseDetail(value: string | null | undefined): { label: string; value: string }[] {
    if (!value) return [];
    return value.split(';').map(s => s.trim()).filter(Boolean).map(part => {
      const m = part.match(/^([A-Za-z][A-Za-z ]*?):\s*(.+)$/);
      if (m) return { label: m[1].trim(), value: m[2].trim() };
      const am = part.match(/^Appointed\s+(.+)$/i);
      if (am) return { label: 'Appointed', value: am[1].trim() };
      return { label: 'Correspondence address', value: part };
    });
  }

  /** People = directors (from contacts, CH detail folded in) + LinkedIn staff.
   *  Every person carries the same field slots — Role, the CH detail (Appointed
   *  / Nationality / Correspondence address), Email, LinkedIn — with "—" where
   *  not yet enriched, so the layout is consistent. */
  clPeople = computed(() => {
    const d = this.clDetail();
    if (!d) return [];
    const dash = '—';
    const out: { name: string; fields: { label: string; value: string; url?: string }[] }[] = [];
    for (const c of d.contacts) {
      const full = `${c.first_name} ${c.last_name ?? ''}`.trim();
      const key = (c.last_name || c.first_name || '').toLowerCase();
      const di = d.info.find(i => /^director:/i.test(i.name) && key !== '' && i.name.toLowerCase().includes(key));
      const fields: { label: string; value: string; url?: string }[] = [{ label: 'Role', value: c.position || dash }];
      for (const p of this.parseDetail(di?.value)) fields.push(p);
      fields.push({ label: 'Phone', value: c.phone || dash });
      fields.push({ label: 'Email', value: c.email || dash });
      fields.push({ label: 'LinkedIn', value: c.linkedin_url || dash, url: c.linkedin_url || undefined });
      out.push({ name: full, fields });
    }
    for (const i of d.info) {
      if (/^staff:/i.test(i.name)) out.push({
        name: i.name.replace(/^staff:\s*/i, ''),
        fields: [{ label: 'Role', value: 'Staff' }, { label: 'LinkedIn', value: i.value || dash, url: i.value || undefined }],
      });
    }
    return out;
  });

  /** Company field slots — always the same set (Company number, Registered
   *  address, CH classification, then the contact fields Phone/Email/Website/
   *  LinkedIn), "—" where not yet enriched, so you can see where data lands. */
  clCompanyFacts = computed(() => {
    const d = this.clDetail();
    if (!d) return [];
    const cl = d.company_lead;
    const dash = '—';
    const iv = (name: string) => d.info.find(i => i.name === name)?.value || '';
    const liCompany = iv('LinkedIn (company)');
    return [
      { label: 'Company number',    value: cl.company_number || dash },
      { label: 'Registered address', value: cl.address || dash },
      { label: 'Incorporated',      value: iv('Incorporated') || dash },
      { label: 'SIC codes',         value: iv('SIC codes') || dash },
      { label: 'Sector',            value: iv('Sector') || dash },
      { label: 'Sector group',      value: iv('Sector group') || dash },
      { label: 'Phone',             value: cl.phone || dash },
      { label: 'Email',             value: cl.email || dash },
      { label: 'Website',           value: cl.url || dash, url: cl.url || undefined },
      { label: 'LinkedIn',          value: liCompany || dash, url: liCompany || undefined },
    ] as { label: string; value: string; url?: string }[];
  });

  /** Extra online-presence detail (Google Business), only shown when present. */
  clWebFacts = computed(() => {
    const d = this.clDetail();
    if (!d) return [];
    return d.info.filter(i => LeadgenAdmin.CL_WEB_KEYS.includes(i.name))
      .map(i => ({ label: i.name, value: i.value || '', url: this.isUrl(i.value) ? (i.value || undefined) : undefined }));
  });

  loadCompanyLeads() {
    this.clLoading.set(true);
    this.api.listCompanyLeads({
      q: this.clSearch.trim() || undefined,
      source: this.sourceKey(),
    }).subscribe({
      next: r => { this.companyLeads.set(r.company_leads || []); this.clLoading.set(false); },
      error: () => this.clLoading.set(false),
    });
  }
  viewCl(id: number) {
    this.api.getCompanyLead(id).subscribe({ next: d => this.clDetail.set(d), error: () => {} });
  }
  async promoteCl(r: CompanyLead) {
    const ok = await this.dialog.confirm(`Promote "${r.company || r.name}" into your Leads funnel? It leaves the pipeline.`);
    if (!ok) return;
    this.api.promoteCompanyLead(r.id).subscribe({
      next: () => { this.companyLeads.set(this.companyLeads().filter(x => x.id !== r.id)); this.loadChPipeline(); },
      error: e => this.chError.set(e?.error?.error || 'Promote failed.'),
    });
  }
  async deleteCl(r: CompanyLead) {
    const ok = await this.dialog.confirm(`Delete "${r.company || r.name}" from the pipeline? This cannot be undone.`);
    if (!ok) return;
    this.api.deleteCompanyLead(r.id).subscribe({
      next: () => { this.companyLeads.set(this.companyLeads().filter(x => x.id !== r.id)); this.loadChPipeline(); },
      error: () => {},
    });
  }
  chPushing = signal<'dev' | 'prod' | null>(null);
  /** Push the current pipeline's source to a dev/prod target (local → remote). */
  async doPush(target: 'dev' | 'prod') {
    if (this.chPushing()) return;
    const ok = await this.dialog.confirm(`Push the ${this.sourceKey()} pipeline (${this.companyLeads().length} records) up to ${target}? New records are added there; existing ones are skipped.`);
    if (!ok) return;
    this.chPushing.set(target);
    this.chError.set(null); this.chFetchMsg.set(null);
    this.api.chPush({ target, source: this.sourceKey() }).subscribe({
      next: r => { this.chPushing.set(null); this.chFetchMsg.set(`Synced ${r.pushed} to ${target} — ${r.result.inserted} added, ${r.result.skipped} already there.`); },
      error: e => { this.chPushing.set(null); this.chError.set(e?.error?.error || `Sync to ${target} failed.`); },
    });
  }
  async purgeCl() {
    const ok = await this.dialog.confirm('Delete ALL pipeline records? This cannot be undone.');
    if (!ok) return;
    this.api.purgeCompanyLeads().subscribe({
      next: () => { this.companyLeads.set([]); this.loadChPipeline(); },
      error: () => {},
    });
  }
  isUrl(v: string | null): boolean { return !!v && /^https?:\/\//.test(v); }

  // ---- Bulk selection + actions (promote / delete / re-qualify) ----
  clSelected = signal<Set<number>>(new Set<number>());
  bulkAction = '';
  bulkBusy = signal(false);
  allSelected = computed(() => { const n = this.clRows().length; return n > 0 && this.clSelected().size === n; });
  someSelected = computed(() => { const s = this.clSelected().size; return s > 0 && s < this.clRows().length; });

  toggleRow(id: number): void {
    const s = new Set(this.clSelected());
    s.has(id) ? s.delete(id) : s.add(id);
    this.clSelected.set(s);
  }
  toggleAll(e: Event): void {
    const on = (e.target as HTMLInputElement).checked;
    this.clSelected.set(on ? new Set(this.clRows().map(r => r.id)) : new Set<number>());
  }
  clearSelection(): void { this.clSelected.set(new Set<number>()); this.bulkAction = ''; }

  async runBulk(): Promise<void> {
    const ids = [...this.clSelected()];
    if (!ids.length || !this.bulkAction || this.bulkBusy()) return;
    const action = this.bulkAction;
    if (action === 'delete') {
      const ok = await this.dialog.confirm(`Delete ${ids.length} record${ids.length === 1 ? '' : 's'} from the pipeline? This cannot be undone.`);
      if (!ok) return;
      this.bulkBusy.set(true);
      for (const id of ids) { try { await firstValueFrom(this.api.deleteCompanyLead(id)); } catch { /* keep going */ } }
      this.companyLeads.set(this.companyLeads().filter(x => !ids.includes(x.id)));
      this.clearSelection(); this.bulkBusy.set(false); this.loadChPipeline();
    } else if (action === 'promote') {
      const ok = await this.dialog.confirm(`Promote ${ids.length} record${ids.length === 1 ? '' : 's'} into your Leads funnel? They leave the pipeline.`);
      if (!ok) return;
      this.bulkBusy.set(true);
      for (const id of ids) { try { await firstValueFrom(this.api.promoteCompanyLead(id)); } catch { /* keep going */ } }
      this.companyLeads.set(this.companyLeads().filter(x => !ids.includes(x.id)));
      this.clearSelection(); this.bulkBusy.set(false); this.loadChPipeline();
    } else if (action === 'requalify') {
      this.bulkBusy.set(true);
      await this.reQualifyIds(ids, `${ids.length} selected`);
      this.clearSelection(); this.bulkBusy.set(false);
    }
  }

  /** Re-qualify a single record from its info panel — runs the full Qualify
   *  flow (officers → Google → domain status → contact crawl) for it alone. */
  async reQualifyCl(r: CompanyLead): Promise<void> {
    this.clDetail.set(null);
    await this.reQualifyIds([r.id], r.company || r.name);
  }

  /** Run the Qualify flow for an explicit set of ids (single or bulk). */
  async reQualifyIds(ids: number[], label?: string): Promise<void> {
    if (this.chQualifying() || !ids.length) return;
    this.chError.set(null); this.chQualifyMsg.set(null);
    this.chQualifying.set(true); this.chActive.set(2);
    const found: ChFoundCounts = { directors: 0, industry: 0, address: 0, website: 0, phone: 0, email: 0, linkedin: 0, staff: 0 };
    this.chLastRun.set({ checked: 0, enriched: 0, found: { ...found }, running: true });
    try {
      const r = await firstValueFrom(this.api.chQualify({
        after_id: 0, ids, source: this.sourceKey(),
        google_method: this.chQualifyGoogle,
        linkedin_method: this.chQualifyLinkedin,
      }));
      found.directors += r.found.directors; found.industry += r.found.industry ?? 0; found.address += r.found.address ?? 0;
      found.website += r.found.website; found.phone += r.found.phone;
      found.email += r.found.email ?? 0; found.linkedin += r.found.linkedin; found.staff += r.found.staff;
      this.chLastRun.set({ checked: r.processed, enriched: r.enriched, found: { ...found }, running: false });
      this.chQualifyMsg.set(`Re-qualified ${r.processed} record${r.processed === 1 ? '' : 's'}${label ? ' · ' + label : ''} — ${r.enriched} gained new info.`);
      this.api.saveChLastRun({ checked: r.processed, enriched: r.enriched, found, source: this.sourceKey() }).subscribe({ error: () => {} });
    } catch (e: any) {
      this.chError.set(e?.error?.error || 'Re-qualify failed.');
    } finally {
      this.chQualifying.set(false); this.chActive.set(null);
      this.loadCompanyLeads(); this.loadChPipeline();
    }
  }

  /** Date the pipeline record was first created, e.g. "16 Jul 2026". */
  recordedDate(r: CompanyLead): string {
    const s = r.created_at;
    if (!s) return '—';
    const d = new Date(s.replace(' ', 'T'));
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // Icon grid on the list: address · website · LinkedIn · email · phone, one row
  // for the company + one for its people. Grey = absent, gold = present.
  // Row-leader glyphs so the two icon rows read as "company" vs "people".
  readonly leadCompanyPath = 'M3 21V7l6-4v4l6-4v6h6v12H3zm4-2h2v-2H7v2zm0-4h2v-2H7v2zm4 4h2v-2h-2v2zm0-4h2v-2h-2v2zm0-4h2V9h-2v2zm4 8h2v-2h-2v2zm0-4h2v-2h-2v2z';
  readonly leadPeoplePath = 'M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z';
  readonly clIcons: { key: string; title: string; path: string }[] = [
    { key: 'address',  title: 'Address',  path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z' },
    { key: 'website',  title: 'Website',  path: 'M12 2a10 10 0 100 20 10 10 0 000-20zm6.92 6h-2.95a15.7 15.7 0 00-1.38-3.56A8.03 8.03 0 0118.92 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14a7.96 7.96 0 010-4h3.38a16.6 16.6 0 000 4H4.26zm.81 2h2.95c.32 1.25.78 2.45 1.38 3.56A8 8 0 015.07 16zm2.95-8H5.07a8 8 0 014.33-3.56A15.7 15.7 0 008.02 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66a14.9 14.9 0 010-4h4.68a14.9 14.9 0 010 4zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 01-4.33 3.56zM16.36 14a16.6 16.6 0 000-4h3.38a7.96 7.96 0 010 4h-3.38z' },
    { key: 'linkedin', title: 'LinkedIn', path: 'M19 3a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h14zM8.34 9.67H5.67V18h2.67V9.67zM7 6.33a1.55 1.55 0 100 3.1 1.55 1.55 0 000-3.1zM18.33 18v-4.57c0-2.45-1.31-3.59-3.06-3.59-1.41 0-2.04.78-2.39 1.32v-1.13H10.2V18h2.67v-4.53c0-.24.02-.48.09-.65.19-.48.63-.98 1.37-.98.97 0 1.35.74 1.35 1.82V18h2.66z' },
    { key: 'email',    title: 'Email',    path: 'M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z' },
    { key: 'phone',    title: 'Phone',    path: 'M6.62 10.79a15.5 15.5 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24 11.4 11.4 0 003.56.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.25 1.02l-2.2 2.2z' },
  ];
  // Domain statuses that mean the website exists but isn't a live business site.
  private readonly deadUrl = ['parked', 'for_sale', 'unconfigured', 'dead'];
  private urlDead(r: CompanyLead): boolean { return !!r.url && this.deadUrl.includes(r.url_status ?? ''); }

  companyHas(r: CompanyLead, key: string): boolean {
    switch (key) {
      case 'address':  return !!r.address;
      case 'website':  return !!r.url && !this.urlDead(r); // gold only when live/unknown
      case 'linkedin': return !!r.c_li;
      case 'email':    return !!r.email;
      case 'phone':    return !!r.phone;
    }
    return false;
  }
  /** Website exists but the domain is parked/for-sale/dead → render icon red.
   *  Only meaningful on the company row (people have no website). */
  companyBad(r: CompanyLead, key: string): boolean {
    return key === 'website' && this.urlDead(r);
  }
  peopleHas(r: CompanyLead, key: string): boolean {
    switch (key) {
      case 'address':  return !!r.p_addr;
      case 'website':  return false;   // a person doesn't have a website
      case 'linkedin': return !!r.p_li;
      case 'email':    return !!r.p_email;
      case 'phone':    return !!r.p_phone;
    }
    return false;
  }

  /** (runStage) dispatcher — the dashboard's per-row Run buttons emit
   *  the stage number, we forward to the matching do* method. Stages
   *  4 + 5 aren't implemented yet so they no-op (the dashboard's
   *  Locked / disabled state should keep those buttons unclickable
   *  anyway, but this guards against future misclicks). */
  runChStage(stageN: number): void {
    switch (stageN) {
      case 1: this.doChFetch();    break;
      case 2: this.doChEnrich();   break;
      case 3: this.doChProfiles(); break;
      case 4: /* pending crawler */ break;
      case 5: this.doChStaff();    break;
    }
  }

  /** Stage 1 — pull companies into the leads table. */
  doChFetch() {
    if (this.chFetching()) return;
    this.chError.set(null);
    this.chFetchMsg.set(null);
    this.chFetching.set(true);
    this.chActive.set(1);        // light up Stage 1 on the dashboard
    this.chProgress.set(null);   // single call — no chunk progress
    this.api.chFetchCompanies({
      days:   this.chDays,
      limit:  this.chLimit,
      sector: this.chSector.trim() || undefined,
      status: 'active',
    }).subscribe({
      next: r => {
        this.chFetching.set(false);
        this.chActive.set(null);
        this.chFetchMsg.set(
          `Added ${r.inserted} new compan${r.inserted === 1 ? 'y' : 'ies'} ` +
          `(${r.skipped} already stored, ${r.fetched} fetched).`
        );
        this.loadChPipeline();
      },
      error: e => {
        this.chFetching.set(false);
        this.chActive.set(null);
        this.chError.set(e?.error?.error || 'Fetch failed.');
      },
    });
  }

  /** Stage 1 (LinkedIn source) — capture a company list from LinkedIn by
   *  keyword + location, seeding the pipeline with source='linkedin'. */
  async doLiFetch() {
    if (this.chFetching() || (!this.liKeyword.trim() && !this.liSearchUrl.trim() && !this.liGeo.trim() && !this.liSizes().size)) return;
    this.chError.set(null);
    this.chFetchMsg.set(null);
    this.chFetching.set(true);
    this.chActive.set(1);
    this.chProgress.set(null);
    const base = {
      keyword:    this.liKeyword.trim() || undefined,
      search_url: this.liSearchUrl.trim() || undefined,
      geo:        this.liGeo.trim() || undefined,
      sizes:      [...this.liSizes()],
    };
    let start = 1, inserted = 0, total = 0;
    this.liCaptured.set(0); this.liTotal.set(0); this.liPage.set(0);
    try {
      for (;;) {
        // First batch = 2 pages (fast → shows the total quickly), then 6-page
        // batches to amortise the browser launch.
        const r = await firstValueFrom(this.api.chFetchLinkedin({ ...base, start_page: start, pages: start === 1 ? 2 : 6 }));
        inserted += r.inserted;
        if (r.total) total = r.total;
        this.liCaptured.set(inserted); this.liTotal.set(total); this.liPage.set(r.to_page);
        this.loadChPipeline();  // list grows live
        if (r.done) {
          this.chFetchMsg.set(
            `Done — captured ${inserted} compan${inserted === 1 ? 'y' : 'ies'} from LinkedIn` +
            `${total ? ' (of ≈' + total.toLocaleString() + ' results)' : ''}.`
          );
          break;
        }
        start = r.next_page;
      }
    } catch (e: any) {
      this.chError.set(e?.error?.error || 'LinkedIn crawl failed.');
    } finally {
      this.chFetching.set(false);
      this.chActive.set(null);
    }
  }

  /** Stage 2 — walk stage-1 leads in chunks until the backend reports done,
   *  attaching directors as contacts. Re-calls itself with a live progress
   *  message so long runs stay visible instead of one blocking request. */
  async doChEnrich() {
    if (this.chEnriching()) return;
    this.chError.set(null);
    this.chEnrichMsg.set(null);
    this.chEnriching.set(true);
    this.chActive.set(2);        // light up Stage 2 on the dashboard
    let total = 0;
    try {
      for (;;) {
        const r = await firstValueFrom(this.api.chEnrichOfficers(20));
        total += r.processed;
        // Feed the dashboard live chunk progress (done so far · left to go).
        this.chProgress.set({ processed: total, remaining: r.remaining, done: r.done });
        this.loadChPipeline();
        if (r.done || r.processed === 0) {
          this.chEnrichMsg.set(`Done — enriched ${total} compan${total === 1 ? 'y' : 'ies'} with directors.`);
          break;
        }
        this.chEnrichMsg.set(`Enriched ${total}… ${r.remaining} to go.`);
      }
    } catch (e: any) {
      this.chError.set(e?.error?.error || 'Enrichment failed.');
    } finally {
      this.chEnriching.set(false);
      this.chActive.set(null);
      this.chProgress.set(null);
      this.loadChPipeline();
    }
  }

  /** Stage 3 — walk stage-2 leads in chunks, resolving each against the
   *  Google Places API. Runs slowly on purpose (small chunks + a server-side
   *  stagger) so it stays under Google's rate limits; the loop keeps the UI
   *  updated with running totals. */
  async doChProfiles() {
    if (this.chProfiling()) return;
    this.chError.set(null);
    this.chProfileMsg.set(null);
    this.chProfiling.set(true);
    this.chActive.set(3);        // light up Stage 3 on the dashboard
    const method = this.chProfileMethod;
    const noun = method === 'scrape' ? 'website' : 'listing';
    let total = 0, found = 0;
    try {
      for (;;) {
        const r = await firstValueFrom(this.api.chFindProfiles(method));
        total += r.processed;
        found += r.found;
        this.chProgress.set({ processed: total, remaining: r.remaining, done: r.done });
        this.loadChPipeline();
        if (r.done || r.processed === 0) {
          this.chProfileMsg.set(`Done — checked ${total} compan${total === 1 ? 'y' : 'ies'}, found ${found} ${noun}${found === 1 ? '' : 's'}.`);
          break;
        }
        this.chProfileMsg.set(`Checked ${total} (${found} found)… ${r.remaining} to go.`);
      }
    } catch (e: any) {
      this.chError.set(e?.error?.error || 'Lookup failed.');
    } finally {
      this.chProfiling.set(false);
      this.chActive.set(null);
      this.chProgress.set(null);
      this.loadChPipeline();
    }
  }

  /** Stage 5 — walk enriched leads in chunks, resolving each company's
   *  LinkedIn page (+ staff, cookie method only) against LinkedIn. Runs slowly
   *  (1–15s server-side stagger) either way, since LinkedIn is scraped. */
  async doChStaff() {
    if (this.chStaffing()) return;
    this.chError.set(null);
    this.chStaffMsg.set(null);
    this.chStaffing.set(true);
    this.chActive.set(5);        // light up Stage 5 on the dashboard
    const method = this.chStaffMethod;
    let total = 0, found = 0, staff = 0;
    try {
      for (;;) {
        const r = await firstValueFrom(this.api.chFindStaff(method));
        total += r.processed;
        found += r.found;
        staff += r.staff;
        this.chProgress.set({ processed: total, remaining: r.remaining, done: r.done });
        this.loadChPipeline();
        if (r.ratelimited) {
          this.chStaffMsg.set(`Paused — DuckDuckGo rate-limited the search after ${total}. Wait a minute and run ⑤ again to continue (${r.remaining} left).`);
          break;
        }
        if (r.done || r.processed === 0) {
          this.chStaffMsg.set(`Done — checked ${total}, found ${found} company page${found === 1 ? '' : 's'} and ${staff} staff profile${staff === 1 ? '' : 's'}.`);
          break;
        }
        this.chStaffMsg.set(`Checked ${total} (${found} pages, ${staff} staff)… ${r.remaining} to go.`);
      }
    } catch (e: any) {
      this.chError.set(e?.error?.error || 'LinkedIn lookup failed.');
    } finally {
      this.chStaffing.set(false);
      this.chActive.set(null);
      this.chProgress.set(null);
      this.loadChPipeline();
    }
  }

  /** Bundled enrichment — walk every record (cursor via last_id) and fill any
   *  missing info (directors / website / phone / LinkedIn) with the searches we
   *  have, one at a time. Re-runnable to re-check records whose data may since
   *  have appeared. */
  async doQualify() {
    if (this.chQualifying()) return;
    this.chError.set(null);
    this.chQualifyMsg.set(null);
    this.chQualifying.set(true);
    this.chActive.set(2);
    let after = 0, total = 0, enriched = 0;
    const found: ChFoundCounts = { directors: 0, industry: 0, address: 0, website: 0, phone: 0, email: 0, linkedin: 0, staff: 0 };
    this.chLastRun.set({ checked: 0, enriched: 0, found: { ...found }, running: true });
    try {
      for (;;) {
        const r = await firstValueFrom(this.api.chQualify({
          after_id: after, source: this.sourceKey(),
          limit: this.chQualifyLinkedin === 'cookie' ? 2 : 4,
          google_method: this.chQualifyGoogle,
          linkedin_method: this.chQualifyLinkedin,
        }));
        total += r.processed; enriched += r.enriched; after = r.last_id;
        found.directors += r.found.directors; found.industry += r.found.industry ?? 0; found.address += r.found.address ?? 0;
        found.website += r.found.website; found.phone += r.found.phone;
        found.email += r.found.email ?? 0; found.linkedin += r.found.linkedin; found.staff += r.found.staff;
        this.chLastRun.set({ checked: total, enriched, found: { ...found }, running: true });
        this.chProgress.set({ processed: total, remaining: r.remaining, done: r.done });
        this.loadChPipeline();
        if (r.done || r.processed === 0) {
          this.chQualifyMsg.set(`Done — checked ${total} record${total === 1 ? '' : 's'}, ${enriched} gained new info.`);
          break;
        }
        this.chQualifyMsg.set(`Checked ${total} (${enriched} enriched)… ${r.remaining} to go.`);
      }
    } catch (e: any) {
      this.chError.set(e?.error?.error || 'Qualify failed.');
    } finally {
      this.chQualifying.set(false);
      this.chActive.set(null);
      this.chProgress.set(null);
      this.chLastRun.update(lr => lr ? { ...lr, running: false } : lr);
      // Persist the run summary so the module survives a page reload.
      this.api.saveChLastRun({ checked: total, enriched, found, source: this.sourceKey() }).subscribe({ error: () => {} });
      this.loadChPipeline();
    }
  }

  setMapping(field: LeadField, columnIndex: number) {
    this.mapping.set({ ...this.mapping(), [field]: columnIndex });
  }

  onDragOver(e: DragEvent) { e.preventDefault(); this.dragging.set(true); }
  onDragLeave(e: DragEvent) { e.preventDefault(); this.dragging.set(false); }
  onDrop(e: DragEvent) {
    e.preventDefault();
    this.dragging.set(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) this.parseFile(f);
  }
  onFileChange(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) this.parseFile(f);
  }

  private async parseFile(file: File) {
    this.parsing.set(true);
    this.parseError.set(null);
    this.importResult.set(null);
    this.filename.set(file.name);
    try {
      const buf = await file.arrayBuffer();
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error('No sheets found in workbook');
      const all = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false, defval: '' });
      if (all.length === 0) throw new Error('Sheet is empty');

      const headerIdx = this.findHeaderRowIndex(all);
      const headerRow = (all[headerIdx] ?? []).map(c => String(c ?? '').trim());
      const dataRows = all.slice(headerIdx + 1)
        .filter(r => Array.isArray(r) && r.some(c => c != null && String(c).trim() !== ''));

      this.headers.set(headerRow);
      this.rows.set(dataRows);
      this.mapping.set(this.autoMap(headerRow));
    } catch (e: any) {
      this.parseError.set(e?.message || 'Failed to parse file');
      this.rows.set([]);
      this.headers.set([]);
    } finally {
      this.parsing.set(false);
    }
  }

  /** Scan the first ~10 rows; pick the first one that looks like headers
   *  (≥ 2 cells matching known keywords). Falls back to row 0. */
  private findHeaderRowIndex(rows: any[][]): number {
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;
      const matches = row.filter(c => {
        if (typeof c !== 'string') return false;
        const s = c.toLowerCase();
        return HEADER_KEYWORDS.some(kw => s.includes(kw));
      }).length;
      if (matches >= 2) return i;
    }
    return 0;
  }

  /** Best-effort header → field mapping. User can override in the UI. */
  private autoMap(headers: string[]): Mapping {
    const map = this.emptyMapping();
    for (const field of Object.keys(FIELD_PATTERNS) as LeadField[]) {
      for (let i = 0; i < headers.length; i++) {
        if (map[field] !== -1) break;
        const h = headers[i] || '';
        if (FIELD_PATTERNS[field].some(p => p.test(h))) {
          // skip columns already claimed by a higher-priority field
          if (Object.values(map).includes(i)) continue;
          map[field] = i;
        }
      }
    }
    return map;
  }

  private emptyMapping(): Mapping {
    return { name: -1, email: -1, phone: -1, company: -1, address: -1, url: -1, status: -1, source: -1 };
  }

  private buildLeads(rows: any[][], mapping: Mapping): Partial<Lead>[] {
    const out: Partial<Lead>[] = [];
    for (const row of rows) {
      const get = (idx: number) => idx < 0 ? '' : String(row[idx] ?? '').trim();
      const personName = get(mapping.name);
      const company    = get(mapping.company);
      // Accept any row that has SOMETHING to identify the lead — a person
      // name OR a company name. Lists of newly-established providers
      // typically only have the business name at this stage; dropping
      // them because there's no human contact yet loses 90%+ of the
      // dataset. When no person is supplied we use the company as the
      // lead's display name so the row is still saveable + searchable.
      if (!personName && !company) continue;
      const name = personName || company;
      const email = get(mapping.email);
      const rawStatus = get(mapping.status).toLowerCase();
      const status = (ALLOWED_STATUSES as string[]).includes(rawStatus)
        ? (rawStatus as LeadStatus)
        : this.defaultStatus;
      out.push({
        name,
        email:   email || undefined,
        phone:   get(mapping.phone)   || undefined,
        company: company || undefined,
        address: get(mapping.address) || undefined,
        url:     get(mapping.url)     || undefined,
        status,
        source:  get(mapping.source)  || this.defaultSource || undefined,
      });
    }
    return out;
  }

  leadValue(l: Partial<Lead>, key: LeadField): string {
    const v = (l as any)[key];
    return v == null ? '' : String(v);
  }

  doImport() {
    const leads = this.validLeads();
    if (leads.length === 0) return;
    this.importing.set(true);
    this.importError.set(null);
    this.importResult.set(null);
    this.api.bulkCreateLeads(leads).subscribe({
      next: r => {
        this.importing.set(false);
        this.importResult.set(r);
      },
      error: e => {
        this.importing.set(false);
        this.importError.set(e?.error?.error || 'Import failed');
      },
    });
  }

  reset() {
    this.filename.set('');
    this.rows.set([]);
    this.headers.set([]);
    this.mapping.set(this.emptyMapping());
    this.defaultSource = '';
    this.defaultStatus = 'new';
    this.parseError.set(null);
    this.importError.set(null);
    this.importResult.set(null);
    this.aiLeads.set([]);
    this.aiPrompt = '';
    this.aiError.set(null);
  }
}

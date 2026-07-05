import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { DialogService } from '../../core/dialog';
import { AppSettings, InvoiceTemplate } from '../../core/models';
import { SettingsService } from '../../core/settings.service';

/**
 * Settings → Invoices tab.
 *
 * All fields persist under the `invoice.*` namespace of the existing
 * key-value settings table — no new backend needed. The InvoiceDetailModal
 * reads these on open so both the PDF drawer and the "View PDF" HTML tab
 * use them (business identity in the header, PAID TO block from the bank
 * fields, signature block from signature_name + signature_font).
 *
 * template_style is a placeholder for future layout variants; for now
 * only "modern" ships.
 */
type InvoiceSettings = {
  business_name: string;
  business_address: string;
  business_email: string;
  business_phone: string;
  business_website: string;
  /** Override for the invoice header logo. Blank = reuse the org-wide
   *  `brand_logo_url` from Settings → General. */
  logo_url: string;

  bank_name: string;
  bank_account_name: string;
  bank_account_number: string;
  bank_sort_code: string;
  show_bank_details: '0' | '1';

  signature_name: string;
  signature_font: 'italic' | 'bold' | 'script';

  tax_label: string;
  template_style: 'modern';
};

@Component({
  selector: 'app-settings-invoices',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section>
      <h2>Invoices</h2>
      <p class="muted small">
        Business identity, payment details and signature applied to every
        invoice PDF, email and printable view.
      </p>

      <h3>Business identity</h3>
      <p class="muted small">
        Shown in the invoice header + footer, and on the "Bill to" side
        of the sheet's recipient block.
      </p>

      <label>Business name</label>
      <input [(ngModel)]="draft.business_name" name="biz_name" placeholder="Your Business Ltd" />

      <label>Address</label>
      <textarea [(ngModel)]="draft.business_address" name="biz_addr" rows="3"
                placeholder="5 Martin Pl&#10;Sydney NSW 2000&#10;Australia"></textarea>

      <div class="row two-col">
        <div>
          <label>Contact email</label>
          <input type="email" [(ngModel)]="draft.business_email" name="biz_em" placeholder="email@example.com" />
        </div>
        <div>
          <label>Phone</label>
          <input [(ngModel)]="draft.business_phone" name="biz_ph" placeholder="+44 20 1234 5678" />
        </div>
      </div>

      <label>Website</label>
      <input [(ngModel)]="draft.business_website" name="biz_web" placeholder="www.example.com" />

      <label>Logo URL <span class="muted small" style="text-transform: none; letter-spacing: normal;">(overrides your organisation logo for invoices only — leave blank to reuse it)</span></label>
      <input [(ngModel)]="draft.logo_url" name="biz_logo" placeholder="https://example.com/invoice-logo.png" />

      <hr />

      <h3>Bank details (PAID TO block)</h3>
      <p class="muted small">
        Appears as the "PAID TO" section on the invoice when the toggle
        below is on. Leave blank to hide the block entirely.
      </p>

      <label class="inline-toggle">
        <input type="checkbox" name="show_bank"
               [checked]="draft.show_bank_details === '1'"
               (change)="draft.show_bank_details = ($any($event.target).checked ? '1' : '0')" />
        Show PAID TO block on invoices
        <span class="muted small inline-hint">
          When off, bank fields are still saved but not printed on the PDF.
        </span>
      </label>

      <label>Bank name</label>
      <input [(ngModel)]="draft.bank_name" name="bnk_name" placeholder="HSBC UK" />

      <div class="row two-col">
        <div>
          <label>Account name</label>
          <input [(ngModel)]="draft.bank_account_name" name="bnk_holder" placeholder="Your Business Ltd" />
        </div>
        <div>
          <label>Account number</label>
          <input [(ngModel)]="draft.bank_account_number" name="bnk_acct" placeholder="12345678" />
        </div>
      </div>

      <label>Sort code / routing</label>
      <input [(ngModel)]="draft.bank_sort_code" name="bnk_sort" placeholder="12-34-56" style="max-width: 260px;" />

      <hr />

      <h3>Signature</h3>
      <p class="muted small">
        Rendered under "Issued by, signature" on the invoice. Uses a font
        style — no image upload needed.
      </p>

      <label>Signature name</label>
      <input [(ngModel)]="draft.signature_name" name="sig_name" placeholder="Bobby Jackson" />

      <label>Signature font style</label>
      <select [(ngModel)]="draft.signature_font" name="sig_font" style="max-width: 260px;">
        <option value="italic">Italic (Times, cursive)</option>
        <option value="bold">Bold script look</option>
        <option value="script">Handwritten (Courier italic)</option>
      </select>

      <hr />

      <h3>Layout</h3>

      <div class="row two-col">
        <div>
          <label>Tax label</label>
          <input [(ngModel)]="draft.tax_label" name="tax_label" placeholder="VAT / GST / Tax" />
          <p class="muted small">Used in the totals block ("VAT 20% from £100 …").</p>
        </div>
        <div>
          <label>Template style</label>
          <select [(ngModel)]="draft.template_style" name="tpl">
            <option value="modern">Modern (default)</option>
          </select>
          <p class="muted small">More templates coming.</p>
        </div>
      </div>

      <div class="actions">
        <button class="primary" (click)="save()" [disabled]="saving()">
          {{ saving() ? 'Saving…' : 'Save invoice settings' }}
        </button>
        @if (saved()) { <span class="muted small">Saved.</span> }
      </div>
    </section>

    <!-- ─── Templates section ──────────────────────────────────
         Uploaded HTML templates are rendered server-side with
         mustache-style {{var}} + {{#lines}}…{{/lines}} substitution.
         The template flagged as Default drives the Download / View
         PDF flow on the client Invoices tab; if no template is set
         as default, the built-in "Modern" layout is used. -->
    <section class="templates-section">
      <h2>Templates</h2>
      <p class="muted small" ngNonBindable>
        Upload your own HTML invoice template. Use
        <code>{{variable}}</code> placeholders
        (e.g. <code>{{invoice_number}}</code>,
        <code>{{bill_to_name}}</code>,
        <code>{{total}}</code>) and wrap the
        line-item row in
        <code>{{#lines}} … {{/lines}}</code>.
      </p>

      <div class="tpl-editor">
        <label>Template name</label>
        <input [(ngModel)]="tplDraft.name" name="tpl_name" placeholder="e.g. Modern gold, GST invoice, …" />

        <label style="margin-top: 12px;">Import an HTML file</label>
        <div class="file-row">
          <input #tplFile type="file" accept=".html,.htm,text/html"
                 (change)="onTemplateFileChosen($event)" style="display:none;" />
          <button type="button" class="ghost" (click)="tplFile.click()">Choose file…</button>
          <span class="muted small">
            {{ tplFileName() || 'or paste HTML into the box below' }}
          </span>
        </div>

        <label style="margin-top: 12px;">Template HTML</label>
        <textarea [(ngModel)]="tplDraft.html" name="tpl_html" rows="10"
                  [placeholder]="templatePlaceholder"></textarea>

        <label class="inline-toggle">
          <input type="checkbox" name="tpl_default"
                 [checked]="!!tplDraft.is_default"
                 (change)="tplDraft.is_default = $any($event.target).checked" />
          Set as default template
          <span class="muted small inline-hint">
            Used automatically when downloading / viewing invoice PDFs.
          </span>
        </label>

        <div class="actions">
          <button class="primary" (click)="saveTemplate()" [disabled]="tplSaving() || !tplDraft.name || !tplDraft.html">
            {{ tplSaving() ? 'Saving…' : (tplDraft.id ? 'Update template' : 'Add template') }}
          </button>
          @if (tplDraft.id) {
            <button class="ghost" (click)="resetTplDraft()">Cancel edit</button>
          }
        </div>
      </div>

      <h3 style="margin-top: 24px;">Saved templates</h3>
      @if (templatesLoading()) {
        <p class="muted small">Loading…</p>
      } @else if (templates().length === 0) {
        <p class="muted small">No custom templates yet.</p>
      } @else {
        <ul class="tpl-list">
          @for (t of templates(); track t.id) {
            <li>
              <div class="tpl-info">
                <strong>{{ t.name }}</strong>
                @if (t.is_default) { <span class="chip default">Default</span> }
              </div>
              <div class="tpl-actions">
                @if (!t.is_default) {
                  <button class="ghost small" (click)="setDefault(t)">Make default</button>
                }
                <button class="ghost small" (click)="editTemplate(t)">Edit</button>
                <button class="ghost small danger" (click)="deleteTemplate(t)">Delete</button>
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [`
    section { padding: 8px 4px; }
    h2 { margin: 0 0 4px; }
    h3 { margin: 22px 0 6px; font-size: 14px; color: var(--fg); }
    hr { border: none; border-top: 1px solid var(--line); margin: 22px 0; }
    label { display: block; margin: 12px 0 4px; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    input, textarea, select { width: 100%; padding: 8px 10px; background: var(--bg-2); border: 1px solid var(--line); color: var(--fg); border-radius: var(--radius-sm); font: inherit; }
    input:focus, textarea:focus, select:focus { outline: none; border-color: var(--primary); }
    textarea { resize: vertical; min-height: 68px; }
    .row.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .inline-toggle { display: flex; align-items: center; gap: 8px; margin: 14px 0; text-transform: none; letter-spacing: normal; font-size: 14px; color: var(--fg); white-space: nowrap; }
    .inline-toggle input { width: auto; }
    .inline-hint { margin-left: 6px; }
    .actions { margin-top: 24px; display: flex; align-items: center; gap: 12px; }
    .actions .primary { padding: 10px 20px; background: var(--primary); color: var(--bg); border: none; border-radius: var(--radius-sm); cursor: pointer; font-weight: 600; }
    .actions .primary[disabled] { opacity: 0.5; cursor: not-allowed; }
    .actions .ghost { padding: 10px 16px; background: transparent; color: var(--fg); border: 1px solid var(--line); border-radius: var(--radius-sm); cursor: pointer; }

    /* ── Templates ────────────────────────────────────────────── */
    .templates-section { padding: 8px 4px; margin-top: 22px; border-top: 1px solid var(--line); padding-top: 22px; }
    .templates-section code {
      background: var(--bg-3); padding: 1px 6px; border-radius: 3px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11px; color: var(--primary);
    }
    .tpl-editor { background: var(--bg-2); border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 16px; margin-top: 12px; }
    .tpl-editor textarea { min-height: 200px; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; }
    .file-row { display: flex; align-items: center; gap: 10px; }
    .file-row .ghost { padding: 6px 12px; background: transparent; color: var(--fg); border: 1px solid var(--line); border-radius: var(--radius-sm); cursor: pointer; }
    .tpl-list { list-style: none; padding: 0; margin: 12px 0 0; display: flex; flex-direction: column; gap: 8px; }
    .tpl-list li {
      display: flex; align-items: center; gap: 12px;
      padding: 12px 14px; background: var(--bg-2);
      border: 1px solid var(--line); border-radius: var(--radius-sm);
    }
    .tpl-info { display: flex; align-items: center; gap: 10px; flex: 1; }
    .tpl-info strong { color: var(--fg); }
    .tpl-info .chip.default {
      padding: 2px 8px; border-radius: 999px; font-size: 11px;
      color: var(--primary); border: 1px solid var(--primary);
      background: rgba(212,169,58,0.12); font-weight: 600;
      letter-spacing: 0.3px;
    }
    .tpl-actions { display: flex; gap: 4px; }
    .tpl-actions .ghost {
      padding: 4px 10px; background: transparent; color: var(--fg);
      border: 1px solid var(--line); border-radius: var(--radius-sm);
      cursor: pointer; font-size: 12px;
    }
    .tpl-actions .ghost:hover { border-color: var(--primary); color: var(--primary); }
    .tpl-actions .ghost.danger:hover { border-color: var(--danger); color: var(--danger); }
  `],
})
export class SettingsInvoices implements OnInit {
  private api = inject(Api);
  private settings = inject(SettingsService);
  private dialog = inject(DialogService);

  saving = signal(false);
  saved = signal(false);

  // ── Templates state ─────────────────────────────────────────────
  templates = signal<InvoiceTemplate[]>([]);
  templatesLoading = signal(false);
  tplSaving = signal(false);
  /** Name of the file the user picked (if any). Shown next to the
   *  "Choose file…" button. Cleared when they paste HTML manually. */
  tplFileName = signal<string | null>(null);
  /** Editor draft — id populated when editing an existing row. */
  tplDraft: { id?: number; name: string; html: string; is_default: boolean } = {
    name: '', html: '', is_default: false,
  };

  /** Textarea placeholder — kept as a class field because Angular
   *  parses {{ ... }} in template attribute strings and would otherwise
   *  treat the mustache examples as expression bindings. */
  readonly templatePlaceholder =
    `<!doctype html>
<html><body>
  <h1>Invoice {{invoice_number}}</h1>
  <p>Bill to: {{bill_to_name}}</p>
  <table><tbody>
    {{#lines}}
      <tr><td>{{description}}</td><td>{{quantity}}</td>
          <td>{{unit_price}}</td><td>{{line_total}}</td></tr>
    {{/lines}}
  </tbody></table>
  <p>Total: {{total}}</p>
</body></html>`;

  /** All fields flat + editable via ngModel. Loaded from the tenant's
   *  key-value settings on init (namespace `invoice.*`) and written back
   *  on Save via the same PUT /api/settings endpoint. */
  draft: InvoiceSettings = {
    business_name: '',
    business_address: '',
    business_email: '',
    business_phone: '',
    business_website: '',
    logo_url: '',
    bank_name: '',
    bank_account_name: '',
    bank_account_number: '',
    bank_sort_code: '',
    show_bank_details: '1',
    signature_name: '',
    signature_font: 'italic',
    tax_label: 'VAT',
    template_style: 'modern',
  };

  ngOnInit() {
    this.loadTemplates();
    const s = this.settings.settings() ?? {};
    this.draft = {
      business_name:       (s['invoice.business_name']       as string) || '',
      business_address:    (s['invoice.business_address']    as string) || '',
      business_email:      (s['invoice.business_email']      as string) || '',
      business_phone:      (s['invoice.business_phone']      as string) || '',
      business_website:    (s['invoice.business_website']    as string) || '',
      logo_url:            (s['invoice.logo_url']            as string) || '',
      bank_name:           (s['invoice.bank_name']           as string) || '',
      bank_account_name:   (s['invoice.bank_account_name']   as string) || '',
      bank_account_number: (s['invoice.bank_account_number'] as string) || '',
      bank_sort_code:      (s['invoice.bank_sort_code']      as string) || '',
      show_bank_details:  ((s['invoice.show_bank_details'] as string) === '0') ? '0' : '1',
      signature_name:      (s['invoice.signature_name']      as string) || '',
      signature_font:     ((s['invoice.signature_font']     as any) as InvoiceSettings['signature_font']) || 'italic',
      tax_label:           (s['invoice.tax_label']           as string) || 'VAT',
      template_style:     ((s['invoice.template_style']     as any) as InvoiceSettings['template_style']) || 'modern',
    };
  }

  save() {
    if (this.saving()) return;
    this.saving.set(true);
    this.saved.set(false);
    const patch: AppSettings = {
      'invoice.business_name':       this.draft.business_name,
      'invoice.business_address':    this.draft.business_address,
      'invoice.business_email':      this.draft.business_email,
      'invoice.business_phone':      this.draft.business_phone,
      'invoice.business_website':    this.draft.business_website,
      'invoice.logo_url':            this.draft.logo_url,
      'invoice.bank_name':           this.draft.bank_name,
      'invoice.bank_account_name':   this.draft.bank_account_name,
      'invoice.bank_account_number': this.draft.bank_account_number,
      'invoice.bank_sort_code':      this.draft.bank_sort_code,
      'invoice.show_bank_details':   this.draft.show_bank_details,
      'invoice.signature_name':      this.draft.signature_name,
      'invoice.signature_font':      this.draft.signature_font,
      'invoice.tax_label':           this.draft.tax_label,
      'invoice.template_style':      this.draft.template_style,
    };
    this.settings.update(patch).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.set(true);
        // Fade the "Saved." confirmation after a moment so it doesn't
        // sit forever after a successful write.
        setTimeout(() => this.saved.set(false), 3000);
      },
      error: (e: any) => {
        this.saving.set(false);
        this.dialog.alert(e?.error?.error || 'Save failed', { title: 'Settings', variant: 'danger' });
      },
    });
  }

  // ── Templates ────────────────────────────────────────────────────

  loadTemplates() {
    this.templatesLoading.set(true);
    this.api.listInvoiceTemplates().subscribe({
      next: r => { this.templates.set(r.templates || []); this.templatesLoading.set(false); },
      error: () => { this.templates.set([]); this.templatesLoading.set(false); },
    });
  }

  /** File input change: read the picked .html file into the textarea
   *  so the user can review + tweak it before saving. Also pre-fills
   *  the template name from the filename when the name field is empty. */
  onTemplateFileChosen(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.tplFileName.set(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      this.tplDraft.html = String(reader.result ?? '');
      if (!this.tplDraft.name) {
        // Strip extension for a sensible default.
        this.tplDraft.name = file.name.replace(/\.[a-z]+$/i, '');
      }
    };
    reader.onerror = () => {
      this.dialog.alert('Could not read the file.', { title: 'Upload', variant: 'danger' });
    };
    reader.readAsText(file);
    // Reset the input so re-picking the same file re-fires (change).
    input.value = '';
  }

  saveTemplate() {
    if (this.tplSaving()) return;
    const draft = this.tplDraft;
    if (!draft.name.trim() || !draft.html.trim()) return;
    this.tplSaving.set(true);

    const done = () => {
      this.tplSaving.set(false);
      this.resetTplDraft();
      this.loadTemplates();
    };
    const err = (e: any) => {
      this.tplSaving.set(false);
      this.dialog.alert(e?.error?.error || 'Save failed', { title: 'Template', variant: 'danger' });
    };

    if (draft.id) {
      this.api.updateInvoiceTemplate(draft.id, {
        name: draft.name,
        html: draft.html,
        is_default: draft.is_default ? 1 : 0,
      }).subscribe({ next: done, error: err });
    } else {
      this.api.createInvoiceTemplate({
        name: draft.name,
        html: draft.html,
        is_default: draft.is_default,
      }).subscribe({ next: done, error: err });
    }
  }

  resetTplDraft() {
    this.tplDraft = { name: '', html: '', is_default: false };
    this.tplFileName.set(null);
  }

  /** Populate the editor with an existing row so the user can tweak
   *  the HTML. We refetch to get the full html (list endpoint omits it). */
  editTemplate(t: InvoiceTemplate) {
    if (!t.id) return;
    this.api.getInvoiceTemplate(t.id).subscribe({
      next: r => {
        this.tplDraft = {
          id: r.template.id,
          name: r.template.name,
          html: r.template.html ?? '',
          is_default: !!r.template.is_default,
        };
        this.tplFileName.set(null);
        // Scroll editor into view for large lists.
        setTimeout(() => {
          document.querySelector('.tpl-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 0);
      },
      error: (e: any) => this.dialog.alert(e?.error?.error || 'Load failed', { title: 'Template', variant: 'danger' }),
    });
  }

  async deleteTemplate(t: InvoiceTemplate) {
    if (!t.id) return;
    const ok = await this.dialog.confirm(`Delete template "${t.name}"?`, {
      title: 'Delete template', confirmLabel: 'Delete', variant: 'danger',
    });
    if (!ok) return;
    this.api.deleteInvoiceTemplate(t.id).subscribe({
      next: () => this.loadTemplates(),
      error: (e: any) => this.dialog.alert(e?.error?.error || 'Delete failed', { title: 'Template', variant: 'danger' }),
    });
  }

  setDefault(t: InvoiceTemplate) {
    if (!t.id) return;
    this.api.setDefaultInvoiceTemplate(t.id).subscribe({
      next: () => this.loadTemplates(),
      error: (e: any) => this.dialog.alert(e?.error?.error || 'Update failed', { title: 'Template', variant: 'danger' }),
    });
  }
}

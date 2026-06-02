import { Component, Input, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Api } from '../../core/api';
import { environment } from '@env/environment';
import { FormDef } from '../../core/models';
import { SidePanel } from '../../layout/side-panel.service';

@Component({
  selector: 'app-form-detail-panel',
  template: `
    <div class="col">
      <div>
        <label>Public URL</label>
        @if (form.is_published) {
          <a [href]="publicUrl()" target="_blank">{{ publicUrl() }}</a>
        } @else {
          <p class="muted small">Form is in draft. Publish it from the editor to enable the public URL.</p>
        }
      </div>

      <div>
        <label>Embed code</label>
        <pre class="code-block">{{ embedCode() }}</pre>
        <div style="height:8px"></div>
        <button class="ghost" (click)="copy(embedCode())">{{ copied() ? '✓ Copied' : 'Copy' }}</button>
      </div>

      <div>
        <label>Description</label>
        <p>{{ form.description || 'No description.' }}</p>
      </div>

      <div class="row">
        <button class="primary" (click)="edit()">Edit form</button>
        <button (click)="viewSubs()">View submissions</button>
        <span class="spacer"></span>
        <button class="danger" (click)="del()">Delete</button>
      </div>
    </div>
  `,
})
export class FormDetailPanel {
  @Input({ required: true }) form!: FormDef;
  @Input() onDeleted?: () => void;

  private api = inject(Api);
  private router = inject(Router);
  private panel = inject(SidePanel);
  copied = signal(false);

  publicUrl = () => `${location.origin}${environment.basePath}/forms/${this.form.slug}`;
  embedCode = () =>
    `<iframe src="${this.publicUrl()}" width="100%" height="650" style="border:0"></iframe>`;

  copy(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    });
  }
  edit() { this.panel.close(); this.router.navigate(['/admin/forms', this.form.id, 'edit']); }
  viewSubs() { this.panel.close(); this.router.navigate(['/admin/forms', this.form.id, 'submissions']); }
  del() {
    if (!confirm(`Delete form "${this.form.title}"? This drops the table form_${this.form.slug} and all submissions.`)) return;
    this.api.deleteForm(this.form.id!).subscribe(() => this.onDeleted?.());
  }
}

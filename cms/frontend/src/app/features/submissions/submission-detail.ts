import { Component, Input, inject } from '@angular/core';
import { Api } from '../../core/api';
import { FormField } from '../../core/models';
import { environment } from '@env/environment';

@Component({
  selector: 'app-submission-detail',
  template: `
    <div class="col">
      <div class="row muted small">
        <span>Submitted {{ row.submitted_at }}</span>
        <span class="spacer"></span>
        <span>IP {{ row.ip_address || '—' }}</span>
      </div>
      @for (f of fields; track f.id) {
        <div>
          <label>{{ f.label }}</label>
          @if (f.type === 'file' && row[f.name]) {
            <a [href]="filePath(row[f.name])" target="_blank">{{ row[f.name] }}</a>
          } @else if (f.type === 'checkbox' && row[f.name]) {
            <div>{{ formatCheckbox(row[f.name]) }}</div>
          } @else {
            <div style="white-space: pre-wrap;">{{ row[f.name] || '—' }}</div>
          }
        </div>
      }
      <div class="row" style="margin-top:20px;">
        <span class="spacer"></span>
        <button class="danger" (click)="del()">Delete submission</button>
      </div>
    </div>
  `,
})
export class SubmissionDetail {
  @Input({ required: true }) formId!: number;
  @Input({ required: true }) row!: any;
  @Input({ required: true }) fields!: FormField[];
  @Input() onDeleted?: () => void;

  private api = inject(Api);

  filePath(rel: string) { return `${environment.basePath}/storage/${rel}`; }
  formatCheckbox(v: any) {
    try { const arr = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(arr) ? arr.join(', ') : String(v); }
    catch { return String(v); }
  }
  del() {
    if (!confirm('Delete this submission?')) return;
    this.api.deleteSubmission(this.formId, this.row.id).subscribe(() => this.onDeleted?.());
  }
}

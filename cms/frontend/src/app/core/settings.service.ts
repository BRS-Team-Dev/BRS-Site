import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { Api } from './api';
import { AppSettings } from './models';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private api = inject(Api);
  private _settings = signal<AppSettings | null>(null);
  private _loading = false;

  readonly settings = this._settings.asReadonly();

  readonly brandName = computed(
    () => (this._settings()?.brand_name ?? '').trim() || 'BuiltRightStudio'
  );
  readonly brandLogoUrl = computed(
    () => (this._settings()?.brand_logo_url ?? '').trim()
  );
  readonly brandInitials = computed(() => {
    const name = this.brandName();
    const caps = name.replace(/[^A-Z]/g, '');
    if (caps.length >= 2) return caps.slice(0, 2);
    return name.slice(0, 2).toUpperCase() || 'BR';
  });

  load(): Observable<{ settings: AppSettings }> {
    return this.api.getSettings().pipe(tap(r => this._settings.set(r.settings)));
  }

  ensureLoaded(): void {
    if (this._settings() === null && !this._loading) {
      this._loading = true;
      this.load().subscribe({
        next: () => { this._loading = false; },
        error: () => { this._loading = false; },
      });
    }
  }

  update(patch: AppSettings): Observable<{ ok: boolean }> {
    return this.api.updateSettings(patch).pipe(tap(() => {
      const merged: AppSettings = { ...(this._settings() ?? {}), ...patch };
      if (patch.smtp_pass && patch.smtp_pass !== '••••••••') {
        merged.smtp_pass = '••••••••';
      }
      this._settings.set(merged);
    }));
  }
}

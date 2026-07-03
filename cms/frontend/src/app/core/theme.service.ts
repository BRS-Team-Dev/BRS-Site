import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Auth } from './auth';
import { Api } from './api';
import { CustomTheme } from './models';

/** All theme slugs the SPA knows how to render. Mirrors the six
 *  `:root[data-theme="…"]` blocks in `styles.scss`. Kept in sync
 *  with the signup form's 6 panels + the settings picker. */
export const TENANT_THEMES = [
  'midnight-gold',
  'frosted-mint',
  'sunrise-coral',
  'indigo-pulse',
  'graphite-rose',
  'forest-amber',
] as const;
export type TenantTheme = typeof TENANT_THEMES[number];
const DEFAULT_THEME: TenantTheme = 'midnight-gold';

/** localStorage key for the per-tenant custom theme cache. Bumped
 *  whenever ThemeService.refreshCustoms writes fresh data. Cache TTL
 *  is 24h — expired entries are refetched, valid entries are used
 *  synchronously on boot so the paint doesn't flicker. */
const CACHE_KEY   = (tenantId: number | string) => `brs.themes.tenant.${tenantId}`;
const CACHE_TTL_H = 24;
/** Slug of the <style> element the applier writes CSS variables into
 *  when the active theme is a tenant-defined custom. Removing this
 *  element = reverting to a preset. */
const CUSTOM_STYLE_EL_ID = 'brs-custom-theme-vars';

/** Human-readable labels + swatch hints for the picker UI. The hex
 *  values mirror each theme's `--primary` + `--bg` so the picker
 *  panels reproduce the in-app feel without re-rendering the whole
 *  shell. */
export const THEME_META: Record<TenantTheme, { label: string; primary: string; bg: string; mood: string }> = {
  'midnight-gold':  { label: 'Midnight Gold',  primary: '#d4a93a', bg: '#0a0a0a', mood: 'Dark · Bold' },
  'frosted-mint':   { label: 'Frosted Mint',   primary: '#2fc28b', bg: '#f4fbf8', mood: 'Light · Fresh' },
  'sunrise-coral':  { label: 'Sunrise Coral',  primary: '#ff6b50', bg: '#fff4ec', mood: 'Light · Warm' },
  'indigo-pulse':   { label: 'Indigo Pulse',   primary: '#7aa9ff', bg: '#1a1b3a', mood: 'Dark · Cool' },
  'graphite-rose':  { label: 'Graphite Rose',  primary: '#e88aa7', bg: '#2a2a2e', mood: 'Dark · Soft' },
  'forest-amber':   { label: 'Forest Amber',   primary: '#f5b04a', bg: '#0f1a14', mood: 'Dark · Earthy' },
};

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private auth = inject(Auth);
  private api  = inject(Api);

  /** The currently-applied theme slug. May be a built-in preset OR a
   *  tenant custom slug (`custom-…`). Drives [data-theme] on <html>
   *  and, for customs, an injected <style> element on <head>. */
  readonly theme = signal<string>(this.resolveInitial());

  /** In-memory copy of the tenant's custom themes. Loaded from
   *  localStorage synchronously at boot (so we can paint the right
   *  colours on the first frame) and refreshed from the API in the
   *  background. Empty when the tenant has no customs. */
  readonly customs = signal<CustomTheme[]>(this.readCache());

  constructor() {
    // Defensive: never let a boot-time throw here take down the app.
    // ThemeService is a root singleton — if this constructor errors,
    // every component that transitively injects it (Shell → outlet
    // children) becomes unrenderable, which manifests as blank pages
    // across the whole admin. Wrap so worst case is the default theme.
    try {
      this.apply(this.theme());
    } catch {
      document.documentElement.setAttribute('data-theme', DEFAULT_THEME);
    }
    // Re-apply whenever the tenant payload OR the user record changes
    // — handles login, logout, impersonation, switch-back, and any
    // tenant-default rewrite from the org Settings picker without
    // explicit wiring at call sites.
    //
    // Resolution: per-user override (admin_users.color_theme) wins; if
    // unset, fall back to the tenant default (tenants.color_theme); if
    // that's unset, fall back to Midnight Gold.
    effect(() => {
      try {
        const userSlug   = this.auth.user()?.color_theme;
        const tenantSlug = this.auth.tenant()?.color_theme;
        // Read customs untracked — we don't want cache/API updates
        // that change customs() to re-fire this effect. refreshCustoms
        // handles its own re-apply after a successful fetch.
        const next = untracked(() => this.normalize(userSlug || tenantSlug));
        if (next !== untracked(this.theme)) {
          this.theme.set(next);
          untracked(() => this.apply(next));
        }
        // Kick a background refresh once we know the user is logged in.
        // Fires at most once per boot; refreshCustoms itself is idempotent.
        if (this.auth.user() && !this.customsFetched) {
          this.customsFetched = true;
          queueMicrotask(() => this.refreshCustoms());
        }
      } catch (e) {
        // Never let a signal-graph error blank the app.
        // eslint-disable-next-line no-console
        console.warn('[ThemeService] effect error:', e);
      }
    });
  }

  private customsFetched = false;

  /** Set the theme locally + push to the document. Used by the
   *  settings picker for live preview before the PUT lands. Accepts
   *  either a built-in slug or a custom slug. */
  preview(slug: string): void {
    const next = this.normalize(slug);
    this.theme.set(next);
    this.apply(next);
  }

  /** Live-preview a theme that hasn't been saved yet — used by the
   *  "Create custom theme" modal so the whole app repaints as the
   *  user drags colour pickers. Doesn't touch this.customs. */
  previewVars(vars: Record<string, string>): void {
    this.applyVars(vars);
  }

  /** Undo previewVars() by re-applying whatever theme is currently
   *  selected. Called when the create-custom modal is cancelled. */
  restoreCurrent(): void {
    this.apply(this.theme());
  }

  /** Persist a theme choice for the current tenant — the org default
   *  every user sees unless they override. Accepts a built-in preset
   *  OR a tenant custom slug (`custom-…`). */
  saveTenantDefault(slug: string) {
    return this.api.updateThemeSetting(slug);
  }

  /** Persist a per-user override. Pass null to clear and fall back to
   *  the tenant default. Accepts custom slugs too. */
  saveUserOverride(slug: string | null) {
    return this.api.updateMyTheme(slug);
  }

  /** @deprecated use saveTenantDefault — kept for the existing pickers
   *  that haven't been split yet. */
  save(slug: string) {
    return this.saveTenantDefault(slug);
  }

  /** Apply a theme to the DOM. Built-in presets just set [data-theme]
   *  on <html> — the matching :root[data-theme=…] block in styles.scss
   *  does the rest. Custom slugs require injecting a <style> element
   *  with the tenant's variable map since we can't ship one CSS block
   *  per custom to the browser. */
  private apply(slug: string): void {
    if (this.isPreset(slug)) {
      document.documentElement.setAttribute('data-theme', slug);
      this.removeCustomStyleEl();
      return;
    }
    // Custom slug — look up the theme vars. Untracked read: apply() is
    // sometimes called from inside effects, and we don't want to add
    // customs() as a dependency of every caller's reactive context.
    const custom = untracked(() => this.customs()).find(t => t.slug === slug);
    if (!custom) {
      // The user has a custom slug set but we don't have the row —
      // stale cache or new device. Fall back to default and let the
      // background refetch pick it up.
      document.documentElement.setAttribute('data-theme', DEFAULT_THEME);
      this.removeCustomStyleEl();
      return;
    }
    // We keep [data-theme] on the closest base preset (dark = midnight
    // gold, light = frosted mint) so any un-overridden component styles
    // that key off `[data-theme="…"]` selectors still work. The custom
    // vars sit on top.
    const base = this.pickBase(custom.vars);
    document.documentElement.setAttribute('data-theme', base);
    this.applyVars(custom.vars);
  }

  /** Write the vars map via a single <style> element on <head>.
   *
   *  Specificity note: styles.scss defines each preset as
   *  `:root[data-theme="midnight-gold"] { --bg: … }` — specificity
   *  (0,1,1). If we wrote a plain `:root { --bg: red }` it would LOSE
   *  the cascade because the attribute selector out-specifies element-
   *  only. We match by targeting `:root[data-theme]` (any theme) so
   *  the specificity is equal (0,1,1) and our declaration wins by
   *  cascade order — <head>-appended after the compiled preset block.
   *  Each declaration also carries !important to defeat any per-component
   *  scoped preset overrides that key off the same attribute. */
  private applyVars(vars: Record<string, string>): void {
    let el = document.getElementById(CUSTOM_STYLE_EL_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = CUSTOM_STYLE_EL_ID;
      document.head.appendChild(el);
    }
    const body = Object.entries(vars)
      .filter(([k]) => k.startsWith('--'))
      .map(([k, v]) => `${k}:${v} !important;`)
      .join('');
    el.textContent = `:root[data-theme]{${body}}`;
  }

  private removeCustomStyleEl(): void {
    document.getElementById(CUSTOM_STYLE_EL_ID)?.remove();
  }

  /** For custom themes, pick the built-in slug whose base tone best
   *  matches so scoped :host [data-theme] rules still resolve. Falls
   *  back to midnight-gold. */
  private pickBase(vars: Record<string, string>): TenantTheme {
    const bg = (vars['--bg'] || '').replace('#', '').toLowerCase();
    if (bg.length !== 6) return DEFAULT_THEME;
    const r = parseInt(bg.slice(0, 2), 16);
    const g = parseInt(bg.slice(2, 4), 16);
    const b = parseInt(bg.slice(4, 6), 16);
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    return luminance > 128 ? 'frosted-mint' : 'midnight-gold';
  }

  private isPreset(slug: string | null | undefined): slug is TenantTheme {
    return (TENANT_THEMES as readonly string[]).includes(slug ?? '');
  }

  /** Boot-time best-effort: read the cached user + tenant payload so we
   *  paint the right theme on the first frame instead of flashing the
   *  default. User override beats tenant default. Never throws — a bad
   *  auth cache falls back to the default preset. */
  private resolveInitial(): string {
    try {
      const userSlug   = this.auth.user()?.color_theme;
      const tenantSlug = this.auth.tenant()?.color_theme;
      return this.normalize(userSlug || tenantSlug);
    } catch { return DEFAULT_THEME; }
  }

  /** Any string that's a preset OR matches a known custom slug survives;
   *  everything else falls back to DEFAULT_THEME. Checks the live
   *  in-memory list first (so optimistic updates work) and falls back
   *  to the localStorage cache for pre-boot resolution. */
  private normalize(slug: string | null | undefined): string {
    if (this.isPreset(slug)) return slug;
    if (!slug) return DEFAULT_THEME;
    if (this.customs().some(t => t.slug === slug)) return slug;
    if (this.readCache().some(t => t.slug === slug)) return slug;
    return DEFAULT_THEME;
  }

  // ─── Custom-theme CRUD + cache ─────────────────────────────────

  refreshCustoms(): void {
    // Defensive subscribe — any 401/5xx here must not propagate.
    try {
      this.api.listCustomThemes().subscribe({
        next: r => {
          try {
            const themes = r.themes ?? [];
            this.customs.set(themes);
            this.writeCache(themes);
            // Re-apply in case the stale-cache boot render used a fallback.
            this.apply(untracked(this.theme));
          } catch { /* swallow — theme UI degrades to default */ }
        },
        error: () => { /* no-op: keep whatever cache/default was applied */ },
      });
    } catch { /* HTTP interceptor / DI issue — non-fatal for theme */ }
  }

  createCustomThemeApi(input: { slug?: string; label: string; mood?: string | null; vars: Record<string, string> }) {
    return this.api.createCustomTheme(input);
  }
  updateCustomThemeApi(id: number, input: { slug?: string; label: string; mood?: string | null; vars: Record<string, string> }) {
    return this.api.updateCustomTheme(id, input);
  }
  deleteCustomTheme(id: number) {
    return this.api.deleteCustomTheme(id);
  }

  /** Read the cache synchronously so the boot render is instant.
   *  Returns [] on cache miss / expired / parse error. */
  private readCache(): CustomTheme[] {
    try {
      const tid = this.auth.tenant()?.id ?? 0;
      const raw = localStorage.getItem(CACHE_KEY(tid));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { themes: CustomTheme[]; savedAt: number };
      const ageH = (Date.now() - parsed.savedAt) / 3600000;
      if (ageH > CACHE_TTL_H) return [];
      return Array.isArray(parsed.themes) ? parsed.themes : [];
    } catch { return []; }
  }

  private writeCache(themes: CustomTheme[]): void {
    try {
      const tid = this.auth.tenant()?.id ?? 0;
      localStorage.setItem(CACHE_KEY(tid), JSON.stringify({ themes, savedAt: Date.now() }));
    } catch { /* quota exceeded — non-fatal */ }
  }
}

import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Shared chrome for public-facing pages (no app shell).
 *
 * Two components ship from this file:
 *   - <app-public-brand-banner>  the dark top banner with brand logo + name
 *   - <app-public-footer>        the dark site footer (4-column grid + legal row)
 *
 * Both are standalone — drop them into any public component's template and
 * the markup + styles live here. Brand inputs are passed in so each caller
 * can source them from wherever it likes (SettingsService, API response
 * branding, onboarding snapshot, etc.); the banner is hidden when neither
 * a name nor a logo is set, matching the original public-form behaviour.
 *
 * Used by: public-form, public-legal, public-legal-index, onboarding-portal.
 * Any change to the chrome here lands on every public page at once.
 */

@Component({
  selector: 'app-public-brand-banner',
  template: `
    @if (brandName || brandLogoUrl) {
      <header class="brand-banner">
        <a class="brand-inner" [href]="link">
          @if (brandLogoUrl) { <img class="brand-logo" [src]="brandLogoUrl" alt="" /> }
          @if (brandName)    { <span class="brand-name">{{ brandName }}</span> }
        </a>
      </header>
    }
  `,
  styles: [`
    .brand-banner { background: #000000; padding: 16px 40px; width: 100%; }
    .brand-inner {
      display: flex; align-items: center; gap: 12px;
      text-decoration: none; color: inherit; width: fit-content;
    }
    .brand-inner:hover .brand-name { color: #d4a93a; }
    .brand-logo { max-height: 40px; max-width: 160px; object-fit: contain; }
    .brand-name {
      font-weight: 700; font-size: 18px; letter-spacing: 0.3px;
      color: #ffffff;
    }
    @media (max-width: 600px) { .brand-banner { padding: 12px 20px; } }
  `],
})
export class PublicBrandBanner {
  /** Display name shown next to the logo. Banner is hidden if both this and logo URL are empty. */
  @Input() brandName: string | null | undefined = '';
  /** Logo URL — typically the studio's mark uploaded via Settings. */
  @Input() brandLogoUrl: string | null | undefined = '';
  /** Where the banner links to. Defaults to the marketing site. */
  @Input() link: string = 'https://builtrightstudio.com';
}

@Component({
  selector: 'app-public-footer',
  imports: [RouterLink],
  template: `
    <footer class="footer">
      <div class="footer-container">
        <div class="footer-grid">
          <div class="footer-brand">
            <a href="https://builtrightstudio.com/" class="footer-logo">
              <img src="https://builtrightstudio.com/assets/images/logo3.png" alt="Built Right Studio" />
            </a>
            <p>Modern websites built in 24–72 hours. Fast delivery, clean design, affordable pricing.</p>
            <div class="social-links">
              <a href="#" class="social-link" aria-label="Instagram">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
                  <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
                </svg>
              </a>
              <a href="#" class="social-link" aria-label="TikTok">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"></path>
                </svg>
              </a>
              <a href="#" class="social-link" aria-label="LinkedIn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path>
                  <rect x="2" y="9" width="4" height="12"></rect>
                  <circle cx="4" cy="4" r="2"></circle>
                </svg>
              </a>
            </div>
          </div>

          <div>
            <h6 class="footer-heading">Quick Links</h6>
            <ul class="footer-links">
              <li><a href="https://builtrightstudio.com/index.html">Home</a></li>
              <li><a href="https://builtrightstudio.com/services.html">Services</a></li>
              <li><a href="https://builtrightstudio.com/portfolio.html">Portfolio</a></li>
              <li><a href="https://builtrightstudio.com/about.html">About Us</a></li>
              <li><a href="https://builtrightstudio.com/pricing.html">Pricing</a></li>
              <li><a href="https://builtrightstudio.com/contact.html">Contact</a></li>
            </ul>
          </div>

          <div>
            <h6 class="footer-heading">Services</h6>
            <ul class="footer-links">
              <li><a href="https://builtrightstudio.com/services.html#quick-launch">Quick Launch Sites</a></li>
              <li><a href="https://builtrightstudio.com/services.html#refresh">Website Refresh</a></li>
              <li><a href="https://builtrightstudio.com/services.html#bundle">Brand + Website</a></li>
              <li><a href="https://builtrightstudio.com/services.html#branding">Creative Branding</a></li>
              <li><a href="https://builtrightstudio.com/pricing.html#maintenance">Maintenance Plans</a></li>
            </ul>
          </div>

          <div>
            <h6 class="footer-heading">Contact</h6>
            <ul class="footer-links">
              <li><a href="mailto:hello@builtrightstudio.com">hello@builtrightstudio.com</a></li>
              <li><a href="https://builtrightstudio.com/contact.html">Book a Consultation</a></li>
              <li>UK-Based Team</li>
            </ul>
          </div>
        </div>

        <div class="footer-bottom">
          <p class="footer-copyright">© {{ year }} Built Right Studio. All rights reserved.</p>
          <div class="footer-legal">
            <a routerLink="/legal/privacy-policy">Privacy Policy</a>
            <a routerLink="/legal/terms-of-service">Terms of Service</a>
          </div>
        </div>
      </div>
    </footer>
  `,
  styles: [`
    .footer {
      background: #000000;
      padding: 80px 0 32px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      color: rgba(249, 249, 249, 0.6);
    }
    .footer-container {
      width: 100%; max-width: 1440px; margin: 0 auto;
      padding: 0 clamp(1.5rem, 5vw, 4rem);
    }
    .footer-grid {
      display: grid; grid-template-columns: 2fr repeat(3, 1fr);
      gap: 48px; margin-bottom: 64px;
    }
    .footer-brand { max-width: 320px; }
    .footer-logo { display: inline-block; margin-bottom: 24px; }
    .footer-logo img { height: 100px; width: auto; display: block; }
    .footer-brand p {
      color: rgba(249, 249, 249, 0.6);
      margin: 0 0 24px 0;
      font-size: 15px; line-height: 1.65;
    }
    .footer-heading {
      font-size: 14px; font-weight: 600; color: #F2F2F2;
      letter-spacing: 0.1em; text-transform: uppercase;
      margin: 0 0 24px 0;
    }
    .footer-links { list-style: none; margin: 0; padding: 0; }
    .footer-links li { margin-bottom: 12px; }
    .footer-links a {
      color: rgba(249, 249, 249, 0.6);
      font-size: 14px; text-decoration: none;
      transition: color 250ms ease;
    }
    .footer-links a:hover { color: #af8a0f; }

    .social-links { display: flex; gap: 16px; }
    .social-link {
      width: 44px; height: 44px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 9999px;
      background: #1F1F1F; color: #C9B8A7;
      text-decoration: none;
      transition: all 250ms ease;
    }
    .social-link:hover { background: #af8a0f; color: #121212; transform: translateY(-3px); }
    .social-link svg { width: 20px; height: 20px; }

    .footer-bottom {
      padding-top: 32px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex; justify-content: space-between; align-items: center;
      flex-wrap: wrap; gap: 16px;
    }
    .footer-copyright { font-size: 14px; color: rgba(249, 249, 249, 0.6); margin: 0; }
    .footer-legal { display: flex; gap: 24px; }
    .footer-legal a {
      font-size: 14px; color: rgba(249, 249, 249, 0.6);
      text-decoration: none;
      transition: color 250ms ease;
    }
    .footer-legal a:hover { color: #af8a0f; }

    @media (max-width: 768px) {
      .footer { padding: 48px 0 24px; }
      .footer-grid { grid-template-columns: 1fr; gap: 32px; margin-bottom: 32px; }
      .footer-bottom { flex-direction: column; align-items: flex-start; }
    }
  `],
})
export class PublicFooter {
  year = new Date().getFullYear();
}

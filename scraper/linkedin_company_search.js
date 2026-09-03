/*
 * LinkedIn COMPANY-SEARCH crawler (cookie mode). Drives the tenant's li_at
 * session through the faceted company-search results, page by page, collecting
 * { name, url } for every company card. Seeds the LinkedIn pipeline page.
 *
 *   node linkedin_company_search.js <input.json>
 *   input:  { li_at, csrf, url?, geo?, keyword?, pages, staggerMin, staggerMax }
 *           - url:     a full .../search/results/companies/?… URL (region already
 *                      encoded as companyHqGeo=["<id>"]). Takes precedence.
 *           - geo:     a companyHqGeo id (e.g. "90009496" = London) if no url.
 *           - keyword: optional &keywords= term.
 *           - pages:   how many result pages to walk (LinkedIn caps ~100 → ~1000
 *                      results total for a normal account, whatever the count says).
 *   output (stdout, JSON only):
 *           { ok, companies:[{name,url}], pages_crawled, note, error? }
 *
 * LOCAL/VPS ONLY — needs Node + Playwright + Chromium. Against LinkedIn's ToS;
 * keep the stagger and low volume or the account gets restricted. Diagnostics
 * go to stderr so stdout stays clean JSON.
 */
const PW = 'C:/xampp/htdocs/builtrightstudio/cms/e2e/node_modules/playwright';
const { chromium } = require(PW);
const fs = require('fs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const log = (...a) => console.error('[li-search]', ...a);
const wait = ms => new Promise(r => setTimeout(r, ms));
function done(obj) { process.stdout.write(JSON.stringify(obj)); process.exit(0); }

// Build the base search URL and return a function that stamps a page number on it.
function baseUrl(input) {
  let u;
  if (input.url && /linkedin\.com\/search\/results\/companies/i.test(input.url)) {
    u = new URL(input.url);
  } else {
    u = new URL('https://www.linkedin.com/search/results/companies/');
    u.searchParams.set('origin', 'FACETED_SEARCH');
    if (input.geo) u.searchParams.set('companyHqGeo', '["' + String(input.geo).replace(/[^0-9]/g, '') + '"]');
    // companySize facet: array of LinkedIn size codes (A..I), e.g. ["C","D"].
    if (Array.isArray(input.sizes) && input.sizes.length) {
      const codes = input.sizes.map(s => String(s).toUpperCase()).filter(s => /^[A-I]$/.test(s));
      if (codes.length) u.searchParams.set('companySize', JSON.stringify(codes));
    }
    if (input.keyword) u.searchParams.set('keywords', String(input.keyword));
  }
  return (page) => { u.searchParams.set('page', String(page)); return u.toString(); };
}

(async () => {
  let input;
  try { input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); }
  catch (e) { done({ ok: false, companies: [], error: 'bad input: ' + e.message }); }

  const { li_at, csrf = '' } = input;
  const startPage = Math.max(1, Number(input.startPage ?? 1));
  const pages = Math.max(1, Math.min(100, Number(input.pages ?? 5)));  // batch size
  const sMin = Number(input.staggerMin ?? 1), sMax = Number(input.staggerMax ?? 2);
  if (!li_at) done({ ok: false, companies: [], error: 'no li_at' });

  const makeUrl = baseUrl(input);

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] });
  } catch (e) { done({ ok: false, companies: [], error: 'browser launch failed: ' + e.message }); }

  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 900 } });
  const ck = [{ name: 'li_at', value: li_at, domain: '.linkedin.com', path: '/', httpOnly: true, secure: true }];
  if (csrf) ck.push({ name: 'JSESSIONID', value: '"' + csrf.replace(/^"|"$/g, '') + '"', domain: '.linkedin.com', path: '/', secure: true });
  await ctx.addCookies(ck);
  // Block heavy, useless-for-scraping resources — the biggest per-page speedup.
  await ctx.route('**/*', (route) => {
    const t = route.request().resourceType();
    return (t === 'image' || t === 'media' || t === 'font') ? route.abort() : route.continue();
  });
  const page = await ctx.newPage();

  const authBad = url => /\/(login|authwall|checkpoint|uas\/login)/i.test(url);
  const seen = new Set();
  const companies = [];
  let crawled = startPage - 1, note = '', total = 0;

  try {
    for (let n = startPage; n < startPage + pages; n++) {
      if (n > 100) { note = note || 'cap'; break; }
      if (n > startPage && sMax > 0) await wait((sMin + Math.random() * (sMax - sMin)) * 1000);
      const url = makeUrl(n);
      log('page', n, url);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      if (authBad(page.url())) { note = 'auth'; break; }

      await page.waitForSelector('a[href*="/company/"]', { timeout: 12000 }).catch(() => {});

      // Wait for the result COUNT to STABILISE. LinkedIn first paints a
      // suggested/geo-only view with a big number (e.g. 200,000) then swaps in
      // the actually-filtered results with the real count (e.g. 4,300).
      // Extracting before it settles gives the wrong total AND wrong companies,
      // so poll the count until it's unchanged twice in a row.
      const readCount = () => page.evaluate(() => {
        const t = ((document.querySelector('main') || document.body).innerText || '');
        const m = t.match(/([\d][\d,]{0,11})\+?\s+results?/i);
        return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
      }).catch(() => 0);
      let last = -1, streak = 0, pageCount = 0;
      for (let i = 0; i < 16; i++) {           // up to ~8s
        const c = await readCount();
        if (c > 0 && c === last) { if (++streak >= 2) { pageCount = c; break; } }
        else { last = c; streak = 0; }
        await page.waitForTimeout(500);
      }
      if (pageCount && !total) total = pageCount;

      // Two quick scrolls to trigger the last lazy cards, then extract.
      for (let s = 0; s < 2; s++) { await page.mouse.wheel(0, 2600); await page.waitForTimeout(300); }

      const pageItems = await page.evaluate(() => {
        const scope = document.querySelector('main') || document.body;
        // Group anchors by company slug; the company NAME is the shortest text
        // among the anchors pointing at it (the card wrapper carries the whole
        // blurb, the title link carries just the name).
        const bySlug = {};
        for (const a of Array.from(scope.querySelectorAll('a[href*="/company/"]'))) {
          const m = a.getAttribute('href').match(/\/company\/([^/?#]+)/);
          if (!m) continue;
          const slug = m[1].toLowerCase();
          if (/^(setup|about|posts|jobs|people)$/i.test(slug)) continue;
          const span = a.querySelector('span[aria-hidden="true"]');
          let name = ((span && span.textContent) || a.textContent || '').replace(/\s+/g, ' ').trim();
          // collapse the "NameName" / "Name Name" doubling from aria+visually-hidden spans
          name = name.replace(/^(.+?)\1$/, '$1').replace(/^(\S.*?)\s\1(\s|$)/, '$1$2').trim();
          if (!name || name.length < 2) continue;
          if (/^\d[\d,.]*\s*(followers|employees|people)/i.test(name)) continue;
          if (/follows? this page|other connections?|\bfollow\b/i.test(name)) continue; // "X follows this page" sub-links
          if (name.length > 90) continue; // still a card blurb, not a name
          if (!bySlug[slug] || name.length < bySlug[slug].name.length) {
            bySlug[slug] = { slug, name, url: 'https://www.linkedin.com/company/' + m[1].replace(/\/$/, '') };
          }
        }
        return Object.values(bySlug);
      }).catch(() => []);

      let added = 0;
      for (const it of pageItems) {
        const key = it.slug.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        companies.push({ name: it.name, url: it.url });
        added++;
      }
      crawled = n;
      log('page', n, 'added', added, 'total', companies.length);
      // No new companies on a page usually means we've hit the end / the cap.
      if (added === 0 && n > 1) { note = note || 'exhausted'; break; }
    }
  } catch (e) {
    note = note || ('error: ' + e.message);
  } finally {
    await browser.close().catch(() => {});
  }

  done({
    ok: note !== 'auth',
    companies,
    total,                       // LinkedIn's reported result count for this search
    from_page: startPage,
    to_page: crawled,
    next_page: crawled + 1,
    exhausted: note === 'exhausted' || note === 'cap' || crawled >= 100,
    note: note === 'auth' ? 'LinkedIn rejected the session (login/checkpoint) — refresh your li_at cookie in Settings.'
        : note === 'exhausted' ? 'Reached the end of available results.'
        : note === 'cap' ? 'Reached LinkedIn\'s ~1,000-result pagination limit.'
        : note || '',
  });
})();

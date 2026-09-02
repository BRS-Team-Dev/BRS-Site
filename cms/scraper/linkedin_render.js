/*
 * LinkedIn cookie-mode renderer (Stage 5). Uses a real (headless) browser +
 * the tenant's li_at session so LinkedIn's JS actually renders the company
 * people list, which curl can't see. Called by routes/leads.php for
 * method=cookie. LOCAL/VPS ONLY — needs Node + Playwright + a Chromium binary,
 * which shared hosting (Hostinger) doesn't have; the no-cookie DDG path in
 * linkedin.php is the portable fallback.
 *
 *   node linkedin_render.js <input.json>
 *   input:  { li_at, csrf, staggerMin, staggerMax, companies:[{id,name,location}] }
 *   output (stdout, JSON only): { results:[{id,company_url,staff:[{name,url}]}], error? }
 *
 * Diagnostics go to stderr so stdout stays clean JSON for the PHP caller.
 */
const PW = 'C:/xampp/htdocs/builtrightstudio/cms/e2e/node_modules/playwright';
const { chromium } = require(PW);
const fs = require('fs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const log = (...a) => console.error('[li]', ...a);
const wait = ms => new Promise(r => setTimeout(r, ms));

function done(obj) { process.stdout.write(JSON.stringify(obj)); process.exit(0); }

(async () => {
  let input;
  try { input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); }
  catch (e) { done({ results: [], error: 'bad input: ' + e.message }); }

  const { li_at, csrf = '', companies = [] } = input;
  const sMin = Number(input.staggerMin ?? 1), sMax = Number(input.staggerMax ?? 15);
  if (!li_at) done({ results: [], error: 'no li_at' });

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] });
  } catch (e) { done({ results: [], error: 'browser launch failed: ' + e.message }); }

  const ctx = await browser.newContext({ userAgent: UA });
  const ck = [{ name: 'li_at', value: li_at, domain: '.linkedin.com', path: '/', httpOnly: true, secure: true }];
  if (csrf) ck.push({ name: 'JSESSIONID', value: '"' + csrf.replace(/^"|"$/g, '') + '"', domain: '.linkedin.com', path: '/', secure: true });
  await ctx.addCookies(ck);
  const page = await ctx.newPage();

  const authBad = url => /\/(login|authwall|checkpoint|uas\/login)/i.test(url);
  const results = [];

  for (let i = 0; i < companies.length; i++) {
    const c = companies[i];
    if (i > 0 && sMax > 0) await wait((sMin + Math.random() * (sMax - sMin)) * 1000);
    try {
      // 1) Resolve the company page. LinkedIn search needs a clean name (the
      // full registered name + address returns "no results"), so strip legal
      // suffixes and drop the location. Fall back to DuckDuckGo if search is
      // empty (it's far more forgiving and indexes the /company/ URL).
      const cleanName = String(c.name || '').replace(/\b(ltd|limited|plc|llp|llc|group|holdings|uk|the)\b/gi, '').replace(/[^A-Za-z0-9&\s]/g, ' ').replace(/\s+/g, ' ').trim();
      let companyUrl = '';
      try {
        await page.goto('https://www.linkedin.com/search/results/companies/?keywords=' + encodeURIComponent(cleanName || c.name), { waitUntil: 'domcontentloaded', timeout: 40000 });
        if (authBad(page.url())) { await browser.close(); done({ results, error: 'cookie_invalid' }); }
        await wait(2500);
        companyUrl = await page.$$eval('a[href*="/company/"]', as => {
          for (const a of as) { const m = a.href.match(/\/company\/([^/?#]+)/); if (m) return 'https://www.linkedin.com/company/' + m[1] + '/'; }
          return '';
        }).catch(() => '');
      } catch (e) { log('search err: ' + e.message); }
      if (!companyUrl) {
        try {
          const res = await fetch('https://lite.duckduckgo.com/lite/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, body: 'q=' + encodeURIComponent([cleanName, c.location, 'LinkedIn'].filter(Boolean).join(' ')) + '&kl=uk-en' });
          const html = await res.text();
          const m = html.match(/https?:\/\/[a-z]{0,4}\.?linkedin\.com\/company\/[A-Za-z0-9\-_%.]+/i);
          if (m) { companyUrl = m[0].replace(/\/+$/, '') + '/'; log('resolved via DDG: ' + companyUrl); }
        } catch (e) { log('ddg err: ' + e.message); }
      }

      const staff = [];
      if (companyUrl) {
        // 2) Render the people list.
        await page.goto(companyUrl + 'people/', { waitUntil: 'domcontentloaded', timeout: 40000 });
        if (authBad(page.url())) { await browser.close(); done({ results, error: 'cookie_invalid' }); }
        for (let s = 0; s < 4; s++) { await page.mouse.wheel(0, 2600).catch(() => {}); await wait(1400); }
        const raw = await page.$$eval('a[href*="/in/"]', links => {
          const clean = t => (t || '').replace(/\s+/g, ' ').trim();
          const out = [];
          for (const a of links) {
            const m = a.href.split('?')[0].match(/\/in\/([^/]+)/); if (!m) continue;
            let name = '';
            const img = a.querySelector('img[alt]'); if (img) name = clean(img.alt);
            if (!name) { const al = a.getAttribute('aria-label'); if (al) name = clean(al).replace(/^View\s+/i, '').replace(/[’']s (profile|graphic).*$/i, '').trim(); }
            if (!name) name = clean(a.innerText).split('\n')[0].trim();
            // Strip LinkedIn status badges that leak into the image alt text.
            name = name.replace(/\s+is (open to work|hiring|verified).*$/i, '').replace(/,?\s*#OpenToWork.*$/i, '').trim();
            out.push({ slug: m[1], name });
          }
          return out;
        }).catch(() => []);
        const seen = new Set();
        for (const r of raw) {
          if (seen.has(r.slug) || /^unknown/i.test(r.slug)) continue;
          seen.add(r.slug);
          staff.push({ name: r.name || r.slug.replace(/-[a-f0-9]{4,}$/i, '').replace(/-/g, ' '), url: 'https://www.linkedin.com/in/' + r.slug + '/' });
        }
      }
      results.push({ id: c.id, company_url: companyUrl, staff: staff.slice(0, 30) });
      log(`#${c.id} ${c.name} -> ${companyUrl || 'no page'}, ${staff.length} staff`);
    } catch (e) {
      log(`#${c.id} error: ${e.message}`);
      results.push({ id: c.id, company_url: '', staff: [] });
    }
  }

  await browser.close();
  done({ results });
})().catch(e => { process.stdout.write(JSON.stringify({ results: [], error: e.message })); process.exit(0); });

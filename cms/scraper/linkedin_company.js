/*
 * LinkedIn COMPANY PROFILE loader (cookie mode). Loads a company's public
 * /about/ page and extracts the overview LinkedIn shows: website, industry,
 * company size, headquarters, type, founded, specialties, and the locations
 * list. This is the first Qualify step for a LinkedIn-sourced lead — it hands
 * the shared flow a website (→ email/phone crawl), an address and an industry.
 *
 *   node linkedin_company.js <input.json>
 *   input:  { li_at, csrf, url }   (url = .../company/<slug>[/...])
 *   output: { ok, name, website, industry, size, headquarters, type, founded,
 *             specialties, locations:[..], description, error? }
 *
 * NOTE: LinkedIn walls the company page for logged-out/automated requests (curl
 * gets 302→login; a cookieless headless browser gets a "Sign in" wall), so this
 * needs the stored li_at session. LOCAL/VPS ONLY (Node + Playwright + Chromium).
 */
const PW = 'C:/xampp/htdocs/builtrightstudio/cms/e2e/node_modules/playwright';
const { chromium } = require(PW);
const fs = require('fs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const log = (...a) => console.error('[li-company]', ...a);
const wait = ms => new Promise(r => setTimeout(r, ms));
function done(o) { process.stdout.write(JSON.stringify(o)); process.exit(0); }

(async () => {
  let input;
  try { input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); }
  catch (e) { done({ ok: false, error: 'bad input: ' + e.message }); }
  const { li_at, csrf = '', url = '' } = input;
  const sMin = Number(input.staggerMin ?? 1), sMax = Number(input.staggerMax ?? 15);
  if (!li_at) done({ ok: false, error: 'no li_at' });
  const m = String(url).match(/\/company\/([^/?#]+)/i);
  if (!m) done({ ok: false, error: 'not a company url' });
  const about = 'https://www.linkedin.com/company/' + m[1].replace(/\/$/, '') + '/about/';

  let browser;
  try { browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] }); }
  catch (e) { done({ ok: false, error: 'browser launch failed: ' + e.message }); }
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1280, height: 1000 } });
  const ck = [{ name: 'li_at', value: li_at, domain: '.linkedin.com', path: '/', httpOnly: true, secure: true }];
  if (csrf) ck.push({ name: 'JSESSIONID', value: '"' + csrf.replace(/^"|"$/g, '') + '"', domain: '.linkedin.com', path: '/', secure: true });
  await ctx.addCookies(ck);
  await ctx.route('**/*', (r) => { const t = r.request().resourceType(); return (t === 'image' || t === 'media' || t === 'font') ? r.abort() : r.continue(); });
  const page = await ctx.newPage();

  let out = { ok: false };
  try {
    // Human-like stagger before hitting LinkedIn (ToS — keep it spaced out).
    if (sMax > 0) await wait((sMin + Math.random() * (sMax - sMin)) * 1000);
    await page.goto(about, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
    if (/\/(login|authwall|checkpoint)/i.test(page.url())) done({ ok: false, error: 'auth' });
    await page.waitForTimeout(1500);
    for (const name of [/^Accept/i, /^Dismiss/i]) { try { await page.getByRole('button', { name }).first().click({ timeout: 1500 }); break; } catch (e) {} }
    await page.waitForSelector('dl', { timeout: 10000 }).catch(() => {});
    // Scroll the whole /about/ page so the lazy-loaded Locations blocks render.
    for (let s = 0; s < 6; s++) { await page.mouse.wheel(0, 2200); await page.waitForTimeout(450); }
    await page.waitForTimeout(600);

    out = await page.evaluate(() => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const firstLine = (el) => {
        if (!el) return '';
        // take the first text line, dropping nested tooltip/aria helper text
        const txt = (el.innerText || '').split('\n').map(x => x.trim()).filter(Boolean);
        return txt[0] || '';
      };
      const res = { ok: true, name: clean((document.querySelector('h1') || {}).innerText), specialties: '', locations: [] };
      const map = { Website: 'website', Industry: 'industry', 'Company size': 'size', Headquarters: 'headquarters', Type: 'type', 'Founded': 'founded', Specialties: 'specialties' };
      const isNoise = (s) => /associated members|LinkedIn members who|Get directions|see all|show all/i.test(s);
      // Pair each <dt> with its OWN following <dd> (index-matching across the whole
      // dl breaks when a dd carries nested tooltip nodes).
      for (const dt of document.querySelectorAll('dl dt')) {
        const k = clean(dt.innerText);
        if (!map[k]) continue;
        let dd = dt.nextElementSibling;
        while (dd && dd.tagName !== 'DD') dd = dd.nextElementSibling;
        if (!dd) continue;
        if (k === 'Website') { const a = dd.querySelector('a'); res.website = a ? a.href : firstLine(dd); continue; }
        // first non-noise text line of the value
        const lines = (dd.innerText || '').split('\n').map(x => x.trim()).filter(Boolean).filter(x => !isNoise(x));
        const val = (k === 'Specialties') ? lines.join(' ') : (lines[0] || '');
        if (val) res[map[k]] = val;
      }
      // Description / tagline (the paragraph under the Overview heading).
      const ov = [...document.querySelectorAll('h2,h3')].find(h => /overview/i.test(h.innerText || ''));
      if (ov) { let p = ov.nextElementSibling; while (p && !/^P$/i.test(p.tagName) && p.tagName !== 'P') p = p.nextElementSibling; if (p) res.description = clean(p.innerText).slice(0, 600); }
      // Locations — the address blocks each carry a "Get directions" link, but
      // they're NOT inside the Locations heading's section (that just holds the
      // map). So anchor on the "Get directions" links anywhere and read the
      // address out of each one's containing block.
      for (const a of document.querySelectorAll('a')) {
        if (!/Get directions/i.test(a.innerText || '')) continue;
        let el = a.parentElement, addr = '';
        for (let i = 0; i < 5 && el; i++) {
          const t = clean(el.innerText).replace(/Get directions.*$/is, '').replace(/Primary/ig, '').trim();
          if (t.length > 10 && t.length < 160 && t.includes(',') && /\d/.test(t)) { addr = t; break; }
          el = el.parentElement;
        }
        if (addr && !res.locations.includes(addr)) res.locations.push(addr);
        if (res.locations.length >= 10) break;
      }
      return res;
    }).catch((e) => ({ ok: false, error: String(e) }));

    // Employees live on the MAIN company page (not /about/) — grab a few
    // (name + /in/ profile link) for the staff list.
    if (out && out.ok) {
      const main = 'https://www.linkedin.com/company/' + m[1].replace(/\/$/, '') + '/';
      await page.goto(main, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
      await page.waitForTimeout(2500);
      // Scroll to the "Employees at …" highlight section so its /in/ cards load.
      for (let s = 0; s < 8; s++) { await page.mouse.wheel(0, 2400); await page.waitForTimeout(500); }
      await page.waitForSelector('a[href*="/in/"]', { timeout: 6000 }).catch(() => {});
      out.employees = await page.evaluate(() => {
        const clean = s => (s || '').replace(/\s+/g, ' ').trim();
        const seen = new Set(); const emps = [];
        for (const a of document.querySelectorAll('a[href*="/in/"]')) {
          const mm = a.getAttribute('href').match(/\/in\/([^/?#]+)/); if (!mm) continue;
          const slug = mm[1]; if (seen.has(slug)) continue;
          let nm = (clean(a.innerText).split('\n')[0] || '').replace(/^(.+?)\1$/, '$1').trim();
          if (nm.length > 1 && nm.length < 50 && !/^\d/.test(nm) && !/follow|connection|member/i.test(nm)) {
            seen.add(slug); emps.push({ name: nm, url: 'https://www.linkedin.com/in/' + slug });
          }
        }
        return emps.slice(0, 10);
      }).catch(() => []);
    }
  } catch (e) { out = { ok: false, error: String(e && e.message || e) }; }
  finally { await browser.close().catch(() => {}); }
  done(out);
})();

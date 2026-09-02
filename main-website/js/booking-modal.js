/* booking-modal.js — "Book a Call" overlay.
 *
 * Any element carrying [data-book-call] opens a three-step flow:
 *   1. Details  — name, email, phone, company
 *   2. Date     — calendar; bookable days come from the API
 *   3. Time     — slots for that day, in the VISITOR's timezone
 *
 * TIMEZONES
 * ---------
 * The team works UK hours (weekdays 09:00–22:00 Europe/London) but
 * prospects are UK and US. So the visitor picks a date and time in
 * their OWN timezone, while every slot also carries the UK wall-clock
 * datetime it maps to — and that UK value is the only thing posted
 * back. No conversion happens in the browser, so a wrong system clock
 * or a spoofed timezone can never shift the booking the team sees.
 * The CRM stores UK time throughout; the visitor's local time is kept
 * on the booking's notes for whoever makes the call.
 *
 * Confirming POSTs to /api/public-lead-booking, which writes the CRM
 * booking row and the matching lead. The markup is injected here so a
 * page only needs the CSS + this script + one button.
 */

(function () {
  'use strict';

  // ── API base ───────────────────────────────────────────────────
  // Prod: the marketing site is at the domain root and the CMS API
  // lives at /cc/api. Local XAMPP: the site is served from
  // /builtrightstudio/main-website/ with the API a sibling folder.
  // window.BRS_API_BASE overrides both.
  function apiBase() {
    if (window.BRS_API_BASE) return window.BRS_API_BASE;
    var m = window.location.pathname.match(/^(.*)\/main-website\//);
    return m ? m[1] + '/cms/api' : '/cc/api';
  }

  // The visitor's IANA zone. Everything the API returns is rendered
  // against it; unsupported browsers fall through to UK time.
  function visitorTz() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (e) {
      return '';
    }
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS   = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // ── Date helpers (plain Y-M-D strings — never Date arithmetic) ──
  function parseYmd(iso) {
    var p = iso.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function prettyDate(iso) {
    var d = parseYmd(iso);
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  function prettyTime(hhmm) {
    var p   = hhmm.split(':');
    var h   = +p[0];
    var ap  = h < 12 ? 'am' : 'pm';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + p[1] + ap;
  }
  // Morning / Afternoon / Evening in the visitor's own day.
  function period(hhmm) {
    var h = +hhmm.split(':')[0];
    if (h < 12) return 'Morning';
    if (h < 17) return 'Afternoon';
    return 'Evening';
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ── Markup ──────────────────────────────────────────────────────
  var MARKUP = [
    '<div class="bk-panel" role="dialog" aria-modal="true" aria-labelledby="bkTitle">',
    '  <button type="button" class="bk-close" data-bk-close aria-label="Close">',
    '    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    '  </button>',
    '  <div class="bk-head">',
    '    <span class="bk-eyebrow">Free 15-minute call</span>',
    '    <h2 class="bk-title" id="bkTitle">Book a Call</h2>',
    '    <p class="bk-sub">Tell us who you are, then pick a slot that suits you.</p>',
    '    <div class="bk-steps" data-bk-steps>',
    '      <span class="bk-step" data-bk-step="1"><span class="bk-step-dot">1</span><span class="bk-step-text">Details</span></span>',
    '      <span class="bk-step-line"></span>',
    '      <span class="bk-step" data-bk-step="2"><span class="bk-step-dot">2</span><span class="bk-step-text">Date</span></span>',
    '      <span class="bk-step-line"></span>',
    '      <span class="bk-step" data-bk-step="3"><span class="bk-step-dot">3</span><span class="bk-step-text">Time</span></span>',
    '    </div>',
    '  </div>',
    '',
    '  <div class="bk-body" data-bk-scroll>',
    '    <!-- Step 1 — details -->',
    '    <div class="bk-pane" data-bk-pane="1">',
    '      <div class="bk-field">',
    '        <label for="bkName">Full name *</label>',
    '        <input type="text" id="bkName" name="name" autocomplete="name" placeholder="Jane Doe" required />',
    '      </div>',
    '      <div class="bk-field">',
    '        <label for="bkEmail">Email *</label>',
    '        <input type="email" id="bkEmail" name="email" autocomplete="email" placeholder="jane@company.com" required />',
    '      </div>',
    '      <div class="bk-field">',
    '        <label for="bkPhone">Phone number *</label>',
    '        <input type="tel" id="bkPhone" name="phone" autocomplete="tel" placeholder="07700 900123" required />',
    '      </div>',
    '      <div class="bk-field">',
    '        <label for="bkCompany">Company name</label>',
    '        <input type="text" id="bkCompany" name="company" autocomplete="organization" placeholder="Company Ltd" />',
    '      </div>',
    '      <div class="bk-hp" aria-hidden="true">',
    '        <label for="bkWebsite">Website</label>',
    '        <input type="text" id="bkWebsite" name="website" tabindex="-1" autocomplete="off" />',
    '      </div>',
    '    </div>',
    '',
    '    <!-- Step 2 — date -->',
    '    <div class="bk-pane" data-bk-pane="2" hidden>',
    '      <div class="bk-month">',
    '        <span class="bk-month-label" data-bk-month></span>',
    '        <span class="bk-month-nav">',
    '          <button type="button" class="bk-month-btn" data-bk-prev aria-label="Previous month">',
    '            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>',
    '          </button>',
    '          <button type="button" class="bk-month-btn" data-bk-next aria-label="Next month">',
    '            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>',
    '          </button>',
    '        </span>',
    '      </div>',
    '      <div class="bk-grid" data-bk-days></div>',
    '    </div>',
    '',
    '    <!-- Step 3 — time -->',
    '    <div class="bk-pane" data-bk-pane="3" hidden>',
    '      <p class="bk-chosen-date" data-bk-chosen></p>',
    '      <div data-bk-times></div>',
    '    </div>',
    '',
    '    <!-- Confirmation -->',
    '    <div class="bk-pane" data-bk-pane="done" hidden>',
    '      <div class="bk-done">',
    '        <span class="bk-done-mark">',
    '          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    '        </span>',
    '        <h3>You are booked in</h3>',
    '        <span class="bk-done-when" data-bk-when></span>',
    '        <p class="bk-done-uk" data-bk-done-uk hidden></p>',
    '        <p>A member of the team will confirm by email shortly with the call details.</p>',
    '      </div>',
    '    </div>',
    '  </div>',
    '',
    '  <p class="bk-error" data-bk-error hidden></p>',
    '',
    '  <div class="bk-foot" data-bk-foot>',
    '    <button type="button" class="btn btn-outline" data-bk-back hidden>Back</button>',
    '    <span class="bk-foot-spacer"></span>',
    '    <button type="button" class="btn btn-primary" data-bk-next-step>Continue</button>',
    '    <button type="button" class="btn btn-primary" data-bk-submit hidden>Confirm Booking</button>',
    '    <button type="button" class="btn btn-primary" data-bk-done hidden>Done</button>',
    '  </div>',
    '</div>'
  ].join('\n');

  // ── Build once, lazily ──────────────────────────────────────────
  var modal = null;
  var el    = {};
  var state = {
    step: 1,
    tz: '',
    date: null,        // visitor-local Y-M-D
    slot: null,        // UK wall-clock datetime — what gets posted
    slotLocal: null,   // visitor-local HH:MM, for the confirmation
    slotUk: null,      // UK HH:MM, for the confirmation
    month: null,       // {y, m} of the visible calendar month
    days: null,        // { set, min, max } from /days
    sending: false
  };

  function build() {
    modal = document.createElement('div');
    modal.className = 'bk-modal';
    modal.setAttribute('data-booking-modal', '');
    modal.hidden = true;
    modal.innerHTML = MARKUP;
    document.body.appendChild(modal);

    el.panel   = modal.querySelector('.bk-panel');
    el.scroll  = modal.querySelector('[data-bk-scroll]');
    el.error   = modal.querySelector('[data-bk-error]');
    el.monthLb = modal.querySelector('[data-bk-month]');
    el.days    = modal.querySelector('[data-bk-days]');
    el.prev    = modal.querySelector('[data-bk-prev]');
    el.nextMo  = modal.querySelector('[data-bk-next]');
    el.times   = modal.querySelector('[data-bk-times]');
    el.chosen  = modal.querySelector('[data-bk-chosen]');
    el.when    = modal.querySelector('[data-bk-when]');
    el.doneUk  = modal.querySelector('[data-bk-done-uk]');
    el.back    = modal.querySelector('[data-bk-back]');
    el.next    = modal.querySelector('[data-bk-next-step]');
    el.submit  = modal.querySelector('[data-bk-submit]');
    el.done    = modal.querySelector('[data-bk-done]');

    modal.querySelector('[data-bk-close]').addEventListener('click', close);
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    el.back.addEventListener('click', function () { goTo(state.step - 1); });
    el.next.addEventListener('click', function () { advance(); });
    el.submit.addEventListener('click', submit);
    el.done.addEventListener('click', close);
    el.prev.addEventListener('click', function () { shiftMonth(-1); });
    el.nextMo.addEventListener('click', function () { shiftMonth(1); });

    // Enter on step 1 moves forward instead of doing nothing.
    modal.querySelector('[data-bk-pane="1"]').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); advance(); }
    });

    document.addEventListener('keydown', function (e) {
      if (!modal.hidden && e.key === 'Escape') close();
    });
  }

  // ── Open / close ────────────────────────────────────────────────
  var lastFocus = null;

  function open() {
    if (!modal) build();
    lastFocus = document.activeElement;
    reset();
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () { modal.classList.add('is-open'); });
    var first = modal.querySelector('#bkName');
    if (first) setTimeout(function () { first.focus(); }, 120);
  }

  function close() {
    if (!modal) return;
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
    setTimeout(function () { modal.hidden = true; }, 250);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function reset() {
    state.step = 1;
    state.tz = visitorTz();
    state.date = null;
    state.slot = null;
    state.slotLocal = null;
    state.slotUk = null;
    state.days = null;
    state.month = null;
    state.sending = false;
    ['#bkName', '#bkEmail', '#bkPhone', '#bkCompany', '#bkWebsite'].forEach(function (sel) {
      var i = modal.querySelector(sel);
      if (i) i.value = '';
    });
    showError('');
    goTo(1);
    loadDays();   // warm the calendar while they fill in step 1
  }

  // ── Step machine ────────────────────────────────────────────────
  function goTo(step) {
    state.step = step;
    showError('');

    modal.querySelectorAll('.bk-pane').forEach(function (p) {
      p.hidden = p.getAttribute('data-bk-pane') !== String(step);
    });
    var isDone = step === 'done';
    modal.querySelectorAll('[data-bk-step]').forEach(function (s) {
      var n = +s.getAttribute('data-bk-step');
      s.classList.toggle('is-active', n === step);
      s.classList.toggle('is-done', isDone || n < step);
    });

    el.back.hidden   = isDone || step === 1;
    el.next.hidden   = isDone || step === 3;
    el.submit.hidden = step !== 3;
    el.done.hidden   = !isDone;

    if (step === 2) renderCalendar();
    if (step === 3) loadTimes();
    el.scroll.scrollTop = 0;
  }

  function advance() {
    if (state.step === 1) {
      var err = validateDetails();
      if (err) { showError(err); return; }
      goTo(2);
      return;
    }
    if (state.step === 2) {
      if (!state.date) { showError('Please choose a date.'); return; }
      goTo(3);
    }
  }

  function val(sel) { return (modal.querySelector(sel).value || '').trim(); }

  function validateDetails() {
    if (!val('#bkName'))  return 'Please enter your name.';
    var email = val('#bkEmail');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Please enter a valid email address.';
    if (!val('#bkPhone')) return 'Please enter a phone number.';
    return '';
  }

  function showError(msg) {
    el.error.textContent = msg;
    el.error.hidden = !msg;
  }

  // ── Step 2 — calendar ───────────────────────────────────────────
  // Which days are bookable is the server's call, not ours: it owns the
  // UK working window and knows which of those days still have a free
  // slot once converted into the visitor's timezone.
  function loadDays() {
    state.daysPromise = fetch(apiBase() + '/public-lead-booking/days?tz=' + encodeURIComponent(state.tz), {
      headers: { 'Accept': 'application/json' }
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var dates = (data && data.dates) || [];
        state.days = { set: {}, min: data.min_date || null, max: data.max_date || null };
        dates.forEach(function (d) { state.days.set[d] = true; });
        if (state.days.min) {
          var f = parseYmd(state.days.min);
          state.month = { y: f.getFullYear(), m: f.getMonth() };
        }
        return state.days;
      });
    return state.daysPromise;
  }

  function shiftMonth(delta) {
    var d = new Date(state.month.y, state.month.m + delta, 1);
    state.month = { y: d.getFullYear(), m: d.getMonth() };
    renderCalendar();
  }

  function renderCalendar() {
    if (!state.days) {
      el.monthLb.textContent = '';
      el.days.innerHTML = '<p class="bk-loading">Loading available dates...</p>';
      state.daysPromise
        .then(function () { if (state.step === 2) renderCalendar(); })
        .catch(function () {
          el.days.innerHTML = '<p class="bk-empty">Could not load available dates. Please try again.</p>';
        });
      return;
    }
    if (!state.days.min) {
      el.days.innerHTML = '<p class="bk-empty">No slots are open at the moment. Please email hello@builtrightstudio.com.</p>';
      return;
    }

    var year = state.month.y, month = state.month.m;
    el.monthLb.textContent = MONTHS[month] + ' ' + year;

    var min = parseYmd(state.days.min), max = parseYmd(state.days.max);
    el.prev.disabled   = year === min.getFullYear() && month === min.getMonth();
    el.nextMo.disabled = year === max.getFullYear() && month === max.getMonth();

    var html = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      .map(function (d) { return '<span class="bk-dow">' + d + '</span>'; });

    // Monday-first grid.
    var offset = (new Date(year, month, 1).getDay() + 6) % 7;
    for (var i = 0; i < offset; i++) html.push('<span class="bk-day-blank"></span>');

    var total = new Date(year, month + 1, 0).getDate();
    for (var day = 1; day <= total; day++) {
      var iso = year + '-' + ('0' + (month + 1)).slice(-2) + '-' + ('0' + day).slice(-2);
      var ok  = !!state.days.set[iso];
      html.push(
        '<button type="button" class="bk-day' + (state.date === iso ? ' is-selected' : '') + '"' +
        ' data-date="' + iso + '"' + (ok ? '' : ' disabled') + '>' + day + '</button>'
      );
    }
    el.days.innerHTML = html.join('');

    el.days.querySelectorAll('.bk-day:not([disabled])').forEach(function (b) {
      b.addEventListener('click', function () {
        state.date = b.getAttribute('data-date');
        state.slot = null;
        el.days.querySelectorAll('.bk-day').forEach(function (o) { o.classList.remove('is-selected'); });
        b.classList.add('is-selected');
        showError('');
        goTo(3);   // picking a date is the commit — go straight to times
      });
    });
  }

  // ── Step 3 — times ──────────────────────────────────────────────
  function loadTimes() {
    el.chosen.textContent = prettyDate(state.date);
    el.times.innerHTML = '<p class="bk-loading">Loading available times...</p>';
    el.submit.disabled = true;

    fetch(apiBase() + '/public-lead-booking/slots?date=' + encodeURIComponent(state.date) +
          '&tz=' + encodeURIComponent(state.tz), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (data) { renderTimes(data || {}); })
      .catch(function () {
        el.times.innerHTML = '<p class="bk-empty">Could not load times. Please try again.</p>';
      });
  }

  function renderTimes(data) {
    var slots = data.slots || [];
    if (!slots.filter(function (s) { return s.available; }).length) {
      el.times.innerHTML = '<p class="bk-empty">No slots left on this day - please pick another date.</p>';
      return;
    }

    var html = [];

    // Only worth explaining the two clocks when they actually differ.
    if (!data.same_as_uk) {
      html.push(
        '<p class="bk-tz-note">Times below are in <strong>' + esc(data.tz) + '</strong>' +
        (data.tz_abbr ? ' (' + esc(data.tz_abbr) + ')' : '') +
        '. We are UK-based, so the matching ' + esc(data.uk_abbr || 'UK') +
        ' time is shown under each slot.</p>'
      );
    }

    // Group by the visitor's own morning / afternoon / evening.
    var groups = [];
    slots.forEach(function (s) {
      var p = period(s.time);
      var g = groups[groups.length - 1];
      if (!g || g.name !== p) { g = { name: p, items: [] }; groups.push(g); }
      g.items.push(s);
    });

    groups.forEach(function (g) {
      html.push('<h4 class="bk-time-group">' + g.name + '</h4>');
      html.push('<div class="bk-times">' + g.items.map(function (s) {
        return '<button type="button" class="bk-time" data-slot="' + esc(s.value) + '"' +
               ' data-local="' + esc(s.time) + '" data-uk="' + esc(s.uk_time) + '"' +
               (s.available ? '' : ' disabled') + '>' +
               '<span class="bk-time-main">' + prettyTime(s.time) + '</span>' +
               (data.same_as_uk ? '' :
                 '<span class="bk-time-uk">' + prettyTime(s.uk_time) + ' UK</span>') +
               '</button>';
      }).join('') + '</div>');
    });

    el.times.innerHTML = html.join('');

    el.times.querySelectorAll('.bk-time:not([disabled])').forEach(function (b) {
      b.addEventListener('click', function () {
        state.slot      = b.getAttribute('data-slot');
        state.slotLocal = b.getAttribute('data-local');
        state.slotUk    = b.getAttribute('data-uk');
        el.times.querySelectorAll('.bk-time').forEach(function (o) { o.classList.remove('is-selected'); });
        b.classList.add('is-selected');
        el.submit.disabled = false;
        showError('');
      });
    });
  }

  // ── Submit ──────────────────────────────────────────────────────
  function submit() {
    if (state.sending) return;
    if (!state.slot) { showError('Please choose a time.'); return; }

    state.sending = true;
    el.submit.disabled = true;
    el.submit.textContent = 'Booking...';
    showError('');

    fetch(apiBase() + '/public-lead-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:    val('#bkName'),
        email:   val('#bkEmail'),
        phone:   val('#bkPhone'),
        company: val('#bkCompany'),
        website: val('#bkWebsite'),   // honeypot
        slot:    state.slot,          // UK wall clock, straight from the API
        tz:      state.tz
      })
    })
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error((res.body && res.body.error) || 'Something went wrong.');
        el.when.textContent = prettyDate(state.date) + ' at ' + prettyTime(state.slotLocal);
        var differs = state.slotUk && state.slotUk !== state.slotLocal;
        el.doneUk.textContent = differs ? 'That is ' + prettyTime(state.slotUk) + ' UK time.' : '';
        el.doneUk.hidden = !differs;
        goTo('done');
      })
      .catch(function (e) {
        showError(e.message || 'Something went wrong. Please try again.');
        // A 409 means the slot went while they were typing — refresh it.
        if (/taken|passed/i.test(e.message || '')) loadTimes();
      })
      .then(function () {
        state.sending = false;
        el.submit.disabled = false;
        el.submit.textContent = 'Confirm Booking';
      });
  }

  // ── Triggers ────────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    var trigger = e.target.closest && e.target.closest('[data-book-call]');
    if (!trigger) return;
    e.preventDefault();
    open();
  });

  // Let other scripts open it directly.
  window.BRSBooking = { open: open, close: close };
})();

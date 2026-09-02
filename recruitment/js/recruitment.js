/* ============================================================
   Built Right Recruitment — interactions
   Sticky nav · mobile menu · scroll-reveal · smooth anchor scroll
   · client-side form handling (no backend wired yet)
   ============================================================ */
(function () {
  'use strict';

  var nav = document.getElementById('nav');
  var navToggle = document.getElementById('navToggle');

  /* ---- Sticky nav state on scroll ---- */
  function onScroll() {
    if (window.scrollY > 20) nav.classList.add('scrolled');
    else nav.classList.remove('scrolled');
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---- Mobile menu toggle ---- */
  if (navToggle) {
    navToggle.addEventListener('click', function () { nav.classList.toggle('open'); });
  }
  // Close the mobile menu after tapping a link.
  document.querySelectorAll('#navLinks a').forEach(function (a) {
    a.addEventListener('click', function () { nav.classList.remove('open'); });
  });

  /* ---- Scroll reveal via IntersectionObserver ---- */
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  /* ---- CMS API base ----
     Production site is builtrightrecruitment.co.uk, a separate domain from the
     CMS, so we can't use a relative path there. Local dev keeps the relative
     XAMPP path; production points at the CMS's public API origin.
     >>> SET PROD_CMS_API to the CMS's real URL (its `/cc/api`). <<<
     CORS on the CMS is already open (Access-Control-Allow-Origin: *). */
  var PROD_CMS_API = 'https://builtrightstudio.com/cc/api'; // CMS lives under the main domain at /cc
  var isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var CMS_API = isLocal ? '/builtrightstudio/cms/api' : PROD_CMS_API;

  function showSuccess(key) {
    var s = document.getElementById(key + 'Success');
    var e = document.getElementById(key + 'Error');
    if (e) e.classList.remove('show');
    if (s) { s.classList.add('show'); s.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }
  function showError(key, msg) {
    var s = document.getElementById(key + 'Success');
    var e = document.getElementById(key + 'Error');
    if (s) s.classList.remove('show');
    if (e) { e.textContent = msg; e.classList.add('show'); e.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }

  /* Submit a form to the CMS as multipart/form-data (handles file uploads). */
  function submitToCms(form, endpoint, key) {
    var btn = form.querySelector('button[type="submit"]');
    var label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
    fetch(CMS_API + endpoint, { method: 'POST', body: new FormData(form) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok && res.j && res.j.ok) { showSuccess(key); form.reset(); }
        else { showError(key, (res.j && res.j.error) || 'Sorry, something went wrong. Please try again or email us directly.'); }
      })
      .catch(function () { showError(key, 'Network error — please check your connection and try again.'); })
      .finally(function () { if (btn) { btn.disabled = false; btn.textContent = label; } });
  }

  document.querySelectorAll('form[data-form]').forEach(function (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var key = form.getAttribute('data-form');
      if (key === 'candidate') { submitToCms(form, '/public-recruitment-apply', 'candidate'); return; }
      if (key === 'client')    { submitToCms(form, '/public-recruitment-client', 'client'); return; }
      if (key === 'contact')   { submitToCms(form, '/public-recruitment-contact', 'contact'); return; }
      showSuccess(key); form.reset();
    });
  });

  /* ---- Opportunity cards: scroll to the CV form + prefill Current Role ---- */
  function pickRole(card) {
    var role = card.getAttribute('data-role') || '';
    var form = document.getElementById('candidate-form');
    var input = form ? form.querySelector('input[name="role"]') : null;
    if (input) input.value = role;
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (input) setTimeout(function () { input.focus({ preventScroll: true }); }, 600);
  }
  document.querySelectorAll('.opp-card').forEach(function (card) {
    card.addEventListener('click', function () { pickRole(card); });
    card.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pickRole(card); }
    });
  });

  /* ---- Current year in footer ---- */
  var yr = document.getElementById('year');
  if (yr) yr.textContent = new Date().getFullYear();
})();

/* ============================================================
   Built Right — Platform site interactions
   Nav · mobile menu · scroll-reveal · count-up · tabbed showcase ·
   carousel · gallery + lightbox · FAQ accordion · billing toggle ·
   demo form → CMS lead intake.
   ============================================================ */
(function () {
  'use strict';

  var nav = document.getElementById('nav');

  /* ---- The ONLY nav JS: is the page at the top or scrolled? ----
     rAF-throttled, with a dead-zone (add >60, remove <10) so the bar can't
     flip-flop between transparent/solid near the threshold. The mobile menu
     is pure CSS (a checkbox toggle) — no JS. */
  var navTicking = false;
  function applyNav() {
    navTicking = false;
    if (!nav) return;
    var y = window.scrollY;
    if (y > 60) nav.classList.add('scrolled');
    else if (y < 10) nav.classList.remove('scrolled');
  }
  function onScroll() {
    if (!navTicking) { navTicking = true; requestAnimationFrame(applyNav); }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  applyNav();

  /* ---- Scroll reveal ---- */
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(function (el) { io.observe(el); });
  } else { reveals.forEach(function (el) { el.classList.add('in'); }); }

  /* ---- Count-up stats ---- */
  var counters = document.querySelectorAll('[data-count]');
  if (counters.length && 'IntersectionObserver' in window) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target, target = parseFloat(el.getAttribute('data-count'));
        var suffix = el.getAttribute('data-suffix') || '', dur = 1200, t0 = null;
        function tick(ts) {
          if (!t0) t0 = ts;
          var p = Math.min((ts - t0) / dur, 1);
          var val = Math.round(target * (0.5 - Math.cos(Math.PI * p) / 2) * 10) / 10;
          el.textContent = (Number.isInteger(target) ? Math.round(val) : val) + suffix;
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        cio.unobserve(el);
      });
    }, { threshold: 0.4 });
    counters.forEach(function (el) { cio.observe(el); });
  }

  /* ---- Tabbed module showcase ---- */
  document.querySelectorAll('[data-tabs]').forEach(function (wrap) {
    var tabs = wrap.querySelectorAll('.tab');
    var panes = wrap.querySelectorAll('.tab-pane');
    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('active'); });
        panes.forEach(function (p) { p.classList.remove('active'); });
        tab.classList.add('active');
        if (panes[i]) panes[i].classList.add('active');
      });
    });
  });

  /* ---- Carousel ---- */
  document.querySelectorAll('[data-carousel]').forEach(function (car) {
    var track = car.querySelector('.carousel-track');
    var slides = car.querySelectorAll('.carousel-slide');
    var dotsWrap = car.querySelector('.carousel-dots');
    var idx = 0, n = slides.length, timer = null;
    if (!track || !n) return;
    var dots = [];
    if (dotsWrap) {
      for (var i = 0; i < n; i++) {
        var b = document.createElement('button');
        b.setAttribute('aria-label', 'Slide ' + (i + 1));
        (function (j) { b.addEventListener('click', function () { go(j); restart(); }); })(i);
        dotsWrap.appendChild(b); dots.push(b);
      }
    }
    function go(i) {
      idx = (i + n) % n;
      track.style.transform = 'translateX(-' + (idx * 100) + '%)';
      dots.forEach(function (d, j) { d.classList.toggle('active', j === idx); });
    }
    function next() { go(idx + 1); }
    function prev() { go(idx - 1); }
    function restart() { if (timer) clearInterval(timer); timer = setInterval(next, 5000); }
    var nx = car.querySelector('.carousel-btn.next'), pv = car.querySelector('.carousel-btn.prev');
    if (nx) nx.addEventListener('click', function () { next(); restart(); });
    if (pv) pv.addEventListener('click', function () { prev(); restart(); });
    car.addEventListener('mouseenter', function () { if (timer) clearInterval(timer); });
    car.addEventListener('mouseleave', restart);
    go(0); restart();
  });

  /* ---- Galleries: each filter bar scoped to its own gallery; shared lightbox ---- */
  var lb = document.getElementById('lightbox');
  var lbImg = lb ? lb.querySelector('img') : null;
  var lbCap = lb ? lb.querySelector('.lb-cap') : null;
  var lbList = [], lbCur = 0;
  function lbVisible() { return lbList.filter(function (s) { return s.style.display !== 'none'; }); }
  function openLb(list, idx) {
    if (!lb) return;
    lbList = list; lbCur = idx;
    var s = list[idx]; if (!s) return;
    var img = s.querySelector('img');
    lbImg.src = img ? img.src : '';
    lbImg.style.display = img ? '' : 'none';
    lbCap.textContent = s.getAttribute('data-cap') || '';
    lb.classList.add('open'); document.body.style.overflow = 'hidden';
  }
  function lbMove(d) {
    var v = lbVisible(); if (!v.length) return;
    var i = v.indexOf(lbList[lbCur]); if (i < 0) i = 0;
    openLb(lbList, lbList.indexOf(v[(i + d + v.length) % v.length]));
  }
  function closeLb() { if (lb) { lb.classList.remove('open'); document.body.style.overflow = ''; } }

  document.querySelectorAll('.gallery').forEach(function (gallery) {
    var shots = Array.prototype.slice.call(gallery.querySelectorAll('.shot'));
    var bar = gallery.parentElement ? gallery.parentElement.querySelector('.filter-bar') : null;
    if (bar) {
      bar.querySelectorAll('.filter-chip').forEach(function (chip) {
        chip.addEventListener('click', function () {
          bar.querySelectorAll('.filter-chip').forEach(function (c) { c.classList.remove('active'); });
          chip.classList.add('active');
          var f = chip.getAttribute('data-filter');
          shots.forEach(function (s) {
            var tags = (s.getAttribute('data-tags') || '');
            s.style.display = (f === 'all' || tags.indexOf(f) > -1) ? '' : 'none';
          });
        });
      });
    }
    shots.forEach(function (s) {
      s.addEventListener('click', function () { openLb(shots, shots.indexOf(s)); });
    });
  });

  if (lb) {
    lb.querySelector('.lb-close').addEventListener('click', closeLb);
    lb.querySelector('.lb-nav.next').addEventListener('click', function () { lbMove(1); });
    lb.querySelector('.lb-nav.prev').addEventListener('click', function () { lbMove(-1); });
    lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
    document.addEventListener('keydown', function (e) {
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') closeLb();
      if (e.key === 'ArrowRight') lbMove(1);
      if (e.key === 'ArrowLeft') lbMove(-1);
    });
  }

  /* ---- FAQ accordion ---- */
  document.querySelectorAll('.faq-item').forEach(function (item) {
    var q = item.querySelector('.faq-q'), a = item.querySelector('.faq-a');
    q.addEventListener('click', function () {
      var open = item.classList.toggle('open');
      a.style.maxHeight = open ? a.scrollHeight + 'px' : '0';
    });
  });

  /* ---- Pricing billing toggle (monthly / annual) ---- */
  document.querySelectorAll('[data-bill]').forEach(function (wrap) {
    var btns = wrap.querySelectorAll('button');
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        btns.forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        var mode = b.getAttribute('data-mode');
        document.querySelectorAll('[data-monthly]').forEach(function (el) {
          el.textContent = el.getAttribute(mode === 'annual' ? 'data-annual' : 'data-monthly');
        });
        document.querySelectorAll('[data-per]').forEach(function (el) {
          el.textContent = mode === 'annual' ? '/mo billed annually' : '/month';
        });
      });
    });
  });

  /* ---- CMS API base (same host-aware pattern as the recruitment site) ---- */
  var PROD_CMS_API = 'https://builtrightstudio.com/cc/api';
  var isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var CMS_API = isLocal ? '/builtrightstudio/cms/api' : PROD_CMS_API;

  function showSuccess(key) {
    var s = document.getElementById(key + 'Success'), e = document.getElementById(key + 'Error');
    if (e) e.classList.remove('show');
    if (s) { s.classList.add('show'); s.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }
  function showError(key, msg) {
    var s = document.getElementById(key + 'Success'), e = document.getElementById(key + 'Error');
    if (s) s.classList.remove('show');
    if (e) { e.textContent = msg; e.classList.add('show'); e.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }
  function submitToCms(form, endpoint, key) {
    var btn = form.querySelector('button[type="submit"]'), label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
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
      // Demo / contact form → CMS lead intake (endpoint TBD server-side).
      if (key === 'demo') { submitToCms(form, '/public-platform-demo', 'demo'); return; }
      showSuccess(key); form.reset();
    });
  });

  /* ---- Footer year ---- */
  var yr = document.getElementById('year');
  if (yr) yr.textContent = new Date().getFullYear();
})();

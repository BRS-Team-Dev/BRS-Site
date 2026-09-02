/* site-view.js — page-specific behaviour for site-view*.html.
 * Extracted from previously inline <script> blocks so the HTML
 * stays clean. Idempotent per element (queries once, no rebinding). */

(function () {
  'use strict';

  // ── Missing-image placeholders ─────────────────────────────────
  // The device-mockup <img>s used to use onerror="…" handlers to
  // hide themselves and let the diagonal placeholder pattern show
  // through. Handle it here instead.
  document.querySelectorAll('.sv-screen img').forEach(function (img) {
    img.addEventListener('error', function () {
      img.classList.add('sv-missing');
      img.removeAttribute('src');
    });
    // Element already errored (e.g. cached 404) — trigger the same path.
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) {
      img.classList.add('sv-missing');
      img.removeAttribute('src');
    }
  });
  document.querySelectorAll('.sv-fullimage-img').forEach(function (img) {
    img.addEventListener('error', function () {
      img.classList.add('is-missing');
      img.removeAttribute('src');
      img.alt = '';
    });
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) {
      img.classList.add('is-missing');
      img.removeAttribute('src');
      img.alt = '';
    }
  });

  // ── Image slider (.sv-slider) ──────────────────────────────────
  (function initSlider() {
    var root = document.querySelector('.sv-slider');
    if (!root) return;
    var vp    = root.querySelector('.sv-slider-viewport');
    var track = root.querySelector('.sv-slides');
    var slides = Array.prototype.slice.call(root.querySelectorAll('.sv-slide'));
    var dotsWrap = root.querySelector('.sv-dots');
    if (!vp || !track || !dotsWrap || slides.length === 0) return;
    var n = slides.length;
    var index = 0;

    var dots = slides.map(function (_, i) {
      var d = document.createElement('button');
      d.type = 'button';
      d.className = 'sv-dot';
      d.setAttribute('role', 'tab');
      d.setAttribute('aria-label', 'Slide ' + (i + 1));
      d.addEventListener('click', function () { go(i); });
      dotsWrap.appendChild(d);
      return d;
    });

    function setX(pct) { track.style.transform = 'translateX(' + pct + '%)'; }
    function go(i) {
      index = (i % n + n) % n;
      track.style.transition = '';
      setX(-index * 100);
      dots.forEach(function (d, di) {
        d.classList.toggle('is-active', di === index);
        d.setAttribute('aria-selected', di === index ? 'true' : 'false');
      });
    }
    root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') go(index - 1);
      else if (e.key === 'ArrowRight') go(index + 1);
    });

    // Drag / swipe (mouse + touch via Pointer Events).
    var dragging = false, startX = 0, dx = 0, width = 1;
    function onDown(e) {
      if (e.button != null && e.button !== 0) return;
      dragging = true; dx = 0;
      startX = e.clientX;
      width = vp.clientWidth || 1;
      track.style.transition = 'none';
      vp.classList.add('is-dragging');
    }
    function onMove(e) {
      if (!dragging) return;
      dx = e.clientX - startX;
      setX(-index * 100 + (dx / width) * 100);
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      vp.classList.remove('is-dragging');
      track.style.transition = '';
      if (Math.abs(dx) > width * 0.15) go(index + (dx < 0 ? 1 : -1));
      else go(index);
      dx = 0;
    }
    vp.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    vp.addEventListener('dragstart', function (e) { e.preventDefault(); });

    go(0);
  })();

  // ── Full-page video (.sv-fullvideo) ────────────────────────────
  (function initFullVideo() {
    var section = document.querySelector('[data-sv-fullvideo]');
    if (!section) return;
    var video = section.querySelector('video');
    var mute  = section.querySelector('[data-sv-mute]');
    if (!video || !mute) return;

    // Click anywhere except the mute button toggles play/pause.
    section.addEventListener('click', function (e) {
      if (e.target.closest('[data-sv-mute]')) return;
      if (video.paused) video.play(); else video.pause();
    });
    video.addEventListener('play',  function () { section.classList.remove('is-paused'); });
    video.addEventListener('pause', function () { section.classList.add('is-paused'); });

    mute.addEventListener('click', function (e) {
      e.stopPropagation();
      video.muted = !video.muted;
      section.classList.toggle('is-unmuted', !video.muted);
      mute.setAttribute('aria-label', video.muted ? 'Unmute video' : 'Mute video');
    });
  })();
})();

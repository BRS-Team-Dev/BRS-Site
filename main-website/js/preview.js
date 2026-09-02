/* preview.js — page-specific behaviour for preview.html.
 * Extracted from previously inline <script> blocks so the HTML
 * stays clean. Two independent IIFEs:
 *   1. Video grid — hover-to-play tiles + click-to-lightbox
 *   2. Gallery strip — 4 tiles, click opens a full-page lightbox
 *      with a thumbnail picker and slide-in transitions
 */

(function () {
  'use strict';

  // ── FULL-VIDEO FEATURE mute toggle (.preview-video) ────────────
  (function initFeatureMute() {
    var section = document.querySelector('[data-pv-section]');
    if (!section) return;
    var video = section.querySelector('.preview-video-media');
    var mute  = section.querySelector('[data-pv-mute]');
    if (!video || !mute) return;

    mute.addEventListener('click', function (e) {
      e.stopPropagation();
      video.muted = !video.muted;
      section.classList.toggle('is-unmuted', !video.muted);
      mute.setAttribute('aria-label', video.muted ? 'Unmute video' : 'Mute video');
      if (!video.muted) {
        var p = video.play();
        if (p && p.catch) p.catch(function () {});
      }
    });
  })();

  // ── VIDEO GRID (.vg-tile → #vgLightbox) ────────────────────────
  (function initVideoGrid() {
    var lightbox = document.getElementById('vgLightbox');
    if (!lightbox) return;
    var lbVideo = lightbox.querySelector('.vg-lightbox-video');
    var lbClose = lightbox.querySelector('.vg-lightbox-close');
    if (!lbVideo || !lbClose) return;

    function openLightbox(src) {
      lbVideo.src = src;
      lightbox.hidden = false;
      // Next frame so the opacity transition runs.
      requestAnimationFrame(function () { lightbox.classList.add('is-open'); });
      var p = lbVideo.play();
      if (p && p.catch) p.catch(function () {});
      document.body.style.overflow = 'hidden';
    }
    function closeLightbox() {
      lightbox.classList.remove('is-open');
      lbVideo.pause();
      document.body.style.overflow = '';
      setTimeout(function () {
        lightbox.hidden = true;
        lbVideo.removeAttribute('src');
        lbVideo.load();
      }, 250);
    }

    lbClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', function (e) {
      if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !lightbox.hidden) closeLightbox();
    });

    document.querySelectorAll('.vg-tile').forEach(function (tile) {
      var video = tile.querySelector('.vg-video');
      if (!video) return;
      tile.addEventListener('mouseenter', function () {
        tile.classList.add('is-playing');
        var p = video.play();
        if (p && p.catch) p.catch(function () {});
      });
      tile.addEventListener('mouseleave', function () {
        tile.classList.remove('is-playing');
        video.pause();
        try { video.currentTime = 0; } catch (err) {}
      });
      tile.addEventListener('click', function () {
        openLightbox(tile.getAttribute('data-src'));
      });
    });
  })();

  // ── GALLERY STRIP (.gallery-tile → [data-lightbox]) ────────────
  //
  // Gallery data — edit these arrays to add/remove pictures.
  // `cover` optional; if omitted the first image in `images` is used
  // as the tile's cover.
  var GALLERIES = [
    { name: 'Gallery 01', cover: 'assets/images/inspiration/jewellery/SnapInsta.to_724287067_18105117722092442_1794015491274529794_n.jpg', images: [
        { src: 'assets/images/inspiration/jewellery/SnapInsta.to_724287067_18105117722092442_1794015491274529794_n.jpg', label: 'Jewellery 1' },
        { src: 'assets/images/inspiration/jewellery/SnapInsta.to_725767352_18105117566092442_7857999924986795027_n.jpg', label: 'Jewellery 2' },
        { src: 'assets/images/inspiration/jewellery/SnapInsta.to_726868171_18105117464092442_5237291526585691823_n.jpg', label: 'Jewellery 3' },
        { src: 'assets/images/inspiration/jewellery/SnapInsta.to_727393558_18105117443092442_3111772903502023883_n.jpg', label: 'Jewellery 4' },
      ] },
    { name: 'Gallery 02', cover: 'assets/images/inspiration/jewellery/SnapInsta.to_468992617_18308272345205514_6990975109356901035_n.jpg', images: [
        { src: 'assets/images/inspiration/jewellery/SnapInsta.to_468992617_18308272345205514_6990975109356901035_n.jpg', label: 'Jewellery 5' },
        { src: 'assets/images/inspiration/jewellery/SnapInsta.to_469064700_18308272381205514_8082453770140076585_n.jpg', label: 'Jewellery 6' },
        { src: 'assets/images/inspiration/jewellery/SnapInsta.to_469074146_18308272399205514_5032175992815396744_n.jpg', label: 'Jewellery 7' },
        { src: 'assets/images/inspiration/jewellery/SnapInsta.to_469110335_18308272372205514_7525222463289753031_n.jpg', label: 'Jewellery 8' },
      ] },
    { name: 'Gallery 03', cover: 'assets/images/inspiration/jewellery/SnapInsta.to_759752065_18100039496055789_2140021904421534308_n.jpg', images: [
        { src: 'assets/images/inspiration/jewellery/SnapInsta.to_759752065_18100039496055789_2140021904421534308_n.jpg', label: 'Jewellery 9' },
        { src: 'assets/images/inspiration/jewellery/SnapInsta.to_760211419_18100039505055789_4878053030941089971_n.jpg', label: 'Jewellery 10' },
        { src: 'assets/images/inspiration/jewellery/SnapInsta.to_760331613_18100039478055789_939384686199718825_n.jpg',  label: 'Jewellery 11' },
        { src: 'assets/images/inspiration/jewellery/SnapInsta.to_760378330_18100039487055789_4056786264501397743_n.jpg', label: 'Jewellery 12' },
        { src: 'assets/images/inspiration/jewellery/SnapInsta.to_760545578_18100039469055789_4969358543795347795_n.jpg', label: 'Jewellery 13' },
      ] },
    { name: 'Gallery 04', cover: 'assets/images/inspiration/jewellery/SnapInsta.to_670924789_17951012439132307_5281790891127416766_n.jpg', images: [
        { src: 'assets/images/inspiration/jewellery/SnapInsta.to_670924789_17951012439132307_5281790891127416766_n.jpg', label: 'Jewellery 14' },
        { src: 'assets/images/inspiration/jewellery/SnapInsta.to_670934372_17951012430132307_3578863971683297027_n.jpg', label: 'Jewellery 15' },
        { src: 'assets/images/inspiration/jewellery/SnapInsta.to_671193044_17951012466132307_6792463120435042665_n.jpg', label: 'Jewellery 16' },
        { src: 'assets/images/inspiration/jewellery/SnapInsta.to_671221092_17951012403132307_4723775129223528242_n.jpg', label: 'Jewellery 17' },
      ] },
  ];

  (function initGalleryStrip() {
    var lb = document.querySelector('[data-lightbox]');
    if (!lb) return;
    var lbImage   = lb.querySelector('[data-lightbox-image]');
    var lbTitle   = lb.querySelector('[data-lightbox-title]');
    var lbCounter = lb.querySelector('[data-lightbox-counter]');
    var lbThumbs  = lb.querySelector('[data-lightbox-thumbs]');
    if (!lbImage || !lbTitle || !lbCounter || !lbThumbs) return;

    // Paint the tile covers.
    document.querySelectorAll('[data-gallery-cover]').forEach(function (el) {
      var g = GALLERIES[+el.getAttribute('data-gallery-cover')];
      var src = g && (g.cover || (g.images[0] && g.images[0].src));
      if (src) el.style.backgroundImage = 'url("' + src + '")';
    });

    var state = { g: 0, i: 0 };

    function render() {
      var gal = GALLERIES[state.g];
      if (!gal) return;
      var img = gal.images[state.i];
      if (img && img.src) {
        lbImage.src = img.src;
        lbImage.alt = img.label || '';
        lbImage.style.display = '';
      } else {
        lbImage.removeAttribute('src');
        lbImage.style.display = 'none';
      }
      lbTitle.textContent   = gal.name + (img && img.label ? ' — ' + img.label : '');
      lbCounter.textContent = (state.i + 1) + ' / ' + gal.images.length;
      lbThumbs.querySelectorAll('.lightbox-thumb').forEach(function (t, idx) {
        t.setAttribute('aria-current', idx === state.i ? 'true' : 'false');
      });
    }

    function buildThumbs() {
      var gal = GALLERIES[state.g];
      lbThumbs.innerHTML = '';
      gal.images.forEach(function (img, idx) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'lightbox-thumb';
        if (img.src) b.style.backgroundImage = 'url("' + img.src + '")';
        b.setAttribute('aria-label', img.label || ('Image ' + (idx + 1)));
        b.addEventListener('click', function () { state.i = idx; render(); });
        lbThumbs.appendChild(b);
      });
    }

    // Belt-and-braces: hide the site's floating pill from JS so we
    // don't rely on :has() support. Restore it when the lightbox closes.
    var floatingCta = document.querySelector('.floating-cta');
    function open(gIdx) {
      state.g = gIdx; state.i = 0;
      buildThumbs();
      render();
      lb.hidden = false;
      document.body.style.overflow = 'hidden';
      if (floatingCta) floatingCta.style.display = 'none';
    }
    function close() {
      lb.hidden = true;
      document.body.style.overflow = '';
      if (floatingCta) floatingCta.style.display = '';
    }
    // Slide the current image out to the opposite side, swap the src,
    // then let CSS animate the new one in from the direction of travel.
    function step(delta) {
      var len = GALLERIES[state.g].images.length;
      state.i = (state.i + delta + len) % len;
      var dir  = delta > 0 ? 'right' : 'left';   // moving forward = new image enters from the right
      var away = delta > 0 ? 'left'  : 'right'; // old image leaves the opposite side
      lbImage.classList.add('is-leaving-' + away);
      setTimeout(function () {
        render();
        lbImage.classList.remove('is-leaving-' + away);
        lbImage.classList.add('is-entering-' + dir);
        // Force a reflow so the "entering" state paints before we drop
        // the class and let the transition run.
        void lbImage.offsetWidth;
        lbImage.classList.remove('is-entering-' + dir);
      }, 200);
    }

    document.querySelectorAll('.gallery-tile').forEach(function (t) {
      t.addEventListener('click', function () { open(+t.getAttribute('data-gallery')); });
    });
    lb.querySelector('[data-lightbox-close]').addEventListener('click', close);
    lb.querySelector('[data-lightbox-prev]').addEventListener('click',  function () { step(-1); });
    lb.querySelector('[data-lightbox-next]').addEventListener('click',  function () { step(1); });
    // Click backdrop (outside the stage) closes.
    lb.addEventListener('click', function (e) { if (e.target === lb) close(); });
    // Keyboard: ← → navigate, ESC closes.
    document.addEventListener('keydown', function (e) {
      if (lb.hidden) return;
      if (e.key === 'Escape')     close();
      if (e.key === 'ArrowLeft')  step(-1);
      if (e.key === 'ArrowRight') step(1);
    });
  })();
})();

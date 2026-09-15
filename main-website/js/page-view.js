/* page-view.js — count a view for tracked links.
 *
 * When a page is opened as  preview.html?id=2&id_type=lead  this records one
 * view against lead 2 on preview.html, via POST /api/public-page-view. Pages
 * opened without both parameters do nothing at all.
 *
 * The id is the Mailer's {{id}} placeholder, so a link written as
 *   https://builtrightstudio.com/preview.html?id={{id}}&id_type=lead
 * counts a view per lead that opens it.
 *
 * Counted from the browser rather than on the server because the page is a
 * static file — and it has a useful side effect: the link scanners email
 * providers run on incoming mail mostly fetch the HTML without executing
 * scripts, so most of them never register a view.
 *
 * Generic on purpose: include it on any page and that page is tracked under
 * its own file name.
 */

(function () {
  'use strict';

  // Same resolution as booking-modal.js: domain root + /cc/api in production,
  // sibling cms/api folder on local XAMPP. window.BRS_API_BASE overrides both.
  function apiBase() {
    if (window.BRS_API_BASE) return window.BRS_API_BASE;
    var m = window.location.pathname.match(/^(.*)\/main-website\//);
    return m ? m[1] + '/cms/api' : '/cc/api';
  }

  var params = new URLSearchParams(window.location.search);
  var id = (params.get('id') || '').trim();
  var idType = (params.get('id_type') || '').trim().toLowerCase();

  // Nothing to count without both halves. The server validates again.
  if (!/^\d+$/.test(id) || (idType !== 'lead' && idType !== 'client')) return;

  var path = window.location.pathname;
  var page = path.substring(path.lastIndexOf('/') + 1) || 'index.html';

  try {
    fetch(apiBase() + '/public-page-view', {
      method: 'POST',
      // Lets the request finish even if the visitor clicks away immediately.
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: page, id_type: idType, id: id })
    }).catch(function () { /* a failed count must never affect the page */ });
  } catch (e) {
    /* older browsers without fetch/keepalive: skip counting silently */
  }
})();

/* ============================================================
   REALITY FX — Student Portal service worker
   The portal's app shell, installable like an app.
   ------------------------------------------------------------
   Rules (deliberately conservative):
   • HTML is NETWORK-FIRST — the app always shows the newest
     build online; the cache only stands in when the network
     is gone (the registration page stays open offline).
   • Static assets (js/css/svg) are stale-while-revalidate —
     instant second visits, updated in the background.
   • /api/… is NEVER cached or intercepted — the state rail,
     the gate and the handoff always hit the live server.
   • Every release bumps CACHE so an updated build never
     serves a stale shell. Register only where the app runs
     (localhost demo + production origin).   */
'use strict';
const CACHE = 'rfx-portal-20260816-77';
const SHELL = ['./', './index.html', './register.html', './member.html', './assets/icons.js', './assets/favicon.svg', './css/system.css', './js/db.js', './js/ui.js', './js/bridge.js', './js/member.js', './js/register.js', './js/reception.js', './js/bot.js', './js/pdf.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var u;
  try { u = new URL(req.url); } catch (err) { return; }
  if (u.origin !== location.origin) return;
  if (u.pathname.indexOf('/api/') !== -1) return;      // state/gate/handoff — always live
  if (u.pathname.indexOf('manifest.webmanifest') !== -1) return; // never cache the manifest
  if (u.pathname.indexOf('.html') !== -1) {
    // network-first for pages: newest build wins online, cache stands in offline
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { return c.put(req, copy); }).catch(function () {});
        return res;
      }).catch(function () { return caches.match(req).then(function (hit) { return hit || caches.match('./index.html'); }); })
    );
    return;
  }
  // static assets: stale-while-revalidate
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { return c.put(req, copy); }).catch(function () {}); }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});

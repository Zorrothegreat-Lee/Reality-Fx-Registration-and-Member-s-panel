# 📱 REALITY FX — MOBILE STRATEGY · System A (the Student Portal)

*Written for the founder · 15 Aug 2026 · answers: "Lee is making a mobile app for the OS — do we make one for the Student Portal?"*

---

## The short answer

**Registration: always online, always web.** We agree with your instinct 100% —
the front desk never closes. It already works on every phone browser, and it
now also survives a dead connection through the portal's app shell.

**Student Portal: web-first + installable (a PWA), not a native app.**
The portal is thin and its data lives on the server — a native app would
re-implement what the browser already does, add an app-store review surface
for no real gain, and risk the two sides drifting out of sync. The OS is
where the heavy course content lives — **that is exactly what Lee's native
app should own.**

So the division of labour is clean:
| Surface | Home | Why |
|---|---|---|
| **Front desk / Registration** | Web, always online | The front door. Works on any phone, zero install. Now offline-tolerant too. |
| **Student Portal (My RFX Account)** | Web + installable PWA | Thin, server-backed. Installs like an app, updates itself, no store review. |
| **RFX OS (the Academy)** | Lee's native app (Android + iOS) | Heavy course content, offline learning, native notifications. This is where native earns its keep. |

---

## What we built this pass (already live)

1. **`manifest.webmanifest`** — "Reality FX — Student Portal", standalone
   display, black-and-gold theme, crown icon.
2. **`sw.js`** — a deliberately conservative service worker:
   - **HTML is network-first** — the newest build always wins online; the
     registration page stays open even when the connection drops.
   - **Static assets are stale-while-revalidate** — instant second visits,
     updated in the background.
   - **`/api/…` is never intercepted** — the state rail, the gate and the
     handshake always hit the live server. No stale data, ever.
   - Cache is versioned per release, so an update can never serve a stale
     shell.
3. **Wired into the three student pages** — `index.html`, `register.html`,
   `member.html` (manifest + theme colour + SW registration).
4. **Install buttons that behave** — "Put the portal on your phone" on the
   registration-complete screen and "Install app" on the member panel
   header. They appear **only when the browser can actually install**
   (Chrome/Edge/Android), show a gentle Share → Add to Home Screen hint on
   iPhone/iPad, and hide themselves once installed.

## Why not a native Student Portal app?

- **The portal is thin.** Identity, wallet, mailbox, standing — four cards.
  A browser renders them perfectly; a native app adds a download, an update
  cycle, and a second place to get out of sync.
- **Its data lives on the server.** Every screen is a live read of System A.
  The PWA gives you the app *feel* (own icon, own window, launches full
  screen) with zero duplication of the brain.
- **One brain, two shells is the rule.** Reuse before rebuild — the mobile
  brief's own headline. The portal PWA reuses System A's existing pages;
  Lee's OS app reuses the OS's existing rooms.

## The one thing that outranks all of this

**Registration must never go down.** That is Lee's §0/§2.1 deliverable —
always-on hosting (never a machine that can be switched off), HTTPS + HSTS,
a health endpoint System A can probe, and uptime monitoring. The PWA is the
app-layer polish; the always-on host is the actual promise. When Netlify
credits land, `deploy-live.sh` ships both.

## Version / status

System A **v72 (`20260815-72`)** — audit 21/21, self-test 5/5, all pages
zero console errors. Live preview: **http://127.0.0.1:8126** (the current
tree; 8125 was found serving a stale snapshot and will collapse back to one
port when the app next restarts its preview).

*Reality FX — The Trading Academy. The front desk never closes; the portal
lives on your phone; the Academy lives in your pocket.*

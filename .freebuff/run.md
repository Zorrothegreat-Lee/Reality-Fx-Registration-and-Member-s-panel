# Reality FX Registrar — preview run doc

## What needs reproducing (uncommitted artifacts)

None. The project is a static vanilla-JS app; there is no build step and no
`node_modules`. The only runtime artifact is the shared demo store file, which
the server creates on first save:

- `.freebuff/rfx-shared-store.json` — the demo's state, shared across ALL
  browsers on this machine via `/api/state`. It is created automatically when
  the app first saves (wipe it to reset the demo: `rfx-registration-system`
  Staff Console → the wipe path, or just delete the file — the app recreates
  it from defaults).

No `.env` files exist and none are needed.

## How to run the server

The preview runs a tiny Perl HTTP server (Git for Windows ships Perl; the core
`HTTP::Daemon` module is used). From the project root:

```bash
cd rfx-registration-system
RFX_ROOT="$(pwd)" RFX_PORT=8125 perl ../.freebuff/serve_fork.pl
```

- Serves the static app (`rfx-registration-system/`) on
  `http://127.0.0.1:8125`.
- `GET /api/state` → returns the shared demo store (single JSON file, the
  reason registration links work from ANY browser, not just the one that
  created the enrollment).
- `POST /api/state` → persists the state JSON (rev-guarded against stale
  writes, atomic temp-file + rename). A payload with `"wipe":true` bypasses
  the rev guard — the demo reset always wins, even against a stale high-rev
  state (the guard's one deliberate exception).
- `GET /api/gate?email=…` → the **gatekeeper contract** (v69): answers "can
  this identity come in?" from the store's `loginAttempts` record —
  `{"locked":false}` or `{"locked":true,"lockedUntil":"…","minutesLeft":N}`.
  `OPTIONS` answers CORS preflight for the OS origin. Production: Lee's OS
  Cloud Function calls this before issuing any session; the demo bridges it
  via `RFX.bridge.gateStatus(email)`.
- Default port 8123 (override with `RFX_PORT`).

To run detached with logging (as the preview does):

```bash
cd rfx-registration-system
RFX_ROOT="$(pwd)" RFX_PORT=8125 nohup perl ../.freebuff/serve_fork.pl \
  >> ../.freebuff/preview-4f40a73f-3234-4c50-9a13-44a3e0ccf6df.log 2>&1 &
```

If the port is already taken, kill the old listener first
(`taskkill //F //PID <pid>` on Windows).

## Demo reset

The demo ships "pristine": one 24-hour demo-pass enrollment (Leeroy Chirwa,
invoice INV-2026-0001) + one staff member (Sarah Mokoena). To rebuild it:
Staff Console → `RFX.db.wipe()` then mint a fresh pass, or simply delete
`.freebuff/rfx-shared-store.json` and open the app once.

## Port note (2026-08-11)

The thread's preview runs on **8125** (`RFX_PORT=8125`). Ports 8123 and 8124 are
still occupied by older server instances (owned by an elevated process — cannot
be killed from this shell) that serve a stale snapshot of the app; they are
harmless but must not be used for verification. Always verify against 8125.

## Preview renderer limitation

The preview pane sometimes stops firing `requestAnimationFrame` (a static
snapshot mode). rAF-driven animations can then appear frozen in the PREVIEW
TAB only — they run normally in any real browser. Verify animations in a real
browser tab, not the preview.

## v57 (2026-08-11)

The campus map is retired (founder's quality call) — `js/campus-tour.js` and
all map CSS are deleted; the reception page is a clean hero → doors grid.
Version markers bumped to `v=20260810-57` across all pages. New: DOB
birthday engine (`RFX.db.checkBirthdays()` — idempotent, once per year),
197-country dropdown on registration, and busy-locked + try/catch-registered
wizard buttons. FOR-LEE.md §9.49 documents the batch; the Desktop copy of
`RFX-FOR-LEE-UPDATE-v57.md` has the founder-facing summary.

## v58 (2026-08-14)

Crown brand matched to the OS: `assets/logo.svg` + `assets/favicon.svg` now
carry the gold crown mark (the old serif letterform the founder saw as a
"B" is gone), with the wordmark geometry fixed ("Registrar" no longer
overlaps; the sub-line no longer clips). New **staff shift-coverage
heatmap** on the Staff Portal (`db.coverageHeatmap` + admin-only
`db.seedCoverage` — 7×24 grid from real shift records, hover names,
coverage stats, labelled sample roster). The 2000-student load test was
re-verified live (10.4s, 21/21 audit, R0.00 reconciliation delta, codes
unique). Reception/staff pills now honestly say "no one on duty right now —
coverage gap" instead of "checking coverage…" when the team exists but
nobody is clocked in. Version stamps `v=20260810-58`. FOR-LEE.md §9.50;
Desktop: `RFX-FOR-LEE-UPDATE-v58.md`.

## Port note (15 Aug 2026, v72)

- The canonical preview now runs on **8126** (the current tree). 8125 was
  found occupied by an app-managed server serving a **stale snapshot**
  (`20260813-01` — pre-gate). If 8125 comes back on a future app restart it
  will serve the current tree and 8126 can be retired. Legacy demo forks
  8123/8124 (OS-thread demo, no `/api/gate`) are left untouched.
- The portal is now a PWA: `manifest.webmanifest` + `sw.js` wired into
  index/register/member (network-first HTML, stale-while-revalidate static,
  `/api/` never intercepted).

## Update (same pass, after admin approval)

- The three legacy forks (8123, 8124, 8125) were serving a stale snapshot
  and have been **retired**. The current tree now serves **8125** only —
  `RFX_ROOT="$(pwd)" RFX_PORT=8125 perl ../.freebuff/serve_fork.pl` from
  `rfx-registration-system`. The OS will re-point to it automatically when
  its academy health check runs.
- Portal icons generated: `assets/icon-192.png` + `assets/icon-512.png`
  (regenerate with `perl ../.freebuff/tools/…` → `powershell
  -File ../.freebuff/tools/make-portal-icons.ps1`).

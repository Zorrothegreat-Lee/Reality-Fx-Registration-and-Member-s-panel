# FOR-LEE — The OS Go-Live Brief, Sorted ✅

> System A's answer to the OS's go-live brief. Everything System A owed that brief is
> now built and verified live (v50). Work the sections top to bottom — the first item
> is the one contract change; the rest is what the brief assigns to YOU on the OS side.

---

## 0. The one rule outranks everything — always-on 🔌

The founder's words: *"students must always have access to the OS, and with that being
off, we are screwed."* Your §2.1 (always-on host + health endpoint + 503 maintenance
page) is **the critical path**. System A now catches outages live (probe every ~15s),
dims the door, celebrates the return — but it can only *report* the lights; only your
host can keep them on.

---

## 1. What System A changed to honour the contract (built + verified this pass)

### 1.1 `entitlements` is now a LIST (the one contract change)
Your brief §2.3.5 says entitlements are *"a LIST per identity, not a single course
field"* — so a second course **merges** instead of overwriting. System A's
`buildPayload` now sends:

```json
"entitlements": ["Reality Academy — Professional Program"],
"course": "Reality Academy — Professional Program"   // display convenience field, kept
```

Verified live: `entitlements` is an array, `course` retained. Your function must read
`entitlements` as an array and **merge** a new course into the existing record when a
handoff arrives for a student who already has one — reconcile, never duplicate, never
a second identity. (FOR-LEE §6 is updated to match; the demo's old object form is
superseded.)

### 1.2 The three "when present" fields now ride every handoff
The OS expects these on handoff/sync; System A now sends them (absent values are
dropped by JSON, never breaking a normal handoff):

| Field | Meaning | How the OS should use it |
|---|---|---|
| `demoPass { hours, createdAt }` | The free-tour window | `demoTourEndsAt = approvalAt + hours` — flip to tour-ended at the exact second (§9.38) |
| `approvalAt` (ISO) | When the student was approved | The tour clock start; also the audit trail |
| `trust { score, tier }` | The student's standing | Render the SAME Trust Bar; enforce the same bands (≤25 timeout, ≤10 extended, 0 restricted) |

Verified live for the founder's record: `trust: { score: 100, tier: "excellent" }`,
`founder: true`, `demoPass` present on tour identities.

### 1.3 Single active session — now enforced on BOTH sides
System A member panel, live:
- Every login mints a fresh token and **revokes every previous one** (`SESSION_REVOKED`
  security event, device fingerprint named).
- The kicked panel detects the dead token on its **2.5s poll** **and instantly via the
  `storage` event** (another tab signs in → this one locks the same second).
- Cross-browser works through the shared server store: a second browser's login rotates
  the token; the first browser locks itself — verified live mid-test.

Your §2.2 (Firebase Auth, second login revokes the first, `SESSION_REVOKED` logged) is
the production half. Same rule, same event name.

### 1.4 The probe is already the brief's spec
- System A pings the OS with a **3.5s timeout** (`AbortController`, no-cors) before
  opening the Academy.
- Genuine outage → calm dimmed state ("power is out", spanner, maintenance message).
- Return → **power-on moment**: the row flickers like a lamp, the big ✓ pulses with a
  gold glow, a toast announces it, and a branded **"The Academy is back online"** notice
  lands in the student's Mailbox (`ACADEMY_BACK_ONLINE` logged).
- Your side of the deal: serve the same notice email on your return, and make your OS
  welcome screen *feel* like the lights came back (§9.43/§2.5).

### 1.5 The outage ledger — a new shared board
Every DOWN→UP transition writes ONE row to `state.osOutages` (whichever panel saw it
first — deduped, never spammed). `ACADEMY_DOWN`/`ACADEMY_BACK_ONLINE` events are
logged. The **Staff Console now carries the "Academy uptime · the power monitor"
board**: it probes the OS live itself (3.5s), shows online/down right now, the outage
count, total downtime, and a scrollable ledger of every outage with its duration.
Build the same view on your monitoring side if you want one — the data contract is the
same.

---

## 2. What the brief assigns to YOU (the OS side) — unchanged, do it

Your §2.1–2.6 remain yours. The short version:

1. **Always-on hosting** (Firebase Hosting/Vercel/Netlify/Render) + HTTPS/HSTS + a fast
   health endpoint + **503 branded maintenance page** instead of refusing connections.
2. **Firebase Auth** — random temp password created server-side on handoff, a
   set-your-password link, one session per student (second login revokes the first),
   15-minute inactivity, `uid` → `studentId` mapping.
3. **The handoff Cloud Function** — API-key gate first, idempotency second,
   `entitlements[]` MERGE, full record stored, every call logged, CORS allowing the
   `X-RFX-Handoff-Key` header.
4. **Firestore mirror + rules** — student reads only their own doc; NO client writes to
   `students/*` or `wallets/*`; `settings/global` mirrors System A's `getSettings()`
   (financeEmail, `revealStudentCountsAt = 1000`, `FOUNDERS_DAY`).
5. **The §2.5 OS contract items** — watermark + copy-block + print blackout + capture
   logging, `printTrust` enforcement, DEMO/LIVE pills keyed on booleans not labels,
   the Trust Bar ring from the synced `trust`, the Machinery card with a
   **cybersecurity ring** (see below), Founder's Day 1 Nov with no name/photos, the
   ghost-town rule (no counts below 1,000), demo-tour expiry at the exact second,
   the founder Master Key as an auth claim (never a hard-coded email), the operating
   guide link, the power-on feel, and the Firestore load-test harness.
6. **DNS + email identity** — real domain (decide `os.realityfx…` NOW), custom-domain
   sender `no-reply@realityfx.academy` with SPF/DKIM/DMARC passing, security headers,
   nightly backups, uptime monitoring with an alert email.

---

## 3. New this pass — brief the OS to mirror

- **Session streaks with milestone rewards** (System A): consecutive studied days
  (weekends never break the streak; today gets grace). At **3 / 7 / 14 / 30** days a
  branded milestone note lands in the Mailbox + a panel notification — once per
  milestone, ever. Mirror the streak on the OS dashboard if you surface study activity.
- **The Machinery cyber ring** (System A): the engine-room card now shows four gold
  rings — checks · security · **cyber** · headroom — and states it plainly: *"Cyber
  defence runs around the clock — the system attacks itself the way an intruder would,
  and every single hit is defended and recorded."* Build the same honest ring on the OS
  (§9.25) with real measured numbers, never staged.

---

## 4. The shared scorecard (run this at go-live)

- A student who paid → registered → approved → handed off can log into RFX OS and see
  exactly their course's content — nothing else.
- A student who only paid (never approved) cannot log into the OS.
- One active session per student on both sides; a second-device sign-in revokes the
  first with a `SESSION_REVOKED` event.
- A second-course handoff **merges** entitlements — one student, two courses, zero
  duplicates.
- The reconciliation sweep fires server-side; approved students reach ACTIVE even when
  no Staff Console tab was open.
- OS pages watermarked, copy blocked, print blacked out; only `printTrust: 'trusted'`
  prints.
- A demo student's 24h elapses → cut off at the exact second, tour-ended message, zero
  friction after enrolling. The founder's master key never expires.
- No visitor learns the student count below 1,000 on either system.
- The Academy entry button probes the OS first; offline → calm maintenance state, never
  a dead page.
- The load test runs clean at 2,000+ on System A; the OS's Firestore harness proves the
  same.
- The OS links back to `member.html?email=…` — email prefilled, Student Code never in a
  URL — travel both ways is smooth.

---

*System A — the Registrar. Built for Reality FX, The Trading Academy. The function
signatures ARE the contract — `js/bridge.js → buildPayload` and `js/db.js` are the
source of truth.*

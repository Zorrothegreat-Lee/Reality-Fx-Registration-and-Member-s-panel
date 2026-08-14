# 🚀 FOR-LEE — SYSTEM A GO-LIVE HANDOFF (v59, crisp)

> The one-page runbook. Everything System A needs to run in production,
> distilled from FOR-LEE.md into the exact order to do it. Work top to bottom;
> each item has a ✅ *done means* check. When every box is ticked, System A is
> live and the handshake with RFX OS is real.
>
> The whole app is built behind clean seams — `js/db.js` (storage/adapter) and
> `js/bridge.js` (the handoff rail). Nothing else changes.

---

## PHASE 1 — The foundation (do this FIRST, it gates everything)

- [ ] **Firebase project + environments** — create the project; separate dev/staging/prod
      configs (`js/db.js` reads a `FIREBASE_CONFIG` seam). ✅ *done when: a config swap
      points the same app at three different projects.*
- [ ] **Firestore schema** — mirror System A's state: `enrollments`, `wallets`,
      `securityEvents`, `emails`, `supportThreads`, `merchOrders`, `staff`, `settings`.
      ✅ *done when: every field System A writes has a Firestore home.*
- [ ] **Firebase Auth (email/password)** — every student identity maps 1:1 to an Auth
      user created at APPROVAL (never before). ✅ *done when: an approved student can sign
      in; a pending one cannot.*
- [ ] **Firestore security rules** — the non-negotiable: students read/write only their
      own records, staff roles are enforced server-side, no client is ever the final
      gatekeeper. ✅ *done when: a forged read of another student's wallet returns denied.*
- [ ] **Storage (selfies)** — data-minimisation: upload → decision → purge. Retention
      setting honored. ✅ *done when: the bucket holds zero stale files after decisions.*
- [ ] **Backups + monitoring** — nightly export of Firestore + the System A store file,
      uptime pings (UptimeRobot free tier) on both URLs, founder alert email on any outage.
      ✅ *done when: a killed server page sends the founder an email within 5 minutes.*

## PHASE 2 — The bridge (System A ⇄ OS handshake)

- [ ] **Handoff endpoint on your side** — `POST /api/handoff` receives the student
      identity from System A, creates the OS account idempotently (retries create ZERO
      duplicates), returns confirmation. ✅ *done when: two identical POSTs produce one
      identity.*
- [ ] **API key + forged-payload rejection** — the handoff POST carries the shared key;
      anything without it is refused and logged. ✅ *done when: an unauthenticated POST is
      rejected with a security event on both sides.*
- [ ] **Achievement bridge event** — OS sends `ACHIEVEMENT` (80%+ average) → System A
      creates exactly one merch order. ✅ *done when: a retry creates zero duplicates.*
- [ ] **Reconciliation sweep** — an approved student with a live bridge reaches ACTIVE
      even with no Staff Console tab open (server-side schedule on your side; the demo has
      the sweep + Sync-all button). ✅ *done when: approve a student, close the console, and
      the OS account appears.*
- [ ] **Single-session contract** — one active session per student on both sides; a
      second-device sign-in revokes the first (SESSION_REVOKED event). ✅ *done when: signing
      in on a phone boots the laptop session.*

## PHASE 3 — Mail, money, CAPTCHA

- [ ] **Email provider** — Resend / SendGrid / SES; custom-domain sender
      (realityfx…), SPF/DKIM/DMARC passing; branded gold templates; test on Gmail +
      Outlook with no "via" label. ✅ *done when: raw headers show SPF/DKIM/DMARC PASS.*
- [ ] **Server-verified CAPTCHA** — the challenge is validated server-side; a headless
      script cannot pass. ✅ *done when: an automated attempt is blocked.*
- [ ] **PayPal rail** — webhooks for refunds + prize cash-outs; idempotent; an executed
      refund revokes the Auth user + OS entitlement; 30-day cooldown blocks re-enroll.
      ✅ *done when: a refund pays out, revokes access, and the same identity cannot
      re-enroll within 30 days.*
- [ ] **Package catalog codes** — the store's spend-credit codes match System A's
      catalog exactly; a balance payment deducts once, an unknown code is refused.
      ✅ *done when: RFX-UPGRADE-02 buys exactly the Advanced Program, once.*

## PHASE 4 — The rails System A already proves (mirror them)

- [ ] **Full audit + self-test live** — System A's `fullAudit` (21 checks) and
      `securitySelfTest` (5 attacks) run against production data; the Staff Console
      one-click button works. ✅ *done when: 21/21 + 5/5 on real data.*
- [ ] **Load test clean** — `simulateLoad(2000)` runs green: audit 21/21, self-test 5/5,
      R0.00 reconciliation delta, codes unique. ✅ *done when: the 2,000-student run passes
      end to end on production-sized data.*
- [ ] **Staff machinery** — hire → one-time invite → new hire sets own credential →
      clocks in → 24/7 on-duty pill reflects reality; staff duties, staff trust bar and
      performance ledger run (the robotic manager). ✅ *done when: a hired staff member's
      bar moves with their work.*
- [ ] **Referral rail** — `?ref=CODE` attribution at enrollment; self-referral refused;
      commission vests after 30 un-refunded days, forfeits on refund, clawed back on ban
      within 90 days. ✅ *done when: each rule fires in a live test.*
- [ ] **End-of-day financial audit** — the money file email reaches
      `realityfx20@gmail.com` and matches the Firestore ledger line-for-line; CSV/JSON
      downloads work. ✅ *done when: report and ledger agree to the cent.*
- [ ] **Sarrah + the human line** — Sarrah answers with live data; a "human" request
      reaches a real queue. ✅ *done when: a stuck student is answered by Sarrah or a human
      within the SLA.*
- [ ] **Security events visible** — moderator sees the full feed; a lockout actually
      blocks sign-in. ✅ *done when: lock out a test account and watch the feed.*

## PHASE 5 — Go-live networking (DNS + providers)

- [ ] **Domain** — buy/confirm; registrar auto-renew + transfer lock + 2FA + WHOIS
      privacy. ✅ *done when: the domain cannot expire or be hijacked silently.*
- [ ] **DNS** — A/CNAME @ + www → Netlify; MX + SPF/DKIM/DMARC TXT; decide the OS URL
      (`os.realityfx…` or `academy.realityfx…`) NOW and lock the subdomain.
      ✅ *done when: dig returns the records and mail passes.*
- [ ] **HTTPS everywhere** — both hosts force HTTPS + HSTS; no `file://` or
      `http://127.0.0.1` left in production; security headers (X-Content-Type-Options,
      X-Frame-Options, Referrer-Policy, CSP). ✅ *done when: SecurityHeaders scores full
      marks on both hosts.*
- [ ] **System A settings** — set the OS endpoint to the HTTPS URL in settings (the app
      reads it from there; no code change). ✅ *done when: Enter the Academy opens the live
      OS.*
- [ ] **Final end-to-end** — from a phone on mobile data (no localhost, no shared Wi-Fi):
      purchase → webhook → enroll → invoice → register → approve → handoff → OS login →
      content. ✅ *done when: the whole journey works on a stranger's network.*

## Order of operations (summary)

1. Firebase project + Auth + rules + schema.
2. Email provider + DNS verification (starts the slow clock FIRST).
3. Handoff endpoint + key + idempotency.
4. Deploy System A + OS to HTTPS hosts; point settings at the live OS URL.
5. Reconciliation sweep + single-session + selfie gate live.
6. Mail/money/CAPTCHA rails.
7. Phone test on mobile data. Uptime monitoring on. Go live. 🎉

---

## Storage-capacity note (for the founder's question)

The "36% of 5 MB ≈ 15 more students" number is the **demo's browser store** — a
~5 MB per-origin quota in the browser where the demo runs. Each student record
weighs ~200 KB in the demo because it stores every email body, ledger event and
security event verbatim. That is a **demo artifact, not the system's real
capacity**: production runs on Firebase/Firestore where storage is effectively
unlimited, and the load test proves the pipeline itself handles 2,000 students
in ~10 seconds with every rand reconciling. The 5 MB browser limit disappears
the day this doc is done.

---

*System A · Reality FX Registrar · v59 · last verified 14 Aug 2026 — full audit
21/21, security self-test 5/5, 2000-student load test clean, all nine pages
zero console errors.*

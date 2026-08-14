# Reality FX — System A: The Complete Overview

**The one-line mission:** *"Someone bought Reality FX. Let's verify that purchase, properly
register them, establish their official identity, and safely introduce that identity to RFX OS."*

This document is the **general view** — for anyone (especially Lee) who wants to understand
everything System A does before touching it. It is not the deep technical reference (that's
`README.md` + `FOR-LEE.md`); it's the map.

---

## 1. The pipeline — the five pillars, nothing more

```
 PURCHASE ──▶ REGISTRATION ──▶ APPROVAL ──▶ SECURE HANDOFF ──▶ CONFIRMATION
    │             │               │               │                 │
  paid      student fills     automated       the bridge       RFX OS says
  enrollment  form, verifies   checks +       introduces       "got him" —
              email, captcha,  moderator      the student      student is
              identity, signs  decision       to System B      ACTIVE
              agreements
```

Everything in the system hangs off **one root record: the enrollment**. Identity, wallet,
awards, merch, credit history, handoff — every branch grows from the same trunk. That's why
new features never feel "bolted on": they're new branches of an existing tree.

**The five links are sacred.** If purchase → registration → approval → handoff → confirmation
never break, the system is doing its job. Everything else is value layered on top.

---

## 2. The pages (who uses what)

| Page | Who | What it is |
|---|---|---|
| `index.html` | Everyone | **Reception** — the front door. Doors to Staff Console, Students (SRM), Mailbox, Staff Portal, My RFX Account. Live "Reception · 24/7 · N on duty" pill. Sarrah (chat assistant) lives here. |
| `admin.html` | Staff | **Staff Console** — create enrollments from payment data (auto-invoice), approve/reject students, monitor the handshake, security & data-hygiene panel. |
| `srm.html` | Staff | **Student Relationship Manager (SRM)** — every enrollment is a relationship record. Search/filter by name, ID, course, country, stage. Full profile: identity, invoice, wallet, awards, merch, journey events. |
| `wallet.html` | Staff | **Credit & Refunds** — RFX accounts, ledgers, awards & giveaways console, PayPal payout queue + monthly batch, merch fulfilment queue, package catalog editor. |
| `staff.html` | Staff | **Staff Portal** — one-time invite activation, sign in, clock in/out (day/night), on-duty roster. Admin hires new team members here. |
| `mailbox.html` | Demo | Simulated inbox — every email the system would send: invoices, registration links, verification codes, awards, merch shipping. |
| `member.html` | Student | **My RFX Account** — sign in with email + Student Code. Vital details (masked, eye-reveal), identity, RFX OS access state, wallet + ledger, spend your credit, merch, invoice (print/PDF). |
| `register.html?token=…` | Student | The secure, single-use registration portal. |
| *(Sarrah)* | Everyone | Floating chat assistant — answers account questions with **live** data. |

---

## 3. The subsystems (what's actually built)

### 3.1 Identity & registration
- Purchase confirmed → enrollment created → **invoice auto-generated** (no manual typing).
- Student receives registration email with a **single-use link** (token, 7-day expiry).
- Registration: personal info, email verification (6-digit code), CAPTCHA, selfie + phone +
  address, terms & agreements accepted **with exact version + timestamp recorded**.
- **No government IDs, ever** — Reality FX is an educator, not a regulated broker. Collecting
  national ID numbers would only add POPIA/GDPR duty and breach risk for zero benefit.

### 3.2 Approval & identity creation
- Automated checklist (paid, link valid, personal complete, email verified, human verified,
  identity complete) — then a **moderator makes the call** (never auto-verdicts).
- On approval: **Student ID** (`RFX-10482`) + **Student Code** (6-char, unambiguous alphabet)
  are generated. On rejection: student chooses **credit or cash refund**.
- **Fixable rejections** allow re-application (2 attempts / 7 days).

### 3.3 The bridge (handshake with your system)
- System A → `POST /api/handoff` with `{ studentId, studentCode, verifiedName, email,
  course, entitlements, idempotencyKey }`.
- **Idempotency is the law:** the Student ID is the key. A retried request can never create a
  second identity. RFX OS replying "already have this one" is a **success**, not an error.
- States: `PENDING → APPROVED → SYNCING → RFX_OS_CONFIRMED → ACTIVE`, with `SYNC_FAILED` +
  automatic retry with backoff. A hiccup is invisible to the student.
- **The achievement bridge event** (`POST /api/achievement`): your OS sends
  `{ studentId, average, reference }` when a student hits 80%+ — System A creates the free
  merch reward. Same idempotency discipline.

### 3.4 The wallet & value centre
- Every student has an **RFX account starting at R0.00** with a unique wallet number
  (`W-XXXXXXXXX` + Luhn check digit — staff can send by number, typos fail before money moves).
- **Credits** (refund alternative) expire after 24 months; **awards & giveaway prizes** never
  expire. Both land in one ledger.
- **Awards** (Head Boy/Head Girl, best performer) and **giveaways** (crypto-random draw over
  the ACTIVE pool) credit wallets instantly, idempotent by reference, fully audited.
- **Spend your credit** — package catalog with codes (the same codes Lee puts on the website
  store), sorted **ascending** (cheapest first), pay only if you can afford it.
- **Referral commissions** also land here — same ledger, never expire, fully spendable.

### 3.5 Referral marketing (students grow the Academy)
- Every student gets a shareable code (`RFX-XXXXXX`) + a `?ref=` link on their member panel.
  When a friend enrolls with it, **attribution is locked at enrollment** — before registration,
  before approval — so the Academy always knows where every student came from.
- **The founder's rule, enforced:** a commission (15% base → 20% at 3 → 25% at 6 → 30% at 10
  active referrals) **accrues** when the referred student goes ACTIVE, **vests** only after
  they survive the 30-day refund window, **forfeits** on refund, and **claws back** if they're
  banned within 90 days. Money subject to change is not yet earned — the house always wins.
- **Single-level payouts only.** The family tree is tracked for analytics and responsibility,
  but payouts are direct-referral only (a multi-level scheme would be a regulatory landmine).
- Staff see it all on the wallet page: attribution intel, survival rates, vest/pay buttons.

### 3.6 Merch
- **Earned:** 80%+ average → free tee + hoody, celebrated with a gold confetti fanfare on the
  member panel, then size pickers. It's a **fulfilment obligation, never credit** — can't
  expire, can't become cash.
- **Purchased:** tee (R250), sweatpants (R320), hoody (R450), combo (R600) with size +
  address. Both flow through the fulfilment queue: `collecting → packing → shipped →
  delivered`, with shipped emails and full audit.

### 3.6 Security & data hygiene
- **Enforced in the demo** (UX-grade, so it behaves like the real thing): email-code
  brute-force guard, CAPTCHA lifetime, member + staff login throttling with lockouts, session
  inactivity timeout, security event log.
- **Data minimisation:** verification selfies are purged once a decision is made.
- **The honest boundary:** a browser can't be the final gatekeeper. Every swap point to the
  production backend (Firebase auth, server-verified CAPTCHA, HTTPS, provider-held PCI) is
  documented in FOR-LEE.md.

### 3.7 The team
- Staff are **hired, not registered** — admin creates a one-time invite, the new team member
  sets their own credential. Roles: reception / approver / finance / admin.
- **Shifts** (day/night, clock in/out) power the "Reception · 24/7" promise with a live
  on-duty roster.

### 3.8 Sarrah (the assistant)
- Rule-based intents + **live** data: balance, wallet number, invoice, status, RFX OS access,
  refunds, spend options, staff shifts. Quick-reply chips, typing indicator.
- Production swap: replace the `ask()` core with an LLM/agent endpoint — the chat UI stays.

---

## 4. The state machine

```
                 purchase
                    │
              ┌─────▼─────┐        registration submitted
              │  PENDING  │ ────────────────────────────▶  (verified checks)
              └─────┬─────┘                                      │
                    │ approve                           ┌────────▼────────┐
                    ▼                                   │  (moderator)    │
              ┌─────────────┐     rejected              │  APPROVED       │
              │  APPROVED   │ ────────────────────▶     │  or REJECTED    │
              └─────┬───────┘                           └────────┬────────┘
                    │ bridge sync (idempotent)                   │ credit/refund
                    ▼                                              ▼
              SYNCING_WITH_RFX_OS ──▶ RFX_OS_CONFIRMED ──▶ ACTIVE    (resolution)
                    │ (retry w/ backoff if it fails)
                    └──────────▶ SYNC_FAILED ── retries until confirmed
```

`ACTIVE` is the only state where the student enters RFX OS. Buying the course alone is never
enough; a completed registration alone is never enough. Only the full chain unlocks the door.

---

## 5. What Lee inherits (his lane)

1. **RFX OS** (System B) — identity, auth, authorization, course access, integrity
   monitoring. Receives approved students via the bridge.
2. **The handoff endpoint** — he implements the OS side: validate, create/update, reply
   `{ received: true }`, honour the idempotency key.
3. **The achievement endpoint** — he sends `POST /api/achievement` when a student hits 80%+.
4. **Firebase Auth** — students set their own passwords (never plain-text), staff get custom
   role claims.
5. **Firestore security rules** — the non-negotiable: clients can never touch balances.
6. **Screen-capture deterrence** — watermarks, selection lock, print blackout, capture
   detection (see FOR-LEE.md §9.6), plus **trusted printing**: an EARNED entitlement carried in
   the handoff payload (`printTrust`) that the OS enforces at the backend — staff grant/revoke
   it in the SRM, and the terms state every guard so misusers know the system is watching.
7. **Email / CAPTCHA / PayPal providers** — each has a documented swap point.
8. **The single members panel decision** — RFX OS keeps identity/learning/security; System A's
   `member.html` is THE account panel (wallet, invoice, vitals, merch). Your OS's account menu
   deep-links to `member.html?email=…` (email prefilled, code never in the URL). The Academy nav
   item everywhere is branded **RFX OS Academy** and opens with `?sid=` so the OS greets the
   student by identity. Contract: FOR-LEE.md §9.8.

Everything he needs, step by step, is in `FOR-LEE.md`. The function signatures in `js/db.js`
and `js/bridge.js` ARE the contract.

---

*System A — the Registrar. Built for Reality FX, The Trading Academy.*
*One enrollment → invoice → registration → approval → identity → handoff → wallet → awards →
merch. The gem grows new branches; it never gets Frankenstein'd.*

# Reality FX — Enrollment & Registration System (System A)

**"Someone bought Reality FX. Let's verify that purchase, properly register them, establish their
official identity, and safely introduce that identity to RFX OS."**

This is System A — the official front door into the Reality FX student ecosystem. RFX OS
(System B, Lee's system) receives the approved identity and handles authentication, course
access and integrity monitoring. This system does **not** sell courses and does **not** host
lessons. It does exactly five things, and does them rock solid:

```
PURCHASE → REGISTRATION → APPROVAL → SECURE HANDOFF → CONFIRMATION
```

## Pages

| Page | Who | What |
|---|---|---|
| `index.html` | Everyone | Reception — the doors: Staff Console, Staff Portal, Mailbox & My RFX Account; live 24/7 on-duty pill |
| `admin.html` | Staff | Create enrollments from payment data, auto-invoice, approve students, monitor the handshake |
| `wallet.html` | Staff | Credit & Refunds — RFX accounts, ledgers, payout queue, monthly batch |
| `srm.html` | Staff | **Student Relationship Manager** — every enrollment is a relationship record: search/filter by stage, open a full profile (identity, wallet, awards, spend history, journey events) |
| `staff.html` | Staff | **Staff Portal** — one-time invite activation, sign in, clock in/out (day/night), on-duty roster; admin hires new team members here |
| `mailbox.html` | Demo | Simulated inbox showing every email the system sends |
| `member.html` | Student | **My RFX Account** — sign in with email + Student Code; status, RFX credit balance + ledger, invoice, and the gateway into RFX OS |
| `register.html?token=…` | Student | The secure, single-use registration portal |
| *(floating assistant)* | Everyone | **Sarrah** — the RFX assistant chat widget on Reception & Members; answers account questions with live data |

## The journey

1. **Purchase** — the payment provider reports a confirmed sale. The system automatically
   creates the enrollment record and generates the invoice (no manual typing → no human error).
2. **Registration** — the student receives the invoice email, then a registration email with a
   **secure, unique, single-use link** (7-day expiry). The link leads to the branded portal:
   personal details → email verification (6-digit code) → CAPTCHA → identity info (phone,
   address, selfie) → electronic acceptance of the Terms, Fair Usage Policy, Privacy
   Notice and Refund Policy — **exact agreement versions and acceptance times recorded**.
3. **Approval** — the system runs automated checks (genuine paid enrollment, link valid &
   unused, everything submitted) shown as a visible checklist. A staff member makes the final
   call — flags are review triggers, never verdicts. On approval the system generates the
   official **Student ID (RFX-XXXXX)** and **Student Code**.
4. **Handoff** — the bridge sends the identity to RFX OS and asks for confirmation.
5. **Confirmation** — RFX OS acknowledges, the student becomes **ACTIVE** and receives the
   welcome email with the "Enter RFX OS" button.

## Rejection & refunds (the resolution flow)

When a registration is **rejected**, the student keeps their money in hand — the system never
forces an immediate, expensive refund:

1. The rejected student sees exactly **why**, then **chooses** their resolution:
   - **💳 RFX account credit** — instant, zero fees, revenue stays in the business. Usable toward
     any course, a seat transfer, or mentorship. Every student's RFX account starts at **R0.00**
     and lives in `wallet.html` (Credit & Refunds).
   - **💵 Cash refund** — queued into a **consolidated monthly batch**, so cross-border transfer
     and FX fees are paid once for the whole batch, not once per student.
2. The student's choice is recorded on the enrollment; staff execute it in the Staff Console
   (*Registration & Approval* tab of a rejected enrollment).
3. Credit lands on the RFX account instantly with a ledger entry + confirmation email; refunds
   land in the payout queue and are paid in one run via **Process monthly batch**.
4. The **Refund & Credit Policy (v2.0)** — which every student accepts at registration with
   exact version + timestamp — is what makes this enforceable.

Cross-border students are flagged in the console so staff can steer toward the fee-free credit
route when a cash refund would cost more than it returns.

**Credit expiry:** RFX credits are valid **24 months** from issue (configurable in `js/db.js` →
`credit`). Ledgers show the expiry date per credit and flag balances expiring within 60 days so
staff can nudge students to use them before they lapse.

**Re-application for fixable rejections:** when staff reject, they mark the rejection **fixable**
(default) or **final**. Fixable rejections let the student correct the issue (blurry selfie, typo,
missing detail) and re-apply within **7 days**, up to **2 attempts** — their payment stays put, no
refund needed. The rejection/re-application history stays in the audit trail and a re-application
email goes to the student. Final rejections go straight to the credit/refund resolution.

## The wallet as the academy's value centre — awards & giveaways

The RFX account wallet is more than a refund lane — it is where the academy's value
lives. Prize money lands straight into student wallets:

- **Ceremony awards** — e.g. Head Boy / Head Girl, best student of the year. Staff pick the
  student, set the amount (say R1,000 each), and the money is credited to their wallet
  instantly, with a congratulations email.
- **Giveaway pots** — a **crypto-random fair draw** over the **ACTIVE** pool (`crypto.getRandomValues`
  Fisher–Yates shuffle). Winners, pool size and time are recorded in the draw record, so the
  draw is provably fair and auditable — run it live on stage.
- **Unique wallet numbers** — every wallet has a permanent number (`W-` + 9 digits with a
  **Luhn check digit**, like a bank account). Staff reference and send by number, and a
  mis-typed number fails loudly before money moves. Students quote their number at ceremonies.

Two rules keep the money honest:

1. **Awards never expire** — they are *earned*, unlike refund credits (24 months). A student
   who wins R1,000 keeps it until they spend it.
2. **Idempotent by reference** — every award carries a unique reference
   (`AWARD-2026-01`, `GIVEAWAY-0001`). Re-submitting the same award is a no-op: the money
   moves exactly once, no matter how many times the ceremony record is re-entered.

Awards/giveaways are created from **Credit & Refunds → Awards & giveaways**, with a full
history (recipients, totals, references). Winning money is internal credit — usable for
courses, mentorship or seat transfer; there are no bank rails involved, so zero transfer fees.

## Identity verification — the honest version

Reality FX does **not** contact governments or national databases — no academy does.
Verification is intentionally light and layered:

- **Format & consistency math** (free, in the browser): phone numbers with valid country codes,
  plausible addresses, self-checking formats where they exist.
- **Human review** in the Staff Console: the selfie vs. the declared name/DOB.
- **Optional commercial KYC** (Smile ID / Yoti / Veriff) only if you ever want it — a plug-in for
  red-flagged cases, never a government partnership.

**Government ID/passport numbers are OFF by default — the system does not collect them at all.**
(`registrationRequirements.idNumber` in `js/db.js` → `'off'` hides the field entirely.)

Why this is the right posture: AML/KYC rules that force ID collection apply to **regulated
financial services providers** (brokers like XM, banks, exchanges) — not to educators. Reality FX
is a course business, so it has no legal obligation to collect national IDs, and POPIA/GDPR do not
require it either. Collecting them would only add sensitive-data obligations and breach risk for
zero benefit at course level. Email + phone + selfie + payment-record name match is the right
weight, and RFX OS integrity monitoring handles post-entry abuse. The selfie retention rule is
now implemented: verification selfies are deleted once a decision is made, keeping only the
verdict (see Security posture below).

## States

```
PENDING  →  APPROVED  →  SYNCING WITH RFX OS  →  RFX OS CONFIRMED  →  ACTIVE
                │
                └→ REJECTED (final, reason recorded)

APPROVED  →  SYNC FAILED  →  AUTOMATIC RETRY (5s → 15s → 45s → 120s backoff)  →  …
```

## Members access & the OS lock

- **RFX OS stays locked** until the student is **approved AND the handshake is confirmed**
  (state `ACTIVE`). Buying the course alone is never enough — the "Enter RFX OS" button on the
  completion screen stays locked (with a live status) until the handoff lands, then unlocks itself.
- **My RFX Account** (`member.html`) gives every student a reason to come back: sign in with their
  email + Student Code, see their identity, status, RFX credit balance with expiry dates, their
  invoice (printable), and their OS access state. Rejected students see their resolution status
  and a path back to their registration link.
- Codes are shown once on the completion screen (possession = credential in the demo). Production
  swaps this for Firebase password auth, which is Lee's lane in the OS.
- The whole UI uses a **stroke SVG icon set** (`assets/icons.js`) instead of emoji — the same
  classy line style as RFX OS.

## Spending the wallet (the redeem rail)

The wallet is a **payment method, not a store**. The website store keeps owning products; when
someone checks out with RFX balance, the store calls one idempotent rail
(`redeemCredit`) to deduct. Academy services that live outside the store — **mentorship
sessions, seat transfers, course deposits** — are spendable right from the member panel's
*Spend your credit* card. Rules:

- Only **non-expired** value is spendable (an expired refund credit is not real money).
- Every redemption has a unique transaction reference — a purchase can never double-deduct.
- Redeems are ledgered (negative entries), audited, emailed and security-logged.

## Cash refunds ride PayPal

When a student chooses a cash refund, the payout record carries `rail: 'paypal'` — paid through
**PayPal Payouts** in the consolidated monthly batch (international, no bank details needed,
easy reversals). The demo simulates the API; production wires the Payouts call (see
`FOR-LEE.md` §9). Prize money stays **internal credit** — no payout unless a student later
chooses a cash-out.

## Invoices: download AND print

Every invoice — in the Staff Console and the member panel — now has **Download PDF** (a
real, dependency-free `.pdf` built client-side by `js/pdf.js`) plus **Print**. Production swaps
`js/pdf.js` for a server-generated or library PDF; the call site never changes.

## Member panel session timeout

Signed-in members are **auto signed out after inactivity** (`security.sessionTimeoutMinutes`,
default 15) — pointer/keyboard activity resets the clock. Shared devices can't stay logged in.
The timeout is editable from Staff Console → Security & data hygiene.

## The staff team: hired, not self-registered

Students register; **staff are hired**. A staff account can only be created by an admin
(Staff Portal → “Hire & invite”), which sends a **one-time invite link** (7-day expiry) — the
new team member opens it, confirms their email, and sets their own staff code. Never
self-serve, exactly like a real hire: interview → contract → on-boarding → access.

**Shifts make the 24/7 promise real.** Staff clock in/out (day/night) from the Staff Portal;
the reception page shows a live “Reception · 24/7 · N on duty” pill, so a gap in coverage is
visible at a glance — no more guessing whether someone is answering the inbox.

- Staff sign-in is **throttled** like members (lockout after repeated failures, logged to the
  security event feed).
- Every hire, activation, clock-in and clock-out lands in the security event log.
- Roles: `reception`, `approver`, `finance`, `admin`. Only admins see the hire console.
- The demo stores a staff code; production is Firebase Auth + a **custom claim** per role
  (see FOR-LEE.md).

## Refund intelligence — the layer that remembers who refunded

A refund is a **signal, not a transaction.** Before any refund reaches the queue, it is
scored 0–100 against the identity's full history:

- **Identity fingerprinting** — email + normalized name + phone + payment method. A
  refunded identity is linked across enrollments even when the email changes.
- **Signals:** prior refunds by this identity, refund velocity (N in 90 days), early
  refunds (within 7 days of purchase — consume-then-refund), pre-registration refunds,
  and payment-link reuse across refunded enrollments.
- **Flags are review triggers, never auto-verdicts** — same philosophy as the integrity
  monitor. The moderator sees the score + named signals in the Credit & Refunds page and
  decides.
- **The stated consequence** (in the Refund & Credit Policy v2.1 the student accepts): an
  approved refund **revokes all rights and ownership of course material**, terminates RFX
  OS access, and starts a **30-day identity cooldown** — the refunding identity cannot
  re-enroll or re-apply until it passes. The student sees this before confirming; the
  registration refund choice reveals the statement on first click and only confirms on a
  deliberate second click.
- New enrollments from an on-cooldown identity are **flagged in the SRM** for moderator
  review (never silently accepted, never hard-blocked).
- **The policy the student reads is the policy we enforce.** The Refund & Credit Policy text
  in the wizard now states the credit-first posture: RFX account credit is always honoured in
  full with no deduction, and for cross-border payments Reality FX may recommend (or require)
  the fee-free credit where a cash refund's transfer + FX costs would exceed its value.
  Repeated, rapid or abusive refund activity (or refund farming across identities) may result
  in denial of future enrollment — stated up front, so nobody is surprised later.

## Financial audit — the end-of-day money file

Every money event lives in one flat, exportable ledger (`financialLedger()` in `js/db.js`),
sourced **live from the records** — never a separate bookkeeping copy that could drift. It
covers: course payments received, credits issued, awards, referral commissions, wallet spend,
staff funding, and cash refunds (queued and paid). The Credit & Refunds page shows the
summary and three actions:

- **Download CSV / Download JSON** — the full ledger: timestamp, kind, direction, amount,
  currency, party, detail and reference for every single event.
- **Email end-of-day log** — sends the automated report to the finance address
  (`settings.financeEmail`, default `realityfx20@gmail.com`); it lands in the Mailbox as a
  preview. This is your tax/audit record: every attempt, every rand, every reference.

Nothing moves without a reference, and the report is generated the same way in production
(§9.11 in FOR-LEE).

## Staff wallets — the team has RFX money too

Staff are paid the same way students are credited: a wallet number, a ledger, a balance.
Only finance staff (Credit & Refunds page) can fund one — pick the team member, set the
amount and a note, and the funding is **ledgered, emailed to the staff member,
security-logged, and idempotent by an optional reference** (the same reference can never pay
twice). The Staff Portal shows the signed-in member their balance and recent ledger.

## The 24-hour demo pass

`createDemoPass()` mints a free tour that feels exactly like a real purchase: invoice,
registration email, full wizard — but the registration link expires after a configurable
window (default **24 hours**; `tokenHours` is stored on the record so a resend keeps the same
lifetime instead of silently extending). Idempotent by the fixed `DEMO-TOUR` transaction:
re-running returns the same enrollment — never a duplicate student or duplicate emails; only
an expired tour gets a fresh link.

## Registration funnel analytics

Every registration link records its **first open** (`markLinkOpened`, once, with a security
event) and the **time from first open to submission**. The Staff Console shows the funnel —
links sent → opened → submitted → approved — plus the average time students take to
register, so a slowing registration flow is visible before it hurts conversion.

## Mailbox: download any email as a file

The Mailbox is the dry-run outbox — every email the machine would send. Each one can now be
**downloaded as a standalone `.html` file** (per-row icon or the button in the preview), so
the invoice, the registration link, or the end-of-day audit log can be saved, filed or
printed from the file itself. Production: the same button becomes "download attachment"
on the real provider.

## Staff payroll — deposit method + monthly payday

Finance sets each team member's **deposit method** (PayPal / Bank / Zapper / Cash) and a
**monthly payday** (day of month 1-28). The wallet screen renders the payroll schedule —
every member's next pay date, with a "due today" flag — and funding on the scheduled day is
a normal, audited wallet funding (idempotent, so one pay run can never be paid twice).

## Prize-money cash-outs

Awards and giveaway winnings sit in the student wallet. A student can **cash out** (min
R50) — the amount leaves the wallet the moment it is requested and queues into the **same
consolidated monthly PayPal batch as refunds**. A cash-out is **not** a refund: nothing is
revoked and the enrollment is untouched; the payout record keeps a distinct `cashout` kind
so the financial ledger shows prize money separately from purchase reversals.

## The SRM — students, not customers

Every enrollment is a **relationship record**, not a row in a sales ledger. `srm.html`
(Student Relationship Manager) is the staff view of that database: search by name,
email, ID, course or country; filter by stage; and open a full profile that pulls
identity, invoice, wallet balance, spendable amount, ledger and the student's entire
journey event trail into one place.

- The database was always there (`enrollments[]`); the SRM is the *view* that makes
  it feel like a living student relationship system.
- A profile shows what the student accepted (agreement version + timestamp), when the
  RFX OS handshake confirmed, their wallet number and current spendable amount.
- This is the screen the team lives in: “how is RFX-10482 doing?” answered in one click.

## Spending credit — the package catalog (codes Lee mirrors on the store)

The member panel's spend surface is now **catalog-driven**. A package is
`{ code, name, price }` — and those same codes are what Lee attaches to products on
the website store. The student dropdown is sorted **by price ascending** (cheapest
first — what they can afford is at the top) and every package shows exactly what it
costs. Affordability is enforced at the button: if spendable balance covers the price,
*Apply* is live; if not, the button shows how much more is needed and cannot be clicked.

- Default catalog: Advanced upgrade (R6 900), Professional upgrade (R3 510),
  mentorship session (R350), seat transfer (R150). Merch: tee (R250), sweatpants
  (R320), hoody (R450), combo (R600). Staff edit it in `wallet.html` → Package
  catalog (codes must be unique). The dropdown is **ascending** by price — the
  affordable options are at the top, so a student with a small balance sees what
  they can actually pay for first.
- The store remains the home of products — the same `redeemCredit` rail is what the
  website calls when a student pays with RFX balance.
- **Lee's contract:** the code on a website product is the same code in this catalog.
  When a student pays with RFX balance, the store sends `{ code }` and this system
  prices it from the catalog. If the code doesn't exist here, the purchase is refused
  rather than guessed.

## Merch — earned rewards and the merch shop

Two different business objects share one fulfilment queue:

- **Earned** — every student averaging **80%+** earns a free branded tee + hoody,
celebrated with a one-time gold fanfare on the member panel (confetti reveal), then the
size pickers slide in.
  The average lives in RFX OS (System B), so this arrives as a **bridge achievement
  event** (`{ studentId, average, reference }`) — System A never grades. Idempotent by
  reference: one achievement = one claim, ever. The reward is a *fulfilment
  obligation, not credit*: it can't expire and can't become cash.
- **Purchased** — merch items in the package catalog (`kind: 'merch'`, with sizes).
  Students buy with wallet credit, but physical goods need **size + address**, so a
  purchase creates an order rather than just a ledger row.

Both land in the **Merch fulfilment** queue (Credit & Refunds):
`collecting → packing → shipped → delivered`, with every step on the audit trail and
shipping emails sent automatically. The member panel shows the earned-reward banner
(size pickers + address) and the shop with per-item size selects. The SRM profile
shows each student's merch status.

**Demo note:** the staff console can *simulate* the RFX OS achievement event for any
active student. In production Lee's system sends it for real — see FOR-LEE.md §6b.

## Sarrah — the RFX assistant (account Q&A bot)

**Sarrah** is a floating chat widget on **Reception** and **My RFX Account** that answers
account & member questions — balance, credits, invoices, status, RFX OS access, refunds,
spend options, staff shifts. Wherever the student is signed in, her answers are **live**: she
reads the actual wallet, invoice and state from the store rather than reciting scripts.

- Rule-based intent matching in `js/bot.js` — no network, instant, deterministic.
- Quick-reply chips guide the conversation; typing indicator keeps it feeling human.
- Staff shifts answer from the live roster (e.g. “3 team members on duty now”).
- **Production swap point:** replace the `ask()` core with your agent/LLM endpoint or a
  provider widget — the chat UI (`#rfx-bot`) stays as-is. The “talk to a human” intent
  should route to a real queue in production.

## Security posture

This system holds student details and moves money — so it treats security as a layer, and is
honest about the boundary: **a browser can never be the final gatekeeper.** Everything enforced
below is real in the demo and mirrored server-side in production.

### Enforced now (in this demo)

- **Verify-code brute-force guard** — a wrong email code locks after `verifyCodeAttempts` (5)
  wrong entries for `verifyCodeLockMinutes` (5) minutes; the student must request a fresh code.
- **CAPTCHA challenge lifetime** — a challenge expires after `captchaAttempts` (6) failed tries
  and a fresh one is generated.
- **Member sign-in throttling** — `memberLogin` locks an account for `lockoutMinutes` (15) after
  `maxLoginAttempts` (5) failures. Lockouts are logged as security events and surface in the
  Staff Console's *Security & data hygiene* panel. Success clears the throttle.
- **Single-use, expiring registration links** — 48-hex CSPRNG tokens, one identity per link,
  rotated on resend (a leaked link is invalidated).
- **Idempotent handoff** — the Student ID is the idempotency key; a retried handshake can never
  create a duplicate identity.
- **Data minimisation** — no government IDs collected at all; **verification selfies are purged
  once a decision is made** (`retainSelfies: 'untilDecision'`) and only the verdict is kept.
  Staff can run a manual purge from the Security panel and see how many selfies remain.
- **Masked credentials** — Student Codes are `RFX-••••` until explicitly revealed.
- **Escaping everywhere** — all user input is HTML-escaped before entering the DOM or emails.

### Prove it, don't claim it

- **Live security self-test** — the Staff Console's *Live security self-test* card runs the real
  enforcement code against a scratch record: login lockout, verify-code brute-force guard,
  expired-link rejection and the selfie purge all fire (or fail loudly), then the scratch record
  is removed. Nothing touches real students.
- **Storage capacity meter** — the Staff Console's *Storage capacity* card shows live bytes used,
  students held, KB per student and headroom in students against the browser's ~5 MB store.
  Measured reality: a fully-registered student is ≈1.3 KB, so 30 students is ~0.8% of capacity
  with headroom for ~3,800 more at that size. Production (Firebase/Firestore) is effectively
  unlimited — see FOR-LEE.md.
- **Security event log** — failed logins, lockouts, code locks and purge runs are recorded and
  reviewable by the moderator (flags are review triggers, never verdicts).

Settings live in `js/db.js` → `security`, and are editable from the Staff Console →
*Security & data hygiene*.

### What moves to the backend in production

| Control | Demo (now) | Production (swap point) |
|---|---|---|
| Login | email + code, throttled in-browser | Firebase Auth password (Lee's lane) + server-side rate limit |
| Verify codes | generated & shown in mailbox | emailed/SMS'd by the provider; verified server-side with attempt limits |
| CAPTCHA | canvas challenge | Cloudflare Turnstile / hCaptcha, server-verified |
| Storage | localStorage (per-device demo data) | server DB + private file bucket with retention rules |
| Transport | http on localhost | HTTPS everywhere |
| Payments | simulated | the payment provider holds the PCI scope — cards never touch this system |
| Bridge | simulated RFX OS | signed requests, server-side idempotency, mTLS/API key |

**In short:** the browser enforces UX-grade security so the demo behaves like the real thing; the
backend enforces real security. When System A goes live, the seams in `js/db.js` are where each
control gets swapped — nothing else in the app changes.

## The engineering that matters

- **Idempotency.** The bridge always sends the **Student ID** as its idempotency key
  (`js/bridge.js`, `buildPayload`). RFX OS can only ever create one identity per Student ID, so
  a retried request after a network hiccup can **never** create a duplicate student.
- **Retry without panic.** If the handshake fails, the system goes `SYNC_FAILED`, schedules an
  automatic retry with exponential backoff, and keeps an audit trail. Staff never have to
  manually reconcile a student who already paid.
- **Reconciliation.** If RFX OS replies "already have this one", that is a *success*, not an
  error — the systems agree on the same identity.
- **Audit log.** Every enrollment carries a full event log (created → emailed → submitted →
  approved → handed off → confirmed).
- **Money moves once.** Every resolution (credit or refund) is guarded by a single
  `executedAt` lock on the enrollment — a credit can never be followed by a refund (or vice
  versa), the student's choice is locked after execution, and an executed resolution closes
  re-application. Merch buys redeem the wallet **first** and only then create the order, so a
  failed purchase can never leave a ghost order. (Audit findings, hardened and live-tested.)
- **Enrollment is idempotent too.** A retried payment confirmation (same transaction ID)
  returns the existing enrollment — never a second record, second invoice, or second batch of
  emails. Prices are clamped to a positive number so a bad webhook payload can't create a
  negative-price enrollment (which would move refund/credit money the wrong way).
- **Every caller respects idempotency.** The admin form, the demo "Load Pedro" button, and the
  security self-test all check freshness before creating invites or sending emails — a repeated
  click can't wipe a student's registration progress or double-email them, and a crashed
  self-test run can never skew the next run (stale SELFTEST records are pre-cleaned).
- **Multi-tab safe.** Every save stamps a revision counter, and a `storage` event listener
  adopts a fresher write from any other open tab (Staff Console + member panel together),
  then pages re-render via a `rfx:sync` event — so two tabs can never silently clobber each
  other's changes. Production seam: Firestore realtime listeners replace this entirely.
- **Staff funding is idempotent too.** Fund a staff wallet with the same reference twice and
  the second is refused — the same never-pay-twice standard as awards and resolutions.
- **The financial ledger is derived, not copied.** The audit file is compiled live from the
  records on demand, so it can never drift from what actually happened.
- **The front door knows what you need.** The reception dashboard highlights the one door
  that matters right now (a live registration link → Members; no enrollments yet → Staff
  Console; an approved student awaiting handoff → Staff Console; everyone active → Members)
  and says why, so nobody stands at the wrong door.

## Running it

Any static server works — or just double-click `index.html`. For the **full experience**
use the bundled Perl server (Git for Windows ships Perl; core `HTTP::Daemon`):

```bash
# from this folder
RFX_ROOT="$(pwd)" RFX_PORT=8123 perl ../.freebuff/serve_fork.pl
# then open http://127.0.0.1:8123
```

**Why the Perl server and not a plain static one?** The demo is browser-local, so without a
shared store a registration link only works in the browser that created the enrollment —
opened anywhere else it says *"link not recognised"*. The server exposes `GET/POST
/api/state`, a single JSON file every browser on the machine reads and writes, so **links work
from any browser** (localhost only — production is Lee's Firebase, which is global by design).

> ⚠️ `file://` works for browsing, but some browsers restrict `fetch` and clipboard on
> `file://`, and the shared store won't be reachable — a link created in one browser will
> refuse in another. Use the Perl server (above) for the full demo.

### Demo tips

1. Open **Staff Console** → click **"Load Pedro (demo)"** → **Create enrollment + invoice**.
2. Open the **Mailbox** to see the invoice email + registration email. Open the registration
   link (or grab it from the Reception page under "Active registration links").
3. Complete registration (the verification code is in the Mailbox).
4. Back in the Staff Console: **View** the enrollment → **Registration & Approval** → **Approve**.
5. Watch the state march `APPROVED → SYNCING → RFX OS CONFIRMED → ACTIVE` in the **Handoff**
   tab. Refresh the registration page — the final **VERIFIED** screen appears.
6. Demo mode randomly simulates a network hiccup (~25%) so you can see the retry engine work.

## Production roadmap (swap points)

**Lee's instructions:** the complete, ordered Firebase production handoff is in
[`FOR-LEE.md`](FOR-LEE.md) — project setup, Firestore schema + rules, Auth, the handoff
endpoint contract, email/CAPTCHA/PayPal providers, and the go-live checklist.

Everything lives behind clean seams in `js/db.js` and `js/bridge.js`:

- **Database** — replace `localStorage` with Firebase/Firestore or a REST backend. The function
  signatures in `RFX.db` stay the same.
- **Email** — wire `RFX.db.email()` to Resend / SendGrid / SES. The mailbox page becomes an
  admin-only outbox log.
- **CAPTCHA** — swap the canvas check for Cloudflare Turnstile / hCaptcha (server-verified).
- **Verification codes** — email them for real (the demo shows them in the mailbox).
- **Selfie & ID storage** — store server-side (private bucket) with retention rules; never in
  the browser.
- **RFX OS endpoint** — set the real URL in Staff Console → Handoff tab → *Bridge settings* and
  switch off **Demo mode**. Lee's system accepts the payload and replies
  `{ received: true, already?: boolean }`.
- **Link security** — tokens are 48-hex CSPRNG values today; production should sign them and
  check them server-side with rate limiting.

## Design language

Dark `#080808`, Reality FX gold `#D4AF37`, white `#FFFFFF`, muted `#A7A7A7`, borders
`rgba(255,255,255,0.08)` — the same family as RFX OS (Playfair Display + Inter + Cormorant
Garamond italic quotes).

---

*System A — the Registrar. Built for Reality FX, The Trading Academy. Since January 2020.*

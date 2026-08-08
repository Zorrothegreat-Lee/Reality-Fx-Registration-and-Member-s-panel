# FOR-LEE — Taking System A to Production (Firebase)

> Everything System A (the Enrollment & Registration system) needs from you to run in
> production, in the order to do it. The whole app is built behind clean seams in
> `js/db.js` and `js/bridge.js` — each item below is a swap point. Nothing else in the app
> changes. Work through the list top to bottom; each item has a ✅ *done means* check.

---

## 0. The boundary (so we never cross wires)

| | System A (this repo) | System B (RFX OS — yours) |
|---|---|---|
| Owns | purchase → registration → approval → identity → **wallet** → awards/refunds | authentication, authorization, course access, integrity monitoring |
| Never does | sells courses, hosts lessons, logs students into the OS | creates student identities from scratch, collects payments |

System A **introduces** the approved student to you via the handoff; you **activate** them.
You never create a student who didn't come through the handoff.

---

## 1. Firebase project + environments

- Create **two Firebase projects**: `rfx-prod` and `rfx-staging` (mirror settings).
- Enable: **Authentication**, **Firestore**, **Cloud Functions**, **Hosting** (for the OS),
  **Storage** (selfie bucket — private).
- All APIs locked to the domain(s) `realityfx.netlify.app` + your OS domain.

✅ *done when: `firebase deploy` succeeds to both projects and dev consoles show zero "missing
permission" errors for the locked APIs.*

---

## 2. Firestore schema (mirror System A's state)

Collections (rules-secured, see §4). Document IDs are the System A IDs (`ENR-0001`,
`RFX-10482`).

- `students/{studentId}` — the identity System A hands over:
  `{ studentCode, name, email, country, course, enrollmentId, entitlements, status, createdAt }`
- `enrollments/{enrollmentId}` — the paid record (invoice number, price, transaction, state).
- `wallets/{email}` — `{ walletNo, balance, ledger[] }` — ledger entries typed
  `credit | award | redeem`, awards never expire, credits carry `expiresAt`.
- `staffWallets/{staffId}` — the team's RFX money: `{ walletNo, balance, ledger[] }` with
  ledger entries typed `staff-fund` carrying `{ amount, note, reference, by }` — the
  reference is the idempotency key (the same funding reference can never pay twice).
- `payouts/{payoutId}` — cash refunds queued for the PayPal batch.
- `awards/{reference}` — ceremony awards + giveaway records (idempotent by reference).
- `securityEvents/{id}` — lockouts, redeems, handoffs (append-only).
- `settings/global` — mirrors System A's `getSettings()` so both sides agree on limits
  (including `financeEmail` — where the end-of-day financial audit report is sent).

✅ *done when: all collections exist with the fields above and sane indexes (wallets by
email, payouts by status, events by time, staffWallets by staffId).*

---

## 3. Authentication (Firebase Auth — email/password)

The one rule: **Reality FX never sees or sends a plain-text password. Ever.**

- On handoff (see §6), System A sends the verified student email + Student ID. Your
  **server-side** Cloud Function creates the Auth user with a **random temporary password**,
  then sends a **set-your-password link** via email (Firebase's `sendPasswordResetEmail` style
  flow). The student sets their own password on first OS login.
- RFX OS sign-in = standard Firebase Auth. Sessions via `onAuthStateChanged`.
- `signInWithEmailAndPassword` throttling is built into Firebase — no extra lockout code needed
  for login, but keep System A's 15-minute **lockout messaging** on the OS UI for consistency.

✅ *done when: a student who received their set-password link can complete sign-up, log in,
and the OS shows their Student ID from the Auth `uid` lookup.*

### Staff accounts (System A's Staff Portal → your Auth)

System A has a Staff Portal (`staff.html`) where **admins hire staff** — a one-time invite,
the new team member sets their own credential, staff clock in/out for shifts, and the
reception page shows a live on-duty count. In production this must ride on Firebase too:

- **Staff users are NOT self-service.** A Cloud Function `createStaffMember` (admin-only,
  gated by an existing admin's custom claim) creates the Auth user and sends a
  **set-password link** — the same rule as students: never send a plain-text password.
- Attach a **custom claim** per staff member: `{ role: 'admin' | 'reception' | 'approver' | 'finance', staffId: 'STF-0001' }`.
  The OS/Console UI reads `getIdTokenResult().claims.role` to gate the hire console, the
  approval buttons, the finance screens — never trust the client to tell you who it is.
- Mirror `shifts` and `onDuty` to Firestore (or keep them in System A's store; the OS only
  needs the **on-duty count** for its “Reception 24/7” pill — a simple `onDutyStaff` read
  with a `clockedOutAt` timeout of 16 h as a safety valve).
- Keep the same **lockout messaging** on the Staff Portal; Firebase throttles the actual auth.

✅ *done when: an admin can hire a receptionist, the receptionist sets their own password,
clocks in, and the OS/reception pill shows them on duty.*

---

## 4. Firestore security rules (the non-negotiable part)

Write these so **a student can only ever read their own data, and money only ever moves through
server functions**:

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    // Students read only their own record (auth.uid === studentId)
    match /students/{studentId} {
      allow read: if request.auth != null && request.auth.uid == studentId;
      allow write: if false; // only server functions create/update students
    }
    // Wallets: the student reads their own; NO client writes to balance.
    // Every money movement (credit, award, redeem, refund) goes through a
    // Cloud Function with an API key — the client can never touch balances.
    // (The owner check is inlined below: the wallet doc id is the student's
    // lowercased email, so compare against the auth token's email claim.)
    match /wallets/{email} {
      allow read: if request.auth != null
        && request.auth.token.email != null
        && request.auth.token.email.lower() == email;
      allow write: if false;
    }
    match /payouts/{id} {
      allow read: if request.auth != null && request.auth.token.moderator == true;
      allow write: if false;
    }
    // Moderators (staff) have their own claim-based collection
    match /staff/{uid} {
      allow read, write: if request.auth != null && request.auth.token.moderator == true;
    }
  }
}
```

- Grant staff the `moderator` custom claim via a Cloud Function (`admin.auth().setCustomUserClaims`).
- **The handoff endpoint must be a Cloud Function with an API-key gate** (System A calls it
  with a shared secret; only that function may write `students/*` and `wallets/*`).

✅ *done when: a raw Firestore client SDK attempt to write `wallets/any/balance` fails, and a
student can read exactly one document: their own.*

---

## 5. Storage — selfies (data minimisation)

- System A uploads the verification selfie to a **private** Storage bucket (not Firestore).
- **Retention:** the same rule System A already enforces — selfies are purged once a decision
  exists (approval or final rejection). A scheduled Cloud Function deletes
  `selfies/*` older than 24h past their decision, and System A's purge call triggers immediate
  deletion.
- Never serve selfies to anyone but the moderator's session.

✅ *done when: a purged selfie is gone from the bucket within minutes and no client URL works
after deletion.*

---

## 6. The handoff endpoint (System B side of the bridge)

System A calls `POST /api/handoff` (Cloud Function) with this exact payload (already produced
by `js/bridge.js → buildPayload`):

```json
{
  "studentId": "RFX-10482",        // <- the idempotency key
  "studentCode": "VGNNAC",
  "name": "Pedro Zulu",
  "email": "pedro.zulu@example.com",
  "course": "Reality Academy — Professional Program",
  "entitlements": ["RFX-ACADEMY-PRO"],
  "status": "APPROVED"
}
```

Your function must:

1. **Idempotency check first.** `if student exists by studentId → return { received: true,
   already: true }` — no create, no duplicate, no error. A retried request after a network
   hiccup must **never** produce `RFX-10483`.
2. Otherwise create the `students/{studentId}` doc + the Auth user + wallet (with the
   walletNo System A sent if present), then return `{ received: true, already: false }`.
3. Respond fast; System A schedules its own retry with backoff if you time out.

✅ *done when: you call the function twice with the same `studentId` and the students
collection still has exactly one document.*

---

## 6b. The achievement bridge event (merch rewards) — Lee's side

System A doesn't grade. RFX OS owns averages, so **you send the merch-reward event**
the moment a student's course average reaches the threshold:

```
POST /api/achievement        (System A endpoint — same idempotency discipline as /api/handoff)
{
  "studentId": "RFX-10482",   // the ID you received at handoff
  "average":   84.5,          // the student's current average
  "reference": "ACH-2026-S1-10482"  // idempotency key — never send the same achievement twice
}
```

- System A validates the student exists and `average >= 80` (threshold is a setting),
  then creates the free tee + hoody **fulfilment order** and emails the student to
  pick sizes + address.
- **Idempotent by `reference`:** if your first POST's response is lost and you retry,
  System A replies "already claimed" — no double reward, no duplicate order.
- Below-threshold averages are refused with `{ ok: false, reason: 'below_threshold' }`.
- The reward is fulfilment, not credit: the student can never convert it to cash or
  use it toward a course.
- Merch bought with wallet credit (`RFX-MERCH-*` catalog codes) uses the same queue.

✅ *done when: a student's average crossing 80% in the OS creates exactly one merch
order, and a retried achievement event creates zero duplicates.*

---

## 7. Email provider (Resend / SendGrid / SES)

System A's `RFX.db.email(...)` currently drops mail into the demo mailbox. Replace with an
HTTPS call to your provider from a Cloud Function:

- Invoice email (from the payment record — never typed by humans).
- Registration email (secure single-use link; 7-day expiry, rotated on resend).
- Verification codes (6-digit, one-time, attempt-limited).
- Award / credit / redeem / refund notifications.
- Set `DKIM`, `SPF`, `DMARC` on the Reality FX domain so these don't land in spam.

✅ *done when: a test student receives invoice → registration → code → welcome emails in the
right order with the right branding.*

---

## 8. CAPTCHA (server-verified)

Replace the canvas challenge with **Cloudflare Turnstile** (or hCaptcha). The verify call must
be made from your Cloud Function, not the client. Keep System A's "challenge expires after N
attempts" behaviour server-side.

✅ *done when: a headless script cannot pass the CAPTCHA, and the demo hook
`window.__RFX_CAPTCHA_ANSWER` is removed.*

---

## 9. PayPal rail (cash refunds + prizes)

- Cash refunds: System A queues them; a scheduled Cloud Function calls **PayPal Payouts**
  once per month (the consolidated batch — one run, one fee) using the student's PayPal email.
- Prize money (awards/giveaways) stays **internal credit** for now — no payout unless the
  student later chooses cash-out (then the same Payouts rail applies, with policy + tax notes).

✅ *done when: a test payout appears in the PayPal dashboard and the payout record updates to
`paid`.*

---

## 8.5 The package catalog (spend-credit codes) — Lee's side of the contract

The member panel lets students spend RFX credit on **packages**, each with a code
(e.g. `RFX-UPGRADE-01`, `RFX-MENTOR-01`). The same codes live on your website store
products — that's how the two systems agree on price.

- **Your job:** attach the exact catalog code to each store product that accepts
  RFX balance (a product field, e.g. `rfxCode: 'RFX-MENTOR-01'`).
- **Our job:** when a student pays with RFX balance, the store calls the redeem rail
  with `{ code, studentId }`. System A looks the code up in its catalog, checks the
  student's spendable balance, deducts, and returns a signed receipt.
- **Never guess:** an unknown code is refused with `{ ok: false, reason: 'unknown_code' }` —
  never invent a price. A student can only pay when spendable ≥ catalog price.
- The catalog is staff-editable in System A (Credit & Refunds → Package catalog).
  Codes are unique and case-insensitive; the store should send them uppercase.

✅ *done when: a student clicks “pay with RFX balance” on the website for a catalog
package, System A prices it from the catalog, deducts correctly, and both ledgers match.*

---

## 9.5 Sarrah (the chat assistant)

System A ships **Sarrah**, a floating chat assistant (`js/bot.js`) on Reception and the member
panel — rule-based, answering account questions with **live** wallet/invoice/state data. Two
production options, both documented so the swap is drop-in:

- **Option A (recommended):** keep the deterministic rules for the common questions
  (balance, invoice, status, access) — they're fast, free and always correct — and add a
  **"talk to a human"** intent that opens a real support queue (email a ticket, or a
  provider widget like Tawk.to/Intercom). The chat UI `#rfx-bot` stays untouched.
- **Option B:** replace the `ask()` core with your LLM/agent endpoint. Give it read-only
  access to the student's Firestore doc via the authenticated SDK — never write access.

Rule of thumb: the assistant may **read** a student's own data; it must never move money,
change state, or act on behalf of staff.

---

## 9.6 Screen-capture deterrence (phones + desktops)

**The honest truth first:** a website **cannot** fully block OS-level screenshots. That's
why banking apps ship native with `FLAG_SECURE` (Android) / `UIApplicationExitsOnSuspend`
style controls. So the web strategy is *deterrence + traceability*, not impossible
prevention — and the marketing silver lining the founder wants: any leaked shot still
carries the brand, watermarked. Apply all of these in RFX OS (and the member panel):

1. **Watermark every protected page with the student's ID** — a faint, rotated
   `RFX-10482 · Reality FX` tiled overlay (CSS `::before` with a repeating pattern, or a
   canvas layer). If a screenshot leaks, it traces to exactly one student, and the brand is
   in the image either way.
2. **Disable text selection & copy on course content**: `user-select: none`;
   `-webkit-user-select: none`; block `copy` events. Screenshot tools can still capture,
   but casual copy-paste sharing is killed.
3. **Print blackout**: `@media print { body { visibility: hidden } }` — the OS content
   prints as a blank branded page, so "print to PDF" is not a leak vector.
4. **Discourage screen-recording apps on desktop**: `navigator.mediaDevices.getDisplayMedia`
   can't be blocked by the page, but you can detect it (a capture starts → pause content /
   show a watermark burst) and log a security event: `window.addEventListener('resize')`
   fires when a capture toolbar appears — use it as a suspicious-activity signal, not a
   verdict (matches the existing integrity-monitoring philosophy).
5. **Native OS app (when it exists):** use `FLAG_SECURE` on Android and the iOS equivalent
   so the OS refuses screenshots/recordings at the system level. This is the *only* true
   prevention and only exists in native apps.
6. **Do NOT block right-click globally** — it breaks accessibility and is trivially
   bypassed; it reads as amateur. Watermarks + selection lock are the classy deterrents.

Rule: deter and trace, never pretend to prevent. If someone wants a bad-quality shot they'll
get one — that's fine, it's still a branded ad.

✅ *done when: every OS lesson page shows the student-ID watermark, text can't be copied,
print produces a blank branded page, and a capture attempt logs a reviewable event.*

---

## 9.6b Trusted printing — an EARNED entitlement (Lee's side)

The watermark + print blackout from §9.6 apply to **everyone by default**. Printing
course material is a privilege Reality FX grants only to students who have *earned the
organisation's trust* — a focused student who prefers hard copy, not just a clever one.
Trust is recorded and can be revoked.

**The contract:**

- System A stores `printTrust` per student: `'standard'` (default) or `'trusted'`.
- The handoff payload now includes it:
  ```json
  { ..., "printTrust": "trusted" }
  ```
- **The OS enforces at the backend, never the frontend.** `printTrust: 'standard'` →
  every page watermarked, text selection blocked, print blacked out. `'trusted'` → the
  OS may show a print button for *that student's own course material*, still watermarked
  with their Student ID (a trusted student printing their own notes is fine — the ID
  stays in the file so even they can't resell it anonymously).
- Staff grant/revoke in System A's SRM. A revocation must propagate to the OS on the
  next sync/reconciliation (same idempotency discipline — a revoke is keyed by Student ID
  and can be re-sent safely).
- Every grant and revocation is audited and hits the security event log. A revoked
  student whose print button still works is a production bug — the self-test should
  check it.

**The deterrent is the point.** The terms students sign (Content Protection & Trusted
Printing, v1.0 — System A's registration) state plainly: lessons are watermarked with
your Student ID, copying is blocked, printing is blacked out by default, capture attempts
are detected and logged, and print access is a revocable privilege granted only to those
who have earned trust. Telling misusers the guards exist is itself a guard — people are
far less likely to break rules when they know the system is watching and every leak
points back to them.

✅ *done when: only `printTrust: 'trusted'` students can print in the OS; the watermark
never leaves a trusted student's printouts; a revocation kills print access on the next
sync; grants and revocations are audited.*

## 9.7 Refund intelligence (production mapping)

System A scores every refund request and revokes material rights on execution. The
server-side version should mirror these three rules exactly:

1. **Identity fingerprinting lives server-side.** Keep a `refund_events` collection in
   Firestore keyed by a hashed identity fingerprint (email + phone + normalized name +
   payment method hash). On refund request, score against that history: prior refunds,
   velocity (N in 90 days), early refunds, pre-registration refunds, payment-link reuse.
   Store the score + signals on the payout record. Flags are moderator review triggers,
   never automatic verdicts.
2. **Revocation is a hard state.** On refund execution the student's document moves to
   `REFUNDED`, their Firebase Auth is disabled, and their RFX OS entitlement is removed
   (the OS checks entitlement server-side on every request, so revoked = denied).
3. **Identity cooldown is enforced at enrollment time.** The server refuses (or flags for
   review, per policy) any new enrollment whose fingerprint has an executed refund within
   the cooldown window (default 30 days). Firestore security rules must not allow a
   client to clear `cooldownUntil`.

The Refund & Credit Policy (v2.1) text in System A is the canonical wording — keep it in
sync wherever refunds are mentioned.

**Website Terms update (founder's request):** the wizard's Refund & Credit summary is the
canonical language and now states the full intelligence posture, so mirror it on the website
Terms page exactly: credit is always honoured in full with no deduction; for cross-border
payments Reality FX may recommend (or require) the fee-free RFX account credit where a cash
refund's transfer + FX costs would exceed its value; approved refunds revoke all rights and
ownership of course material, terminate RFX OS access, and start a 30-day re-enrollment
cooldown; every refund is risk-scored and flags are moderator review triggers; repeated,
rapid or abusive refund activity or refund farming across identities may result in denial of
future enrollment. Stating the seriousness up front is itself a deterrent — the terms are
part of the defence.

✅ *done when: a refund request is scored before payout, an executed refund disables the
Auth user + OS entitlement, a cooldown identity cannot re-enroll within the window, and the
website Terms page carries the same wording the student accepts in System A.*

---

## 9.8 Navigation & the single members panel (Lee's side)

The Academy nav item is branded **RFX OS Academy** and every console in System A
links to it with `?sid=` so your OS can greet the student by identity.

**The one-direction decision — there is ONE members panel.**

Your RFX OS already ships an account/members page, and System A ships a richer one
(wallet, invoice, vital details with eye-reveal, merch, Sarrah, spend-credit). Two
competing members panels confuse students. The decision:

- **RFX OS keeps:** identity, authentication, course access, learning, integrity
  monitoring — everything security and education.
- **System A's `member.html` is THE account panel** — wallet, invoice, vital
  details, merch, spend-credit, Sarrah. When a student clicks "My account" inside
  RFX OS, **deep-link them to System A's member page** instead of showing your own.

**The deep-link contract (so the travel is smooth both ways):**

1. **Members → Academy (System A side, already built):** the "Enter RFX OS"
   button on the member panel and the completion screen calls
   `{osBase}/index.html?sid=RFX-xxxxx`. Your OS reads `sid`, recognises the
   student, and drops them straight into their dashboard — no extra login if the
   session is still live.
2. **Academy → Members (your side):** your "My account" link should call
   `{systemA}/member.html?email=student@example.com`. System A prefills the email
   field so the student is one step from signed in. **Never put the Student Code
   in a URL** — it stays a credential the student holds. If the session on your
   side is live, consider a short-lived one-time return token instead.
3. **Idempotency applies to navigation too:** if the OS bounces the student back
   and forth, `member.html` and `index.html` must both be safe to revisit — no
   duplicate accounts, no lost state. The `sid` is a read-only greeting, never a
   write trigger.

**Why this keeps the pipeline clean:** the student never needs to learn two
account panels. One front door (registration), one account home (System A), one
learning home (RFX OS). The sequence you set — web → registration → approval →
Academy — stays intact, and the return trip from the Academy to the members panel
is exactly as smooth as the handshake that got them in.

## 9.9 Capacity & the security self-test (Lee's side)

The demo answers "how much can it hold" honestly, and you should mirror that in production:

- **Demo store:** browser localStorage ≈5 MB per origin. A fully-registered student is ≈1.3 KB,
  so 30 students ≈ 0.8% of capacity. Firestore has no practical ceiling — that is the whole
  point of the production move. Keep the data model slim (no large blobs inline; store selfies
  in Storage, not in the document) and capacity stops being a conversation.
- **The security self-test** (Staff Console) proves the four guards fire in the demo. In
  production these exact checks should run against the real services: login lockout (Auth
  throttling), verify-code guard (server-side attempt counter), link expiry, and selfie purge
  (Storage deletion). If a production guard ever silently fails, the self-test is the tripwire.
- **Never relax a guard to make a demo look better.** The demo enforces the same limits the
  production rules will: maxLoginAttempts, lockoutMinutes, verifyCodeAttempts, retainSelfies,
  sessionTimeoutMinutes. They are load-bearing, not cosmetic.

## 9.10 Referral marketing (Lee's side — the ?ref= plumbing)

Students share a code; the Academy tracks where every student comes from. System A owns the
whole engine; Lee's only job is to **carry the code** on the website store:

- Every student's shareable code is `RFX-XXXXXX` (on their member panel). Their share link is
  `https://store.realityfx.../?ref=RFX-XXXXXX`.
- **When a new purchase arrives at System A's enroll endpoint, pass the `ref` through** in the
  payment payload: `{ ..., "referralCode": "RFX-XXXXXX" }`. System A validates it (must be an
  ACTIVE student, self-referral refused) and locks attribution at enrollment — before
  registration, before approval.
- **Where the money is earned (the founder's rule):** a commission ACCRUES when the referred
  student goes ACTIVE, VESTS after they survive the `vestingDays` refund window (30), and
  FORFEITS if they refund. A referred student banned within `clawbackDays` (90) claws back a
  paid commission. This is "money subject to change is not yours yet" — enforced, not hoped.
- **Tiers** (settings): 15% base → 20% at 3 → 25% at 6 → 30% at 10 active referrals. Payouts
  land in the referrer's RFX wallet as a `referral` ledger entry (never expires, spendable).
- **Single-level only.** The family tree is tracked (who brought whom, for analytics and
  responsibility) but payouts are direct-referral only — a multi-level payout scheme would be
  a regulatory and reputational landmine. Keep it that way in production.
- Staff actions: `vestReferralCommissions()` (batch), `payReferralCommissions()` (idempotent
  into wallets) — the Staff wallet page has buttons for both, plus a survival-rate table
  (referrers whose network refunds heavily are flagged: the house always wins).
- In production, vesting + payout should run on a scheduled cloud function (e.g. daily), not
  a staff button — the logic in `db.js` is the spec.

✅ *done when: a purchase carries its `?ref=` code into System A; a commission vests only after
30 days un-refunded; a refund forfeits it; a ban within 90 days claws it back; payouts are
idempotent and land in wallets.*

## 9.11 Financial audit — the end-of-day money file (production mapping)

System A compiles every money event into one flat ledger (`financialLedger()` — payments
received, credits, awards, referral commissions, wallet spend, staff funding, refunds queued
+ paid) and lets finance download CSV/JSON or email the report to `settings.financeEmail`
(default `realityfx20@gmail.com`). In production:

1. **Mirror the flat ledger in Firestore** (`auditLedger/{id}` append-only, written inside the
   same transaction that moves money — never a separate copy that could drift). One doc per
   event: `{ at, kind, dir, amount, currency, party, detail, ref }`.
2. **A scheduled Cloud Function** (`scheduler` every day at end-of-day) aggregates the day's
   ledger, attaches the summary (received / held / refunded / staff funded / spent), and
   emails the report to `settings.financeEmail` via the provider in §7. CSV + JSON downloads
   are generated server-side on request from the same collection.
3. **The invariant to protect:** money moves in exactly one place (the server function), the
   ledger write is in the same transaction, and every row carries a reference — so the tax
   file can never disagree with what actually happened.

✅ *done when: the daily report arrives at `realityfx20@gmail.com` (or the configured address)
and matches the Firestore ledger line-for-line.*

---

## 9.12 Staff wallets (production mapping)

System A funds staff wallets from the Credit & Refunds page: ledgered, emailed to the staff
member, security-logged, idempotent by reference. In production:

1. `staffWallets/{staffId}` in Firestore (see §2). A **finance-only Cloud Function**
   `fundStaffWallet(staffId, amount, note, reference)` — gated by the `finance`/`admin`
   custom claim, never callable from a client without the claim.
2. The same never-pay-twice rule: a reference already present on the ledger returns an error
   instead of paying again.
3. The Staff Portal reads its own `staffWallets/{uid}` (rules: a staff member reads only
   their own) and shows balance + recent ledger — same look as System A's panel.

✅ *done when: an admin funds a team member from the finance screen, the staff member sees
it in their portal, and a duplicate reference is refused.*

---

## 9.13 Dashboard hover micro-interaction (Lee's side — the mini-box tip)

The founder loves the hover on System A's dashboard cards (Enrollment & Registration doors)
and wants the same on your OS dashboard mini boxes. The whole effect is ~6 lines of CSS —
no JS required:

```css
/* System A's cards */
.kpi, .card-hover, .door {
  transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
}
.kpi:hover, .card-hover:hover, .door:hover {
  border-color: rgba(212, 175, 55, 0.35);   /* gold border, not a new colour */
  transform: translateY(-2px);              /* subtle lift */
  box-shadow: 0 0 0 1px rgba(212,175,55,0.22), 0 14px 36px rgba(212,175,55,0.15);
}
/* and the icon inside grows + glows gold on hover */
.door:hover .door-ic svg, .kpi:hover .kpi-ic svg {
  transform: scale(1.2);
  filter: drop-shadow(0 0 7px rgba(212, 175, 55, 0.9));
}
```

Apply it to your OS dashboard mini boxes (cards, KPI tiles, module shortcuts) using your
existing gold variable (`--gold` / `#D4AF37`) — never introduce a competing yellow.

✅ *done when: every dashboard mini box lifts, glows gold on hover, and the icon scales with
the gold drop-shadow.*

---

## 9.14 The smart front door + the 24-hour demo pass (System A)

Two System A behaviours worth knowing about (and the second is a handy way to demo the
handoff):

1. **Smart front door.** The reception dashboard highlights the one door that matters right
   now and says why — a live registration link → Members; no enrollments yet → Staff Console;
   an approved student awaiting the handoff → Staff Console; everyone active → Members. If you
   ever mirror a dashboard, the principle is: the UI should already know what the user needs
   next, before they click.
2. **24-hour demo pass.** `createDemoPass()` mints a free tour that feels like a real
   purchase (invoice + registration link + full wizard) but the link expires after 24 hours
   (`tokenHours` on the record). Idempotent by the fixed `DEMO-TOUR` transaction. Great for
   gifting a founder/recruiter a first-hand walkthrough — they go through the real
   registration, and when approved the handoff to your OS runs exactly like any student.

✅ *done when: the demo-pass student, once approved, arrives in your OS through the normal
handoff — proof the whole chain works with a real human.*

---

## 9.15 THE WEBSITE → SYSTEM A PIPELINE (Lee's side — the missing link)

This is the exact chain the founder keeps asking about — **who sends the email, and how does
the student even get here?** Answer: **System A sends the emails, automatically, the moment
it receives an approved payment.** The website is only responsible for the first two steps;
from step 3 on, the machine runs it without a human in the loop.

```
1. STUDENT clicks "Enroll" on the website store
        ↓
2. Website asks for the student's EMAIL FIRST (email-first capture — PayPal
   requires it anyway, so capture it before checkout opens)
        ↓
3. Student pays on PayPal → PayPal approves
        ↓
4. PayPal notifies the WEBSITE (webhook / webhook / IPN — server-side, verified)
        ↓
5. WEBSITE calls System A's enrollment endpoint (below) with the approved
   payment details — NOTHING else. No invoices, no emails — just the facts.
        ↓
   ┌── SYSTEM A (the machine) takes over from here ──────────────────┐
   │ 6. Creates the enrollment record (idempotent on transaction id) │
   │ 7. Generates the invoice (INV-2026-0001, R3 510,00, PAID)       │
   │ 8. 📧 Sends the INVOICE email                                   │
   │ 9. 📧 Sends the REGISTRATION email with a secure single-use link │
   │    (24-72h standard lifetime; resend keeps the same lifetime)    │
   └──────────────────────────────────────────────────────────────────┘
        ↓
10. Student clicks the link → the registration wizard (this system)
        ↓
11. register → verify → CAPTCHA → identity → agreements → submit
        ↓
12. Automated checklist + moderator approval → Student ID + Student Code
        ↓
13. Secure handoff to RFX OS → RFX OS confirms → student is ACTIVE
        ↓
14. Student signs into the members panel (member.html) with email + code
```

**The student is never redirected to the members panel after paying.** They arrive through
the link in the email. That is the bridge — one email, one link, one registration.

### The enrollment endpoint (what you call from the website)

`POST /api/enroll` (System A) — body, all optional except the facts:

```jsonc
{
  "transactionId": "PP-9F82K3...",  // PayPal's approved payment id — THE idempotency key
  "customerName": "Pedro Zulu",
  "email": "pedro@example.com",
  "course": "Reality Academy — Professional Program",
  "price": 3510,
  "currency": "R",
  "paymentMethod": "PayPal",
  "referralCode": "RFX-ABCD23"       // optional — from ?ref= on the checkout URL
}
```

Rules System A enforces (so you never have to think about them):

- **Idempotent:** the same `transactionId` returns the existing enrollment — never a second
  record, second invoice, or second batch of emails. **Retrying after a network hiccup is
  safe.** This is the exact same religion as the OS bridge: a retry is a no-op, not a copy.
- **Referral attribution** is captured here from `?ref=`, the code the student carried from
  their friend's share link.
- **Auto-emails:** invoice + registration email fire in the same call. Nobody opens an
  invoice screen and types by hand — that is where human error lives.
- The email address is captured at enroll time (step 2), so the moment payment is confirmed
  the emails go out **swiftly** — there is no waiting step.

**What you must build on the website (your checklist):**

- [ ] Enroll flow asks for email BEFORE checkout (email-first capture).
- [ ] PayPal checkout; capture `PAYERID`/order id server-side, never trust the client.
- [ ] Verify the webhook (PayPal signature) before trusting it.
- [ ] Call `POST /api/enroll` with the fields above; retry with backoff on failure.
- [ ] Show the student "Check your email for your Reality FX invoice and registration link."
- [ ] After approval + handoff, the OS links its account menu to `member.html?email=…`
      (never the Student Code in a URL).

✅ *done when: a real purchase on the website produces, with zero human action, an invoice
email and a registration link email in the student's inbox, and the link completes the whole
journey.*

---

## 9.16 Registration funnel analytics (both sides)

System A now records, once per enrollment: **first link open** (`firstOpenedAt` — with a
security event) and **time to register** (first open → submission). The Staff Console shows
the funnel: links sent → opened → submitted → approved, plus the **average time students
take to register**.

Your side of the record: your email provider (Resend/SendGrid/SES) reports **opens and
clicks** — pixel on send, webhook on open. If you forward those events to System A as
`{enrollmentId, openedAt}`, the funnel becomes end-to-end (email sent → opened → clicked →
registered → approved).

✅ *done when: the funnel shows real numbers and the avg time-to-register is a number we
believe (so we can spot a registration flow that's getting slower and fix it before it hurts
conversion).*

---

## 9.17 Staff payroll (deposit method + monthly payday)

Finance can now set, per staff member, a **deposit method** (PayPal / Bank transfer / Zapper /
Cash) and a **monthly payday** (day of month 1-28). The wallet screen shows the payroll
schedule — each member's next pay date, and a "due today" flag. On the scheduled day, funding
their wallet becomes the payroll run; the money is ledgered, emailed to them, and a duplicate
reference is refused (you cannot pay the same pay run twice).

✅ *done when: a staff member has a method + payday set, the schedule shows their next pay
date, and funding on that day is a normal, audited wallet funding.*

---

## 9.18 Prize-money cash-outs (the wallet as real money)

Awards and giveaway winnings sit in the student wallet. Students can now **cash out** (min
R50): the amount leaves the wallet the moment it's requested, queues into the **same
consolidated monthly batch as refunds** (one PayPal Payouts run, one fee) and is paid out
with it. A cash-out is **not** a refund — nothing is revoked, the enrollment is untouched —
so it must never be routed through the refund/cooldown/revocation logic.

Production mapping: the batch already rides PayPal Payouts (see §9); cash-outs and refunds
share the run but keep distinct kinds in the payout record (`cashout` vs refund), so the
financial ledger and the OS never confuse prize money with purchase reversals.

✅ *done when: a student with prize money requests a cash-out, sees it in their wallet as a
deduction, and it is paid in the next batch without touching their enrollment.*

---

## 10. Go-live checklist (both systems together)

- [ ] Handoff works both directions; a retry creates zero duplicates.
- [ ] A student who paid → registered → approved → handed off can log into RFX OS and see
      exactly their course's content — nothing else.
- [ ] A student who only paid (never approved) cannot log into the OS.
- [ ] Wallet balances match between System A and Firestore after a credit, an award, a redeem.
- [ ] Cash refund → PayPal batch → paid, with confirmation email.
- [ ] Security events visible to the moderator; a lockout actually blocks sign-in.
- [ ] Selfies purged after decisions; the bucket shows zero stale files.
- [ ] Admin can hire a staff member; the invite is one-time; the new hire sets their own
      credential and clocks in; the 24/7 on-duty pill reflects reality.
- [ ] Sarrah answers with live data; a "human" request reaches a real queue.
- [ ] Store products carry the same catalog codes as System A; a balance payment deducts
      once, prices match, and an unknown code is refused.
- [ ] The SRM shows every approved student with identity, wallet and journey events.
- [ ] A purchase carrying `?ref=CODE` is attributed to that ACTIVE student; a self-referral is
      refused; a commission vests only after 30 days un-refunded, forfeits on refund, and a
      ban within 90 days claws it back into the referrer's wallet.
- [ ] An OS achievement event (80%+ average) creates exactly one merch order; a retry
      creates zero duplicates; below-threshold is refused.
- [ ] OS pages are watermarked with the student ID, text copy is blocked, print is
      blacked out by default, capture attempts surface in the security feed, and only
      `printTrust: 'trusted'` students can print (revocations take effect on next sync).
- [ ] A refund is risk-scored before payout, an executed refund revokes the Auth user +
      OS entitlement, a cooldown identity cannot re-enroll within 30 days, and the website
      Terms page carries the same refund policy wording the student accepts.
- [ ] The end-of-day financial audit email reaches `realityfx20@gmail.com` and matches the
      Firestore ledger line-for-line; CSV/JSON downloads work from the finance screen.
- [ ] An admin funds a staff wallet; the staff member sees it in their portal; a duplicate
      funding reference is refused.
- [ ] The OS dashboard mini boxes lift and glow gold on hover (the shared CSS tip).
- [ ] A real purchase on the website → PayPal webhook → `POST /api/enroll` → invoice +
      registration emails appear in the student's inbox with zero human action; a webhook
      retry creates zero duplicates.
- [ ] Registration links are tracked: first open recorded, avg time-to-register visible in
      the Staff Console funnel.
- [ ] A staff member has a deposit method + monthly payday; the payroll schedule shows the
      next pay date.
- [ ] A prize-money cash-out pays out in the consolidated batch without revoking anything;
      the financial audit shows cash-outs separately from refunds.
- [ ] Any email in the Mailbox can be downloaded as a file from the Mailbox screen.
- [ ] RFX OS links its account menu to System A's `member.html?email=…`; the email is
      prefilled; the Student Code is never in a URL; travel both ways is smooth.
- [ ] `file://` and http demo URLs replaced by HTTPS everywhere.

---

*System A — the Registrar. Built for Reality FX, The Trading Academy. If any step is unclear,
open `js/db.js` and `js/bridge.js` — the function signatures ARE the contract.*

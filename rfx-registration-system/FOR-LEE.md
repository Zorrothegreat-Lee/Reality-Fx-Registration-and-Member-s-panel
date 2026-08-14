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
by `js/bridge.js → buildPayload` — **this is the canonical contract; do not change it**):

```json
{
  "idempotencyKey": "RFX-10482",
  "studentId": "RFX-10482",          // <- the idempotency key
  "studentCode": "VGNNAC",
  "verifiedName": "Pedro Zulu",
  "email": "pedro.zulu@example.com",
  "enrollmentId": "ENR-0001",
  "invoice": "INV-2026-0001",
  "course": "Reality Academy — Professional Program",  // display convenience field
  "entitlements": [ "Reality Academy — Professional Program" ],  // a LIST per identity
  "printTrust": "standard",          // "standard" | "trusted" — enforce at the backend
  "founder": false,                  // optional; absent/`false` must never break a handoff
  "demoPass": { "hours": 24, "createdAt": "…" },  // only present on a demo-tour identity
  "approvalAt": "…",                // when the student was approved (ISO, when present)
  "trust": { "score": 100, "tier": "excellent" },  // the standing the OS must mirror
  "status": "ready",                 // the canonical state value
  "source": "reality-fx-registrar",
  "sentAt": "2026-08-09T…"
}
```

**Contract note (go-live brief §2.3.5):** `entitlements` is now a **LIST** (not an object) —
System A sends `[course]`, and when a second course is handed over (same Student ID), the
OS **merges** the new entitlement into the existing record instead of overwriting it.
`course` remains as the display convenience field. The OS should also store, when present:
`demoPass { hours, createdAt }` → derive `demoTourEndsAt` from `approvalAt + hours`;
`trust { score, tier }` → render the same Trust Bar and enforce the same bands (≤25 timeout,
≤10 extended, 0 restricted).

Your function must:

1. **API-key gate first.** Refuse any request missing the matching `X-RFX-Handoff-Key`
   header (the shared secret System A signs into every POST — `settings.handoffApiKey`).
   Only the Cloud Function may write `students/*` and `wallets/*`; knowing the endpoint URL
   must never be enough to mint an identity. A forged payload (missing `studentId`, unknown
   `entitlements`, `printTrust` outside `standard|trusted`) is rejected with a reason.
2. **Idempotency check second.** `if student exists by studentId → return
   { received: true, already: true }` — no create, no duplicate, no error. A retried request
   after a network hiccup must **never** produce `RFX-10483`.
3. Otherwise create the `students/{studentId}` doc + the Auth user + wallet (with the
   walletNo System A sent if present), then return `{ received: true, already: false }`.
4. **Log every handoff call** (success, reject, duplicate) to the security event store — a
   flood of rejects is an attack signal. System A already logs the same on its side
   (`HANDOFF_OK` / `HANDOFF_DUPLICATE` / `HANDOFF_REJECT` in the security feed).
5. **CORS:** the endpoint must allow the `X-RFX-Handoff-Key` request header in its preflight
   response (`Access-Control-Allow-Headers: Content-Type, X-RFX-Handoff-Key`). Without it,
   the browser blocks the POST before it ever reaches your function — the audit caught this
   live: every real-mode handoff failed with “Request header field x-rfx-handoff-key is not
   allowed by Access-Control-Allow-Headers”.
6. Respond fast; System A schedules its own retry with backoff if you time out.

✅ *done when: a raw `curl` to the endpoint without the key is refused, a forged payload is
rejected with a reason, and calling the function twice with the same `studentId` leaves
exactly one student document.*

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

**Demo live-delivery bridge:** until the provider swap, the verification step's "Open your
email app" button composes a `mailto:` to the student's OWN email with the code pre-filled
— their inbox, their provider, so a tour student genuinely receives the code during the
demo pass without being locked to the simulated Mailbox. Same principle: never require the
student to sit inside System A to read Reality FX mail.

**Selfie capture:** the portal offers **three ways** — "Take on my phone" (front camera,
`capture="user"`, mobile), "Use my webcam" (live laptop/desktop preview via `getUserMedia`
with a capture button; the stream is released on every close path, and if the camera is
denied or absent the student is offered the other two paths — never stuck), and "Choose
from gallery" (an existing photo). On your side, accept any capture path; the stored
selfie is downscaled to ≤480px JPEG no matter how it was taken.

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

**The demo countdown.** Demo-pass students see a live countdown clock (gold chip in the
registration header + an inline clock in the member panel) so they always know how long their
tour has left — hover shows *"Time left till your demo session is expired"*. The clock runs on
**Academy time**: it starts when the student is **approved** (that's when the learning can
begin), ticks every second from that moment, and turns warn-red ("Expired — request a new
pass") at zero. Before approval the chip reads the full window ahead with the honest note
"begins when your registration is approved". One shared clock (`demoTimeLeft` / `fmtCountdown`)
feeds both surfaces.

**Your side of the contract:** if you ever show tour/demo status inside the OS (e.g. a demo
badge on the student dashboard), keep the *same* shared clock if you can — or, if the OS
displays it, mirror System A's `demoPass.createdAt + hours` calculation exactly so the two
systems never disagree about when a demo ends. The countdown is a label on the enforcement:
the link itself still dies at `tokenExpiresAt` server-side, so the clock is honesty, not the
wall.

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

## 9.19 Profile tier: DEMO → LIVE (both sides) + second-course enrollment (System A)

### The broker pattern, done honestly

Like Exness/XM (demo account until you register live), a student is **DEMO** until their
registration is approved and a Student ID exists — then they are **LIVE**. The gate is
*already* enforced by the code (no Student Code exists before approval, so a DEMO account
cannot get in); the badge makes the tier visible and the terms make it official.

- System A shows `DEMO PROFILE` on the registration “under review” screen and `LIVE PROFILE`
  on the completion screen (verified ✓ + LIVE chip) and in the members panel identity card.
- **Your side:** when you load a profile from the SRM, render the tier from the student's
  verified/approved status. A DEMO profile gets read-only preview of the course landing
  pages; LIVE profiles get full course access. Label it in the OS dashboard the same way
  (small pill: `LIVE PROFILE` / `DEMO PROFILE`) so the language is identical everywhere.
- The restriction is never cosmetic: Firebase rules must key course access on the
  `approved` + `studentId` fields System A writes, not on a `profileTier` string (a string
  is a label; the underlying booleans are the truth).

### Second-course enrollment — “already verified, so it's simple”

An approved member can enroll in **another course directly from the members panel** — no
re-registration, no forms, no new ID. Their details are already established (SRM-synced),
so the only steps left are: pick a course from the catalog → pay from the RFX wallet → done.

System A mechanics (already live in the demo):

1. The catalog (Credit & Refunds → Package catalog) marks each item `kind`: `course`,
   `service` (mentorship, seat transfer), or `merch`. Only `course` items are enrollable
   from the panel — services stay on “Spend your credit”, merch stays in the shop.
2. Payment goes through the **same idempotent spend rail** as everything else (ledgered,
   emailed, audited) with reference `ADD-<CODE>-<email>`.
3. The new enrollment is created **under the same identity**: same Student ID, same Student
   Code — one person, one credential. It is pre-verified (their identity was already
   established), instantly approved, and handed off to the OS in the same tick.
4. **Ownership is enforced two ways:** the ADD-reference idempotency (a retry can never
   double-charge) **and** by course name (the student's original purchase may carry a
   different transaction ID — a PayPal webhook — so the panel must never let them
   double-buy the same course). A fresh welcome email confirms the new course.

✅ *done when: a verified student buys a second course from the panel, the balance is
deducted exactly once, a new ACTIVE enrollment appears under their existing Student ID,
and retrying the button creates nothing.*

**Your side of the contract:** the OS must accept a second course for an existing Student ID
without treating it as a new person — course entitlements are a **list per identity**, not a
single course field. When System A hands over the second enrollment (same ID, new course),
merge its entitlement into the existing record. This is exactly why the handoff uses the
Student ID as its idempotency key (§6): the second course is a new enrollment record but the
*same* identity, so the OS reconciles rather than duplicates.

---

## 9.20 The Academy prep guide — the 'what to bring to school' letter (both sides)

Every student is emailed an **Academy preparation guide** the instant they are approved —
System A auto-sends it from `approve()` (before any handoff), so no approved student is ever
left wondering what happens next. It covers what to prepare, what every dashboard is for, what
the wallet can do, the rules, and how to get help. It is **year-stamped** (a single constant,
`ACADEMY_YEAR`, currently 2026) — when the year turns, staff change one value and the same
letter serves 2027, 2028, … System changes are announced in the same channel.

**"Why these measures exist" — the transparency section.** The guide now carries a section
that spells out, in plain student language, that every safeguard (link tracking, session
timing, the Trust Bar, page watermarks, security logging) is protection, not surveillance:
so a student's profile never stops working, their login never fails, and the Academy is
never compromised by a leak. It also states Reality FX runs deliberately small and capped
(quality over quantity). Keep this tone — never lecture, never intimidate; the message is
"these tools protect you, and every unusual event is reviewed by a human moderator before
any decision." The OS should mirror the same transparency: if RFX OS shows Trust Bar or
session monitoring, point students to this guide section rather than letting them wonder
what the tools are for.

**"The work behind your Academy" — the earned-trust flex.** The guide also carries a
section that shows the actual engineering effort, using *real, current numbers* (a full
system audit runs 19 checks; four security self-tests attack the system like an intruder;
35+ kinds of security events are logged; a capacity check keeps headroom ahead of the
student body). It is proud but factual — never hype, never invented figures — because
concrete machinery earns more trust than adjectives, and it quietly tells would-be
misbehavers the system is watched and maintained. Mirror this on the OS side with *your*
real numbers: integrity monitors, quiz-timing checks, watermarking, audit trails. Give
students the same honest sense of "this was built carefully, and it is audited so I never
have to worry."

- The email lands in the student's Mailbox like every official message; a matching
  **downloadable PDF** is available from the member panel (Download guide / Email me the
  guide), and staff can re-send it from the Registration & Approval tab (each send is a
  security event — the audit trail shows when a student was briefed).

**Your side of the contract:** the OS dashboard should point students to their members panel
for the guide ("Read your Academy prep guide in My RFX account"), and if you show tour/demo
status in the OS, mirror the guide's year so both systems speak the same Academy year.

## 9.21 One-click full audit (System A tooling — staff use it, not students)

The Staff Console has a **Run full audit** button: one click re-proves the whole chain live
(scratch student runs the REAL pipeline webhook → … → ACTIVE, then is removed; money
reconciles ledger vs wallets; identity integrity; store rev-guard; capacity; all four
security guards). Zero residue — auditing never changes what it audits. Use it whenever a
student reports an issue: the machine re-proves itself on the spot and prints PASS/FAIL per
check.

✅ *done when: a moderator facing a student complaint can press one button and see the whole
chain proven (or pinpointed) in seconds.*

---

## 9.22 The review SLA + student notification feed (System A behaviour to mirror)

Two System A behaviours that keep students informed and calm:

1. **Review SLA — the honest clock.** `security.reviewSlaMinutes` (default 120) is the
   promise on the under-review screen: "Submitted 12 min ago · typically decided within
   ~2 hours — you'll hear by {date+time}". Past the SLA it flips to "still safely in our
   review queue, nothing is wrong · email realityfx20@gmail.com to fast-track". Tune the
   window to real staffing — a promise you can keep beats a vague "short time". If the OS
   ever shows review status, mirror the same message language so both systems speak one
   voice.
2. **Student notification feed.** System A keeps a per-enrollment `enr.notifications`
   feed and toasts the freshest unread item on member-panel sign-in. Events: print trust
   granted, awards landed, referral commission paid, "buddy linked" (a referred student
   approved). If the OS wants to show the same moments, mirror them from the same source
   of truth (the handoff payload can carry the latest `notifications[]` — see §6) rather
   than inventing a second feed.

✅ *done when: a student waiting on approval always knows where they stand (within SLA /
overdue + what to do), and a student who earned print trust or a referral payout sees the
moment celebrated in their account.*

---

## 9.23 THE TRUST BAR — the student's standing (System A owns it, the OS enforces it)

System A now carries a **Trust Bar** per student: 100% the day they're approved, drained by
measured penalties, restored slowly by good conduct, with the **buddy rule** (a referred
student's serious violation costs the referrer). It is the Academy's answer to "who can we
actually trust" — including trusted printing, which should key off it.

### The design (share this — it's the same visual on both systems)

**A gold percentage RING** — deliberately the same visual language as the RFX OS
course-completion ring, so both systems speak one design dialect. It is an asset students
should be obsessed with keeping full, so make it beautiful:

```html
<!-- rendered by ui.trustRingHTML(score, { tierCls, cap }) — a circular SVG -->
<svg viewBox="0 0 100 100">
  <circle class="tr-disc" cx="50" cy="50" r="42"/>
  <circle class="tr-track" cx="50" cy="50" r="42"/>
  <circle class="tr-fill" cx="50" cy="50" r="42"
          stroke-dasharray="263.9" stroke-dashoffset="<pct offset>"/>
</svg>
```

```css
.tr-disc  { fill: #0a0a08; }                  /* the dark inner disc */
.tr-track { fill: none; stroke: rgba(255,255,255,0.09); stroke-width: 7; }
.tr-fill  { fill: none; stroke: url(#goldGrad) /* #8f6f1f → #d4af37 → #f0d98c */;
  stroke-width: 7; /* flat caps — exact arc length */
  transition: stroke-dashoffset .8s cubic-bezier(.22,1,.36,1); }
/* tiers tint the arc: caution → warm amber, low → orange, crit (0%) → red */
.trust-ring.caution .tr-fill { stroke: url(#amberGrad); }
.trust-ring.low .tr-fill { stroke: url(#orangeGrad); }
.trust-ring.crit .tr-fill { stroke: url(#redGrad); }
```

The score sits in the ring centre ("100% · STANDING") over a **dark disc**; a single clean
gold arc drains as trust falls — **no glow, no diamond, no shadows**, flat arc ends. This is
deliberately EXACTLY the RFX OS course-completion ring (your `0% COURSE` ring in the hero
card), so both systems share one design dialect. On the member panel the ring sits beside the
identity card; the demo countdown carries a matching **segmented gold life bar** (rounded
ticks, no glow) that drains as the 24h tour runs out.

Tiers (the founder's model): **80–100 Excellent** · **50–79 Stable** · **30–49 Caution —
be careful** (told: keep it above 30) · **below 30 Danger zone** (inside it: **≤25 Timed
out** · **≤10 Extended timeout**) · **0 Restricted**. The timeout enforcement lives INSIDE
the danger band — the ring reads the band, and the honest timeout warning bites at ≤25.

### The bridge contract (your side)

- **System A is the source of truth** for the score and its ledger. The handoff payload
  already carries identity; include `trust: { score, tier }` on every handoff/sync so the OS
  renders the bar without maintaining a second copy.
- **Integrity events flow TO System A** (like the achievement bridge, §6b): when RFX OS
  detects a violation, call `POST /api/trust-event` with
  `{ studentId, severity: 'minor'|'warning'|'serious', reason, reference }`. System A
  applies the measured penalty, ledger it, and if a referral exists, ripples the referrer
  penalty. Idempotent by `reference` — a retry can never double-penalise.
- **The OS enforces, System A records:** when System A sets `trust.score = 0` (restricted),
  the OS must stop course access server-side on the next sync — never the frontend. Timeout
  tiers (≤25 / ≤10) should likewise pause access with the stated durations.
- **Trusted printing keys off trust:** prefer granting `printTrust: 'trusted'` only to
  students whose Trust Bar is stable (or at least above the caution line) — the bar is the
  honest, current answer to "do we trust this student with hard copy?".

✅ *done when: a violation reported to System A moves the bar and the referrer's bar exactly
once; a restricted student's OS access dies on the next sync; and the OS renders the same
gold bar from the synced score.*

---

## 9.24 The load test — prove the machine at scale (System A tooling + your mirror)

System A ships a **load-test harness** (`db.simulateLoad(n)`): it builds `n` random students
through the REAL pipeline — payment webhook → enrollment → invoice → registration link →
verification → identity → agreements → submission → approval → identity minted → OS
handshake → ACTIVE — with wallets, awards, referral chains, merch spend and refunds mixed
in, then runs the full audit + security self-test + money reconciliation against that entire
world. It runs **in memory only** (a silent flag makes every `save()` a no-op), restores the
real store untouched, and is **deterministic when seeded** so the same academy rebuilds
identically every time. The Staff Console exposes it as a “Simulate students” button with a
full report (rings, funnel, reconciliation, footprint) **and in-console “how to use this”
tips** so any staff member can run it without training.

**Measured at 2,000 students (real run, live):** built in ~4.7s · audit **19/19** · self-test
**4/4** · 1,874 ACTIVE + 126 decisions · all Student Codes unique · money delta **R0.00**
across 2,202 ledger events · 306 referral chains · 121 award payouts · 50 merch orders ·
9 refunds queued · 22 credits issued · world ≈ 33.6 MB (≈17 KB/student — emails dominate).
The 5 MB browser demo store would hold ≈300 students at that size; **production Firestore is
effectively unlimited** — that is the ceiling story, not the real one.

⚠️ **These numbers are hardcoded in two places (this section + prep-guide section 11).** Whenever
the harness changes (prices, ratios, ranges), re-run `simulateLoad(2000)` and update BOTH — the
letter must never quote a figure the machine no longer produces.

**Your mirror on the OS side:** build the same harness against Firestore — seed N students
through your enrollment ingestion, run auth/authorization checks (a Course-B student hitting
Course-A content must be refused), integrity monitors, session/device checks and quiz-timing
checks under load, and prove the OS holds at the same N before go-live. Reuse the same
philosophy: real code, zero residue, deterministic seed, printed PASS/FAIL. When the owner
asks “can it hold 2,000?”, the answer should be a run, not an opinion.

## 9.25 “The Machinery” — the engine-room display students can see (both sides)

The member panel now ends with a full-width **“THE MACHINERY”** card — the engine room shown
honestly, because trust is built on real numbers: three gold rings (system checks 19/19,
security 4/4, capacity headroom), op timings **measured live on the student's device**
(identity lookup, store read), a payment→…→Academy pipeline strip, “35 kinds of security
events watched”, and the Founder credit line. It is a **taller showcase card** (540px vs the
uniform 400px grid) — and deliberately shows **capacity headroom, never raw student counts**,
so a young Academy never feels like a ghost town to its first students. It doubles as a
deterrent: would-be misbehavers can see the system is watched, measured and proven.

**Your mirror:** add the same engine-room card to the OS student dashboard with *your* real
numbers — integrity monitors live, quiz-timing checks, session/device watchers, watermark
coverage — using the SAME gold-ring design language (SVG ring spec in §9.23; reuse the
`trustRingHTML` visual: gold gradient arc, diamond tip, serif centre). Measured, honest,
never staged. The design language must match exactly so both systems read as one brand.

## 9.26 Hall of Fame + Founder's Day (OS-side culture build)

The Academy honours its founder inside the Machinery card and the prep guide with the line
“Founder's Day — 1 November · the founder stays anonymous — the learning is the point” (the
date is a config constant in System A: `FOUNDERS_DAY = { month: 11, day: 1 }`, the founder's
birthday). **The founder's explicit wish is anonymity while alive** — the OS Hall of Fame
must honour “the founder” WITHOUT naming him: no photos, no biography, just the legacy of
the self-reliant school. The name may only be added **after his passing** (family/org
chooses), and it is then a one-line change in the same constant.

**Founder's Day itself (1 November)** is a celebration, not a memorial: the dashboards play
the founder's own words — System A ships `founderQuotes` (fifteen real lines of his
philosophy: “Every lesson is a trade. Every trade is a lesson.”, “The learning is the
point.”, “Money that is subject to change is not yours yet.”, …) and shows one on the
member dashboard that day, attributed only as “the founder”. **The same words are also
shared with TOUR students every day** — a demo pass is a first handshake with the Academy,
so the founder's welcome is part of it (the card reads “A word from the founder”, and on
Founder's Day itself it reads “Founder's Day · 1 November”). Mirror the same on the OS: a
Founder's Day banner + a rotating quote, same quotes source, same date constant.

**Your side:** the OS should host the culture:
- A **Hall of Fame** wall (student-facing) honouring the founder as the architect of the
  self-reliant, fully automated school — plus future awardees (Head Boy/Girl of the year,
  prize-winners). A plaque, not a biography page: short, dignified, gold.
- An annual **Founder's Day** commemoration on **1 November** — a banner/event in the OS
  calendar, a welcome message, a small ceremony block, and a **rotating founder quote** on
  the dashboard. The date comes from the same constant so both systems always agree.
- Tone: honour without idolatry — the founder's explicit wish is that the school runs on
  its own; the celebration remembers who started it while the automation keeps teaching.
  Anonymity is a rule, not a phase: no name, no photos until the founder passes.

## 9.27 Email provider — reminder

Already spec'd in §7 (Resend / SendGrid / SES via a Cloud Function). Nothing in the load
harness or Machinery card changes the swap: `db.email()` becomes the HTTPS provider call;
DKIM/SPF/DMARC on the domain; the Mailbox remains the audit view. When you hook the provider,
re-run the load test — the harness proves the pipeline regardless of the delivery rail.

---

## 9.28 The reconciliation sweep — the bridge must never trust a tab (both sides)

**The bug this kills:** the automatic retry lived in a `setTimeout` inside the browser tab
that scheduled it. If that tab closed, the retry died silently — the founder's own account
sat in `APPROVED` for hours with zero handoff attempts because nothing pulls the trigger
unless the Staff Console is open. The demo now runs a **reconciliation sweep** on System A:

- On Staff Console load (and every 15s while open), `db.pendingSyncs()` scans for any
  APPROVED/SYNC_FAILED enrollment with a live bridge and no confirmed handoff, fires a
  **`SYNC_OVERDUE`** security event once per overdue student (10 min without confirmation),
  and surfaces a gold banner: “Handshake pending — N students · **Sync all pending**”. One
  click marches every pending student through the idempotent handshake (Student ID is the
  key — duplicates are impossible).
- A student approved while NO console tab was open is caught the next time anyone opens it.

**Your side (the real fix for production):** the schedule must live **server-side**, never in
anyone's browser. A scheduled Cloud Function (every 5 min) scans Firestore for enrollments
whose state is `APPROVED`/`SYNCING`/`SYNC_FAILED` with no `handoffConfirmedAt` and a live
bridge, and drives the sync. The browser tab becomes a UI nicety only. Log `SYNC_OVERDUE` to
the security event store there too.

✅ *done when: an approved student with the bridge live reaches ACTIVE even if no Staff
Console tab was open when they were approved — on your side via the scheduled function, on
demo via the sweep.*

---

## 9.29 The single-session contract — one device at a time (both sides)

Apple Music's hole: sign in on a laptop AND an iPad, hand one to a friend, share the course
for free. Reality FX will not. The OS already enforces one active session per student
server-side; System A now mirrors the contract so the member panel speaks the same dialect:

- **Token per login.** `memberLogin` mints a fresh session token (`db.issueSession`) and
  returns it; the panel stores `{ id, token }` locally.
- **STRICT — every login revokes every previous session, no exceptions.** The founder found
  the last hole: two browsers on the *same* PC (work browser + personal browser) each got
  a working session. Same-device is still two separate sessions — so `issueSession` now
  always revokes the previous token and fires **`SESSION_REVOKED`** (naming both device
  fingerprints, flagged “same device, different session” when they match). The device
  fingerprint is audit-trail only; it no longer decides whether a revoke happens.
- **Kicked panel locks itself — no reload needed.** The member panel now re-verifies its
  token on its 2.5s heartbeat (not just on boot): the moment a sign-in happens anywhere
  else, the old panel signs itself out within seconds with “Signed in elsewhere — this
  session was ended automatically.” The student never needs to remember to sign out.
- **Prep guide states it plainly:** “The moment you sign in anywhere — a new device, a new
  browser, even a second browser on the same computer — the previous session ends on its
  own. You never need to sign out of old devices; the system does it for you.”
- The audit's **security self-test now includes a session check** (test #5): a fresh login
  mints a token, a re-login revokes the old one, only the new token validates.

**Your side:** Firebase session tokens revoked server-side on **every** login (not just
cross-device — a second browser on the same machine must also kill the first); the kicked
device learns on its next request (401 / `session_invalid`) and shows the same lock screen;
log `SESSION_REVOKED` (which device, which identity, same-device flag); keep the 15-min
inactivity rule server-side too. A student whose session keeps getting kicked is a support
signal (or a sharing attempt — the moderator decides).

✅ *done when: signing into the member panel on a second device instantly revokes the first,
the first device shows the lock screen on its next request, and a revoke lands in the
security feed on both systems.*

---

## 9.29b The ghost-town rule — student numbers are private (both sides) 🏚️

The founder's rule, in one line: **no student-facing surface ever reveals how
many students (or identities) the Academy has — until we pass 1,000 ACTIVE
students.** A small school's enrolment is nobody's business but ours; public
counts would let anyone estimate our revenue and net worth. Spec:

- **What hides:** raw active-student counts, identity counts, “X students
  joined” and anything that lets a visitor count our books. This includes the
  OS dashboard stat that read “Holding 0 ACTIVE students · 1 identities”.
- **What shows instead:** capacity headroom (“built to hold your whole year
  and the years after”), the machinery rings, and the privacy line: “Our
  Academy is growing — student numbers are kept private until we reach
  1,000.” The System A member panel + Machinery card already do this.
- **Who always sees the real numbers:** staff consoles, the SRM, the admin
  audit — internal by definition.
- **The shared constant:** `revealStudentCountsAt = 1000` in System A's
  settings; mirror it in the OS config so both systems flip together. The
  moment ACTIVE count ≥ 1,000, every surface may show real numbers (and it
  becomes a marketing flex — “1,000 traders and counting”).
- **Why it's a feature, not secrecy:** it protects the founder's family from
  speculation, and it makes the milestone itself an event worth celebrating.

✅ *done when: a visitor (not staff) cannot learn our student count anywhere
on either system below 1,000, and the OS dashboard shows headroom + the
privacy line instead of “Holding N students”.*

---

## 9.30 The selfie quality gate + identity signals (System A — built fresh this pass)

The OS-side audit found that “a selfie was uploaded” was the only check — obvious fakes
sailed through. System A now runs the gate at upload time, with the same philosophy as every
flag here: **review triggers, never auto-verdicts** — the moderator's eyes make the call.

- **`analyzeSelfie()` at upload.** Flat drawings and solid-colour fakes (colour-count < 24,
  >97% grayscale) are **rejected instantly with an honest reason**; a mostly-one-shade
  frame is refused; tiny images (<160px) are refused with “take a closer photo”. Borderline
  images (low colour count, grayscale, odd ratio) are **accepted but flagged
  `suspicious`** — the student sees “accepted — our team will give it a quick look”, and the
  approval checklist shows a gold “Selfie quality · flagged for review” row.
- **`selfieHash()` — a 64-bit perceptual hash** on every accepted selfie. The same photo
  reused across identities fires **`SELFIE_DUPLICATE`** (security event + gold row naming
  both enrollments) — one face, one identity.
- **`scanIdentitySignals()`** runs the same fingerprint machinery as the refund layer:
  phone reuse (`PHONE_REUSE`), full name with a different email (`NAME_REUSE`), or email
  reuse (`EMAIL_REUSE`) against another enrollment → gold “Identity signals · flagged” row
  in the approval checklist, pills on the SRM profile, and `IDENTITY_*` security events.
  Re-saves never spam the log (new-signal-only dedupe).
- **Smarter phone matching** (`phoneKey`/`phonesMatch`): `082 123 4567` == `+27 82 123 4567`
  == `27821234567` (South Africa), `+1 202-555-0123` == `2025550123` (US/Canada); a 9-digit
  number can never match a 10-digit one. Used by identity signals, the refund fingerprint
  and the refund cooldown — the disguise no longer works.

✅ *done when: uploading a flat drawing to the live registration wizard is rejected with the
message, a photo-like image passes with “quality verified”, and a same-phone/name/email
registration shows the gold rows to the moderator.*

---

## 9.31 The student Mailbox — every member's own official inbox (System A — built this pass) 📬

The Academy prep guide (2026) names the Mailbox as **the only channel the Academy uses for
official notices** — “Every invoice, registration link and Academy announcement lands here,
with Reality FX branding. You can download any message as a file.” That promise now has a
home: **every student gets their own Mailbox inside My RFX Account** (member panel).

- **A Mailbox card on the dashboard** shows the unread count + the three newest messages and
  opens the full inbox.
- **The full view** filters the shared mail store by the email on the enrollment — a student
  only ever sees mail addressed to them (invoice, registration link, verification codes,
  welcome, credit/refund notices, announcements). Two panes: list (with kind badges, unread
  gold dots, relative times) + branded paper body.
- **Download as a file** on every message — same helper as the staff mailbox
  (`RFX.ui.downloadEmail`), so anything official can be saved, filed or printed.
- Opening a message marks it read (the staff side sees the same read state). The view
  re-renders live when a new email lands, and the card badge counts only that student's unread.
- **Production:** this reads the same Firestore `emails` collection the real provider writes
  into — swap the seam in `RFX.db.emails()`, nothing in the member panel changes.

**One inbox, both views — the architecture Lee must keep:** every message lives in ONE
place (the shared mail store; in production, one Firestore `emails` collection). The same
record appears in (a) the student's real inbox via the live provider AND (b) their Mailbox
here — mirrored, never duplicated. When the provider is hooked, sending one message lands
in both views automatically; nothing is mailed twice.

**Your side (OS):** keep exactly **one inbox** — System A owns it. The OS's “My RFX Account”
return button is the door; don't build a second mailbox inside the Academy (two inboxes = two
places a student must check). If you ever want a subtle touch, the OS can show a small
“new mail” hint by pinging the member panel's unread count — optional, never required.

✅ *done when: a signed-in student sees only their own mail in their member panel, can open
and download any message, and the card badge tracks their unread — verified live.*

---

## 9.32 Heads-up for Lee: the seed-data heal + one-flag consistency rule 🧹

During the founder's review the “How the five pillars look when they work” bar on the Staff
Console showed **Registration grey while Approval was gold** — it looked like a broken
pipeline. It was a **seed-data quirk**: the founder's own record (ENR-0001) was minted
straight into `approved: true` during demo setup without its `registrationSubmitted` flag.

**Fixed (System A), and worth knowing on the OS side too:**

1. **Approval implies registration.** In the real pipeline registration must complete before
   approval is reachable, so any approved record missing the registration flag is a seed
   artifact — System A now heals it on **every load** (not just a one-time migration), for
   any store. If the OS ever imports a record with the same shape, apply the same rule.
2. **One source of truth per metric.** The funnel previously read “submitted” from a
   timestamp while “approved” read the flag — yielding the impossible *1 submitted / 2
   approved*. It now reads both from the same progress flags. If you ever count two sides of
   one pipeline, count them from the same field.
3. **Report the heal, don't hide it.** The security event feed logged the repair, so the
   moderator sees the system fix itself rather than wondering.

**Suggestions from System A's audit for your OS side (all verified on our side):**

- **Reconciliation sweep.** If the OS ever holds an `APPROVED` student whose handoff never
  arrived (tab closed mid-sync), surface a “Sync now / Sync all pending” CTA instead of
  waiting for a browser tab — System A's Staff Console now does exactly this and logs
  `SYNC_OVERDUE`. Your scheduled Cloud Function is the production owner of retries.
- **Idempotency first, always.** On any repeated handoff POST, answer
  `{ received: true, already: true }` — never duplicate, never error (System A and the OS
  demo endpoint both do this today; keep it in the production function).
- **The handoff key must pass CORS.** System A now sends `X-RFX-Handoff-Key` on live
  handoffs — the OS function must allow that header in preflight (`Access-Control-Allow-
  Headers: X-RFX-Handoff-Key`), or live handshakes fail from the browser.
- **One session per student.** Signing in on a second device revokes the first (System A
  now issues per-login session tokens and logs `SESSION_REVOKED`). Mirror it in Firebase
  Auth sessions so course-sharing across devices stays impossible.

✅ *done when: Lee has read this section and the OS mirrors the one-flag rule, the CORS
header allowance and the session revoke.*

---

## 9.34 The RFX calendar — one classy date picker for the whole system 📅

System A now ships a **shared gold calendar picker** (`RFX.ui.calendarPicker` in
`js/ui.js`) that replaces every plain date control: the staff monthly-payday
dropdown (was "1th of month") and the student's date-of-birth field (was a native
`type=date`). It is deliberately the same visual language as the rest of the
brand — deep-black popover, thin gold border, gold weekday headers, hover
glow, gold-filled selected day, a gold ring on today, and a smooth
fade/rise open animation.

- **Trigger:** a 📅 icon button on the right of the field (or clicking the field
  itself); closes on outside click, Escape, or after picking.
- **Navigation:** ‹ › month arrows, a clickable year that opens a paged 16-year
  grid (‹ › decade arrows) so ANY year from the 1970s to the future is two
  clicks away — students picking a DOB never scroll 50 years one-by-one.
- **Two modes:** `mode: 'day'` (payday — stores the integer day in
  `dataset.rfxVal`, display "15th of month", grid capped at 28) and
  `mode: 'date'` (full date — stores ISO `YYYY-MM-DD`, display "Sep 1, 2002").
- **Where it lives:** wallet.html (Monthly payday) + register.html (Date of
  birth). The machine-readable value is always in `dataset.rfxVal`, so the
  display can be pretty without ever losing the real value.

**For the OS side:** if RFX OS ever needs a date control (exam dates, term
calendars, award ceremonies), reuse this exact component so both systems keep
one design dialect — copy the `.rfx-cal-*` CSS block from `css/system.css` and
the `calendarPicker` function from `js/ui.js`.

## 9.33 The branded email identity — students must never doubt an RFX email ✉️

The founder's concern: when a student gets an email claiming to be from Reality FX, it must
**look** and **come from** somewhere unmistakably official. A generic Gmail address with
plain text instantly invites “is this really them?” — and phishing worry. When you wire the
production provider (§7), stand up the **email identity** as a first-class deliverable:

1. **A custom domain, not a free mailbox.** Own a Reality FX domain (e.g. `realityfx.academy`
   or `realityfx.co.za` — pick one that is registered, renewed on autopay, and owned by the
   business). Never send official student mail from a personal Gmail address.
2. **A dedicated sender address** — e.g. `no-reply@realityfx.academy` for automated system
   mail (invoice, registration link, codes, prep guide, wallet notices) and a human line
   such as `support@realityfx.academy` for staff replies. Keep `realityfx20@gmail.com` only
   as the business's private inbox, never as the sender students see.
3. **A branded display name** so inboxes show **Reality FX Academy**, not a bare address:
   e.g. `Reality FX Academy <no-reply@realityfx.academy>`.
4. **Authentication — the anti-spoofing trio** so a student's provider (Gmail, Outlook)
   marks the mail as genuinely from us and spam filters let it through:
   - **SPF** — authorize only our provider's sending IPs.
   - **DKIM** — sign every message (Resend/SendGrid/SES all do this automatically once
     configured).
   - **DMARC** — policy at minimum `p=quarantine`, ideally `p=reject`, so impostors claiming
     our domain get binned before they reach a student.
   These are configured in the domain's DNS records — the registrar's dashboard. Test with
   a real Gmail + Outlook inbox before launch.
5. **Branded templates, already built.** System A's email templates (`brandHtml()` in
   `js/db.js`) already carry the Reality FX gold identity — the gold rule, serif wordmark,
   “ENROLLMENT · REGISTRATION · IDENTITY” tagline and the dashed-gold footer. Production
   mail from your provider should use these exact templates so the Mailbox preview and the
   live inbox look identical (one inbox, both views).
6. **Never ask for secrets by mail.** All automated mail contains no password or code
   requests beyond the 6-digit verification code the student themselves requested; the
   footer states “This is an automated message — do not reply.”

**Runs free at our scale (the founder asked — answer: yes, entirely free):**
- **Sending (the automation):** **Resend** free tier — 3,000 emails/month, 100/day, real SPF/DKIM/DMARC support, API is a single `fetch`. **Brevo (ex-Sendinblue)** free tier — 300/day (≈9,000/month), also fine. Either is genuinely free forever at a 2,000-student Academy, and both sign the mail so Gmail/Outlook trust it.
- **Human mailboxes (staff reading/replying):** **Zoho Mail** free plan — up to 5 branded mailboxes on your own domain (support@realityfx.academy etc.), no expiry. Or **Cloudflare Email Routing** (free) forwards domain mail to any existing inbox while you send through Resend/Brevo.
- **What you do pay for:** only the domain itself (~R100–R250/yr). No email software cost.
- **Keep in mind:** never send from the free sender *without* SPF/DKIM/DMARC configured — that's what separates branded mail from spam. Resend/Brevo give you the three DNS records to paste into the registrar; that's the whole setup.

**OS side:** the OS's own notifications (quiz results, integrity flags, awards) should come
from the same identity with the same templates, so students learn *one* sender = *one*
trusted brand. System A's Mailbox (§9.31) remains the audit view of everything sent.

✅ *done when: a fresh Gmail and Outlook inbox both show “Reality FX Academy” with the gold
branding, no spam folder, and a DKIM `PASS` in the raw headers.*

---

## 9.35 The Complete Operating Guide — how Reality FX operates (System A, new)

There is now a **standalone, branded guide** at `operating-guide.html` —
*"How Reality FX operates"* — that walks through the entire chain in one
sitting: **Front Desk 🖥 → Student Portal 🧳 → RFX OS Academy 👨🏾🎓**, the
registration gate, the machinery (20 checks / 5 self-attacks / 35+ events),
the staff role (audits not code, the motherboard), and longevity.

- It is linked from the Front Desk as a **6th door card** — *"The Complete
  Guide"* — labelled *"Click me — read the guide"*, so a prospective hire
  (or any curious visitor) can read the whole system in one page.
- It is **fully self-contained** (inline CSS, no build, no API) and works
  from the desktop — a copy ships to the Desktop docs folder.
- There is an **email twin**: `db.sendOperatingGuide(enr)` sends the same
  story as a branded email (kind `operating-guide`, shown in both the staff
  Mailbox and the student Mailbox), and the Staff Console has a
  **"Send operating guide"** button on every APPROVED enrollment, next to
  "Re-send Academy prep guide".
- If you want a version of this on the OS side, the same three-room chain
  story is the perfect onboarding text for the Academy's own welcome flow.

---

## 9.36 The Student Journey Calendar — a planner that thinks with the student (System A — built this pass) 🗓️

Every member now has a **Journey Calendar** — a planner with three tiers the student picks (`Standard` / `Demanding` / `Elite`, same feel as your course difficulty tiers) and a focus (`Study rhythm` / `Updates & briefings` / `All of the above`).

- **Academy dates auto-insert**: year begins, mid-year review, **Founder's Day — 1 November**, graduation ceremony, plus any scheduled awards/giveaway draw. These ride the enrollment record so they can sync to the OS too.
- **Smart suggestions tied to their own record**: tier plan blocks, a "rebuild your standing" nudge when Trust is in the Caution band, and month-anniversary journal prompts — never generic homework.
- **Their own dates**: quick-add, mark-done, remove; stored on the enrollment (`enr.journeyCal`).
- Smooth cubic-bezier transitions on the tier/focus chooser; card on the dashboard shows the next 3 dates.
- **Nice-to-have on the OS side**: if you surface this calendar in the OS, the events already live in the student record — you can render them without any new data.

## 9.37 Academy gate probe + polish batch (System A — built this pass) 🔍

- **The Academy button now probes your OS server** before opening: the member panel fires a lightweight reachability check at the OS URL, and if the OS is unreachable the student sees *"The Academy is warming up — you may open it in a moment, or try again shortly"* instead of a dead `ERR_CONNECTION_REFUSED` page. When your OS server is up, it shows the normal green **Enter the Academy**. The OS URL lives in one constant in `member.js` — point it at production and it just works.
- **Soft gold glow on every trust ring** (identity standing + Machinery rings): a `drop-shadow` that follows the arc — the same look you have on your dashboard. If your OS rings don't have it yet, `filter: drop-shadow(0 0 5px rgba(212,175,55,0.55))` on the filled stroke is the recipe.
- **Visible busy states on every sign-in and heavy button**: student login shows *"Verifying your identity…"*, staff audit/repair/sync/simulate buttons lock with a spinner so a click is never silent.
- **Quick age-range picks on registration DOB** (16–17 / 18–24 / 25–34 / 35–44 / 45+): one tap fills a representative birthdate into the branded calendar — still fully editable.
- **Calendar contrast fix**: the day numbers were invisible against the browser's default button fill; now explicitly transparent with white digits.
- **Audit grows to 21 checks**: added *Trust Bar ledgers reconcile* (every recorded trust action summed from 100% must equal the shown score — drift beyond 1 point is flagged), plus a staff-facing **"What the audit checks"** explainer (the electrical-fence metaphor) under the audit button.
- **Print-trust grant rules now surfaced**: the SRM grant/revoke modal states the exact rules (earned through conduct, revocable, printable with a watermark) so staff and students both know the standard.

## 9.38 Demo-tour expiry — the exact second the free 24h ends (System A + brief for Lee) ⏳

The 24-hour demo tour is a real, enforced clock on System A's side now — not just a cosmetic countdown:

- **At zero, the Academy door closes.** The member panel's RFX OS access card flips from *"Your RFX OS access is ready"* to a locked state: *"Your free tour has ended…"* with the student's registration link still valid, so continuing to a real enrollment takes minutes. The countdown bar drains to empty, then the clock hides itself.
- **The same rule holds on the approved screen** (`register.html`): the OS gate stays closed once the tour expires, with the same honest explanation.
- **The clock starts at approval** (the moment learning can begin), never at purchase or page-open — both the member panel and the registration page share one clock (`db.demoTimeLeft`).
- **The FOUNDER is exempt.** The founder's record is flagged (`isFounder()`) and shows *"Founder · lifetime access"* instead of any countdown; the master key never expires.

### What Lee must build on the OS side (the instant-revocation handshake) ⚙️

The demo tour is handed to the OS as part of the student identity, so the OS can strip tour benefits the **second** the clock hits zero — no student watching a timer race a server:

1. **Carry the tour window in the handoff.** The student record already includes `demoPass { hours, createdAt }` and the approval timestamp. When System A hands a demo student to the OS, include `demoTourEndsAt` (ISO) = approval time + hours. The OS stores it with the account.
2. **The OS enforces it server-side.** At `demoTourEndsAt`, the OS's entitlement check flips the demo account from *tour-active* to *tour-ended* — same authorization path used for paid students, so there is no second codebase: the tour simply had a shorter entitlement window.
3. **What the OS does at expiry:** the account stays (Student ID, identity, progress are permanent), but premium access (course content, assessments, OS tools) reverts to the *tour-ended* state — the OS shows the same message the member panel shows ("Your free tour has ended — enroll to keep your Academy access"), ideally with the enrollment link from System A.
4. **A paid enrollment upgrades seamlessly.** When the same Student ID is later handed off as fully paid, the OS replaces the tour window with the real entitlement — no account change, no data loss.
5. **Labels, so students never panic:** before approval = "24h academy pass" (clock not started); after approval = "Demo tour" / "Demo session" with the countdown; at expiry = "Expired — request a new pass" (on the registration page) and the locked access card (member panel). One consistent voice across both systems.

✅ *done when: a demo student whose 24h elapses mid-session is cut off by the OS at the exact second, sees the tour-ended message, and becomes a full student with zero friction after enrolling.*

## 9.39 The founder's Master Key — one account, every door (System A — built this pass) 🗝️

The founder has a special account on System A with **full overview from anywhere**:

- **How it's identified:** the founder's enrollment (email `leeroychirwa18@gmail.com`, the legacy DEMO-TOUR record) is recognised by `isFounder()` — either the `enr.founder === true` flag or the founder email. **In production, point this helper at the Firebase auth check instead** so the founder's role is a real auth claim, never a hard-coded email.
- **What the founder sees on the member panel:**
  - A **FOUNDER · MASTER KEY** badge on the identity card (outranks LIVE PROFILE).
  - A **Master Key overview card** at the top of the dashboard with six doors: Staff console, SRM, Admin console, Wallet centre, Registration desk, and RFX OS Academy — all open from one place, from any device.
  - **Founder · lifetime access** instead of any demo countdown (the master key is exempt from every tour clock).
- **The founder is NOT exempt from the security rules that matter:** single active session, login throttling, audit trails — the master key opens doors, it does not bypass the machine's own safety.
- **OS side (DONE on System A — this pass):** the handoff payload now carries a top-level `founder` boolean (`bridge.buildPayload`), so the founder's master key rides the exact same secure handoff as every other student — no second channel. Note: `founder` is an **optional boolean that defaults to `false`** — every normal student handoff carries `founder: false`, so the OS must never fail or mis-handle an absent/`false` field.

**Your job on the OS:** read `founder` from the handoff and store it as an **auth claim on the OS account** (Firebase custom claim / profile flag — never a hard-coded email check), then let the founder's OS dashboard open every door (full content overview, all courses) while STILL applying the machine's safety rules (one active session, session revocation, audit trails). If a fresh handoff for an existing student arrives without `founder`, reconcile by merging, not overwriting.

## 9.40 The Campus Map + the arrival story (System A — built this pass) 🗺️

The front desk no longer shows a plain journey strip — it now has a **Campus Map**: an SVG road-network illustration with building cards showing every way a student can arrive:

- **Front Desk** (the website) → the **Registration Gate** → **RFX OS Academy** (the destination, gold-glowing).
- **Side roads**: hand-picked by staff, referred by a friend, or a wandering visitor — all skip the front desk and converge on the same Registration Gate.
- The map answers the #1 question — *"how do I even get the RFX OS course?"* — visually, before anyone clicks anything.
- Legend: the standard road (bought a course) vs side roads (staff pick & referrals); every route ends at the Gate.
- The old "The journey" strip is gone from the reception — the operating guide (§9.35) covers the whole process in depth, and the map covers it at a glance.

**For the OS side:** consider a mini version of the same map on the OS welcome screen (where the student is now = the Academy node, glowing). The SVG pattern (road + building card) is trivial to reuse.

## 9.41 The operating guide belongs in the OS too (Lee's side) 📖

System A has a full standalone guide — `operating-guide.html` ("How Reality FX operates", §9.35) — and it is now linked from the front desk as a door. **The OS should also carry it** so students can re-read how the whole ecosystem fits together without leaving the Academy:

1. Add an **"How Reality FX operates"** link in the OS header/footer (or a card on the OS dashboard) opening the same guide — ideally the branded HTML file so both systems show identical visuals.
2. The map (§9.40) is the natural companion: *"where you are now"* is the Academy node.
3. No new content needed — the guide already explains the front desk → gate → OS chain, the gate's six steps, staff roles, the Machinery, and longevity. It also has a print / save-as-PDF button.

## 9.42 Incident: RFX OS unreachable during the demo — always-on requirement 🔌

**What happened:** during a live walkthrough the founder's panel correctly showed the maintenance state (spanner + "the Academy is being repaired right now — your access is safe and waiting") because **the RFX OS server (System B, port 49270 locally) was not running**. The founder could not reach the Academy. Root cause was on the OS side — System A's probe was doing exactly its job (detecting the dead endpoint and refusing to open a dead page).

**What Lee needs to do (System B):**
1. **Always-on hosting in production.** The OS must live on an always-on host (Firebase Hosting + Cloud Functions, Vercel, Render, or similar) — never a machine that can be switched off. A student who paid for the course must never see "the door is being repaired" because the server was turned off.
2. **Keep the probe endpoint alive.** System A pings the OS root/health endpoint before opening the Academy (3.5s timeout). If the OS is ever genuinely down for maintenance, it should serve a **503 with a maintenance page** rather than refusing the connection — that way System A can show the calm message, and students still never see a browser error.
3. **Self-healing + reconciliation**: when the OS comes back, the existing reconciliation sweep (approved students with live bridges reach ACTIVE) handles anything that happened during the outage. No student is ever lost.
4. **Test the exact flow** the founder hit: panel → "Enter the Academy" → OS loads, handshake confirmed, course unlocked. This must work with the OS up, and show the calm maintenance state only when it is genuinely down.

**Founder key uniqueness (confirmed):** only one account carries the master key. `isFounder()` matches ENR-0001 (the founder's own record — flag OR the founder email), so **RFX-10482 is the ONLY founder-key dashboard**. No other enrollment can ever render the Master Key card. In production, point `isFounder()` at a Firebase auth claim (never a hard-coded email) and keep it to exactly one account.

## 9.43 The calendar grows up: briefing subscriptions, session tracker, and the power-on moment (System A — built this pass) 📅⚡

Three student-facing upgrades landed in the member panel's Journey Calendar and Academy status. All were verified live.

1. **Briefing-type subscriptions.** Students now choose which briefing feeds reach them (in the planner: *Which briefings should reach you?*): **Academy prep & guides**, **Events & dates**, **Merch & rewards**, **Milestones & nudges** — all on by default, saved per enrollment (`enr.journeyCal.subs`), and the card shows a quiet "*N of 4 feeds on*" hint only when some are off. The briefing feed filters by the subscription before rendering.
2. **Study-session tracker.** The card's *Study rhythm* column now shows a gold progress bar for the current week (e.g. *2/3 sessions*) plus a **"Mark today's session done"** button — the target follows the tier (Standard 2, Demanding 3, Elite 5 per week; Mon–Fri slots, logged per date). The planner has the full week view with ✓ marks. Feedback toast on every mark.
3. **The power-on moment.** The handshake dash now behaves like real electricity: when the Academy is unreachable the whole status row **dims ("power is out" tag, grey dot, no pulse)** — a room with the lights off. The moment the probe sees the OS return, the dot **flickers like a lamp warming up and blooms into a steady gold glow**, the line reads *"The Academy is back online — lights are on."*, a toast announces it, and a branded **"The Academy is back online" notice lands in the Mailbox** (with a security event `ACADEMY_BACK_ONLINE`). System A re-probes the OS every ~15s so the moment is caught live; it settles to the steady line after 2.4s.

**What Lee needs to do (System B):**
1. **Serve the same notice email** when the OS comes back after an outage (the copy is in System A's `renderAcademyOnlineEmail` — reuse the warm tone: access was never in doubt, the door simply re-opened; nothing was lost).
2. **Mirror the briefing-subscription + session-tracker pattern** on the OS dashboard if it shows a calendar: same four feed types, same weekly session target from the tier, so the student's calendar and the OS never disagree.
3. **Honour the same power-on moment** on the OS side when it comes back online: flicker→steady glow is System A's job on the handshake dash, but the OS welcome screen should also *feel* like the lights came on (avoid a flat reload after an outage).

## 9.44 The OS go-live brief — sorted on System A's side (this pass) 🚀

The OS side handed over `RFX-OS-GO-LIVE-BRIEF-FOR-LEE.md`. Every System A obligation in it is
now reconciled and built. Work this top to bottom — the first item is the only contract change.

1. **The one contract change: `entitlements` is now a LIST.** The brief's §2.3.5 says
   "entitlements are a LIST per identity, not a single course field" (so a second course
   MERGES instead of overwriting). System A's `buildPayload` now sends
   `"entitlements": ["Reality Academy — Professional Program"]` and keeps `course` as the
   display convenience field. Your function must read it as an array and **merge** a new
   course into the existing `entitlements[]` when a handoff arrives for a student who
   already has one — reconcile, never duplicate, never a second identity. (§6 above is
   updated to match; the demo's old object form is superseded.)
2. **The three "when present" fields are now in every handoff.** `demoPass { hours,
   createdAt }` (demo-tour identities), `approvalAt` (ISO approval moment → derive
   `demoTourEndsAt = approvalAt + hours`), and `trust { score, tier }` (the standing the OS
   must render and enforce: ≤25 timeout, ≤10 extended, 0 restricted — same bands as System A).
   Absent `demoPass`/`approvalAt` are dropped by JSON, never breaking a normal handoff.
3. **Single active session, both sides.** System A enforces it NOW on the member panel:
   every login mints a fresh token and revokes every previous one (`SESSION_REVOKED` event
   with the device fingerprint); the kicked panel detects the dead token on its next poll
   (2.5s) **and instantly via the `storage` event** (another tab signs in → this one locks
   the same second). Same-browser is provable client-side; cross-BROWSER/device is exactly
   your §2.2 server-side job (Firebase Auth, second login revokes the first).
4. **The probe is already the brief's spec.** System A pings the OS with a **3.5s timeout**
   (`AbortController`) before opening the Academy; the calm maintenance state shows only on
   a genuine outage; the power-on moment celebrates the return (flicker → steady gold, the
   big ✓ pulses, a branded "back online" notice lands in the Mailbox, `ACADEMY_BACK_ONLINE`
   is logged). **Your always-on hosting + health endpoint + 503 maintenance page (§2.1)
   is the other half — without it the demo stays in maintenance state.**
5. **The outage ledger is a new shared board.** Every DOWN→UP transition writes ONE row to
   `state.osOutages` (whichever panel saw it first — deduped), `ACADEMY_DOWN`/UP events are
   logged, and the **Staff Console now carries an "Academy uptime · the power monitor"
   board**: live status, outage count, total downtime, and a scrollable ledger of every
   outage with its duration. Feed the same data to your monitoring page if you build one.
6. **Session streaks with milestone rewards.** The Journey Calendar's tracker now counts a
   consecutive-day streak (weekends never break it; today gets grace). At 3 / 7 / 14 / 30
   days a branded milestone note lands in the Mailbox + a panel notification — once per
   milestone, ever. Mirror the same streak on the OS dashboard if you surface study
   activity, with the same milestones.
7. **The Machinery gained its cybersecurity ring.** The engine-room card now shows four
   gold rings (checks · security · **cyber** · headroom) and states it plainly: the system
   attacks itself the way an intruder would, and every hit is defended and recorded.
   Build the same honest ring on the OS (§9.25) — real measured numbers, never staged.
8. **Founder uniqueness + ghost-town + load test stand as briefed.** One master key
   (auth claim, never an email check — your §9.39), no student counts below 1,000 on any
   student surface, and the 2,000-student load answer is a run, not an opinion.

✅ *done when: a second-course handoff merges `entitlements[]`, the OS enforces trust bands
from the synced `trust` field, a second-browser login revokes the first server-side, and
the founder can watch one outage appear on the staff board and close itself.*

## 9.45 Dashboard cards earned their space (System A — built this pass) 📇

Three member-panel cards were rebuilt so no box sits empty and every grid is orderly:

1. **Academy prep guide card** — now shows the letter's full table of contents (12 numbered
   sections with short excerpts, internal scroll) so the box is a real quick-reference,
   with the Download PDF + Email me buttons always visible below.
2. **Your courses** — the owned-course list is now followed by **"More from Reality FX"**:
   every catalog course the student does not own yet (code, name, note, price) with a +
   button that smooth-scrolls to the *Enroll in another course* card. Verified students see
   their next possible step without hunting.
3. **The Master Key — founder overview** — the six doors are now equal tiles in a fixed
   grid with **no orphan columns**: 3×2 on wide screens, 2×3 on tablets, 1×6 on phones
   (verified: six 108px tiles, all equal). Every door is a bordered tile with icon, title
   and one-line description; hover lifts it with a gold border.

The dashboard card grid itself is untouched (uniform 400px boxes with internal scroll —
"anything on the dashboard must earn its place" stays the rule). Mirror the tidy tile
pattern on the OS dashboard if you have similar door/launch grids.

## 9.46 The robotic manager — staff duties, staff trust bar, performance ledger (System A — built this pass) 🤖

Staff now have real jobs and a real scorecard. The founder's invention, engineered:

1. **Today's duties** — the staff console opens with a duty board assigned from LIVE
   system state: clear the registration queue, review identity flags, audit active
   sessions, answer the support queue, advance the merch fulfilment queue, review the
   payout & refund queue, and the daily routines (run the full audit, sync & reconcile
   the bridge, review the uptime board, review the security feed). Manual duties run
   their REAL work before they close (the audit button actually runs `fullAudit()`);
   auto duties close themselves the moment their queue clears.
2. **The staff trust bar** — every staff member carries a 0-100 ring like the students:
   **+1** per completed duty, **+2** per quality approval/rejection decision, **+1** per
   support reply, **+1** per merch fulfilment step, **-2** per overdue duty (recorded ONCE
   per duty, to whoever is at the desk). Bands: 80+ Excellent, 50-79 Solid, 30-49 Needs
   attention, <30 On thin ice, 0 Stand down — admin review. The manager's note under the
   duty board reacts to the standing.
3. **The ledger is permanent** — every recorded action (and every miss) lives on the
   staff member's performance feed. Automated system decisions (the self-test's AUDIT
   runs, referral penalties) NEVER touch a human's bar — machines do not earn staff
   trust, humans do.

**What Lee needs to do (System B):** mirror the same pattern on the OS side if the OS
has staff surfaces — the same duty kinds (from OS-side live state), the same score bands,
and the same rule that automated actions never credit a human. The contract is
`db.js → staffPerfEvent / dutiesFor / completeDuty`.

## 10. Go-live checklist (both systems together)

- [ ] Email identity is live: custom-domain sender with the Reality FX display name, SPF/DKIM/DMARC passing, branded gold templates in the real inbox, and a test on both Gmail and Outlook (§9.33).
- [ ] Handoff works both directions; a retry creates zero duplicates; the handoff POST carries the API key and a forged payload is rejected.
- [ ] The reconciliation sweep fires: an approved student with a live bridge reaches ACTIVE even when no Staff Console tab was open (server-side schedule on your side, sweep + Sync-all button on demo).
- [ ] One active session per student on both sides; a second-device sign-in revokes the first with a SESSION_REVOKED event.
- [ ] The selfie gate is live: a flat drawing is rejected at upload, a reused photo fires SELFIE_DUPLICATE, and identity signals show the gold review rows.
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
- [ ] Every signed-in student sees their own Mailbox in My RFX Account (only mail to their
      email, unread badge, download-as-file) — the prep guide's “official inbox” promise holds.
- [ ] RFX OS links its account menu to System A's `member.html?email=…`; the email is
      prefilled; the Student Code is never in a URL; travel both ways is smooth.
- [ ] `file://` and http demo URLs replaced by HTTPS everywhere.
- [ ] The load test runs clean at 2,000+ students on System A, and your Firestore stress
      harness proves the OS holds the same number (auth/authorization/integrity under load).
- [ ] The OS student dashboard carries its own “The Machinery” engine-room card in the same
      gold-ring design language as §9.25, with real measured numbers.
- [ ] The OS hosts the Hall of Fame + an annual Founder's Day on 1 November (§9.26), date
      read from the shared constant, with a rotating founder quote that day.
- [ ] The Academy entry button on System A probes RFX OS before opening; if the OS is
      offline the student sees a calm "warming up" state instead of a dead page
      (ERR_CONNECTION_REFUSED) — no broken links, ever.

---

## 11. LEE — DNS + provider checklist (go-live networking, System B + website)

This is the networking layer that makes everything above actually reachable in the
real world. Work through it top to bottom with the domain registrar and hosting
provider (Netlify for the website + System A, and whatever hosts RFX OS + Firebase).

**Domain & DNS**
- [ ] Buy/confirm the real domain (e.g. `realityfx.co.za` or the chosen TLD) — keep the
      registrar separate from the hosting so a DNS problem never takes the site down.
- [ ] Registrar: enable **auto-renew** and **domain lock / transfer lock** (prevents
      accidental expiry and hijacking — a stolen domain is unrecoverable fast).
- [ ] Add **2FA on the registrar account** and the hosting account. No exceptions.
- [ ] Use the registrar's free WHOIS privacy or the provider's privacy proxy so the
      founder's name/address aren't public.

**DNS records (create at the registrar)**
- [ ] `A`/`AAAA` or provider CNAME: point `@` (apex) and `www` at Netlify
      (`A 75.2.60.5` or `CNAME <site>.netlify.app`).
- [ ] `TXT` records for the email domain: **SPF** (include the email provider, e.g.
      `v=spf1 include:amazonses.com ~all` or the provider's include), **DKIM** (the
      selector key from the provider), **DMARC** (`v=DMARC1; p=quarantine; rua=mailto:…`).
- [ ] `MX` records pointing at the email provider (Google Workspace / Zoho / the chosen
      one). Without MX, inbound mail to `@realityfx…` fails.
- [ ] A wildcard or explicit subdomain for the OS if it lives at `os.realityfx…` or
      `academy.realityfx…` — decide the OS URL NOW, before anyone links to it.

**Email sending provider (for System A + OS transactional mail)**
- [ ] Pick a transactional provider (Amazon SES, SendGrid, Mailgun, Postmark, or the
      free tier of one of them) — do NOT send live mail from a shared webhost SMTP.
- [ ] Verify the sending domain with the provider (add their DNS records; wait for
      verification to complete — this is the part that takes time, do it FIRST).
- [ ] Set up the provider in **sandbox mode** first, verify the founder's inbox, then
      request production access (SES requires a support case; SendGrid needs domain auth).
- [ ] Configure **bounce/complaint handling** — a soft bounce auto-retries, a hard bounce
      flags the student record, complaints suppress future mail (deliverability is trust).
- [ ] Test deliverability: send to a Gmail, an Outlook, and a Yahoo inbox; check the raw
      headers show `SPF PASS`, `DKIM PASS`, `DMARC PASS` — never a "via" label.

**HTTPS & security headers (both hosts)**
- [ ] Force HTTPS everywhere — Netlify does this by default; the OS host must redirect
      `http` → `https` and set HSTS (`Strict-Transport-Security`).
- [ ] `file://` and `http://127.0.0.1` demo URLs are gone from production builds
      (System A reads the OS endpoint from settings, so just set it to the HTTPS URL).
- [ ] Review the security headers on both hosts: X-Content-Type-Options, X-Frame-Options,
      Referrer-Policy, and a Content-Security-Policy that blocks inline scripts where
      practical.
- [ ] Backups: the OS database + Firebase export on a schedule; the System A store is a
      JSON file, so a nightly copy to cloud storage is trivial — do it.
- [ ] Monitoring: Netlify deploy hooks/uptime check on the website, a simple external
      uptime ping (UptimeRobot free tier) on the OS URL, and the founder gets an alert
      email the moment either goes down — that is the "we never have technical
      difficulties" guarantee made real.

**Order of operations**
1. Buy domain + lock + 2FA + privacy.
2. Set up email provider, add their DNS records, start verification (it takes time).
3. Point website A/CNAME at Netlify; set MX + SPF/DKIM/DMARC while verification runs.
4. Deploy System A + OS to HTTPS hosts; set the OS endpoint in System A settings.
5. Test end-to-end from a phone on mobile data (no localhost, no shared Wi-Fi).
6. Turn on uptime monitoring + backups. Go live.

## 9.47 The campus camera tour — self-driving photographer on the map (System A — built this pass) 🎥

Both the Front Desk (`index.html`) and the operating guide (`operating-guide.html`) now share a
self-driving camera tour across the campus map. The "photographer" pans and zooms on its own:
whole campus → Front Desk → back out → Registration Gate → back out → RFX OS Academy → glide
home, then loops. A single shared file drives both pages (`js/campus-tour.js`).

**What it does:**
- **Automated tour** — `campus-tour.js` applies an SVG `transform` (`translate(500 295) scale(s)
  translate(-cx -cy)`) to a `<g class="cam">` group wrapping the map content, driven by a rAF
  loop with easeInOutCubic interpolation between 7 shots. Each shot dwells 0.9–3.8s; the full
  cycle is ~26s.
- **Hover to pause** — `pointerenter`/`pointerleave` freezes the loop and shows "Tour paused"
  on the HUD badge; `IntersectionObserver` idles the loop when the map is off-screen (battery).
- **Click to focus** — clicking any `.bldg` or `.origin` sets a manual shot (2.4× zoom, 5.6s
  dwell) that glides to the clicked building/station, then resumes the tour. Verified live.
- **HUD badge** — a glass-pill overlay with a pulsing gold dot, camera icon, live label, and
  hover hint. `aria-hidden="true"` (decorative, not announced). `max-width` + ellipsis + hidden
  hint on narrow screens.

**Station beacons smoothed:** the origin halos (`.stn-halo`) and payment diamond (`.pay`) now
breathe with a soft scale+glow animation (`stnPulse`/`payBreathe`) instead of the old opacity
flicker (`ringPulse`) — no more jamming, much classier.

**Icons centred in their cards:** the three building icons were horizontally offset (icons
centred at 180/520/850 instead of the card centres 165/500/835). Fixed to `translate(145,180)`,
`(480,180)`, `(815,180)` — exact centre, verified live.

**Your side:** the shared file `js/campus-tour.js` is auto-loaded by both pages. If you ever
rebuild the map or change the SVG coordinates, update the `shots[].cx/cy` values in that file
(and nowhere else — the extraction was deliberate to prevent drift). The guide's inline CSS
and the main `system.css` both carry the keyframe + HUD styles; the guide still owns its own
copy (inline convention), so pulse and HUD styles must be updated in both if the CSS changes.

---

*System A — the Registrar. Built for Reality FX, The Trading Academy. If any step is unclear,
open `js/db.js` and `js/bridge.js` — the function signatures ARE the contract.*
## 9.48 The v56 batch — calendar icons, silkier camera, stricter manager, smarter suggestions (System A — built this pass) ⚡

Six upgrades in one pass. Everything below is built and verified live on the preview
(port **8125** — see the run doc note: 8123/8124 are stale servers serving old code and
must not be used for verification).

**1. Calendar bolt → classy flame.** The expanded Journey Calendar rendered raw SVG icons at
their default 300px size (the streak "bolt" was a 394px monster). Fix: a new `flame` icon
(`assets/icons.js`) for the streak line, `check` icons for the "mark today done" buttons, and
a new `.ic-run` CSS class that sizes ANY inline icon to 16px. Rule for the OS side: never
concatenate `I.<icon>` raw into running text — wrap it in `<span class="ic-run">` (or `.ic` /
inside a `.btn`), or it renders at 300px.

**2. Camera tour — silky, and the text no longer fights the camera.** `js/campus-tour.js`
(shared by Front Desk + operating guide): easing is now quintic in-out (starts and lands
weightless), glides are ~35% slower, and every label on the map is **counter-scaled** each
frame — at 2.45× zoom the buildings grow while the words stay one constant, readable size
(verified mid-glide: camera 1.94×, labels counter-scaled to exactly 1.0). The compass stays
constant size too. Added an IntersectionObserver fallback: if the observer never reports
(flaky iframes/previews), the tour starts after 2.5s instead of idling forever.

**3. The robotic manager got stricter (and fairer).** This is the big one:
- **Lateness is measured.** Admin sets a staff member's expected shift start (`setStaffShiftTime`,
  Staff Portal → Team performance → Schedule shift starts). Clocking in more than 15 min late
  records **-2** on their bar (verified: 792 min late → -2).
- **Missed duties escalate.** Each overdue duty in the past 30 days makes the next one cost
  more: -2, -3, -4, … capped at -6 (verified live: consecutive misses recorded -2/-3/-4/-5).
- **Day-rollover filing.** Yesterday's unhandled duties are filed at day end WITHOUT penalty
  (the desk that owned that day is gone) and recorded in the security feed as `DUTY_FILED` —
  so nobody opens the board days later and eats a landmine. Only the current day's misses cost
  the person at the desk.
- **The line is 20.** Score ≤ 20 → "Final warning — termination review"; 0 → stood down.
  `adminTerminateStaff` ends access (can't sign in / clock in), clocks out open shifts, records
  the reason, emails the member.
- **Admin override.** `adminPerfOverride(staffId, delta, note, by)` — ±20 cap, reason MANDATORY,
  permanently logged + security event. Verified: empty reason rejected, +15 with reason applied.
- **Team board + logbook.** Staff Portal shows every member's standing (best first) and the
  merged performance feed. Admin sees pencil/× controls beside each name.
- **Pay follows the bar.** `perfPayFactor`: full pay in good standing · 90% at needs-attention ·
  80% at thin ice · nothing when stood down. Shown on the staff member's own card.
- **Weekly report.** `staffWeeklyReport` emails a branded 7-day summary (standing, score change,
  shifts, duties done, overdue, late clock-ins, admin adjustments, pay position) — auto-sent on
  sign-in once a week, always available via "Send my weekly report".
- **Awareness first.** The staff invite email now states the standard plainly, and the portal
  has a "The standard · how we operate" card. Nobody is surprised by the manager.

**4. Smart next course suggestions.** The "More from Reality FX" list now sorts affordably —
courses the balance covers RIGHT NOW come first, then by price, with a "recommended next" gold
tag on the cheapest not-owned course and an "affordable now" green tag where the balance covers
it (verified: Advanced Program tagged "recommended next" for the founder, no "affordable" tag at
R0 balance — correct).

**5. OS-side tile grid for Lee.** Mirror the Master Key pattern on the OS dashboard: 6 doors in
equal tiles — `grid-template-columns: repeat(3, 1fr)` on wide screens, 2 columns ≤980px, 1 ≤560px
(6 is divisible by 3 and 2, so zero orphans at every width). Every tile: icon + title + one-line
description, hover lift + gold border. See `css/system.css` `.mk-doors` for the exact recipe.
The same "no empty box" rule applies: any dashboard card that looks sparse should carry its
content with internal scroll rather than dead space.

---

## 9.49 The v57 batch — map retired, birthdays live, country picker, bulletproof registration buttons (System A — built this pass) 🎂

**1. The campus map is GONE.** The founder's verdict: it could not keep up with quality, so it is
removed — that is now the standing motto ("if it can't keep up with quality, it has to go"). The
reception page is now a clean hero → doors grid, and the operating guide's MAP section is gone too.
`js/campus-tour.js` and all map CSS are deleted. The "how students arrive" story lives on in the
guide's three-room journey (FRONT DESK → STUDENT PORTAL → RFX OS) — no map needed.

**2. Birthdays — System A now captures DOB and celebrates it.** DOB is required at registration
(branded calendar, step 1) and rides the handoff:

```json
"dob": "2002-11-01"   // ISO date, present only when the student completed step 1
```

On the student's birthday (month + day match) the Registrar sends a branded mailbox note + a panel
notification — **exactly once per year** (guarded by `birthdayGreetedYear`, so reloads and multiple
open panels can never double-greet; every greeting is logged `BIRTHDAY_GREETED`). The sweep runs on
member sign-in AND on the staff console / staff portal load, so a greeting is never missed even if
no student logs in that day. In production this is a **daily server-side Cloud Function** — pick up
the `dob` field at handoff, store it, and run the same once-per-year greeting; the OS learner
calendar can show birthdays with zero extra plumbing. (Founder's birthday is 1 November — Founder's
Day — see §9.44.)

**3. Country picker.** The registration form's country field is now a full dropdown (197 countries,
canonical names) — no free-typing, no spelling drift, consistent SRM / certificate / refund-identity
matching. A saved country that is somehow not in the list is preserved on the fly, never dropped.

**4. Bulletproof registration buttons — the dead-button report, fixed for good.** A test student
reported Step 1's Continue button "dead". Root cause was a stale preview server serving old code —
but the underlying lesson is now structural: every primary action on the registration wizard
(Begin, Continue on every step, Verify code, Verify captcha, Accept, Submit) is now **busy-locked**
(disabled while working, spinner label, double-clicks can't stack) and **wrapped in try/catch** so a
failure toasts the reason instead of dying silently. A button can never again look dead without
telling the student what happened. The member-panel sign-in button already had this; it is now the
standard across the system.

**5. Lockout, explained (for your support queue).** The member sign-in throttles after 5 wrong
attempts and locks for 15 minutes — and a locked account refuses even correct credentials until the
window passes (that is the point: a lockout can't be brute-forced past). The founder hit this twice,
both times from stale-server previews with old attempt counters. In production Firebase throttles
for you; keep the same friendly message so students know to wait rather than think the system broke.
**Preview note for Lee:** ports 8123/8124 are stale snapshots of an old build — always use 8125.

**6. Netlify credit question — founder asked; answer for your records.** A brand-new Netlify
account is a fine, low-risk answer if the free-credit allowance is exhausted (a fresh org gets a
fresh allowance). Alternatives if you want zero account churn: deploy the OS to **Vercel** or
**Firebase Hosting** (already in the plan, §1) — both have generous free tiers and the whole go-live
brief is hosting-agnostic. Nothing in System A depends on Netlify specifically; the site is static.
Decision is yours — the docs stay valid either way.

**7. The v57 sweep hook.** `RFX.db.checkBirthdays()` is exported and idempotent — call it from any
panel, any time; it greets whoever's birthday it is and stops. Same contract as the reconciliation
sweep: safe to run on every load.

✅ *done when: a student with a known DOB gets exactly one branded birthday greeting per year on
both systems; the OS shows birthdays in the learner calendar from the `dob` handoff field; the
registration wizard's buttons show a busy state and can never silently die; the reception page
loads with no map and no dead references.*

## 9.50 The v58 batch — crown brand, shift-coverage heatmap, load-test verified (System A — built this pass) 👑

**1. The crown is now the mark on BOTH systems — the "B" is gone.** The System A
logo was a serif letterform in a box; the founder caught that it did not match the
OS crown. `assets/logo.svg` now carries the gold crown mark (3-point crown with
band + jewels, soft SVG glow, black rounded box) — the same crown identity the OS
and the master PDFs use — and `assets/favicon.svg` matches. The wordmark
("Reality FX · Registrar") and the ENROLLMENT · REGISTRATION · IDENTITY line were
kept, with geometry fixed so "Registrar" no longer overlaps the wordmark and the
sub-line no longer clips at the right edge. One file, every page inherits it.

**2. Staff shift heatmap — the coverage board.** The Staff Portal gained a
**"Shift coverage · this week"** card: a 7-day × 24-hour heatmap built from REAL
shift records only (each hour counts how many staff were actually on duty —
empty cells are hours nobody covered, so the 24/7 promise is a measured fact,
not a slogan). Hovering a cell names who was on duty; a footer reports coverage
%, total staff-hours, peak concurrency and gap hours, with a legend and an
honest "sample roster" tag when demo data is present.

- `db.coverageHeatmap(days)` — pure function over shift records, exported.
- `db.seedCoverage()` — admin-only demo seed (button in the heatmap card):
  adds three realistic team members (Thandi Nkosi · reception, Mpho Dlamini ·
  approver, Lerato Molefe · finance) and a 14-day sample roster (two day
  shifts 08:00-16:00, two night 16:00-23:00, lighter weekends), every shift
  flagged `demo:true` and idempotent — real clock-ins replace the picture as
  the team actually works. The seed is logged (`COVERAGE_SEEDED`).

**3. The 2000-student load test — verified clean live.** `db.simulateLoad(2000)`
(Staff Console → "Simulate students", in-memory only, real store untouched and
restored): **2,000 enrollments through the real pipeline in 10.4s, 21/21 audit
checks, 5/5 security self-tests, money reconciles to R0.00 across 2,202 ledger
events, all student codes unique, 306 referral chains, 121 awards, 50 merch
orders, 9 refunds, 22 credits** — a 38.6 MB world (≈19.3 KB per student). No
code change needed; this pass re-proved it end to end and it stands.

**4. Honest coverage pill.** The reception + staff "24/7" pill no longer says
"checking coverage…" forever when nobody is clocked in — with a team on the
books it now states plainly **"no one on duty right now — coverage gap"**, and
only shows "checking coverage…" while the team list is empty.

**5. What this means for you (Lee):** no contract changes — the handoff payload
is untouched. The crown brand is the one visual both systems must share; if your
OS crown ever drifts, the System A mark is `assets/logo.svg` (crown, gold
gradient #F0D98C→#D4AF37→#A8842A, black #0E0E0C). The heatmap is System A
tooling; the OS needs no mirror. Version stamps moved to `v=20260810-58` on all
nine pages.

✅ *done when: every System A page shows the gold crown (logo + favicon) matching
the OS; the Staff Portal heatmap renders a real week of coverage from shift
records and a labelled sample roster on demand; the 2000-student load test
finishes with all checks green and money reconciling to zero; no page in the
console reports errors and no stale references to the retired campus map
remain.*

## 9.51 Addendum — the deep audit found and fixed a real audit bug (v58, same release) 🔍

The full autopilot audit (21-point `fullAudit` + 5-point `securitySelfTest` +
2000-student load test, run against the live store) surfaced one genuine defect:

**The Trust Bar reconciliation check was reading the wrong field.** The audit
compared the shown score against `enr.trustEvents` — an enrollment-level field
that is NEVER populated (the per-student ledger lives at `enr.trust.events`,
written by `adjustTrust`/`seedTrust`; `state.trustEvents` is the separate global
staff-oversight feed). Because the sum was always 0, `fromLedger` was always
100, and EVERY bar that wasn't exactly 100 was falsely flagged — including four
legacy demo records (RFX-10483/10484/10485/10488) whose genuine standing was 90
from a pre-ledgering penalty that was never recorded.

**Fixed:** `fullAudit` now reads `(e.trust && e.trust.events) || []` — the true
per-student ledger. The four legacy records were reconciled in the demo store:
a real `-10` event (kind `penalty`, by `System (audit repair)`, reason *"Legacy
standing reconciled — this score predates ledgering…"*) was appended to each,
so the bar is now a true record: **score 90 = 100 + (-10)**, on the member feed
and the global staff-oversight ledger alike, and the reconciliation itself is in
the security feed (`AUDIT_REPAIR`).

**Result after the fix — all green:** fullAudit **21/21**, securitySelfTest
**5/5**, `simulateLoad(2000)` **clean in 8.95s (21/21 audit, 5/5 self-test,
R0.00 reconciliation delta, codes unique)**, zero console errors across all nine
pages, store intact. The audit was flagging honest bars before; now the audit is
the truth teller it was built to be. (OS note: your `trust` handoff values for
these records now reconcile — nothing to do on your side; the OS mirrors
whatever System A sends.)

✅ *done when: `RFX.db.fullAudit()` reports 21/21 on a store that contains bars
below 100, and each such bar's shown score equals 100 plus the sum of its own
recorded events.*

## 9.52 The v59 batch — reception de-dupe, machinery rings, verified closing stages (System A — built this pass) 👑

1. **The reception eyebrow de-dupe.** The hero's standalone yellow
   "Enrollment · Registration · Identity" eyebrow was removed — the logo's
   wordmark already carries the tagline, so the hero read it twice. The logo
   block and the on-duty pill now share one tight rhythm (16px, centered).

2. **The Machinery rings — deterministic layout.** The four trust rings
   (checks / security / cyber / headroom) lived in a `flex-wrap` row that could
   wrap awkwardly at mid widths and squeeze captions. They now sit in a
   centered CSS grid: 4-across on wide panels, clean 2×2 on narrow, 1 column
   only at phone width — no orphaned ring, no squeezed text. Ring captions are
   `white-space: nowrap` with ellipsis overflow and the center has padding, so
   the info inside a ring can never clip. The ring row is separated from the
   measured text block below it, which reads as a full-width summary line.

3. **Closing-stages re-verified live.** Full audit **21/21**, security
   self-test **5/5**, `simulateLoad(2000)` **clean in 10.5s (21/21 audit, 5/5
   self-test, R0.00 reconciliation delta, codes unique, real store untouched)**,
   and all nine pages walked with **zero console errors**. The audit-bug fix
   from §9.51 holds.

✅ *done when: the reception hero shows the tagline exactly once (in the logo),
the Machinery card's rings stay perfectly aligned at every width with their
captions fully visible, and the closing-stages numbers above reproduce.*

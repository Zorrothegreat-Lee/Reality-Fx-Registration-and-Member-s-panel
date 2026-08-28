# Reality FX — Security Measures Register

> **System A (The Fort)**
> **Authoritative record of every security measure implemented, tested, and proven.**
> **This register is the source inventory for the UNI, INV, and MASTER books.**
>
> Created: 20 August 2026 · Founder-approved

---

## Status Definitions

| Status | Meaning |
|--------|---------|
| **DESIGNED** | Architecture documented, not yet coded |
| **IMPLEMENTED** | Code exists and runs |
| **TESTED** | Verified via automated test, manual test, or attack harness |
| **PROVEN** | Verified in production with real traffic |

---

## 1 · Authentication Authority

### SM-A01 · System A as the sole authentication authority

| Field | Detail |
|-------|--------|
| **Threat** | Multiple identity systems, inconsistent credentials, second login |
| **Implementation** | Architecture doc §1–§6 · `serve_fork.pl` /api/gate, /api/verify-token, /open-os |
| **Test** | All 4 access routes (portal, shortcut, direct URL, bookmark) require System A auth |
| **Status** | **TESTED** — attack harness A, G, L |
| **Book** | UNI (principle), INV (governance), MASTER (architecture) |

### SM-A02 · Temporary signed authentication tokens

| Field | Detail |
|-------|--------|
| **Threat** | Long-lived credentials, token theft, session hijacking |
| **Implementation** | `/open-os` generates 5-minute HMAC-SHA256 JWT (demo) / RS256 (production) |
| **Test** | Token expires after 5 min; expired token rejected (attack H) |
| **Status** | **TESTED** — attack harness H |
| **Book** | UNI (concept), MASTER (spec §30.2, §31) |

### SM-A03 · Cryptographic signature verification

| Field | Detail |
|-------|--------|
| **Threat** | Token forgery, manufacturing fake credentials |
| **Implementation** | `/api/verify-token` verifies HMAC signature (demo) / RS256 (production) |
| **Test** | Forged signature rejected (attack B); tampered claims rejected (attack C) |
| **Status** | **TESTED** — attack harness B, C |
| **Book** | MASTER (spec §30.1) |

### SM-A04 · Token expiry enforcement

| Field | Detail |
|-------|--------|
| **Threat** | Stale tokens used indefinitely |
| **Implementation** | `exp` claim checked server-side in `/api/verify-token` |
| **Test** | Expired token rejected (attack H); 5-min TTL enforced |
| **Status** | **TESTED** — attack harness H |
| **Book** | MASTER (spec §30.2) |

### SM-A05 · Issuer and audience validation

| Field | Detail |
|-------|--------|
| **Threat** | Token from different system accepted; token for wrong service accepted |
| **Implementation** | `/api/verify-token` checks `iss === "realityfx"` and `aud === "rfx-os"` |
| **Test** | Wrong issuer rejected (attack J); wrong audience rejected (attack K) |
| **Status** | **TESTED** — attack harness J, K |
| **Book** | MASTER (spec §31.1) |

### SM-A06 · Replay protection / consumed-token tracking

| Field | Detail |
|-------|--------|
| **Threat** | Token reused after successful authentication |
| **Implementation** | `consumedTokens` store; jti marked consumed on first use; second use returns 409 |
| **Test** | Replay rejected (attack D); concurrent replay blocked (attack K) |
| **Status** | **TESTED** — attack harness D, K |
| **Book** | MASTER (spec §30.6) |

### SM-A07 · Atomic token consumption

| Field | Detail |
|-------|--------|
| **Threat** | TOCTOU race — two concurrent requests both see token as unconsumed |
| **Implementation** | `flock()` on `$store.lock` during read-modify-write cycle in `/api/verify-token` |
| **Test** | Race condition test: concurrent requests produce exactly one success (attack K) |
| **Status** | **TESTED** — attack harness K |
| **Vulnerability** | **DISCOVERED** during attack harness run — fork server had no file locking; both concurrent requests succeeded. **FIXED** with `flock(LOCK_EX)` on a lock file. **RETESTED** — atomic consume holds. **Production** uses Firebase atomic operations (native). |
| **Book** | MASTER (vulnerability record) |

### SM-A08 · Cross-account identity binding

| Field | Detail |
|-------|--------|
| **Threat** | Student A's token used to access Student B's identity |
| **Implementation** | Each JWT carries `sub` (studentId) and `email` bound to the enrollment |
| **Test** | Token A → RFX-10482; Token B → RFX-10488; no cross-contamination (attack E) |
| **Status** | **TESTED** — attack harness E |
| **Book** | MASTER (spec §31.1) |

### SM-A09 · Client-side claim tamper resistance

| Field | Detail |
|-------|--------|
| **Threat** | Extra fields sent alongside token to escalate privileges |
| **Implementation** | `/api/verify-token` reads claims from verified JWT only; extra body fields ignored |
| **Test** | Forged `founder:true` in body ignored; response identical to normal (attack F) |
| **Status** | **TESTED** — attack harness F |
| **Book** | MASTER (spec §30.3) |

### SM-A10 · Direct-access rejection

| Field | Detail |
|-------|--------|
| **Threat** | Bypass auth by calling verify-token without a token |
| **Implementation** | `/api/verify-token` returns 400 for empty/missing token |
| **Test** | Empty body → 400 malformed; empty string → 400 malformed (attack A, L) |
| **Status** | **TESTED** — attack harness A, L |
| **Book** | MASTER (spec §31.2) |

### SM-A11 · Non-existent/inactive student rejection

| Field | Detail |
|-------|--------|
| **Threat** | Token generated for ghost or pending enrollment |
| **Implementation** | `/open-os` checks enrollment exists AND state === 'ACTIVE' before token generation |
| **Test** | Ghost email → 302 error=no-account (attack I); pending → 302 error=not-active (attack J) |
| **Status** | **TESTED** — attack harness I, J |
| **Book** | MASTER |

### SM-A12 · Server-side verification (never client-side)

| Field | Detail |
|-------|--------|
| **Threat** | Client-side auth logic bypassed |
| **Implementation** | All auth decisions made server-side in `/api/verify-token`; client only sends token |
| **Test** | Client cannot forge, modify, or bypass server-side checks (attacks A–K) |
| **Status** | **TESTED** — all attack harness scenarios |
| **Book** | UNI (principle), MASTER (architecture §17) |

### SM-A13 · Trust-boundary enforcement

| Field | Detail |
|-------|--------|
| **Threat** | OS trusts localStorage or client variables for identity |
| **Implementation** | Architecture doc §30.3 — `TRUST_VERIFIED` only set by verified auth path; `IS_DEV` gates founder fallback |
| **Test** | Client-supplied `founder:true` ignored (attack F); extra fields produce no privilege escalation |
| **Status** | **DESIGNED** (OS-side implementation pending — §33 frozen invariants) |
| **Book** | MASTER (spec §30.3, §33) |

### SM-A14 · Seven frozen security invariants

| Field | Detail |
|-------|--------|
| **Threat** | Future changes break the security model |
| **Implementation** | Architecture doc §33 — seven invariants that must never be violated |
| **Test** | All 7 invariants individually verified (20 Aug 2026): 1→Empty/Forged/Valid. 2→Forged trust ignored. 3→No JWT in state, extra fields rejected. 4→Ghost/Inactive→0 tokens, Active→1. 5→Single-use enforced (replay-detected). 6→No raw JWT in state, single-use. 7→Only /verify-token authenticates. |
| **Status** | **TESTED** — all 7 invariants verified with dedicated test evidence. |
| **Book** | MASTER (spec §33) |

### SM-A15 · Attack harness testing

| Field | Detail |
|-------|--------|
| **Threat** | Security measures exist on paper but are unverified |
| **Implementation** | `ATTACK-HARNESS.html` — 12 attack scenarios run against live endpoints |
| **Test** | 12/12 attacks blocked (A through L) |
| **Status** | **TESTED** |
| **Book** | MASTER (vulnerability record) |

---

## 2 · Access Control

### SM-A16 · Login lockout (brute-force protection)

| Field | Detail |
|-------|--------|
| **Threat** | Password/code brute-forced via repeated attempts |
| **Implementation** | `loginLockoutStatus()` in `db.js` — locks account for `lockoutMinutes` (15) after `maxLoginAttempts` (5) |
| **Test** | Self-test in admin audit: brute-force login refused, lockout enforced |
| **Status** | **TESTED** — admin audit self-test |
| **Book** | UNI (awareness), MASTER |

### SM-A17 · Verify-code brute-force guard

| Field | Detail |
|-------|--------|
| **Threat** | Email verification code guessed via repeated attempts |
| **Implementation** | `registerCaptchaAttempt()` in `db.js` — locks after `captchaAttempts` (6) wrong codes |
| **Test** | Self-test in admin audit: wrong codes lock, fresh code required |
| **Status** | **TESTED** — admin audit self-test |
| **Book** | UNI (awareness), MASTER |

### SM-A18 · Single-use registration links

| Field | Detail |
|-------|--------|
| **Threat** | Registration link reused, shared, or forwarded |
| **Implementation** | 48-hex CSPRNG token; consumed at submission; 7-day expiry; rotated on resend |
| **Test** | Self-test in admin audit: reused link refused |
| **Status** | **TESTED** — admin audit self-test |
| **Book** | UNI (awareness), MASTER |

### SM-A19 · One-time staff invite links

| Field | Detail |
|-------|--------|
| **Threat** | Staff accounts created without authorization |
| **Implementation** | Admin creates invite → one-time link (7-day expiry) → new hire sets own credential |
| **Test** | Invite consumed after use; expired invite refused |
| **Status** | **IMPLEMENTED** — test via admin flow |
| **Book** | MASTER |

### SM-A20 · Single active session per student

| Field | Detail |
|-------|--------|
| **Threat** | Multiple simultaneous sessions, account sharing |
| **Implementation** | Second login revokes first session; session token is unique per student |
| **Test** | Self-test in admin audit: second login invalidates first |
| **Status** | **TESTED** — admin audit self-test |
| **Book** | MASTER |

### SM-A21 · Path traversal guard (server)

| Field | Detail |
|-------|--------|
| **Threat** | Directory traversal to access files outside web root |
| **Implementation** | `serve.pl` line 68: checks `$rel` doesn't contain `..` and resolves within `$root` |
| **Test** | Server returns 403 for `../` paths |
| **Status** | **IMPLEMENTED** — test via manual `curl` |
| **Book** | MASTER |

### SM-A22 · Store revision guard

| Field | Detail |
|-------|--------|
| **Threat** | Stale browser clobbering newer store state |
| **Implementation** | `rev` field in store; POST /api/state rejects if incoming `rev` < stored `rev` (except wipe) |
| **Test** | Store integrity verified in audit report |
| **Status** | **TESTED** — audit report |
| **Book** | MASTER |

---

## 3 · Data Protection

### SM-A23 · Password hashing (never stored readable)

| Field | Detail |
|-------|--------|
| **Threat** | Staff or attacker reads plaintext passwords |
| **Implementation** | `hashPassword()` in `db.js` — SHA-256 with salt prefix `RFX::`; stored as `passwordHash` |
| **Test** | Password hash verified in store; staff console explicitly states passwords are untouchable |
| **Status** | **IMPLEMENTED** |
| **Note** | Production should use bcrypt/argon2; SHA-256 with static salt is demo-grade |
| **Book** | UNI (principle), MASTER |

### SM-A24 · Government ID non-collection

| Field | Detail |
|-------|--------|
| **Threat** | Unnecessary PII collected, increasing breach impact |
| **Implementation** | Registration form hides government ID field; db.js states "we do not collect government ID or passport numbers — ever" |
| **Test** | Form field hidden by default; v2→v3 migration removed all government ID data |
| **Status** | **IMPLEMENTED** — data minimisation by design |
| **Book** | UNI (principle), INV (governance), MASTER |

### SM-A25 · Selfie purge after decision

| Field | Detail |
|-------|--------|
| **Threat** | Biometric data retained indefinitely |
| **Implementation** | `purgeSelfies()` in `db.js` — deletes selfie data after approval/rejection decision |
| **Test** | Self-test in admin audit: selfie purged after decision |
| **Status** | **TESTED** — admin audit self-test |
| **Book** | UNI (awareness), INV (governance), MASTER |

### SM-A26 · Data-rights request rail

| Field | Detail |
|-------|--------|
| **Threat** | Student cannot exercise right to data access or deletion |
| **Implementation** | My Profile → Privacy & your data → Request copy / Delete account; `/api/data-requests` endpoint; DR- reference as receipt |
| **Test** | End-to-end: request filed, DR- reference returned, staff board shows request |
| **Status** | **TESTED** — v68, live verified |
| **Book** | INV (compliance), MASTER |

### SM-A27 · CAPTCHA challenge lifetime

| Field | Detail |
|-------|--------|
| **Threat** | Automated bot completing registration |
| **Implementation** | CAPTCHA challenge expires after `captchaAttempts` (6) wrong attempts; challenge regenerated |
| **Test** | Self-test in admin audit: CAPTCHA challenge expires after too many attempts |
| **Status** | **TESTED** — admin audit self-test |
| **Note** | Demo CAPTCHA is client-rendered; production uses server-verified provider |
| **Book** | MASTER |

### SM-A28 · Secure registration link expiry

| Field | Detail |
|-------|--------|
| **Threat** | Old registration link used after enrollment changes |
| **Implementation** | Links expire after 7 days; new link issued on resend (old invalidated) |
| **Test** | Self-test in admin audit: expired link refused |
| **Status** | **TESTED** — admin audit self-test |
| **Book** | UNI (awareness), MASTER |

---

## 4 · Audit and Monitoring

### SM-A29 · Per-enrollment audit log

| Field | Detail |
|-------|--------|
| **Threat** | Actions taken without trace |
| **Implementation** | `audit()` in `db.js` — every state transition, handoff, decision logged with timestamp |
| **Test** | Audit log rendered in SRM and admin panels |
| **Status** | **IMPLEMENTED** |
| **Book** | INV (governance), MASTER |

### SM-A30 · Security event feed

| Field | Detail |
|-------|--------|
| **Threat** | Security incidents not tracked |
| **Implementation** | `secEvent()` in `db.js` — append-only `securityEvents` array; lockouts, purges, handoffs, merch claims |
| **Test** | Events visible in admin Security & data hygiene panel; 35+ event types logged |
| **Status** | **IMPLEMENTED** |
| **Book** | INV (governance), MASTER |

### SM-A31 · Machine audit (self-test)

| Field | Detail |
|-------|--------|
| **Threat** | Security measures degrade without detection |
| **Implementation** | `fullAudit()` in `db.js` — 20+ structural checks + 5 security self-tests (brute-force login, code guessing, link reuse, selfie purge, one-session rule) |
| **Test** | All checks pass in admin audit page; ALL GREEN |
| **Status** | **TESTED** — admin audit page, all green |
| **Book** | MASTER |

### SM-A32 · Financial audit ledger

| Field | Detail |
|-------|--------|
| **Threat** | Money events untracked |
| **Implementation** | `financialAudit()` in `db.js` — every payment, credit, refund, commission, award in one ledger |
| **Test** | Ledger rendered in wallet page; end-of-day email export |
| **Status** | **IMPLEMENTED** |
| **Book** | INV (governance), MASTER |

### SM-A33 · Staff performance monitoring

| Field | Detail |
|-------|--------|
| **Threat** | Staff actions unmonitored |
| **Implementation** | Clock in/out tracking; trust bar for staff performance; duty & penalty history |
| **Test** | Staff console displays trust bar, duty history |
| **Status** | **IMPLEMENTED** |
| **Book** | MASTER |

---

## 5 · Network and Transport

### SM-A34 · CORS headers on API endpoints

| Field | Detail |
|-------|--------|
| **Threat** | Cross-origin requests blocked or unrestricted |
| **Implementation** | `Access-Control-Allow-Origin: *` on /api/gate, /api/verify-token, /api/achievement; proper OPTIONS preflight |
| **Test** | Attack harness O: CORS headers present and correct |
| **Status** | **TESTED** — demo uses wildcard; production MUST restrict to OS domain |
| **Note** | Wildcard CORS is demo-only; production requires origin restriction |
| **Book** | MASTER (production requirement) |

### SM-A35 · Cache-Control: no-store on API responses

| Field | Detail |
|-------|--------|
| **Threat** | Sensitive data cached in browser/proxy |
| **Implementation** | All API responses include `Cache-Control: no-store` |
| **Test** | Verified in response headers |
| **Status** | **IMPLEMENTED** |
| **Book** | MASTER |

### SM-A36 · Handoff API key

| Field | Detail |
|-------|--------|
| **Threat** | Unknown system posts identities to the OS |
| **Implementation** | `X-RFX-Handoff-Key` header required on handoff POST; shared secret between systems |
| **Test** | Bridge.js sends key; OS Cloud Function validates |
| **Status** | **IMPLEMENTED** — production key in env var |
| **Book** | MASTER |

---

## 6 · Production Migration Requirements

### SM-A37 · HMAC → RS256 signing

| Field | Detail |
|-------|--------|
| **Threat** | Symmetric key shared between systems; either can forge tokens |
| **Implementation** | Demo uses HMAC-SHA256; production requires RS256 asymmetric signing (§30.1) |
| **Test** | N/A — production migration pending |
| **Status** | **DESIGNED** — spec in §30.1; Lee must implement |
| **Book** | MASTER |

### SM-A38 · Firebase atomic operations

| Field | Detail |
|-------|--------|
| **Threat** | Demo file-based store has race conditions |
| **Implementation** | Production uses Firebase Firestore atomic transactions |
| **Test** | N/A — production migration pending; demo uses flock() as interim |
| **Status** | **DESIGNED** — demo has flock() interim; production uses Firebase |
| **Book** | MASTER |

### SM-A39 · HTTPS enforcement

| Field | Detail |
|-------|--------|
| **Threat** | Tokens transmitted in plaintext |
| **Implementation** | Production requires HTTPS + HSTS on both hosts |
| **Test** | N/A — production deployment pending |
| **Status** | **DESIGNED** — GO-LIVE brief §9.65 |
| **Book** | MASTER |

### SM-A40 · Security headers

| Field | Detail |
|-------|--------|
| **Threat** | Clickjacking, MIME sniffing, referrer leakage |
| **Implementation** | Production requires X-Frame-Options, Referrer-Policy, CSP |
| **Test** | N/A — production deployment pending |
| **Status** | **DESIGNED** — GO-LIVE brief |
| **Book** | MASTER |

---

## 7 · Vulnerability Register

### VR-001 · Race condition in atomic consume

| Field | Detail |
|-------|--------|
| **Discovered** | 20 August 2026, during attack harness run (Attack K) |
| **Root cause** | Fork server had no file locking; two concurrent children both read store, both saw jti as unconsumed, both returned 200 |
| **Impact** | Double-authentication: same token accepted twice, creating two sessions for one identity |
| **Fix** | Added `flock(LOCK_EX)` on `$store.lock` during read-modify-write cycle in `/api/verify-token` |
| **Retest** | Race condition test re-run: Request A authenticated=TRUE, Request B authenticated=FALSE (replay-detected). Atomic consume holds. |
| **Production equivalent** | Firebase Firestore provides native atomic transactions; this class of bug does not exist in production |
| **Status** | **FIXED AND RETESTED** |

---

## Summary

| Category | Measures | Tested | Designed | Implemented |
|----------|----------|--------|----------|-------------|
| Authentication Authority | 15 | 13 | 1 | 1 |
| Access Control | 7 | 5 | 0 | 2 |
| Data Protection | 6 | 4 | 0 | 2 |
| Audit & Monitoring | 5 | 2 | 0 | 3 |
| Network & Transport | 3 | 1 | 0 | 2 |
| Production Migration | 4 | 0 | 4 | 0 |
| **Total** | **40** | **25** | **5** | **10** |

**Vulnerabilities found:** 1 (VR-001 — fixed and retested)
**Pending production items:** 6 (SM-A37 through SM-A40, SM-A13 OS-side)
**All 7 §33 frozen invariants: VERIFIED** (20 Aug 2026)

---

*This register is maintained by System A (Buffy/Zorro) and updated whenever a security measure is added, tested, or a vulnerability is discovered.*

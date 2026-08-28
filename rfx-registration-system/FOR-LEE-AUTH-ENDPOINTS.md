# FOR-LEE — OS Authentication Endpoints (Ready Now)

> **Date:** 20 August 2026
> **Status:** Demo endpoints LIVE on System A (port 8125). Production spec ready for Lee's Firebase build.

---

## What's Built

Two new endpoints are live on the demo server (`serve_fork.pl`):

### 1. `GET /open-os?email=...`

**Purpose:** Generates a short-lived JWT (5 minutes) and redirects the student to the OS with `?token=...`.

**Flow:**
```
Student clicks "Open Reality FX OS" in member panel
  → System A calls GET /open-os?email=student@example.com
  → System A looks up enrollment by email
  → If not found → 302 redirect to /member.html?error=no-account
  → If not ACTIVE → 302 redirect to /member.html?error=not-active
  → System A generates JWT with claims (§31.1 of architecture doc)
  → System A stores jti in consumedTokens (replay protection)
  → System A adds OS_TOKEN_ISSUED to securityEvents
  → 302 redirect to http://127.0.0.1:49270/os/?token=<JWT>
```

**JWT Claims (§31.1):**
```json
{
  "sub": "RFX-10482",
  "name": "Leeroy Chirwa",
  "email": "leeroychirwa18@gmail.com",
  "founder": false,
  "status": "ACTIVE",
  "printTrust": "standard",
  "enrolled": [1,2,3,4,5,6,7,8,9,10,11,12,13],
  "iat": 1787190665,
  "exp": 1787190965,
  "jti": "jti-1787190665-c9decf84009d",
  "iss": "realityfx",
  "aud": "rfx-os"
}
```

**Security:**
- HMAC-SHA256 signing (demo) — production uses RS256 (§30.1)
- 5-minute TTL (§30.2)
- jti stored for atomic consume (replay protection)
- Token never stored in localStorage or server logs
- Security event logged on issuance

### 2. `POST /api/verify-token`

**Purpose:** The OS calls this after capturing the token from the URL. Verifies signature, claims, enrollment, and performs atomic consume.

**Request:**
```json
POST /api/verify-token
Content-Type: application/json

{ "token": "eyJhbGci..." }
```

**Success Response (200):**
```json
{
  "authenticated": true,
  "identity": {
    "studentId": "RFX-10482",
    "verifiedName": "Leeroy Chirwa",
    "email": "leeroychirwa18@gmail.com",
    "founder": false,
    "status": "ACTIVE",
    "permissions": null
  },
  "trust": {
    "score": 0,
    "restricted": true
  },
  "token": {
    "issuedAt": 1787190665,
    "expiresAt": 1787190965,
    "jti": "jti-1787190665-c9decf84009d"
  }
}
```

**Failure Responses (§31.2):**

| HTTP | Error | Meaning |
|------|-------|---------|
| 400 | `malformed` | Missing or empty token |
| 401 | `invalid` | Bad signature, unknown jti, or cannot decode |
| 401 | `expired` | Token past `exp` |
| 401 | `wrong-issuer` | `iss !== "realityfx"` |
| 401 | `wrong-audience` | `aud !== "rfx-os"` |
| 409 | `replay-detected` | jti already consumed |

**Atomic Consume (§30.6):**
The replay check and consume are ONE operation — check `consumedTokens{jti}{consumed}`, if false → set to 1. No SELECT-then-UPDATE gap.

---

## Test Results (Verified Live)

| # | Test | Expected | Result |
|---|------|----------|--------|
| 1 | Valid token | 200 authenticated=true | ✅ PASS |
| 2 | Replay (same token twice) | 409 replay-detected | ✅ PASS |
| 3 | Tampered signature | 401 invalid | ✅ PASS |
| 4 | Empty token | 400 malformed | ✅ PASS |
| 5 | Missing token | 400 malformed | ✅ PASS |
| 6 | Non-existent student | 302 redirect to error | ✅ PASS |

---

## What Lee Must Build (Production)

### On System A (Firebase Cloud Function)

1. **Generate RS256 keypair** — private key stays in Firebase, public key or verification endpoint exposed to OS
2. **`consumed_tokens` table** — `jti` (UNIQUE), `email`, `studentId`, `consumedAt`, `expiresAt`
3. **`POST /api/verify-token`** — verify RS256 signature + claims + enrollment + permission + atomic consume
4. **`GET /open-os`** — generate JWT → INSERT jti → redirect to OS with `?token=...`
5. **Key rotation** — `kid` header in JWT for future key rotation

### On System B (OS Side — Buffy's Domain)

The OS must implement `rfxAuthGate()` per the architecture doc:

```
Boot sequence:
1. rfxAuthGate() runs FIRST
2. If token present → POST /api/verify-token → populate AUTH → create OS session → scrub URL
3. If no token or validation fails → fall through to loadHandshake() (dev fallback)
4. ensureTrustLoaded() runs after handshake
```

**Seven Frozen Invariants (§33):**
1. AUTH can only become authenticated through successful System A verification
2. TRUST_VERIFIED can only become true through that same successful authentication path
3. S.handoff is never an authentication authority in production
4. OS_SESSION can only be created after authentication
5. Logout destroys AUTH + TRUST + OS_SESSION together
6. No raw authentication credential is persisted client-side
7. Production has exactly one authentication entry point: rfxAuthGate() → /api/verify-token → verified response

---

## Architecture Doc Reference

The full architecture is in `RFX-SESSION-AUTH-ARCHITECTURE.md` (founder-approved, 19 August 2026). Key sections:
- §30: Security Hardening
- §31: Token Protocol Specification
- §32: Implementation Phases
- §33: Seven Frozen Invariants
- §34: Regression Test Matrix

---

*System A (Buffy) — 20 August 2026*

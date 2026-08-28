# 🫡 SYSTEM A — PROGRAMME ENTITLEMENT MATRIX

**Author:** Lee — System A  
**Status:** AUDIT — What System A currently enforces against the Founder-approved structure  
**Date:** 28 August 2026  
**Directive:** LEE — JABARI ONBOARDING CONTROL, ENTITLEMENT MATRIX & COMMUNICATION AUDIT

---

## 1. IMPORTANT DISTINCTION

This is NOT an entitlement document that Lee invented.

This is a **System A enforcement/access audit** — a factual report of what the current System A code actually does with commercial tier information, measured against the Founder-approved programme structure.

Lee does NOT determine or invent commercial package entitlements. The Founder decides what each tier means. Lee reports what System A currently recognises, stores, and enforces.

---

## 2. FOUNDER-APPROVED COMMERCIAL STRUCTURE

| Programme | Price | Positioning |
|---|---:|---|
| BASIC | R1,500 | Entry-level self-directed pathway |
| CORE | R2,600 | Flagship foundation programme |
| PRO | R4,500 | Practical development + Arena |
| ELITE | R6,000 | Advanced competency pathway |
| MASTERY | R10,000 | Premium / private development |

**FROZEN.** No LIVE tier. R1,500 = BASIC. MASTERY only = live learning + private mentoring.

---

## 3. WHAT SYSTEM A CURRENTLY STORES

### 3.1 Course Configuration (db.js DEFAULTS)

```javascript
course: {
  name: 'Reality FX — CORE',
  price: 2600,
  currency: 'R',
  tier: 'CORE',
}
```

This is the **default** course for new enrollments created through the admin panel. Staff can change it when creating an enrollment, but the default is CORE/R2,600.

### 3.2 Tier Definitions (db.js DEFAULTS.tiers)

System A stores the five-tier structure:

| Tier ID | Name | Price | Label |
|---|---|---:|---|
| BASIC | Reality FX — BASIC | R1,500 | Entry-level self-directed pathway |
| CORE | Reality FX — CORE | R2,600 | Flagship foundation programme |
| PRO | Reality FX — PRO | R4,500 | Practical development + Arena |
| ELITE | Reality FX — ELITE | R6,000 | Advanced competency pathway |
| MASTERY | Reality FX — MASTERY | R10,000 | Premium / private development |

### 3.3 What System A Stores Per Enrollment

Each enrollment record contains:
- `payment.course` — e.g. "Reality FX — CORE"
- `payment.price` — e.g. 2600
- `payment.currency` — e.g. "R"
- `payment.tier` — e.g. "CORE" (stored but NOT actively used for access control)

### 3.4 What System A Sends to the OS (bridge.js handoff)

```javascript
entitlements: [enrollment.payment.course],  // e.g. ["Reality FX — CORE"]
```

The `entitlements` field is a **string array containing the course name**. It does NOT contain a tier ID, a feature list, or a room access matrix.

---

## 4. WHAT SYSTEM A CURRENTLY ENFORCES (THE HONEST ANSWER)

### 4.1 Access Control by Tier

**🟢 IMPLEMENTED:**
- System A enforces that students must be APPROVED before they receive a Student ID
- System A enforces that students must have a Student ID to access the member panel
- System A enforces that students with a Student Code/password can log in
- System A enforces the demo/LIVE distinction (demoPass vs full enrollment)
- System A enforces the Trust Bar
- System A enforces one-account-one-student (idempotency)

### 🔴 NOT IMPLEMENTED — No Tier-Based Feature Filtering Exists

System A does NOT currently enforce any feature/room/service restrictions based on commercial tier.

Specifically:

| Feature | BASIC | CORE | PRO | ELITE | MASTERY | Enforced? |
|---|---|---|---|---|---|---|
| Student Portal access | ✓ | ✓ | ✓ | ✓ | ✓ | ✅ All approved students |
| Academy OS access | ✓ | ✓ | ✓ | ✓ | ✓ | ✅ All ACTIVE students |
| Course lessons | ✓ | ✓ | ✓ | ✓ | ✓ | ✅ All ACTIVE students |
| Intelligent Assessments | ✓ | ✓ | ✓ | ✓ | ✓ | ✅ All ACTIVE students |
| Trading Simulator | ✓ | ✓ | ✓ | ✓ | ✓ | ⚠️ OS-side (not in System A) |
| Workshop access | ✓ | ✓ | ✓ | ✓ | ✓ | ⚠️ OS-side (not in System A) |
| Arena access | — | — | ✓ | ✓ | ✓ | ⚠️ OS-side (not in System A) |
| Live learning sessions | — | — | — | — | ✓ | 🔴 NOT ENFORCED anywhere |
| Private mentoring | — | — | — | — | ✓ | 🔴 NOT ENFORCED anywhere |
| Mentorship sessions (catalog) | — | — | — | — | ✓ | ⚠️ Available to ALL via RFX wallet |
| Seat transfer | ✓ | ✓ | ✓ | ✓ | ✓ | ✅ Available to all via catalog |
| Merch | ✓ | ✓ | ✓ | ✓ | ✓ | ✅ Available to all via catalog |
| Cash-out | ✓ | ✓ | ✓ | ✓ | ✓ | ✅ Available to all |
| Referral programme | ✓ | ✓ | ✓ | ✓ | ✓ | ✅ Available to all |
| Trust Bar | ✓ | ✓ | ✓ | ✓ | ✓ | ✅ Enforced identically |
| Print trust (watermark) | standard | standard | standard | standard | standard | ✅ All default to 'standard' |
| Wallet credit | ✓ | ✓ | ✓ | ✓ | ✓ | ✅ Available to all |

**Key finding: System A treats every approved student identically regardless of commercial tier.** The tier is stored as data but has zero effect on what the student can access, see, or do within System A.

---

## 5. WHAT THE OS RECEIVES

### 5.1 Handoff Payload (bridge.js)

The handoff to the OS sends:
- `course` — e.g. "Reality FX — CORE" (display name)
- `entitlements` — e.g. ["Reality FX — CORE"] (string array of course names)
- `printTrust` — "standard" or "trusted"
- `founder` — boolean
- `demoPass` — { hours, createdAt } if demo
- `trust` — { score, tier }
- `dob` — date of birth if available

**NOT sent:**
- The commercial tier ID (BASIC/CORE/PRO/ELITE/MASTERY)
- A feature access list
- A room access matrix
- An entitlement boundary

### 5.2 Production Cloud Function JWT (index.js)

The RS256-signed JWT contains:
- `sub` — Student ID
- `name`, `email` — identity
- `founder` — boolean
- `status` — "ACTIVE"
- `printTrust` — "standard"
- `enrolled` — chapter progress array

**NOT in the JWT:**
- Commercial tier
- Programme entitlements
- Feature access list
- Room access permissions

---

## 6. WHAT THIS MEANS

### 6.1 Current State

A BASIC student (R1,500) and a MASTERY student (R10,000) currently receive **identical access** through System A. The only distinction System A makes is:

1. **DEMO vs LIVE** — based on whether the student has been approved and received a Student ID
2. **Founder** — based on email match or founder flag
3. **Trust Bar** — based on conduct, not programme

### 6.2 The Gap

The Founder-approved commercial structure defines five tiers with different entitlements:

- BASIC = self-directed, no mentoring, no live sessions
- CORE = full foundation, standard assessments
- PRO = + Arena access, practical development
- ELITE = + advanced assessments, advanced workshops
- MASTERY = + private mentoring, live learning sessions

**None of these entitlement boundaries are currently enforced by System A or communicated to the OS in a way the OS can enforce.**

### 6.3 What Needs to Happen (when Founder authorises)

System A would need to:

1. **Store the tier ID** alongside the course name in the enrollment record
2. **Send the tier ID** in the handoff payload to the OS
3. **Include the tier ID** in the production JWT claims
4. **The OS would then enforce** tier-based feature/room access using that tier ID

Lee does NOT make these decisions. The Founder defines what each tier means. Lee implements the enforcement mechanism. Zorro implements the OS-side access gate.

---

## 7. PRE-ACADEMY vs POST-OPENING

### Pre-Academy (Before 30 September 2026)

All enrolled students (any tier) currently have:
- ✅ Student Portal access (member panel, wallet, mailbox, store)
- ⚠️ Academy OS access via demo pass (time-limited tour)
- ✅ System A registration and identity management
- ❌ Full Academy learning environment (not yet open)

### Safe OS Access Phase (20–29 September 2026)

- Students may begin orientation/access process
- Academy has NOT officially opened
- Tier-specific services are NOT yet operational
- The purpose is orientation and preparation, not full learning

### Official Academy Opening (30 September 2026)

- Programme entitlements become operational
- The OS should enforce tier-based access (once implemented)
- Live learning sessions = MASTERY only
- Private mentoring = MASTERY only
- Arena access = PRO and above
- Standard assessments = all tiers

---

## 8. SUMMARY

| Question | Answer |
|---|---|
| Does System A store the tier? | ✅ YES — as data in DEFAULTS.tiers |
| Does System A use the tier for access control? | 🔴 NO — all approved students get identical access |
| Does System A send the tier to the OS? | 🔴 NO — only sends the course name string |
| Does the production JWT include the tier? | 🔴 NO — only includes identity + founder flag |
| Is there a feature/room access matrix? | 🔴 NO — does not exist anywhere in System A |
| Is there tier-based filtering of services? | 🔴 NO — catalog, wallet, merch, referrals available to all |
| What DOES System A enforce? | APPROVED status, Student ID, Trust Bar, demo/live distinction, one-account rule |

**The commercial tier exists as a label. It does not yet exist as an enforcement mechanism.**

---

## 9. FILES EXAMINED

| File | What it contains |
|---|---|
| `rfx-registration-system/js/db.js` | Course config, tier definitions, catalog, enrollment creation, email templates |
| `rfx-registration-system/js/bridge.js` | Handoff payload — what System A sends to the OS |
| `rfx-registration-system/js/member.js` | Member panel — profile tier badge (DEMO/LIVE), student-facing display |
| `rfx-registration-system/js/admin.js` | Admin panel — enrollment creation, course defaults |
| `rfx-registration-system/admin.html` | Admin form — pre-filled course/price |
| `system-a-production/functions/index.js` | Cloud Functions — openOs JWT generation, verifyToken |
| `system-a-production/public/member.html` | Production member panel |
| `system-a-production/public/index.html` | Redirects to member.html |

---

*This matrix is a factual audit of System A's current enforcement. It does not invent, propose, or recommend commercial entitlements. The Founder determines what each programme tier provides. Lee implements the enforcement when authorised.*

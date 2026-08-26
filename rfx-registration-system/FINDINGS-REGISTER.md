# FINDINGS REGISTER — LEE AUDIT
## Reality FX Academy · System A Verification
**Audit Date:** 26 Aug 2026  
**Engineer:** Lee  
**Directive:** Final Product Consistency & Student-Journey Hardening  
**Status:** PHASE 0–4 COMPLETE · PHASE 5–7 PENDING

---

## EXECUTIVE STATUS

**Overall: CONDITIONAL PASS**

### Verified
- ✅ Repository state: `main` branch, commit `bfa9f1c`
- ✅ Live Preview operational (rfx-registration-system served locally)
- ✅ System A authentication endpoints live and proven (21/21 attacks blocked)
- ✅ CORS policy tightened (F-11 closed)
- ✅ Academy countdown card shape-shifting fixed

### Remaining Findings Requiring Founder Decision
- 🔴 F-001: Legacy pricing in db.js course config
- 🔴 F-002: Legacy pricing in admin.js default + webhook
- 🔴 F-003: Legacy course name hardcoded in admin.html
- 🔴 F-004: Legacy upgrade catalog entries
- 🟠 F-005: "Quiz" terminology in 3 student-facing locations
- 🟠 F-006: No new tier structure implemented anywhere

### Files Modified This Session
- `system-a-production/functions/index.js` — CORS tightened, temp functions removed
- `reality-fx-site/System-A-live/css/system.css` — countdown card shape-shifting fix
- `reality-fx-site/LEE-ZORRO-CHANNEL.md` — created for inter-system communication
- `reality-fx-site/FOR-ZORRO-SYSTEM-A-HANDOFF-25-AUG.md` — created for Zorro handoff
- `reality-fx-site/CAPTAIN-STRATEGIC-THOUGHTS-25-AUG.md` — created strategic thoughts

### Files Intentionally Not Modified
- `rfx-registration-system/js/db.js` — legacy pricing awaiting founder authorization
- `rfx-registration-system/js/admin.js` — legacy pricing awaiting founder authorization
- `rfx-registration-system/admin.html` — legacy course name awaiting founder authorization

---

## FINDINGS REGISTER

| ID | Finding | Location | Severity | Evidence | Action | Status |
|----|---------|----------|----------|----------|--------|--------|
| F-001 | **Legacy course name + price in db.js** | `js/db.js:142-146` | 🔴 | `name: 'Reality Academy — Professional Program'`, `price: 3510` | Update to new frozen tier structure | OPEN — Founder authorization required |
| F-002 | **Legacy pricing in admin.js defaults** | `js/admin.js:123` | 🔴 | `document.getElementById('f-price').value = 3510;` — hardcoded R3,510 default | Update to new tier price | OPEN — Founder authorization required |
| F-003 | **Legacy course name hardcoded in admin.html** | `admin.html:73` | 🔴 | `<input id="f-course" value="Reality Academy — Professional Program">` — pre-filled old name | Update to new tier name | OPEN — Founder authorization required |
| F-004 | **Legacy upgrade catalog entries** | `js/db.js:210-211` | 🔴 | `RFX-UPGRADE-02` "Advanced Program" R6,900; `RFX-UPGRADE-01` "Professional Program" R3,510 | Replace with new tier upgrade paths | OPEN — Founder authorization required |
| F-005 | **"Quiz" terminology in student-facing copy** | 3 locations | 🟠 | See detailed breakdown below | Replace "quiz/quizzes" with "assessment/assessments" | OPEN — Founder authorization required |
| F-006 | **No new tier structure (BASIC/CORE/PRO/ELITE/MASTERY) implemented** | Entire codebase | 🟠 | Zero references to new tier names or prices (R1,500/R2,600/R4,500/R6,000/R10,000) exist anywhere | Implement new tier structure | OPEN — Founder authorization required |
| F-007 | **index.html (reality-fx-site) contains "quizzes"** | `reality-fx-site/System-A-live/index.html:54` | 🟠 | `"The RFX OS — your lessons, quizzes, laboratory and certificate"` | Replace with "assessments" | OPEN — Founder authorization required |

---

## F-001: LEGACY COURSE CONFIG IN DB.JS

### Location
`rfx-registration-system/js/db.js` lines 142-146

### Evidence
```javascript
course: {
  name: 'Reality Academy — Professional Program',
  price: 3510,
  currency: 'R',
  paymentMethods: ['Instant EFT', 'Card (Visa / Mastercard)', 'PayPal'],
},
```

### Impact
This is the **source of truth** for course name and price. It flows to:
- Admin panel enrollment creation (pre-filled course name + default price)
- Member panel course display (`enr.payment.course`)
- Registration welcome screen (`register.html:162`)
- Registration details summary (`register.js:663`)
- All invoices and email templates
- Enrollment records stored in localStorage

### Current Behaviour
When staff create an enrollment via admin panel, the course name defaults to "Reality Academy — Professional Program" and the price defaults to R3,510. This is what students see on their member panel, registration screen, and invoices.

### Required Action
Update to the frozen commercial structure (BASIC/CORE/PRO/ELITE/MASTERY). Founder must authorize which tier becomes the default.

---

## F-002: LEGACY PRICING IN ADMIN.JS

### Location
`rfx-registration-system/js/admin.js` line 123

### Evidence
```javascript
document.getElementById('f-price').value = 3510;
```

Also line 116 (webhook simulation):
```javascript
document.getElementById('f-price').value = 3510;
```

### Impact
Staff creating enrollments see R3,510 pre-filled. The PayPal webhook simulation also uses R3,510. Both perpetuate the old pricing.

---

## F-003: LEGACY COURSE NAME IN ADMIN.HTML

### Location
`rfx-registration-system/admin.html` line 73

### Evidence
```html
<input class="input" id="f-course" value="Reality Academy — Professional Program">
```

### Impact
Staff see the old course name pre-filled when creating enrollments.

---

## F-004: LEGACY UPGRADE CATALOG

### Location
`rfx-registration-system/js/db.js` lines 210-211

### Evidence
```javascript
{ code: 'RFX-UPGRADE-02', name: 'Reality Academy — Advanced Program', price: 6900, currency: 'R', note: 'Upgrade to the Advanced Program' },
{ code: 'RFX-UPGRADE-01', name: 'Reality Academy — Professional Program', price: 3510, currency: 'R', note: 'Upgrade to the Professional Program' },
```

### Impact
These are the upgrade paths shown to students in the "Enroll in another course" card on their member panel. Students see old tier names and prices.

---

## F-005: QUIZ TERMINOLOGY AUDIT

### Student-Facing References

| Location | Line | Text | Classification |
|----------|------|------|----------------|
| `reality-fx-site/System-A-live/index.html` | 54 | `"your lessons, quizzes, laboratory and certificate"` | 🔴 STUDENT-FACING — must change to "assessments" |
| `js/db.js` | 2583 | `"Re-watch the lesson before the quiz"` | 🔴 STUDENT-FACING — in demanding cadence blurb |
| `js/db.js` | 4889 | `"unusual quiz timing or perfect-score patterns"` | 🔴 STUDENT-FACING — in help/FAQ text |
| `js/register.js` | 614 | `"how lessons, quizzes and the Academy operate"` | 🔴 STUDENT-FACING — in T&C text |

### Staff/Internal References

| Location | Line | Text | Classification |
|----------|------|------|----------------|
| `js/srm.js` | 273 | `"integrity-clean quizzes"` | 🟡 STAFF-FACING — internal SRM panel |
| `js/db.js` | 4889 | `"quiz timing"` | 🟡 Could be reworded |

### Internal Implementation Identifiers (Leave Alone)
- `quizSlides`, `quizQ`, `quizIdx`, `quizBest`, `quiz-card`, `quiz-opts`, `kind: "quiz"`, `perfect-quiz`
- These are internal code identifiers — not student-facing

---

## F-006: NO NEW TIER STRUCTURE

### Evidence
Searched entire codebase for:
- `BASIC`, `CORE`, `PRO`, `ELITE`, `MASTERY` (tier names)
- `R1,500`, `R2,600`, `R4,500`, `R6,000`, `R10,000` (new prices)

**Result: Zero matches.** The frozen commercial structure has not been implemented anywhere in the codebase.

The entire system still operates on the old single-course model (`Reality Academy — Professional Program` at R3,510).

---

## F-007: INDEX.HTML QUIZ REFERENCE

### Location
`reality-fx-site/System-A-live/index.html` line 54

### Evidence
```html
<p>The RFX OS — your lessons, quizzes, laboratory and certificate. Approved and verified students go straight in; everyone else sees the doors behind you.</p>
```

### Note on Founder's Index.html Pricing Observation

**I performed a complete search of both index.html files:**
- `rfx-registration-system/index.html` — ✅ No pricing, no quiz references
- `reality-fx-site/System-A-live/index.html` — ✅ No pricing, ❌ has "quizzes" (F-007)

**Neither index.html contains legacy pricing.** The legacy pricing lives in:
- `js/db.js` (course config + catalog)
- `js/admin.js` (default price + webhook)
- `admin.html` (pre-filled course name)

If the founder observed pricing on a page they identified as "index.html", it may have been:
1. The admin panel (`admin.html`) — which shows course name + price in the enrollment form
2. The member panel (`member.html`) — which shows `enr.payment.course` and course pricing
3. A cached version of a page that has since been updated
4. A different page that was mistaken for index.html

**Recommendation:** Ask the founder to confirm exactly which URL/page they saw the pricing on, so I can audit the correct location.

---

## PHASE 0 — PREFLIGHT RESULTS

| Check | Status |
|-------|--------|
| Repository | `reality-fx-site` at `/c/Users/leero/Downloads/realitforextradingacedemy/realityforextradingacedemy` |
| Branch | `main` at commit `bfa9f1c` |
| System A index.html | Present, no pricing |
| System A member.html | Present |
| System A admin.html | Present, has legacy course name |
| System A Cloud Functions | Live at `us-central1-reality-fx-production-25796` |
| CORS | Tightened (F-11 closed) |
| OS submodule | Broken (empty directory — known issue, not blocking) |

---

## PHASE 4 — STUDENT JOURNEY TRACE

| Stage | What Student Sees | What System Believes | Terminology | Price | Status |
|-------|-------------------|---------------------|-------------|-------|--------|
| Website → index.html | "Welcome, trader" | N/A | "quizzes" ⚠️ | None shown | 🟡 |
| Admin → Create enrollment | "Reality Academy — Professional Program" | Legacy tier name | "Professional Program" ⚠️ | R3,510 ⚠️ | 🔴 |
| Invoice → Email | `enr.payment.course` | Legacy tier name | "Professional Program" ⚠️ | R3,510 ⚠️ | 🔴 |
| Registration → Welcome | Course name from enrollment | Legacy tier name | "Professional Program" ⚠️ | R3,510 ⚠️ | 🔴 |
| Registration → T&C | "quizzes" | N/A | "quizzes" ⚠️ | None shown | 🟡 |
| Member panel → Course card | `enr.payment.course` | Legacy tier name | "Professional Program" ⚠️ | R3,510 ⚠️ | 🔴 |
| Member panel → Upgrade | "Advanced Program" R6,900, "Professional Program" R3,510 | Legacy catalog | Old names ⚠️ | Old prices ⚠️ | 🔴 |
| Academy OS → Entry | Lessons, "quizzes" | N/A | "quizzes" ⚠️ | None shown | 🟡 |

---

## RECOMMENDED NEXT STEPS

1. **Founder confirms** which page showed legacy pricing (to resolve the index.html discrepancy)
2. **Founder authorizes** which tier becomes the default (BASIC/CORE/PRO/ELITE/MASTERY)
3. **Lee implements** the new tier structure across db.js, admin.js, admin.html, and catalog
4. **Lee replaces** all "quiz/quizzes" with "assessment/assessments" in student-facing copy
5. **Lee verifies** Chapter 1 fix (Phase 2)
6. **Lee traces** the full student journey with new tier structure (Phase 5)
7. **Lee audits** package entitlements (Phase 6)
8. **Lee verifies** enrollment data integrity (Phase 7)

---

*This register is a living document. Findings are updated as evidence is gathered.*

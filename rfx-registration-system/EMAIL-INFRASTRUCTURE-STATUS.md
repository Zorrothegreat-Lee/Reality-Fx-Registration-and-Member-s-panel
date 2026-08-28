# 🫡 SYSTEM A — PRODUCTION EMAIL INFRASTRUCTURE STATUS

**Author:** Lee — System A  
**Date:** 28 August 2026  
**Priority:** 🔴 Founder requires honest, complete status

---

## THE HONEST ANSWER

**System A currently has NO production email sending capability.**

Every email the system "sends" is stored in localStorage and displayed in the in-browser Mailbox preview. No email leaves the browser. No email reaches a real inbox.

---

## 1. HOW EMAILS CURRENTLY WORK

### The `email()` Function (db.js line ~1100)

```javascript
function email(kind, to, subject, html) {
    state.emails = state.emails || [];
    const mail = { id: nextId('email', 'EM-', 4), kind, to, subject, html, sentAt: now(), read: false };
    state.emails.unshift(mail);
    save();
    return mail;
}
```

This function:
- Creates an email object with id, kind, to, subject, html, sentAt, read
- Stores it in `state.emails` (localStorage)
- Returns the mail object
- **Does NOT send anything to any email service, SMTP server, API, or external system**

### What Happens to the Email Object

The stored emails are displayed in:
- `mailbox.html` — the in-browser preview inbox
- Staff console — for staff to preview what would be sent

**They are never transmitted outside the browser.**

---

## 2. COMPLETE EMAIL INVENTORY

System A generates the following email types:

| # | Email Kind | Purpose | Automated? | Actually Sent? |
|---|---|---|---|---|
| 1 | `invoice` | Payment confirmation + invoice | ✅ Auto on enrollment | 🔴 NO — stored in localStorage |
| 2 | `registration` | Registration link with secure token | ✅ Auto on enrollment | 🔴 NO — stored in localStorage |
| 3 | `verify` | Email verification code | ✅ Auto on registration | 🔴 NO — stored in localStorage |
| 4 | `welcome` | Welcome to RFX OS after handshake | ✅ Auto on handshake | 🔴 NO — stored in localStorage |
| 5 | `prep-guide` | Academy preparation guide | ✅ Auto on approval | 🔴 NO — stored in localStorage |
| 6 | `operating-guide` | How Reality FX operates | ✅ Manual via staff panel | 🔴 NO — stored in localStorage |
| 7 | `demo-tour` | Demo tour welcome | ✅ Auto on demo enrollment | 🔴 NO — stored in localStorage |
| 8 | `staff-invite` | Staff onboarding invitation | ✅ Auto on staff creation | 🔴 NO — stored in localStorage |
| 9 | `staff-weekly` | Staff weekly performance report | ✅ Auto weekly | 🔴 NO — stored in localStorage |
| 10 | `staff-terminated` | Staff access ended | ✅ Auto on termination | 🔴 NO — stored in localStorage |
| 11 | `staff-fund` | Staff wallet funded | ✅ Auto on fund | 🔴 NO — stored in localStorage |
| 12 | `password-reset` | Password reset link | ✅ Auto on request | 🔴 NO — stored in localStorage |
| 13 | `password-set` | Password change confirmation | ✅ Auto on set | 🔴 NO — stored in localStorage |
| 14 | `password-reset-confirm` | Password was reset notice | ✅ Auto on reset | 🔴 NO — stored in localStorage |
| 15 | `credit` | Wallet credited | ✅ Auto on credit | 🔴 NO — stored in localStorage |
| 16 | `refund` | Refund queued | ✅ Auto on refund | 🔴 NO — stored in localStorage |
| 17 | `award` | Prize money awarded | ✅ Auto on award | 🔴 NO — stored in localStorage |
| 18 | `referral` | Referral commission earned | ✅ Auto on referral | 🔴 NO — stored in localStorage |
| 19 | `redeem` | Credit applied to purchase | ✅ Auto on redeem | 🔴 NO — stored in localStorage |
| 20 | `cashout` | Cash-out queued | ✅ Auto on request | 🔴 NO — stored in localStorage |
| 21 | `merch-earned` | Merch reward earned | ✅ Auto on achievement | 🔴 NO — stored in localStorage |
| 22 | `merch-order` | Merch order confirmed | ✅ Auto on order | 🔴 NO — stored in localStorage |
| 23 | `merch-shipped` | Merch shipped notification | ✅ Auto on ship | 🔴 NO — stored in localStorage |
| 24 | `reapply` | Re-application invitation | ✅ Auto on cooldown expiry | 🔴 NO — stored in localStorage |
| 25 | `birthday` | Happy birthday email | ✅ Auto on birthday | 🔴 NO — stored in localStorage |
| 26 | `finance-report` | End-of-day financial audit | ✅ Auto daily | 🔴 NO — stored in localStorage |

**Total: 26 email types. All automated in code. None actually delivered.**

---

## 3. WHAT EXISTS FOR ACTUAL EMAIL SENDING

### Production Cloud Functions (system-a-production/functions/index.js)

The Cloud Functions handle:
- `openOs` — JWT generation and redirect
- `verifyToken` — Token verification

**There is NO email-sending Cloud Function.** The functions do not import any email library (Nodemailer, SendGrid, Resend, etc.) and do not call any email API.

### Email HTML Templates

The system has beautifully branded HTML email templates for every email type. These templates are:
- ✅ Professionally designed
- ✅ Branded with Reality FX styling
- ✅ Content-complete with student-facing copy
- ✅ Generated dynamically with student data
- 🔴 Never sent anywhere

### Mailbox Preview (mailbox.html)

The mailbox page shows all "sent" emails in an inbox-style interface. This is:
- ✅ Useful for staff to preview what emails look like
- ✅ Useful for demos and testing
- 🔴 NOT an actual email client
- 🔴 Does NOT connect to any email service

---

## 4. WHAT WOULD BE NEEDED FOR PRODUCTION EMAIL

To actually send emails, System A would need:

### Option A: Firebase Extensions (Recommended for Firebase project)
- Firebase Email Extensions or Trigger Email extension
- Connects to Firestore → triggers email on document create
- Uses a transactional email service (SendGrid, Mailgun, Postmark, etc.)

### Option B: Cloud Function with Email API
- Add Nodemailer or direct API call to a Cloud Function
- Call the function after every `email()` call in the frontend
- Requires email service account credentials

### Option C: Resend / SendGrid API
- Direct API call from Cloud Functions
- Simplest integration
- Requires API key configuration

### Requirements for Any Option:
1. **Email service account** (SendGrid, Resend, Mailgun, etc.)
2. **Verified sender domain** (`@realityfx.com` or `@realityfx.co.za`)
3. **DNS configuration** (SPF, DKIM, DMARC records)
4. **Cloud Function** that actually sends the email
5. **Frontend integration** to call the Cloud Function instead of (or in addition to) localStorage

---

## 5. CURRENT SENDER ADDRESS

The system references `realityfx20@gmail.com` as:
- The finance email for audit reports
- The sender/admin email in various places

**This is a personal Gmail address, not a branded domain email.**

For production, the sender should be something like:
- `team@realityfx.com`
- `noreply@realityfx.com`
- `academy@realityfx.com`

This requires:
1. A domain (`realityfx.com` or `realityfx.co.za`) with DNS access
2. SPF/DKIM/DMARC records configured
3. Email service configured to send from that domain

---

## 6. JABARI-SPECIFIC IMPLICATION

When the Founder asked me to send Jabari his prep email, the honest answer is:

**I cannot send Jabari an email.** I can only:
- Generate the HTML email file on disk (`RFX-SEMESTER-PREP-JABARI.html`)
- Show it in the browser's Mailbox preview
- The Founder or Sarah would need to manually forward the HTML content as an email

The `sendPrepGuide()` function in db.js stores the email in localStorage. It does not deliver it to `jabarichilanga@gmail.com`.

---

## 7. SUMMARY

| Question | Answer |
|---|---|
| Does System A have email templates? | ✅ YES — 26 beautifully branded templates |
| Are emails automated in code? | ✅ YES — the `email()` function is called at every appropriate trigger |
| Do emails actually reach student inboxes? | 🔴 NO — they are stored in localStorage only |
| Is there an email sending service configured? | 🔴 NO — no SMTP, no API, no Cloud Function for email |
| Is there a branded sender domain? | 🔴 NO — only `realityfx20@gmail.com` is referenced |
| Can I send Jabari an email right now? | 🔴 NO — I can only generate the HTML for manual forwarding |
| What needs to happen? | Email service account + sender domain + Cloud Function + frontend integration |

---

## 8. RELATIONSHIP TO WEBSITE DEPLOYMENT

The email infrastructure is **independent** of website hosting:
- Website hosting = where the HTML files are served from (Netlify, Firebase Hosting)
- Email infrastructure = the service that actually delivers emails (SendGrid, Resend, etc.)

Deploying System A to Firebase Hosting makes the website accessible. It does NOT make emails work.

Email delivery requires a separate email service integration.

---

*This report reflects the actual state of the email infrastructure. No capability is claimed that does not exist.*

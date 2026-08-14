# 🔑 Founder Master Key — Account Details + Tour Expiry Explainer

> For the founder's eyes only. Created by Buffy — v35.

---

## Part 1 — Your founder account (the master key)

Your account is **RFX-10482** (ENR-0001, Leeroy Chirwa, leeroychirwa18@gmail.com) —
the record that started it all, now upgraded with the master key.

**What changed for you:**

| Feature | Before | Now |
|---|---|---|
| Identity badge | LIVE PROFILE | **FOUNDER · MASTER KEY** |
| Demo countdown | 24h draining clock | **Founder · lifetime access** (no clock) |
| Dashboard overview | student cards only | **The Master Key card** — every door in one place |
| Tour expiry | would have closed your OS door | **never applies** — the master key is exempt |

**The Master Key card** sits at the top of your member dashboard and opens every
door from any device:

- 🧑‍🤝‍🧑 **Staff console** — reception desk & shifts
- 🔍 **SRM** — every student, every record
- 🛡️ **Admin console** — enrollments, audit & finance
- 💳 **Wallet centre** — credit, payouts & wages
- 📄 **Registration desk** — the gate, as students see it
- 🔓 **RFX OS Academy** — the learning environment

**The master key opens doors — it does not bypass the machine's safety.**
You still have one active session per account, login throttling, and full audit
trails, like every identity. That's deliberate: the founder's overview is
transparent, not invisible.

**Your login stays the same:** email `leeroychirwa18@gmail.com` + Student Code
`RFX-10482` (reveal it with the eye on your identity card).

---

## Part 2 — What happens when a demo tour expires (your 21h 49m clock)

Your **current session clock shows ~21h 49m** because your account still carries
the original 24-hour demo pass. **Because you are the founder, that clock can
never cut you off** — your access is for life. But this is exactly what a
*regular* demo student experiences the moment their 24 hours run out:

### The exact second the clock hits zero

1. **The countdown bar drains to empty** — the gold life bar reaches zero, then
   the clock hides itself.
2. **The Academy door closes.** The "RFX OS access" card flips from *"Your RFX
   OS access is ready"* to a locked state:
   > **Your free tour has ended.** Your tour gave you a real look inside the
   > Academy — to keep going, enroll in a Reality FX program. Your registration
   > link below stays valid.
3. **Their approval and Student ID are permanent** — only the *free tour's
   window* ends. The record, wallet, identity and progress stay real.
4. **The registration link stays valid** — so picking up where they left off
   (enrolling for keeps) takes minutes, not a fresh application.
5. **On the OS side (Lee's system), the same second is enforced server-side:**
   the OS stores `demoTourEndsAt` from the handoff and strips tour benefits at
   that exact moment — the student is cut off mid-session if needed, sees the
   same "tour ended — enroll to continue" message, and upgrades seamlessly when
   their paid enrollment is handed over.

### Labels students see (one consistent voice)

| Stage | Label |
|---|---|
| Not approved yet | "24h academy pass" (clock hasn't started) |
| Approved, touring | "Demo tour" / "Demo session" with live countdown |
| Expired (registration page) | "Expired — request a new pass" |
| Expired (member panel) | Locked card: "Your free tour has ended…" |

### Why this matters (the honesty contract)

No dead links, no fake access, no surprises. The tour ends with a clear
explanation and a straight path forward — exactly the premium, boring, reliable
engineering Reality FX promises. If a student ever hits a wall, it says *why*,
and it tells them *what to do next*.

---

## Part 3 — For Lee (the OS-side handshake)

See **FOR-LEE.md §9.38** for the full brief. The headline: carry
`demoTourEndsAt` in the handoff, enforce it server-side at that instant, show
the same tour-ended message, and upgrade to full entitlement when the paid
enrollment arrives. Also **§9.39**: carry the founder flag to the OS if the
founder should hold the master key inside the OS too.

---

*The founder stays anonymous publicly — the learning is the point. The master
key is the one place that says otherwise, and it lives in your hands only.*

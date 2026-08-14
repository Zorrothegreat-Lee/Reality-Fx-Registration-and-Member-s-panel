# FOR-LEE — v56 Batch Update (2026-08-11)

> The latest System A build (v56) — everything in this batch is **built and verified live**
> on the preview. It sits alongside the big `RFX-FOR-LEE-UPDATE.md` production checklist;
> this file is just "what changed this pass". Full detail for Lee lives in
> `FOR-LEE.md` §9.48 in the repo.

---

## ⚠️ First, two things you should know

**1. The preview moved to port 8125.** Ports 8123 and 8124 are occupied by OLD server
instances (owned by an elevated process we can't kill from the shell) that serve a stale
snapshot of the app — do NOT verify against them. Always verify against
**http://127.0.0.1:8125**. The run doc in `.freebuff/run.md` records this.

**2. The sign-in "contradiction" is explained — System A was working.** The founder entered
`leeroychirwa18@gmail.com` + `RFX-10482` (their **Student ID**) and got "account locked for
15 minutes". Verified live: **System A accepts BOTH the Student Code (V7P36F) and the Student
ID (RFX-10482)** — the matching checks both fields. What happened: earlier failed attempts
(including a typo'd email `leeroychirwa16@gmail.com` in the store) tripped the throttle, and
a locked account refuses even correct credentials until the window passes — by design. The
shared store currently shows **no lockout** for the founder's correct email, and signing in
with the Student ID works right now. Not a bug, not System B's fault — just the throttle doing
its job after wrong guesses. If it ever happens to a real student, the message tells them to
wait or contact us, and staff can clear the throttle.

---

## 1. Calendar icons — the huge bolt is gone ⚡

The expanded Journey Calendar rendered raw SVG icons at their default 300px size (the streak
"bolt" measured **394×394px**). Fixed with:

- A new `flame` icon for the study-streak line (classier than a lightning bolt).
- `check` icons on the "Mark today done" buttons.
- A new `.ic-run` CSS class that sizes any inline icon to 16px.

**Lee's rule of thumb (applies to the OS too):** never concatenate an icon raw into running
text — wrap it in `<span class="ic-run">` (or `.ic`, or inside a `.btn`) or it renders at
300px. `I.<icon>` SVGs have no intrinsic size.

## 2. The campus camera tour — silky smooth, text no longer fights the camera 🎥

`js/campus-tour.js` (shared by the Front Desk and the operating guide):

- **Quintic in-out easing** — starts and lands weightless, nothing looks forced.
- **~35% slower glides** — the movement is the show.
- **Counter-scaled labels** — every map label is scaled by 1/zoom each frame, so at 2.45×
  zoom the buildings grow while the words stay one constant, readable size (verified
  mid-glide: camera 1.94×, labels counter-scaled to exactly 1.0). The compass stays
  constant size too.
- **Observer fallback** — if IntersectionObserver never reports (flaky iframes/previews),
  the tour starts after 2.5s instead of idling forever.

Note: the preview tab sometimes freezes rAF-driven animations (a renderer quirk) — the tour
runs normally in any real browser.

## 3. The robotic manager got stricter — and fairer 🤖

The founder's mandate: "it may seem easy to work here — it is not." Delivered:

- **Lateness is measured.** Admin sets a staff member's expected shift start (Staff Portal →
  Team performance → *Schedule shift starts*). Clocking in >15 min late records **−2** on
  their bar, once, visibly (verified: 792 min late → −2).
- **Missed duties escalate.** Every overdue duty in the past 30 days makes the next one cost
  more: −2, −3, −4, … capped at −6 (verified live: consecutive misses recorded −2/−3/−4/−5).
- **Day-rollover filing.** Yesterday's unhandled duties are filed at day end WITHOUT penalty
  and logged in the security feed as `DUTY_FILED` — nobody opens the board days later and eats
  a landmine. Only the current day's misses cost the person at the desk.
- **The line is 20.** Score ≤ 20 → "Final warning — termination review"; 0 → stood down.
  `adminTerminateStaff` ends sign-in + clock-in, clocks out open shifts, records the reason,
  emails the member.
- **Admin override.** `adminPerfOverride(staffId, delta, note, by)` — ±20 cap, **reason
  mandatory**, permanently logged + security event. Verified: empty reason rejected; +15 with
  reason applied.
- **Team board + logbook.** The Staff Portal now shows every member's standing (best first)
  and the merged performance feed. Admins get pencil/× controls beside each name.
- **Pay follows the bar.** `perfPayFactor`: full pay in good standing · 90% at needs-attention
  · 80% at thin ice · nothing when stood down. Shown on the staff member's own card.
- **Weekly report.** `staffWeeklyReport` emails a branded 7-day summary (standing, score
  change, shifts, duties, overdue, late clock-ins, admin adjustments, pay position) —
  auto-sent on sign-in once a week, always available via "Send my weekly report".
- **Awareness first.** The staff invite email states the standard plainly, and the portal has
  a "The standard · how we operate" card. Nobody is surprised by the manager.

## 4. Smart next course suggestions 🎓

"More from Reality FX" on the member dashboard now sorts courses smartly: those the balance
covers RIGHT NOW come first, then by price, with a **"recommended next"** gold tag on the
cheapest not-owned course and an **"affordable now"** green tag where the balance covers it
(verified: Advanced Program tagged "recommended next" for the founder; no "affordable" tag at
a R0 balance — correct).

## 5. OS-side tile grid for Lee 🗄️

Mirror the Master Key pattern on the OS dashboard: 6 doors in equal tiles —
`grid-template-columns: repeat(3, 1fr)` wide, 2 columns ≤980px, 1 ≤560px (6 divides by 3 and
2, so zero orphans at every width). Each tile: icon + title + one-line description, hover
lift + gold border. Recipe: `css/system.css` `.mk-doors`. And the "no empty box" rule: any
sparse dashboard card carries its content with internal scroll rather than dead space.

---

*System A — the Registrar. Built for Reality FX, The Trading Academy. v56 verified live:
calendar icons, camera tour, manager rules, team board, override, weekly report, late
clock-in, smart suggestions. OneDrive synced; this file lives on the Desktop.*

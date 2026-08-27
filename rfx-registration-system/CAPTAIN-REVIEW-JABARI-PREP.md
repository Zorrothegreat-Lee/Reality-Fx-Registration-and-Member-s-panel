# CAPTAIN REVIEW — JABARI STUDENT PREP PROCESS

**Date:** 27 August 2026
**Engineer:** Lee (System A)
**Status:** 🟡 ON HOLD — Awaiting Captain approval before any student-facing communication

---

## 1. WHAT THE FOUNDER ASKED

The founder asked Lee to prepare Jabari Chilanga (jabarichilanga@gmail.com) for his semester at Reality FX — specifically:
- A semester prep email (what to bring, identity, rules, values, key dates)
- An operating guide email (how the three rooms work end-to-end)
- Include his Student ID and Student Code

## 2. WHAT LEE DID

Lee created two branded HTML emails:
- `RFX-SEMESTER-PREP-JABARI.html` — 10-section prep guide
- `RFX-OPERATING-GUIDE-JABARI.html` — 8-section operating guide

Lee also identified and fixed a **chicken-and-egg bug** in the system's prep guide email:
- The email showed the Student ID but NOT the Student Code
- Then told students to "check your members panel" for their code
- But they need the code to log into the members panel
- **Fix:** Student Code is now displayed prominently in the email header (gold box, monospace)
- Committed as `e9079ba`, pushed to GitHub

## 3. WHAT THE FOUNDER CORRECTED (Critical)

After reviewing Lee's work, the founder identified several **major gaps** in the prep process:

### Gap 1: OS Access Timeline
- **Netlify credits restore:** 14 September 2026
- **Safe student access date:** 20 September 2026 (buffer for testing/deployment)
- **Academy opens:** 30 September 2026
- Lee's prep email did NOT mention that the OS won't be accessible until 20 September
- Students would try to access the OS immediately and get nothing

### Gap 2: Demo/Trial Student Access Limitations
- Jabari is a **demo/live student** (not a fully paid CORE/PRO/ELITE/MASTERY student)
- As a demo student, his access to rooms will be **limited**
- The prep email assumed full access to all three rooms
- Lee did NOT specify which rooms Jabari CAN access vs which he CANNOT

### Gap 3: Tier-Specific Room Access
- The system has a concept of tier-based access (BASIC/CORE/PRO/ELITE/MASTERY)
- Different tiers grant different room access
- The prep email did NOT explain what a demo student can and cannot do
- Students need to know exactly what they're paying for vs what's included

### Gap 4: Captain Approval Required
- The founder explicitly stated: **"Until Captain approves of your process, you will have to put it on hold"**
- This is real students, real people — no mistakes allowed
- Lee must present this entire process to the Captain for review before any email is sent

## 4. THE FOUNDER'S EXACT WORDS

> "And also did you specify to him that the only time that he will have access to the OS is after the credits have been restored so that he can be getting the latest version of it not the stale version??? Hence you should tell him exactly when he should utilize his access????"
>
> "The credits for the OS are restoring only on the 14th of september, which means the students access to the OS will not be available until then, in fact just to be safe and make sure that we have time to test everything to make sure deployment works well we should only give access to the student on the 20th of september."
>
> "Also given the kind of student he is (live/demo) that will affect exactly what he'll be able to access (which rooms he'll be able to get into, im sure we have established this concept a while back)."
>
> "Hence you need to make it known to the students exactly what they will have access to according to the kind of program they are on etc."
>
> "And in your prep for him it feels like you didn't prepare him fully for that hence you will need to redo the entire process."
>
> "In fact this entire conversation and process needs to be audited and approved by the Captain he hasn't given the greenlight for this text that i am sending you."
>
> "Hence you're going to need to tell him exactly what you have done, and also you need to share this exact conversation i sent to show my thought process so he's up to speed."
>
> "So until Captain approves of your process (which i'm not confident of) you will have to put it on hold, i can't afford to have any mistakes these are actual students involved now real people!"

## 5. WHAT NEEDS TO HAPPEN BEFORE SENDING ANYTHING

### A. Captain must approve:
1. The content and tone of the prep email
2. The accuracy of the access timeline (20 Sept OS access, 30 Sept Academy opens)
3. The tier-specific room access rules for demo students
4. The exact wording about what Jabari can and cannot access

### B. Lee must redo the prep email with:
1. **OS access date clearly stated:** "Your RFX OS Academy access opens on 20 September 2026"
2. **Why the delay:** "Netlify credits are restoring on 14 September. We are using the buffer to test everything thoroughly before giving you access."
3. **Demo student limitations:** What rooms Jabari CAN access (likely Student Portal only, limited OS access) vs what he CANNOT (full OS Academy features)
4. **Tier-specific entitlements:** What a demo/live student gets vs what a CORE/PRO/ELITE/MASTERY student gets
5. **Student ID + Student Code:** Both included in the email (already fixed)
6. **Academy opens date:** 30 September 2026

### C. Lee must NOT:
1. Send any email without Captain approval
2. Assume full access for a demo student
3. Skip the OS access timeline
4. Forget to mention tier-specific room access

## 6. TECHNICAL STATUS

| Item | Status |
|------|--------|
| Student Code in email | ✅ Fixed (commit e9079ba) |
| Prep email content | 🟡 Needs redo with access timeline + tier info |
| Operating guide content | 🟡 Needs redo with access timeline + tier info |
| OS access timeline | 🔴 Not yet included |
| Demo student room access | 🔴 Not yet specified |
| Captain approval | 🔴 Not yet obtained |
| Email sent to Jabari | 🔴 BLOCKED until Captain approves |

## 7. WHAT THE CAPTAIN NEEDS TO DECIDE

1. **Is the 20 September OS access date correct?** Or should it be different?
2. **What rooms can a demo student access?** Student Portal only? Limited OS? Which chapters?
3. **What is the exact tier-specific access matrix?** BASIC vs CORE vs PRO vs ELITE vs MASTERY
4. **Should the prep email include pricing/tier info?** Or just access info?
5. **Is the tone and content of the prep email appropriate for a real student?**

---

**Lee is holding all student-facing communications until the Captain reviews and approves this process.**

🫡 Lee — System A
🔒 HOLD STATUS — Captain approval required

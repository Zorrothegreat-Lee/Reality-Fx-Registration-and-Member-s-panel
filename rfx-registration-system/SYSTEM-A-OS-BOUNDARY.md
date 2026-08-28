# Reality FX — System A → OS Security Responsibility Boundary

> **The rule: neither side silently assumes the other is performing a control that belongs to it.**
>
> Created: 20 August 2026 · Founder-approved

---

## System A (The Fort) — RESPONSIBLE FOR

| Control | System A's Job | OS's Job |
|---------|---------------|----------|
| **Identity** | Creates, stores, and manages student identity | Receives verified identity from System A |
| **Credentials** | Stores password hashes; never stores plaintext | Never touches passwords |
| **Authentication** | Issues short-lived tokens; verifies signatures | Captures token from URL; validates via /api/verify-token |
| **Student ID** | Generates and assigns RFX-XXXXX IDs | Displays the ID it receives |
| **Enrolment** | Manages enrollment state (PENDING, ACTIVE, etc.) | Reads enrollment status from handoff |
| **Course status** | Tracks course completion, progress | Displays progress from handoff data |
| **Permissions** | Determines what a student can access | Enforces permissions received from System A |
| **Account status** | ACTIVE, SUSPENDED, REFUNDED | Reads status from handoff |
| **Access rights** | Gates who can enter the OS | Never independently grants access |
| **Token issuance** | Generates signed JWTs with /open-os | Never generates its own tokens |
| **Token verification** | Verifies signatures via /api/verify-token | Calls /api/verify-token; never verifies locally |
| **Replay prevention** | Tracks consumed jtis atomically | Never stores raw tokens |
| **Gate endpoint** | Answers "is this student locked out?" | Calls /api/gate before session creation |

---

## System B (The OS) — RESPONSIBLE FOR

| Control | OS's Job | System A's Job |
|---------|----------|----------------|
| **OS session** | Creates, manages, and destroys OS sessions | Never creates OS sessions |
| **Session timer** | Tracks live session duration | Never tracks OS session time |
| **Time banking** | Deposits duration into total on logout | Never modifies OS session time |
| **Activity detection** | Monitors user activity, idle states | Never monitors OS activity |
| **Session history** | Stores session records | Never stores OS session records |
| **OS interface** | Renders the Academy UI | Never renders OS pages |
| **OS-specific features** | Journal, sim, challenges, workshops | Never implements OS features |
| **Auth gate** | Calls /api/verify-token; redirects to System A if unauthenticated | Serves /api/verify-token |
| **Degraded state** | Retains session if System A temporarily unreachable | N/A — System A is either up or down |
| **Logout cleanup** | Destroys AUTH + TRUST + OS_SESSION together | Never destroys OS sessions |
| **URL scrubbing** | Removes token from URL via history.replaceState() | Never handles URL scrubbing |
| **Trust display** | Renders trust bar from verified handoff data | Provides trust data in handoff |
| **Print trust enforcement** | Enforces printTrust at the backend | Provides printTrust in handoff |

---

## The Golden Rule

```
System A says:  "This is who they are and they're allowed in."
The OS says:    "I verified that System A said so. They're in."
```

**Neither side should ever:**
- Independently authenticate a student
- Grant access without the other side's authorization
- Assume the other side performed a control it didn't
- Trust client-side data as an authentication authority

---

## Failure Modes

| If System A fails | If OS fails |
|-------------------|-------------|
| OS enters degraded state | System A is unaffected |
| Existing sessions retained per grace rules | OS sessions are OS-local |
| New authentication impossible | System A identity intact |
| Show degraded connectivity warning | Student can re-auth via System A |

**Neither failure corrupts the other side's data.**

---

*This boundary is the architectural contract. Neither side crosses it without explicit, documented reason.*

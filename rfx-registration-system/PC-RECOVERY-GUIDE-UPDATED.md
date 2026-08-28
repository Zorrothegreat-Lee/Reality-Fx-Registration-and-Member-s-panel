# 🖥️ REALITY FX — PC RECOVERY GUIDE

*How to bring the whole Reality FX machine to a new PC, and how to carry on with the assistant there.*

**Written 15 Aug 2026 · v72 of the OS. · Port-corrected 16 Aug 2026 (System A now lives on 8125 alone — 8123/8124 retired).**

---

## 1. What lives where

Reality FX is split across **two GitHub repos** + **OneDrive** (documents) + **Netlify** (production data).

| Thing | Where it lives | GitHub |
|---|---|---|
| The whole site — System A registrar, OS, deploy tools | `reality-fx-site` folder (this repo) | `github.com/realityscripts-create/reality-fx-site` |
| The OS itself (the Academy) | submodule inside this repo, `REALITY-FOREX-TRADING-` | `github.com/realityscripts-create/REALITY-FOREX-TRADING-` |
| System A twin (Lee's working fork) | `Reality-Fx-Registration-and-Member-s-panel` (gitignored here) | `github.com/Zorrothegreat-Lee/Reality-Fx-Registration-and-Member-s-panel` |
| Briefs, PDFs, letters | Desktop (OneDrive) | not in git |
| Secrets, tokens, Netlify login | `.freebuff/tools/` (gitignored — NEVER in git) | not in git |
| Live student records, sessions, device trust | Netlify blob store (`os-*.json` in production) | not in git |
| Demo/local state | `.freebuff/tools/system-a-state.json`, `os-*.json` (gitignored) | not in git |

**The one golden rule:** code lives in git. **Data and secrets never do.** So a new PC gets 100% of the machine from git + a manual copy of the secrets folder.

---

## 2. On the new PC — one-time setup (10 minutes)

```bash
# 1. Install Git for Windows (comes with bash + perl — the servers need perl)
#    https://git-scm.com/download/win

# 2. Clone the outer repo (this folder, with the OS inside it)
cd C:/Users/YourName
git clone https://github.com/realityscripts-create/reality-fx-site.git "REALITY FX TRADING/reality-fx-site"
cd "REALITY FX TRADING/reality-fx-site"

# 3. Pull the OS submodule in (the Academy lives in its own repo)
git submodule update --init --recursive

# 4. Clone the System A twin (only if you want Lee's working copy)
git clone https://github.com/Zorrothegreat-Lee/Reality-Fx-Registration-and-Member-s-panel.git

# 5. Start the demo servers (System A + OS)
bash .freebuff/tools/start-demo.sh
#    System A (Reception + Members) → http://127.0.0.1:8125/index.html
#    RFX OS                          → http://127.0.0.1:49270/os/index.html
```

**Keep the servers alive** (survives crashes, restarts any that die):

```bash
bash .freebuff/tools/watchdog.sh &
```

---

## 3. The one folder that must be copied by hand

Because secrets and live state are **never** in git, carry these across on a USB/Drive once:

- `reality-fx-site/.freebuff/tools/` — **the whole folder** (secrets.env, acct.json, tokens, state files).
- Your Desktop OneDrive already syncs the briefs and PDFs automatically — no action needed.

> If you lose `.freebuff/tools/secrets.env` / `acct.json`, the deploy account and email rails are the only things that break — the OS and System A run fine without them. They can be re-obtained from Netlify.

---

## 4. Everyday workflow on the new PC

**Pull latest before working** (grab whatever was pushed from the other machine):

```bash
cd "C:/Users/YourName/REALITY FX TRADING/reality-fx-site"
git pull --recurse-submodules
git -C REALITY-FOREX-TRADING- pull
```

**After the assistant makes changes** it commits and pushes both repos itself —
you only ever need `git pull` on the other machine to catch up.

**To check everything is healthy** (the machine audits itself — one command, ~30 seconds):

```bash
perl audit-regression.pl
```

**To deploy to the live site** (when the Netlify credit gate is open):

```bash
bash deploy-live.sh
```

---

## 5. Switching PCs mid-project — exactly what to do

1. On the **old** PC: `git push` everything (the assistant can do this) + copy `.freebuff/tools/` to a USB/Drive.
2. On the **new** PC: follow section 2, then drop the copied `.freebuff/tools/` folder over the fresh one.
3. Run `bash .freebuff/tools/start-demo.sh` and verify both ports answer (8125 System A, 49270 OS).
4. Open the OS, log in as a test student, run `perl audit-regression.pl` — if it's ALL GREEN, you're home.

---

## 6. Where to get help when you're stuck

- **GitHub account**: sign in on the new PC once (a login window pops on first push) — or use a **personal access token** with `repo` scope as the password.
- **Never paste passwords/tokens into the chat** — a conversation log is not a vault. The assistant will never ask you for them.
- **The machine audit** explains every check in plain language. Run it first, always.

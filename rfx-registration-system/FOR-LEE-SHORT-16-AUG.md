# FOR-LEE — two quick ones (16 Aug)

Hey Lee — two corrections from today's sweep, both on your side to act on:

**1. The APK delivery email's fingerprint is all zeros.**
`RFX-APK-DELIVERY-EMAIL.html` ships with `SHA-256: 0000…0000` — that must never
reach a student. On the machine holding the real `RFX-OS-Android.apk`, run:

```bash
bash fill-apk-fingerprint.sh /path/to/RFX-OS-Android.apk
```

It computes the real SHA-256 and patches `RFX-APK-DELIVERY-EMAIL-READY.html`, and
refuses to finish unless exactly one real hash is in. Both files are on the Desktop.
Don't send the letter until that's done.

**2. The recovery guide still points at dead ports.**
`PC-RECOVERY-GUIDE (1).md` tells a fresh PC to start **three** demo servers and reach
System A on **8123** — but System A collapsed to a single **8125** a while ago
(8123/8124 retired). Corrected copy on the Desktop: `PC-RECOVERY-GUIDE-UPDATED.md`
(two servers: System A 8125 + OS 49270). Use that one on any new machine.

**Bonus — the achievement demo rail is now real.** `POST /api/achievement` is live
on System A's demo fork (8125): idempotent by reference, threshold 80,
below-threshold refused, unknown student refused, and it mints the merch order +
mailbox email + audit + security event through the shared store. The OS demo can now
POST for real instead of faking it. Production still swaps to your Cloud Function
per §6b.

Full notes in FOR-LEE §15–16. Cheers.

# Data clearing after an accepted trade-in

User request (2026-10-16): *"And also data cleared tool once accepted."*

## Rules

1. **Only after acceptance.** Available only when the case is `locked` (the customer accepted the
   trade-in and the checks were done) or later. Never from the QR, a test result or anything the
   customer taps before acceptance. (Architecture note: erasure is a separately authorised task.)
2. **Separately authorised.** Staff press **Clear customer data** on the case (store app or desk).
   Recorded: who, when, case, device (model, IMEI 1/2).
3. **Honest about what it is.** A factory reset, labelled **"Factory reset record — not a certified
   erasure"**. Certified erasure (Phonecheck / Blancco, NIST 800-88) is a provider seam for later.
4. **Evidence before the app disappears.** The phone reports `started` (method, device, time) to
   the server BEFORE it resets — the reset deletes SwapUp Check with everything else.
5. **Completion is observed, not assumed.** The store confirms the phone shows the Welcome / setup
   screen (optional photo). Until then the record says "started, not confirmed".

## States (server, per case)

`none → authorized → started → confirmed` (+ `abandoned` with a reason).
Pickup lists show "Data cleared ✓ / not yet"; handing over an uncleared phone warns the manager
(default: warn, not block — a programme setting can make it a block).

## On the customer's phone (SwapUp Check, native)

The app (still joined to the session) sees `erasure: authorized` in its status poll and shows
**Clearing your data**:

1. Sign out of the Samsung account and the Google account → buttons open the Accounts settings
   (`android.settings.SYNC_SETTINGS`). Apps cannot read other apps' accounts on Android 8+, so this is
   a guided step; the advisor already attested "accounts signed out" at lock.
2. Remove the SIM and memory card (physical).
3. Factory reset:
   - **Device-admin path** — SwapUp Check asks the system to activate it as a device admin
     (one system prompt) and calls `DevicePolicyManager.wipeData(WIPE_EXTERNAL_STORAGE)`. Needs a
     small local Expo native module (Kotlin) + a config plugin adding the `DeviceAdminReceiver` and
     `device_admin.xml` with `<wipe-data/>`. Where Android refuses (newer versions restrict wiping
     the main user to device-owner apps → `SecurityException`), fall through to:
   - **Guided path** — open Settings and show the exact steps (Samsung: General management → Reset
     → Factory data reset; others: System → Reset options → Erase all data); the customer taps the
     final confirmation.
   - Either way, POST `started` first.

Browser version: guided steps only (a browser cannot reset a phone).

## On the store (SwapUp Store + desk)

- Case / session screen: **Clear customer data** (enabled only when the case is locked or later).
- Live state: authorized → phone reports started (method) → **Confirm data cleared** (phone shows the
  setup screen; optional photo) → record shown + printable with the receipt.
- Pickup list column "Data cleared".

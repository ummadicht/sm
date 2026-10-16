# Data clearing after an accepted trade-in

User request (2026-10-16): *"And also data cleared tool once accepted."*

## What it is (as built)

The **customer clears their own phone from its own Settings**, at the counter, after accepting
the trade-in. The store records what it saw. Nothing in SwapUp resets a phone, and staff never
handle the customer's passwords.

Always labelled: **"Factory reset by the customer, seen by the store — not a certified erasure."**
Certified erasure (Phonecheck / Blancco, NIST 800-88) stays a separate provider seam for later.

## Server (swapup repo)

- Migration 6: `cases.data_clear` (JSON). Domain rules in `lib/domain/dataClear.ts` (+ tests).
- `POST /api/cases/:id/action {action:"data_clear", steps:{accountsSignedOut, resetDone, setupScreenSeen, noPreviousAccount}, note?}`
  - store staff only (advisor / store manager), only while the case is `locked` or `in_pickup`, once;
    every step must be a real `true` (400 lists what is missing; 409 if already recorded or wrong state).
- `CaseView.dataClear` (the record) and `CaseView.dataClearState`:
  `done` · `attested` (older cases: the reset was ticked at hand-over before this step existed) ·
  `due` · `not_applicable`. Also on every `CaseListItem` as `dataClear`.
- **Hand-over (lock) no longer asks for "factory reset" and "accounts signed out"** — those moved here,
  after acceptance. Ownership, SIM removed, IMEI match, finance lock and KYM stay at lock.
- Desk: a **"Clear the customer's data"** card at the top of an accepted case (Samsung + other-phone
  read-out steps, four ticks, optional note), a timeline entry, a receipt line, and warnings on the
  store's waiting list, the book-pickup form and the pickup page. **Warn, not block.**
- SwapUp Store reaches it through the case hand-off (the desk case page in the in-app web view).

## Customer's phone (SwapUp Check)

`src/check/ClearDataGuide.tsx` on the Done screen (native and browser) and the "store has your
results" screen:

- Before the store has applied the results: *"Don't reset it yet — the advisor still needs these results."*
- After: **"Trading it in? Clear your phone"** — back up → sign out of Samsung + Google → factory
  reset → show the advisor the Welcome screen. On Android two buttons open **Accounts**
  (`android.settings.SYNC_SETTINGS`) and **Settings** via `Linking.sendIntent` (no new native module).
  The reset also removes SwapUp Check — expected; the results are already on the case.

## Not done

- No photo of the setup screen yet (the record is the four observed ticks + note).
- No certified-erasure provider.

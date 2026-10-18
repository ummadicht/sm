# SwapUp mobile — SwapUp Store + SwapUp Check

One Expo (SDK 57) codebase, two Android apps:

| App | Package | Who | What it does |
|---|---|---|---|
| **SwapUp Store** | `com.swapup.store` | store staff | Sign in with the SwapUp store login — or, on a **store tablet** a manager set up in Settings, tap your name on "Who's serving?" and type your 4-digit PIN (`~/projects/swapup/docs/STORE-TABLET.md`) — start a customer trade-in **by mobile number**, show the **Wi‑Fi QR** and the **test QR**, **scan the customer's phone** with the tablet's camera (one pass: GradeIQ photographs it and sweeps its screen; **check the phone** inside that step, by name, only when the camera couldn't decide) — and the answer opens **by itself**: refurb quote against trade-in + bonus, with the SwapUp grade. Swap up: one "Take the trade-in" screen |
| **SwapUp Check** | `com.swapup.check` | the customer | Installed from the test QR's download page (or run in the browser). It asks the customer **nothing about the phone**: it tests the phone **by itself** — two physical actions only (swipe the grid, plug in the charger) — streams every result to the store, shows the patterns the store's camera asks for, and the test colours while the advisor checks the screen |

SwapUp is built on **GradeIQ** (`~/projects/gradeiq`) underneath: the SwapUp server gives every test
session a GradeIQ session, and GradeIQ's AI vision grades the glass, body and LCD from photos the
**store device** takes. The phone's own hardware tests stay SwapUp's (see below).

Server contract: `~/projects/swapup/docs/MOBILE-API.md` (§4 photo check, §8 camera grading).
GradeIQ integration: `~/projects/swapup/docs/GRADEIQ-INTEGRATION.md`. The automatic native run:
[`docs/AUTO-TESTS.md`](docs/AUTO-TESTS.md).

## How a customer gets connected — one flow, reduced

Owner, 2026-10-17: *"Reduce the flow"* — the fewest steps that keep the law, the money and safety
(`src/store/flow.ts` holds the store side's rules, tested). The customer is never asked about
condition — the camera tests it; when the camera can't decide, the advisor certifies it in SwapUp
Store with one tap per row, by name, while the customer's phone shows the colours.

**SwapUp Store — 5 steps:**

1. **New trade-in — mobile number first.** At 10 digits SwapUp Store asks
   `GET /api/customers?phone=` (`src/store/customers.ts`): a returning customer's name fills in;
   otherwise a name field. Both optional.
2. **Connect the customer's phone.** The **Wi‑Fi QR** (the store's router, saved once by the
   manager) and the **test QR** (`https://<server>/j/<CODE>`: download SwapUp Check, or "Test in this
   browser"; the deep link `swapupcheck://join?code=…&server=…`; the 6-character code).
3. **One camera pass.** The phone shows a QR of GradeIQ's camera link; the tablet's camera app opens
   it (or **Take photos** opens the same page in Chrome on the tablet). The camera page photographs
   the phone and runs the **screen sweep** in one go while the phone shows white, black, stripes and
   colours on request (`GET`/`POST /api/device/screen`, echoed two frames after each colour lands,
   re-sent after 600 ms, 350 ms polls once the camera is there). The phone **waits for the camera** —
   no skip for the customer; **Continue without camera** (by name) lets it go on, and a camera page
   that never connects in 5 minutes lets it go on by itself. Once the camera page is connected the
   phone shows no scan code (the front-glass photo must never carry it). Where the camera
   couldn't decide, **Check the phone** (`src/store/screens/CertifyCard.tsx`, rows from the server's
   `certify`) opens **inside this step**: Body (Like new · Scuffs · Dents · Back cracked · Bent) and
   the Liquid indicator (Clean · Tripped · Can't see) at once, Screen (OK · Scratches · Lines or spots
   · Cracked) once the phone's tests are done and it loops the test colours by itself — its chips
   wait while the phone is still testing (`GET /api/device/status` says `colours`;
   `src/check/ResultColours.tsx`). Each tap goes on the case with the advisor's name and time
   (`POST /api/cases/<id>/action {action: "certify"}`); on the answer the tapped card stays one tap
   away — "Checked by Asha · change" — until the trade-in is taken. An older
   SwapUp Check (tests first) gets the same single pass after its tests.
4. **The answer — by itself.** No "Apply to case": once the phone's tests and the camera grade are
   in (and those taps), the server puts the results on the case (`session.autoApply`, swapup
   `lib/domain/autoApply.ts` — Apply's own gates still decide) and the Session screen opens the
   answer. If Apply refuses: its one-line reason and **Retry**; a phone that stopped mid-test can
   still go on with **Apply partial results**. The answer: the refurb quote against the trade-in
   + bonus, with the **SwapUp grade** line (Superb / Good / Fair / Best Value and its letter A–D, as
   the server writes it). Under the trade-in, the server's one line for how it was reached — e.g.
   "Refurbished market price ₹51,399 (Good) − 2% − 2 defects · PriceIQ 2026-W35, 52 days old" —
   and a closed **Show details** with each deduction's % and rupees (see **Prices** below). The
   **grade report** is one tap away ("View report", or "Show to customer" as a QR).
   **Repair** or **Walked away** end the visit here.
5. **Swap up → Take the trade-in**, one screen (`src/store/lock.ts`): the IMEI only if the case has
   none, the customer's name and mobile prefilled, the ID type and last 4, the government IMEI check
   (KYM), and ONE hand-over confirm — **"Owner confirmed · SIM out · IMEI matches · no EMI/lock"** —
   which still sends the server all four flags. No money on it: the answer showed it.

**SwapUp Check — 3 steps: Scan → Test → Done.** "Is this your phone?" only when the store's model
match isn't exact (a regional version — one tap; an unknown phone picks it from the list), the storage
only when the phone couldn't measure it, the battery-health screenshot only when the store has no
other reading of it (an attached Phonecheck report) — and it can be skipped. No IMEI, no name or
mobile, no condition questions. Results are saved on the phone first and sent second.

## Prices

Every price comes from the SwapUp server, which gets it from **PriceIQ** (the live refurbished-market
price by grade), the **partner's uploaded rate card**, or a **quote staff type in** — never from the
apps, and never made up. The apps print the server's figures and words and add only these:

- **Store margin › Sell** (`src/store/buySell.ts`): "Refurbished market price ₹53,499 (Superb) − 2% ·
  PriceIQ 2026-W35" — the market price less the store's markdown (5% up to ₹15k, 4% to ₹30k, 3% to
  ₹50k, 2% above), PriceIQ's data week, and " · none at Superb" when a lower grade had to be used.
  Data **over 14 days old** shows its age once: the server's own sentence under the price
  ("Refurbished market price, week 2026-W35, 52 days old." — or "PriceIQ unreachable, last answer …"
  while it uses its last good answer), else ", 52 days old" on the line. Data **over 90 days old is no
  price**. The answer's trade-in line and note are the server's words, printed as sent.
- **No price from anywhere**: "No market price yet — enter a quote." (the partner's or a typed quote).
- **Test programme** (the server's `org.demo`): one short banner, "Test programme — no real money".

Older servers keep working: fields they don't send (`ageDays`, `stale`, `note`) are simply absent,
and flags they send that newer ones dropped (a storage chip's old marker) are ignored. A
figure an older server marks as off its placeholder card is never used as the sell price.
`src/shared/copy.test.ts` reads the whole repo: no made-up-price wording, and the buyback partner is
never named — not in a screen, comment, identifier, test, doc or file name.

## Screen words

Owner, 2026-10-17: *"reduce the words"*. On every screen, staff and customer: one headline (≤ 6
words), at most one short sentence under it (≤ 15 words), buttons and labels 1–3 words, numbers
carry the meaning. Explanations and caveats go behind **Show details ›** (`Details` in
`src/store/ui.tsx`, closed by default) or the round **?** — or go. Kept, but short: the KYM/IMEI
register check, the hand-over confirm, "Do not take it", the data-clear steps. No partner brand
anywhere. `src/shared/words.test.ts` guards the sentences the apps write themselves; the server's
strings are shortened at their source.

## GradeIQ underneath

- **Server to server only.** The SwapUp server creates and talks to the GradeIQ session; the
  customer's phone only ever sees `/api/device/screen` (a proxy) and never the GradeIQ id. The camera
  URL — the only key to that session — goes to staff only, as a button, never a QR.
- **What GradeIQ decides:** the camera's cosmetic findings from the photos (its own Premium/A–D
  letter stays out of the app, so it never meets the SwapUp grade's A–D), and the LCD check from
  the screen sweep. Nothing from the camera is **ever priced**. Only
  camera-*confirmed* damage (≥ 70 %, corroborated, boxed) from a *final* grade is added to the case
  at Apply; the LCD sweep counts on its own when it fails at ≥ 70 %. Weaker sightings are flags.
- **What SwapUp decides:** the hardware tests and the verdict (`summary.verdict`). Every result batch
  is forwarded to GradeIQ in full (`merge:true`), so GradeIQ's report matches.
- **No invented grades:** camera grading off, failed (e.g. its AI out of credit) or never
  photographed = "Not camera-graded", and the advisor certifies the condition on **Check the phone**.

## Develop

```bash
npm install
APP_VARIANT=store npx expo start     # or APP_VARIANT=check
npx tsc --noEmit
node --test --experimental-strip-types --no-warnings src/diagnostics/auto/*.test.ts src/store/*.test.ts src/check/*.test.ts src/shared/*.test.ts
# verdict maths, pairing + the result screen's colours, plan, touch · store: the reduced flow (the
# answer by itself, the card in the camera step), PIN rules, Check the phone, the one hand-over
# confirm, find by mobile · check: engine, report, "Is this your phone?" · no partner name anywhere,
# one short sentence per line
```

Where the native run lives: `src/diagnostics/auto/` — pure logic with no app imports
(`analysis.ts` thresholds and verdicts, `pairing.ts`, `plan.ts`, `touch.ts`, `tone.ts`, tested with
`node --test`) and the on-phone parts (`steps.ts`, `audio.ts`, `camera.tsx`, `AutoRunner.tsx`,
`Actions.tsx`). `src/check/NativeCheck.tsx` + `PairingScreen.tsx` are the native screens;
`NativeCheck.web.tsx` is an empty stand-in so the browser bundle never contains them. Store side:
`src/store/flow.ts` (the reduced flow: `autoApply`, where the card goes, the top line),
`src/store/grading.ts` (reads `session.grading`), `src/store/certify.ts` (reads `certify`, "Check the
phone"), `src/store/customers.ts` (find by mobile), `screens/CameraParts.tsx` (the one camera pass),
`screens/CertifyCard.tsx`, `screens/SessionParts.tsx` (the connect step),
`openCamera.ts` / `openCamera.web.ts`. Customer side: `src/check/ResultColours.tsx` (the colours on
the result screen).

## Build the APKs

```bash
bash scripts/build-apk.sh store      # → dist/swapup-store.apk + .json manifest
bash scripts/build-apk.sh check      # → dist/swapup-check.apk + .json manifest
```

Builds in a throwaway copy with the local toolchain (`~/android-toolchain`), arm64 only,
signed with the SwapUp release key in `~/.swapup-keys` (never commit it; losing it means
customers must uninstall before an update). Publish with `~/projects/swapup/deploy/deploy.sh`,
which uploads `dist/*.apk` to `/var/www/swapup-downloads` (served by Caddy at `/downloads/`).

**What ships is checked, not just the source.** `deploy.sh` uploads `dist/` and `dist-web/` exactly
as they are, so a build made before a copy change still carries the old words. Both build scripts
refuse their own output, and the deploy should refuse the lot, when a shipped file names the
buyback partner, says a price is made up or calls a programme a demo, isn't app.json's version, or
(APKs) has a manifest that doesn't describe it — or when it was built before the app's source last
changed (`src/shared/buildScan.ts`):

```bash
node --experimental-strip-types --no-warnings scripts/check-builds.ts   # everything deploy.sh uploads; exit 1 = rebuild
```

## The browser versions (same code, no install)

Both apps also run in a browser, served by the SwapUp server itself at **`/app/store/`** and
**`/app/check/`** (same origin as the API — no CORS). The join page's first option,
"Test in this browser — no install", opens `/app/check/?code=…`; it is the only way to test an
iPhone. Browser-only code lives in `*.web.ts(x)` files (Metro picks them for web; the APKs never
contain them).

```bash
bash scripts/export-web.sh store     # → dist-web/store/   (base /app/store)
bash scripts/export-web.sh check     # → dist-web/check/   (base /app/check)
node scripts/web-dev-proxy.mjs       # http://localhost:4620/app/store/ · /app/check/ · rest → :4500
```

Locally, `ln -s ../../swapup-mobile/dist-web ~/projects/swapup/public/app` makes the server's
`/j` page offer the browser test. Production: `~/projects/swapup/deploy/deploy.sh` uploads
`dist-web/` and Caddy serves it. `expo start --web` (port 8081) can't reach the API — use the
export + proxy. Contract: MOBILE-API.md §7.

**The browser check** runs the same steps where a browser can — no damage questions and no "was
the screen clean?": the scan shows the camera's patterns (a page can't set the brightness, so it
asks for it), and the result screen shows the test colours for the advisor. Its functional tests
are still interactive ("how many beeps?"). The store app in a browser opens the camera page in a
new tab (`swapup-camera`) so the live session keeps updating.

What a browser can't do: earpiece, fingerprint/face, SIM, storage size, RAM — and NFC and the
torch anywhere but Chrome on Android. Those tests report "Can't test in a browser" and count as
untested; the store sees "In the browser, no app" and a note on the summary.

## Honest limits

- Android does not let apps read the **IMEI** (Android 10+) or **battery health %** — battery
  health stays blank rather than guessed; the native app no longer asks for the IMEI.
- The phone cannot see its own glass. Cracks, scratches and the LCD come from GradeIQ's camera
  grading on the store device; whatever it can't decide (no photos, a sweep without a verdict, the
  AI out of credit) the advisor certifies on **Check the phone**, by name. Nobody asks the customer.
- Every automatic verdict is **pass only on positive evidence**; anything inconclusive (too dark,
  too quiet, sensor absent, permission refused, timed out) is a **skip with `detail.reason`**, and
  `detail.method` says how it was measured. A skipped or unsupported test is reported as untested —
  never as passed. Multi-touch and the side buttons are not in the automatic run (skip, "not in the
  automatic run"); biometrics is always a skip (exercising it needs the customer).
- **Not yet tried on a real phone.** The sensor, audio-loopback and camera-luminance thresholds are
  untuned on hardware; many phones won't route media to the earpiece, so `voice` will often be a
  skip (tone not heard, or as loud as the loudspeaker so the earpiece route is not confirmed). The full-screen patterns hide the status bar, but the
  Android navigation bar still covers the bottom edge.
- If camera grading **fails** before the phone pairs, the phone goes on to its tests at once; a
  later **Retry** on the store app gives a fresh GradeIQ session, and the phone's result screen
  follows that camera page's colours when it asks for them. A camera page opened while the phone
  is still mid-tests can't get its colours (the tests aren't interrupted) — the screen is then
  certified on **Check the phone**.
- **Skip photos** is remembered only on that device for this run of the app (the server records
  nothing); Home's **Photos needed** chip doesn't know about it.
- iPhones: SwapUp Check is Android-only; the join page offers the browser test and tells iPhone
  customers to hand the phone to the advisor.

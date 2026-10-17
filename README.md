# SwapUp mobile — SwapUp Store + SwapUp Check

One Expo (SDK 57) codebase, two Android apps:

| App | Package | Who | What it does |
|---|---|---|---|
| **SwapUp Store** | `com.swapup.store` | store staff | Sign in with the SwapUp store login, start a customer trade-in, show the **Wi‑Fi QR** and the **test QR**, **photograph the customer's phone** on GradeIQ's camera page (step ③), watch the tests and the camera grade arrive live, apply them to the case, continue pricing in the web desk inside the app |
| **SwapUp Check** | `com.swapup.check` | the customer | Installed from the test QR's download page. On Android it asks **no questions**: it pairs with the store's camera (shows the screen patterns the camera asks for), then tests the phone **by itself** — two physical actions only (swipe the grid, plug in the charger) — and streams every result to the store |

SwapUp is built on **GradeIQ** (`~/projects/gradeiq`) underneath: the SwapUp server gives every test
session a GradeIQ session, and GradeIQ's AI vision grades the glass, body and LCD from photos the
**store device** takes. The phone's own hardware tests stay SwapUp's (see below).

Server contract: `~/projects/swapup/docs/MOBILE-API.md` (§4 photo check, §8 camera grading).
GradeIQ integration: `~/projects/swapup/docs/GRADEIQ-INTEGRATION.md`. The automatic native run:
[`docs/AUTO-TESTS.md`](docs/AUTO-TESTS.md).

## How a customer gets connected

1. The advisor taps **New customer trade-in** in SwapUp Store.
2. **Wi‑Fi QR** — the store's router / hotspot (saved once by the manager). The customer
   points the phone camera at it and taps *Join*. Customers on mobile data skip it.
3. **Test QR** — opens `https://<server>/j/<CODE>`: Download SwapUp Check (APK), the
   "Install unknown apps" steps, an **Open SwapUp Check** button (deep link
   `swapupcheck://join?code=…&server=…`) and the 6-character code to type as a fallback.
4. The app joins (code → one-time ticket, bound to that phone). From here the **native app
   asks nothing**:
   - **Get ready** — the camera, microphone and location permission dialogs, then straight on.
     The tests run FIRST (below); the photos are the last step, so the customer never waits for
     the store's camera.
   - **Photos (last) — "Tests done — lay it on the counter, screen up".** It turns the
     brightness up and polls `GET /api/device/screen` every ~700 ms. Whatever GradeIQ's camera
     page asks for (white, black, stripes, red/green/blue…) is drawn full-screen and echoed with
     `POST /api/device/screen {shown}`. The first echo is what unlocks the store's camera button.
     It leaves when the camera says it is finished (`handoffDone`, or 30 s after `cosmeticDone`),
     at once when camera grading is off or failed for this check, and offers **Finish without
     photos** only if the store's camera never connects within 1 min (or stalls for 6 min) — the
     phone then records `display` as skipped ("not camera-checked: …").
   - **Automatic steps** — one progress bar, steps tick by themselves: battery, sensors, motion,
     connectivity, vibration (felt by the accelerometer), speaker + microphone (a tone played and
     heard back), earpiece, flash (rear frame with the torch off vs on), cameras (frame luminance),
     biometrics (hardware probe only), Bluetooth / NFC (Android feature list).
   - **Two actions** — swipe over every square; plug in the charger (skips itself after 45 s).
   - **Done** — "Show this to the advisor". Results are saved on the phone first and sent
     second — they survive Wi‑Fi drops and app restarts.
5. **Meanwhile the advisor photographs the phone (store app, step ③)**, during the pairing
   screen above. The button stays locked until the
   customer's phone is echoing patterns (the server withholds `grading.cameraUrl` until then).
   **Take photos** opens GradeIQ's `/v2/cam/<id>` in **Chrome** (not the in-app WebView: it needs
   the camera, HTTPS and the torch). If the customer's phone can't pair, **Take photos anyway**
   needs a reason (≥ 8 characters), is recorded with the advisor's name, and the case says
   "LCD not camera-checked". Home shows a **Photos needed** chip until a grade arrives.
6. The store app shows each test landing, the model match (from the phone's model code, e.g.
   `SM-S901E` → Galaxy S22), the storage, faults found, anything untested, and the **Camera AI
   (GradeIQ)** card: the grade (final or provisional, and why), per-part findings, the faults that
   will be added at Apply, the LCD verdict, a case on the phone, an identity mismatch.
   **Apply to case** fills the case; the Cashify quote and repair-vs-upgrade decision follow.

## GradeIQ underneath

- **Server to server only.** The SwapUp server creates and talks to the GradeIQ session; the
  customer's phone only ever sees `/api/device/screen` (a proxy) and never the GradeIQ id. The camera
  URL — the only key to that session — goes to staff only, as a button, never a QR.
- **What GradeIQ decides:** the cosmetic grade (Premium/A–D) and findings from the photos, and the
  LCD check from the screen sweep. The grade is shown to staff, **never priced**. Only
  camera-*confirmed* damage (≥ 70 %, corroborated, boxed) from a *final* grade is added to the case
  at Apply; the LCD sweep counts on its own when it fails at ≥ 70 %. Weaker sightings are flags.
- **What SwapUp decides:** the hardware tests and the verdict (`summary.verdict`). Every result batch
  is forwarded to GradeIQ in full (`merge:true`), so GradeIQ's report matches.
- **No invented grades:** camera grading off, failed or never photographed = "Not camera-graded",
  and the advisor checks condition by eye.

## Develop

```bash
npm install
APP_VARIANT=store npx expo start     # or APP_VARIANT=check
npx tsc --noEmit
node --test --experimental-strip-types --no-warnings src/diagnostics/auto/*.test.ts   # verdict maths, pairing, plan, touch
```

Where the native run lives: `src/diagnostics/auto/` — pure logic with no app imports
(`analysis.ts` thresholds and verdicts, `pairing.ts`, `plan.ts`, `touch.ts`, `tone.ts`, tested with
`node --test`) and the on-phone parts (`steps.ts`, `audio.ts`, `camera.tsx`, `AutoRunner.tsx`,
`Actions.tsx`). `src/check/NativeCheck.tsx` + `PairingScreen.tsx` are the native screens;
`NativeCheck.web.tsx` is an empty stand-in so the browser bundle never contains them. Store side:
`src/store/grading.ts` (reads `session.grading`), `screens/CameraParts.tsx`, `openCamera.ts` /
`openCamera.web.ts`.

## Build the APKs

```bash
bash scripts/build-apk.sh store      # → dist/swapup-store.apk + .json manifest
bash scripts/build-apk.sh check      # → dist/swapup-check.apk + .json manifest
```

Builds in a throwaway copy with the local toolchain (`~/android-toolchain`), arm64 only,
signed with the SwapUp release key in `~/.swapup-keys` (never commit it; losing it means
customers must uninstall before an update). Publish with `~/projects/swapup/deploy/deploy.sh`,
which uploads `dist/*.apk` to `/var/www/swapup-downloads` (served by Caddy at `/downloads/`).

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

**The browser check keeps the interactive flow**: the damage questions, then tests the customer
answers ("did you hear it?"). It does not pair with the store's camera — a check run in a browser
reaches GradeIQ's camera page only through the advisor's **Take photos anyway** override (LCD then
"not camera-checked"). The store app in a browser opens the camera page in a new tab
(`swapup-camera`) so the live session keeps updating.

What a browser can't do: earpiece, fingerprint/face, SIM, storage size, RAM — and NFC and the
torch anywhere but Chrome on Android. Those tests report "Can't test in a browser" and count as
untested; the store sees "In the browser, no app" and a note on the summary.

## Honest limits

- Android does not let apps read the **IMEI** (Android 10+) or **battery health %** — battery
  health stays blank rather than guessed; the native app no longer asks for the IMEI.
- The phone cannot see its own glass. **Native:** cracks, scratches and the LCD come from GradeIQ's
  camera grading on the store device; without photos the advisor checks by eye. **Browser:** the
  customer's answers, shown to the advisor as such.
- Every automatic verdict is **pass only on positive evidence**; anything inconclusive (too dark,
  too quiet, sensor absent, permission refused, timed out) is a **skip with `detail.reason`**, and
  `detail.method` says how it was measured. A skipped or unsupported test is reported as untested —
  never as passed. Multi-touch and the side buttons are not in the automatic run (skip, "not in the
  automatic run"); biometrics is always a skip (exercising it needs the customer).
- **Not yet tried on a real phone.** The sensor, audio-loopback and camera-luminance thresholds are
  untuned on hardware; many phones won't route media to the earpiece, so `voice` will often be a
  skip (tone not heard, or as loud as the loudspeaker so the earpiece route is not confirmed). The full-screen patterns hide the status bar, but the
  Android navigation bar still covers the bottom edge.
- **Server gap:** SwapUp's summary does not yet count GradeIQ's LCD sweep as the `display` result,
  so a native check reads "incomplete" (17/18) even when the camera checked the screen; the Camera
  AI card shows the LCD verdict separately. It also notes that the customer "has not answered the
  damage questions", which the native app no longer asks.
- If camera grading **fails** before the phone pairs, the phone moves straight on to its tests; a
  later **Retry** on the store app gives a fresh GradeIQ session the phone is no longer echoing for,
  so the photos then need **Take photos anyway**.
- iPhones: SwapUp Check is Android-only; the join page offers the browser test and tells iPhone
  customers to hand the phone to the advisor.

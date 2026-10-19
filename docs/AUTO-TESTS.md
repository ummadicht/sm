# SwapUp Check (native) — automatic testing, no questions

User direction (2026-10-16): *"SwapUp is built on GradeIQ fundamentals but extends beyond the
browser to native app testing, all automatically without any questions — simple."*

## The customer's experience

```
App ≥ 0.6.0 — the phone leads (server repo docs/PHONE-LED-FLOW.md), in three steps with a rail on
every screen: Scan · Test · Done (owner, 2026-10-17: "Reduce the flow").
Scan the store's QR (or the store's counter code) → SwapUp Check opens
→ Identify — only when the store couldn't name the phone EXACTLY from its model code: a regional
   version gets "Is this your phone?" (one tap; its storage only when the phone couldn't measure
   it), an unknown phone "Which phone is this?" (brand → model → storage) or "Leave it to the
   advisor". An exact match is asked NOTHING: no IMEI (the advisor types or scans it at the
   trade-in), no name or mobile (the trade-in form)
→ Scan: a QR of GradeIQ's camera link — "Show this to the advisor"; their tablet photographs the
   phone and sweeps its screen (and may ask for Settings › About phone). It waits for the camera:
   the customer is offered no skip — the advisor taps "Continue without camera" in SwapUp Store
   (by name) if they won't use it; a camera page that never connects in 5 minutes lets the phone go on
   by itself (no button). Once the camera page is connected the scan code is gone from the screen.
   Only an older server (no `released` on /screen) keeps the 90 s "Skip camera"
→ Battery health: a screenshot of the battery-health page, read by GradeIQ — only when the store has
   no other reading (the server leaves `battery_health` out of the plan when an attached Phonecheck
   report read it), and always skippable
→ "Testing your phone" (permission dialogs, then straight on)
→ "Testing your phone…" (one progress bar, steps tick by themselves)
→ two physical ACTIONS only: "Swipe over every square" · "Plug in the charger" (auto-skips after 45 s)
→ Done — "Checks complete — the advisor confirms your price." While the
   advisor checks the screen by eye ("Check the phone" in SwapUp Store), this screen shows the test
   colours full-screen by itself — white, black, red, green, blue, stripes, 2.5 s each — with
   "Advisor checking the screen — keep it face up". The customer taps nothing. A camera
   page that comes back (a retake, "Take photos anyway") gets its own colours here too. Once the
   store applies the results the same screen (src/check/ResultScreen.tsx, the browser's too) shows
   the answer the server writes — "Current grade C · Market price for grade C ₹25,000 · We pay you
   ₹26,000 + ₹6,199 bonus if you exchange with a new device · or repair it for ₹34,096", no partner
   name, no store margin — or "The advisor is working out your price." until it is priced, and "See
   the grade report"; it re-reads every 5 s until the answer is final (an older server: "The store
   has your results", with the SwapUp grade) — also when the app is reopened on a check that ended
   that way.

Changed 2026-10-16: the photos used to come FIRST, so a customer could sit on "Waiting for the
advisor's camera…" for 3 minutes. Tests now start at once and the photos are the last step.
Changed 2026-10-17 (server repo docs/TWO-PASS-CAMERA.md): the store's camera now works in TWO
passes — the outside is photographed BEFORE the phone joins (pass 1, nothing for this app to do),
and only the screen check (pass 2, the colour sweep) happens on this app's last screen. An older
store app still does both on that screen in one pass; this app handles either.
Changed 2026-10-17 (PHONE-LED-FLOW.md, app ≥ 0.6.0): Scan comes FIRST again, after Identify, and
the camera grade is worked out while the tests run.
Changed 2026-10-17 (app 0.8.0, owner: "why question asked … when they are already tested", "advisor
certify lcd in its app instead of asking"): the customer is asked nothing about the phone — no
confirm card, no IMEI, no name, no skip. What the camera can't decide, the advisor certifies in
SwapUp Store with one tap per row while this phone shows the test colours.
```

No yes/no questions, no "did you hear/see/feel it", no Pass/Fail buttons, and since 0.8.0 no
questions in the **browser** check either: its damage questions and its "was the screen clean on
every colour?" are gone (`display` is the server's, as natively). Cracks, scratches and the LCD come
from **GradeIQ's AI vision**, photographed by the **store device** running GradeIQ's `/v2/cam/<id>`
page while this phone shows the patterns it is asked for (pairing, see `docs/GRADEIQ-INTEGRATION.md`
in the server repo) — and where the camera can't decide (a failed sweep, the AI out of credit), the
advisor certifies the screen, body and liquid indicator by name.

## Honesty rules

- Every automatic test returns **pass** only on positive evidence. Anything inconclusive
  (too dark, too quiet, sensor absent, permission refused, timed out) is **skip** with a `detail.reason`
  the store can read — never pass, and never fail unless there is evidence of a fault.
- A failure needs evidence too (a camera that won't open, a sensor that reports nothing while the
  phone is moving, etc.).
- `detail` always says how the verdict was reached (e.g. `{ method: "speaker→mic loopback", corr: 0.83 }`).

## The steps (native only; the browser build keeps its interactive tests)

| Plan id | How (native, automatic) | pass | fail | skip (inconclusive) |
|---|---|---|---|---|
| battery | expo-battery level + state + low-power | level read | — | API unavailable |
| sensors | expo-sensors isAvailableAsync for magnetometer/light/barometer + 1.5 s magnetometer sampling | magnetometer reports varying data | magnetometer listed but silent | not present |
| motion | Accelerometer + Gyroscope 1.5 s at 50 Hz | gravity ≈ 9.8 m/s² (±25%) and gyro data | sensor present but no data | not present |
| connectivity | expo-network state, expo-cellular carrier/generation, expo-location fix (10 s) | online + (GPS fix or permission refused → detail) | GPS hardware reports error repeatedly | location refused & offline |
| vibration | Vibration.vibrate(700 ms) while sampling the accelerometer at 100 Hz; compare std-dev during vs before | ratio ≥ 2.5 | — | accelerometer absent / ratio inconclusive |
| speaker + mic | expo-audio recorder with metering + a 3-burst tone pattern through the loudspeaker at full player volume; correlate metering with the on/off pattern | speaker: correlation ≥ 0.6 · mic: metering varies ≥ 6 dB | mic: recorder starts but metering flat at the floor | permission refused; speaker not heard (maybe low media volume) |
| voice (earpiece) | same pattern routed to the earpiece (Android `shouldRouteThroughEarpiece`) | correlation ≥ 0.5 | — | not heard |
| camera | CameraView rear then front, `takePictureAsync` (low quality) → expo-image-manipulator 32 px → jpeg-js decode → mean luminance + std-dev; `detail.side` on failure | frame std-dev ≥ 6 for both | a camera fails to open / errors | frame too dark/uniform (lens covered) — retried once |
| flash | rear frame torch off vs torch on | mean luminance +15% | torch call errors | scene already bright |
| faceid (biometrics) | expo-local-authentication hasHardware / isEnrolled | — | — | always skip, `detail.hardware` / `enrolled` (exercising it needs the customer) |
| bluetooth / nfc | expo-device `hasPlatformFeatureAsync("android.hardware.bluetooth" / "android.hardware.nfc")` | hardware present | — | absent → `unsupported` |
| touch | ACTION: existing TouchTest grid (auto verdict) | grid cleared | timeout with dead region | — |
| charging | ACTION: already charging → pass at once; else "Plug in the charger" and watch battery state (45 s) | state becomes charging/full | — | not plugged in time |
| display | not run on the phone (native or browser) — GradeIQ's camera LCD sweep decides, or the advisor's certification (server worse-of rule) | — | — | skip only when the scan ended without the camera (`detail.reason`) |
| battery_health | not run on the phone — the server records what GradeIQ read off the battery screenshot (≥ 80 % pass) | — | — | skip when the customer skips the screenshot (`detail.reason`) |
| multitouch / buttons | not run in the automatic flow | — | — | skip, `detail.reason: "not in the automatic run"` |

## Order

`plan.ts` `nativeStep`: identify → scan → battery → auto → actions → done. Each step is kept on disk
(`identifiedAt`, `pairing`, `battery`, the results), so a restart resumes where it was; a check begun
by an older app (results but no `identifiedAt`) carries on with its tests. Every step change is sent
as `POST /api/device/phase {phase}` (identify / scan / battery / test / done, and `colours` while the
result screen shows the test colours for the advisor).

1. Join (deep link / QR / code / counter code) → 2. Identify (`src/check/IdentifyScreen.tsx`, only
when the join's `identity` isn't an exact match — `core.ts identifyDone`: a `family` match gets the
one-tap confirm (`core.ts confirmAsk`, sent as `identityConfirmed` + `picked` when a size was asked),
no match the picker from `GET /api/device/models`; a pick is sent with `POST /api/device/declare`,
"Ask the advisor" sends nothing) → 3. Scan (`PairingScreen.tsx`: the QR from `GET /api/device/camera-link`,
409 = not ready, ask again; poll `GET /api/device/screen` ~700 ms, ~350 ms once the camera page is
here; show the requested pattern full-screen and post `POST /api/device/screen {shown}` two frames
after it lands, again after 600 ms if the server's `shown` still differs; after the sweep, idle
with no `handoffDone` for 2.5 s → "Open Settings › About phone"; leave when `handoffDone`, 30 s
after a `cosmeticDone` that appeared while this screen was up, or `released: true` (the advisor);
on leaving post `shown: "off"`, so a camera still waiting for white never takes an old echo; the
90 s "Skip camera" only when the server sends no `released` key) → 4. Battery (`BatteryScreen.tsx`, only when the plan
has `battery_health`: expo-image-picker, images only, ≤ 1600 px, JPEG 0.6 → `POST /api/device/battery`)
→ 5. Get ready (`src/check/GetReady.tsx`: camera, microphone and location permission dialogs — the
tests only read them) → 6. Automatic steps (keep-awake, one progress bar) → 7. Actions (touch,
charger) → 8. Result (`ResultColours.tsx`: `GET /api/device/status` every 4 s, every 1.5 s while
`colours` is true — then the six test colours loop full-screen, phase `colours`, stopping by itself
20 s after the last status that said so; and `GET /api/device/screen` every 2 s, so a camera page
that comes back is followed — only a NEW `connectedAt` or a changed pattern counts, and a colour
stuck for 90 s goes back to the result).

Results go through the existing outbox (`src/check/engine.ts`) to SwapUp, which forwards them to
GradeIQ (full map, merge:true).

## As built (2026-10-16) — where the code differs from the table above

Checked end to end against the dev server (:4500) and local GradeIQ (:3700) with curl; **not yet run
on a physical phone**, so every threshold below is untuned on hardware.

- **Order:** flash runs **before** the cameras (`plan.ts` `AUTO_ORDER`): while the phone lies screen-up
  the rear lens faces the counter, so the torch makes a visible difference. The camera step then asks
  the customer to hold the phone up if a frame is too dark.
- **Pairing exits** (`pairing.ts`): `handoffDone`; 30 s after a NEW `cosmeticDone`; `state` disabled/failed →
  at once; `released: true` (the advisor's "Continue without camera") → `pairing.outcome: "skipped"`,
  reason "the advisor went on without the camera"; 15 s of refused polls (≥ 3) → "camera grading
  unavailable". Only on a server that never sends `released`: **Skip camera** after 90 s
  with no store camera page, or after 6 min with nothing changing once it connected.
  "Connected" = a NEW relayed `connectedAt` (a camera page loaded after this screen mounted), a
  pattern, or a `cosmeticDone` / capture verdict that appeared or changed after mount. The
  `connectedAt`, `cosmeticDone` and capture already on `/screen` when the screen mounts are
  baselines (`Tracker.firstConnectedAt` / `staleCosmeticDone` / `staleCapture`): with the photos
  taken before the phone joined, pass 1 leaves `cosmeticDone: true` + `capture: ok` behind, and
  treating those as live would start the 30 s grace and walk the phone off this screen before the
  screen check ran. A baseline is dropped once its value changes (a retake clears `cosmeticDone`),
  so a later one counts. `handoffDone` is never baselined (only pass 2 / a full pass sets it).
  A 503 keeps polling; only 401/403 refresh the ticket (≤ every 20 s). A server for ≥ 0.8.0 answers an
  unreadable camera service with `unreachable: true` (and `released`) instead of a 503: the screen says
  "busy", keeps polling, and still leaves the moment the advisor releases it — no skip for the customer.
- **`display`** is posted by the phone (native and browser, `core.ts displayAfterScan`) **only** when
  the scan ended without the camera: `skip`, `{ method: "store camera sweep", photos, reason: "not
  camera-checked: …" }`. Otherwise the phone never posts it: the camera's sweep, or the advisor's
  certification of the screen, decides it on the server.
- **Speaker / earpiece** need a ≥ 3 dB on/off level gap as well as the correlation; the earpiece
  passes only when ≥ 3 dB quieter than the loudspeaker run, else skip (route not confirmed).
- **Motion** passes on a phone built without a gyroscope (`gyroscope: false`); **no magnetometer** is a
  skip; **no flash hardware** is `unsupported`; flash fails only if a photo with the torch on throws
  (expo-camera reports no torch errors).
- **Camera:** not ready within 10 s → skip; an error → fail with `detail.side` (front/rear/both).
- **Touch** is its own 6×10 grid (`touch.ts`, `Actions.tsx`): fail only after 15 s of the finger
  repeatedly landing next to squares that won't clear (≤ 25 % left); 45 s idle or 150 s total → skip.
- Every result carries `detail.method`; every detail stays far below the server's 2,000-character cap
  (a longer one is stored as `{ truncated: true }`, which would lose `side`).

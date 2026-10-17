# SwapUp Check (native) — automatic testing, no questions

User direction (2026-10-16): *"SwapUp is built on GradeIQ fundamentals but extends beyond the
browser to native app testing, all automatically without any questions — simple."*

## The customer's experience

```
Scan the store's QR → SwapUp Check opens → "Testing your phone" (permission dialogs, then straight on)
→ "Testing your phone…" (one progress bar, steps tick by themselves)
→ two physical ACTIONS only: "Swipe over every square" · "Plug in the charger" (auto-skips after 45 s)
→ [photos: "Tests done — lay it on the counter, screen up"; "Finish without photos" after 90 s with no camera page]
→ Done — "Show this to the advisor"

Changed 2026-10-16: the photos used to come FIRST, so a customer could sit on "Waiting for the
advisor's camera…" for 3 minutes. Tests now start at once and the photos are the last step.
```

No yes/no questions, no "did you hear/see/feel it", no Pass/Fail buttons. The damage questions
screen is removed from the native app — cracks, scratches and the LCD come from **GradeIQ's AI
vision**, photographed by the **store device** running GradeIQ's `/v2/cam/<id>` page while this
phone shows the patterns it is asked for (pairing, see `docs/GRADEIQ-INTEGRATION.md` in the
server repo).

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
| display | not run on the phone — GradeIQ's camera LCD sweep decides (server worse-of rule) | — | — | — |
| multitouch / buttons | not run in the automatic flow | — | — | skip, `detail.reason: "not in the automatic run"` |

## Order

1. Join (deep link / QR / code) → 2. Get ready (`src/check/GetReady.tsx`: camera, microphone and
location permission dialogs — the tests only read them) → 3. Automatic steps (keep-awake, one
progress bar) → 4. Actions (touch, charger) → 5. Pairing / photos (poll `GET /api/device/screen`
~700 ms, show the requested pattern full-screen, post `POST /api/device/screen {shown}`; leave when
`handoffDone` or 30 s after `cosmeticDone`; "Finish without photos" after 90 s with no store camera page, or over a pattern unchanged for 90 s)
→ 6. Done.

Results go through the existing outbox (`src/check/engine.ts`) to SwapUp, which forwards them to
GradeIQ (full map, merge:true).

## As built (2026-10-16) — where the code differs from the table above

Checked end to end against the dev server (:4500) and local GradeIQ (:3700) with curl; **not yet run
on a physical phone**, so every threshold below is untuned on hardware.

- **Order:** flash runs **before** the cameras (`plan.ts` `AUTO_ORDER`): while the phone lies screen-up
  the rear lens faces the counter, so the torch makes a visible difference. The camera step then asks
  the customer to hold the phone up if a frame is too dark.
- **Pairing exits** (`pairing.ts`): `handoffDone`; 30 s after `cosmeticDone`; `state` disabled/failed →
  at once; 15 s of refused polls (≥ 3) → "camera grading unavailable"; **Finish without photos** after
  90 s with no store camera page (a new relayed `connectedAt`, a pattern or a capture verdict counts), or after 6 min with nothing changing once it connected.
  "Connected" = the camera asked for a pattern or judged a capture (the server does not relay GradeIQ's
  `connectedAt` to the phone). A 503 keeps polling; only 401/403 refresh the ticket (≤ every 20 s).
- **`display`** is posted by the phone **only** when no photos were taken: `skip`,
  `{ method: "GradeIQ camera sweep", photos, reason: "not camera-checked: …" }`. Otherwise the phone
  never posts it. ⚠ SwapUp's `summarise()` does not yet fold GradeIQ's LCD verdict into `display`, so
  a native check currently reads `incomplete` (17/18) — a server change.
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

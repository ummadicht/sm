# SwapUp mobile — SwapUp Store + SwapUp Check

One Expo (SDK 57) codebase, two Android apps:

| App | Package | Who | What it does |
|---|---|---|---|
| **SwapUp Store** | `com.swapup.store` | store staff | Sign in with the SwapUp store login, start a customer trade-in, show the **Wi‑Fi QR** and the **test QR**, watch the customer's tests arrive live, apply them to the case, continue pricing in the web desk inside the app |
| **SwapUp Check** | `com.swapup.check` | the customer | Installed from the test QR's download page; asks the damage questions a phone can't test on itself, runs ~17 native hardware tests on the customer's own phone and streams every result to the store |

Server contract: `~/projects/swapup/docs/MOBILE-API.md`.

## How a customer gets connected

1. The advisor taps **New customer trade-in** in SwapUp Store.
2. **Wi‑Fi QR** — the store's router / hotspot (saved once by the manager). The customer
   points the phone camera at it and taps *Join*. Customers on mobile data skip it.
3. **Test QR** — opens `https://<server>/j/<CODE>`: Download SwapUp Check (APK), the
   "Install unknown apps" steps, an **Open SwapUp Check** button (deep link
   `swapupcheck://join?code=…&server=…`) and the 6-character code to type as a fallback.
4. The app joins (code → one-time ticket, bound to that phone), asks *screen cracked? back
   cracked? liquid? IMEI (optional)*, runs the tests. Results are saved on the phone first and
   sent second — they survive Wi‑Fi drops and app restarts.
5. The store app shows each test landing, the model match (from the phone's model code, e.g.
   `SM-S901E` → Galaxy S22), the storage, faults found and anything untested.
   **Apply to case** fills the case; the Cashify quote and repair-vs-upgrade decision follow.

## Develop

```bash
npm install
APP_VARIANT=store npx expo start     # or APP_VARIANT=check
npx tsc --noEmit
```

## Build the APKs

```bash
bash scripts/build-apk.sh store      # → dist/swapup-store.apk + .json manifest
bash scripts/build-apk.sh check      # → dist/swapup-check.apk + .json manifest
```

Builds in a throwaway copy with the local toolchain (`~/android-toolchain`), arm64 only,
signed with the SwapUp release key in `~/.swapup-keys` (never commit it; losing it means
customers must uninstall before an update). Publish with `~/projects/swapup/deploy/deploy.sh`,
which uploads `dist/*.apk` to `/var/www/swapup-downloads` (served by Caddy at `/downloads/`).

## Honest limits

- Android does not let apps read the **IMEI** (Android 10+) or **battery health %** — the
  customer dials `*#06#`, and battery health stays blank rather than guessed.
- The phone cannot see its own glass: cracked screen / back / liquid are the customer's answers,
  shown to the advisor as such.
- A skipped or unsupported test is reported as untested — never as passed.
- iPhones: SwapUp Check is Android-only; the join page tells iPhone customers to hand the phone
  to the advisor.

// Pure rules for the store tablet's lock screen — the app's copy of the
// server's lib/domain/storeTablet.ts (~/projects/swapup, docs/STORE-TABLET.md).
// The server checks every PIN again; this copy only saves a round trip, so it
// must say the same sentence the server would. No React Native imports: the
// test runs under plain node.

export const PIN_LENGTH = 4;

/** Back to "Who's serving?" after this long without a touch (the server exports the same number for docs). */
export const TABLET_IDLE_MS = 15 * 60_000;

/**
 * Null when the PIN is fine. A shared counter tablet is unlocked in front of
 * customers, so the guessable PINs are refused: one digit four times (1111) and
 * a straight run up or down (1234, 4321, 0123, 9876). Wrapping runs (7890) are allowed.
 */
export function pinProblem(pin: unknown): string | null {
  if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) return "The PIN is 4 digits.";
  const d = Array.from(pin, Number);
  const step = d[1] - d[0];
  const guessable = Math.abs(step) <= 1 && d.every((x, i) => i === 0 || x - d[i - 1] === step);
  return guessable ? "Pick a PIN that isn't a run or one repeated digit." : null;
}

/** The "Set your PIN" / "Change my PIN" forms: a good PIN, typed the same way twice. */
export function newPinProblem(pin: string, repeat: string): string | null {
  return pinProblem(pin) ?? (pin === repeat ? null : "The two PINs don't match. Type the same PIN twice.");
}

/** What a PIN box accepts while typing: digits only, at most four (a pasted "12 34" becomes "1234"). */
export function pinInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, PIN_LENGTH);
}

/**
 * Which screens lock after TABLET_IDLE_MS. Not a test session or the web desk:
 * the advisor is mid-trade-in there, often waiting on the customer's phone
 * without touching the tablet.
 */
export function idleLocks(screen: string): boolean {
  return screen === "home" || screen === "new" || screen === "settings";
}

export function isIdle(lastTouchAt: number, now: number, idleMs: number = TABLET_IDLE_MS): boolean {
  return now - lastTouchAt >= idleMs;
}

/** "Asha Rao" → "Asha", for the "Asha · Switch" button. Falls back to the whole name. */
export function firstName(name: string): string {
  const t = (name || "").trim();
  return t.split(/\s+/)[0] || t;
}

/** The name a manager gives the tablet ("Counter tablet 1"): 2–40 characters after trimming — the server's sentence. */
export function deviceNameProblem(name: unknown): string | null {
  const n = typeof name === "string" ? name.trim() : "";
  return n.length < 2 || n.length > 40 ? "Give the tablet a name of 2 to 40 characters, like “Counter tablet 1”." : null;
}

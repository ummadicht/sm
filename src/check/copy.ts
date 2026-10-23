// The Check app's own sentences shown in more than one place — one constant each, so the native and
// the browser screens say the same thing (≤ 15 words, src/shared/words.test.ts). No React Native imports.

/** Under "Testing your phone" (native) and the browser welcome: what leaves the phone. */
export const PRIVACY_LINE = "Nothing personal is read — only test results and phone details are sent.";

// Battery health when nothing read it (SUP-42). SwapUp Store has no battery check ("Check the phone"
// is the screen, the body and the liquid indicator), so the phone never promises that the advisor
// will check it. What is true: no % is recorded (never a guessed one), and the advisor may look at
// the phone's own battery page. Each says why first, then who.

/** The battery step when the store has no reader for the screenshot. */
export const BATTERY_READER_OFF = "Can't read screenshots now — the advisor may ask to see Settings › Battery.";
/** The battery step when the store's answer can't be read. */
export const BATTERY_ODD_ANSWER = "Unexpected answer — skip; the advisor may ask to see Settings › Battery.";
/** The browser's battery gauge: no web page can read battery health. */
export const BATTERY_IN_BROWSER = "A browser can't read battery health — the advisor may ask to see Settings › Battery.";

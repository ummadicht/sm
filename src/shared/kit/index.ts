// SWAPUP EXPERIENCE CENTER building blocks (the Samsung-like light look, theme P).
// Keep a screen simple: one Headline, one Lead, one Hero visual, one PillButton
// docked in the Screen's footer, at most one QuietLink; secondary explanations
// go in a Sheet (HelpButton). No logo — the Wordmark is text.
export { Screen, Hero, Gap } from "./Screen";
export { Wordmark, Headline, Lead, Caption, Label, Eyebrow } from "./text";
export { PillButton, QuietLink, Arrow, type PillKind } from "./PillButton";
export { Sheet, HelpButton } from "./Sheet";
export { Card, Notice, Field, Option, Chip, FactRow, ProgressBar, StatusLine, toneColor, type Tone } from "./parts";
export { PhoneArt, PhoneImeiArt, DialKeysArt, ScanArt, BatteryArt, ChecklistArt, TickArt } from "./art";
export { FontsReady, useFontsReady, useHeadlineFace, headlineFace } from "./fonts";

// TAKE THE TRADE-IN from the store app: only the checks the law and the money need.
//
// The same form as the desk's ⑦ (~/projects/swapup components/counter/LockForm.tsx): its labels
// word for word, its order of problems, its payload. The server is the judge (lib/server/cases.ts
// lockTradeIn): the app's check only says, before the tap, the first thing the server would refuse.
// Two ticks are conditional, as on the desk:
//   - storageSeen   only when the customer typed the storage (variantSource "customer"): claimed is
//                   enough to show a price, verified is needed to move money;
//   - imeiCheckAck  only when an IMEI fails its check digit.
// The government IMEI check (KYM) covers IMEI 2 as well when the case has one, as the desk says
// ("and again for <imei2>"); its answer can't be recorded before there is an IMEI to check, and
// is cleared when an IMEI changes — it was the answer for the old number.
// No React Native imports: the test runs under plain node (./lock.test.ts).
import type { CaseHead } from "./offer";

/** The ID documents the server accepts (lib/server/cases.ts ID_TYPES; desk components/counter/shared.ts). */
export type IdType = "aadhaar" | "pan" | "driving_licence" | "voter_id" | "passport";
export const ID_TYPES: { id: IdType; label: string }[] = [
  { id: "aadhaar", label: "Aadhaar card" },
  { id: "pan", label: "PAN card" },
  { id: "driving_licence", label: "Driving licence" },
  { id: "voter_id", label: "Voter ID" },
  { id: "passport", label: "Passport" },
];

/** What the government IMEI register (KYM, SMS to 14422) answered — the desk's chip labels. */
export type Kym = "clear" | "blacklisted" | "duplicate" | "in_use";
export const KYM: { id: Kym; label: string }[] = [
  { id: "clear", label: "No block — OK to buy" },
  { id: "blacklisted", label: "Black-listed" },
  { id: "duplicate", label: "Duplicate IMEI" },
  { id: "in_use", label: "Already in use" },
];

/** The four hand-over ticks, the desk's words. */
export type CheckKey = "ownership" | "simRemoved" | "imeiMatches" | "noFinanceLock";
export const CHECKS: { key: CheckKey; label: string }[] = [
  { key: "ownership", label: "The customer confirms they own this phone" },
  { key: "simRemoved", label: "SIM and memory card removed" },
  { key: "imeiMatches", label: "IMEI on the phone (*#06#) matches the one recorded" },
  { key: "noFinanceLock", label: "Not on an EMI / finance plan, and no lender or company lock on it" },
];

/** The server's lock blocker for a case with no IMEI (cases.ts lockBlockers). */
export const IMEI_MISSING = "Record the IMEI (dial *#06#).";

export type LockForm = {
  name: string;
  phone: string;
  idType: IdType | "";
  idLast4: string;
  kym: Kym | "";
  kymRef: string;
  checks: Record<CheckKey, boolean>;
  storageSeen: boolean;
  imeiCheckAck: boolean;
};

/** The lock's view of the case. */
export type LockHead = Pick<CaseHead, "variant" | "variantSource" | "imei" | "imei2" | "imeiCheck" | "imei2Check" | "lockBlockers">;

/** POST /api/cases/<id>/action body, less `action: "lock"`. */
export type LockBody = {
  customer: { name: string; phone: string; idType: IdType | ""; idLast4: string };
  checks: Record<CheckKey, boolean> & { kym: { status: Kym | ""; reference: string | null }; imeiCheckAck?: boolean; storageSeen?: boolean };
};

/** A fresh form: name and mobile prefilled from the case (editable), nothing ticked. */
export function emptyLockForm(head: Pick<CaseHead, "customerName" | "customerPhone">): LockForm {
  return {
    name: head.customerName ?? "",
    phone: head.customerPhone ?? "",
    idType: "",
    idLast4: "",
    kym: "",
    kymRef: "",
    checks: { ownership: false, simRemoved: false, imeiMatches: false, noFinanceLock: false },
    storageSeen: false,
    imeiCheckAck: false,
  };
}

const digits = (s: string) => s.replace(/\D/g, "");
/** The customer typed the storage — the phone couldn't measure it. */
const storageClaimed = (h: LockHead) => h.variantSource === "customer";
const imeiInvalid = (h: LockHead) => h.imeiCheck === "invalid" || h.imei2Check === "invalid";

/** Every tick the advisor makes, in order: the desk's four, then the conditional ones. */
export function lockTicks(head: LockHead): { key: CheckKey | "storageSeen" | "imeiCheckAck"; label: string }[] {
  const out: { key: CheckKey | "storageSeen" | "imeiCheckAck"; label: string }[] = [...CHECKS];
  if (storageClaimed(head)) out.push({ key: "storageSeen", label: `Settings › About phone shows ${head.variant ?? "the storage"}` });
  if (imeiInvalid(head)) out.push({ key: "imeiCheckAck", label: "IMEI re-read from *#06# — it is correct" });
  return out;
}

/**
 * The first reason the trade-in can't be taken yet, or null. The desk's order and words for the
 * form (LockForm.tsx submit), then the server's for what only the server checks (lockTradeIn).
 */
export function lockProblem(form: LockForm, head: LockHead): string | null {
  if (form.name.trim().length < 2) return "Enter the customer's name.";
  if (!/^[6-9]\d{9}$/.test(digits(form.phone))) return "Enter a 10-digit Indian mobile number.";
  if (!ID_TYPES.some((t) => t.id === form.idType)) return "Choose the customer's ID document.";
  if (!/^[A-Za-z0-9]{4}$/.test(form.idLast4.trim())) return "Enter the last 4 characters of the ID number.";
  // The KYM answer can't be recorded until there is an IMEI to check: the IMEI is the first thing to do.
  if (!form.kym) return head.imei ? "Do the government IMEI check (KYM) and record what it says." : IMEI_MISSING;
  if (form.kym !== "clear") return "The government register flags this phone — do not take it.";
  if (!CHECKS.every((c) => form.checks[c.key])) return "Tick every hand-over check before taking the phone.";
  if (storageClaimed(head) && !form.storageSeen)
    return `Confirm before taking the phone: Settings › About phone shows ${head.variant ?? "the storage"} (the customer typed it — the phone couldn't measure it).`;
  if (imeiInvalid(head) && !form.imeiCheckAck) return "An IMEI fails its check digit. Re-read it from *#06#, or confirm it is correct.";
  if (!head.imei) return IMEI_MISSING;
  return null;
}

/** The desk's payload, plus `storageSeen` when the storage was only claimed. ID last 4 uppercased, the mobile digits only. */
export function lockBody(form: LockForm, head: LockHead): LockBody {
  return {
    customer: { name: form.name.trim(), phone: digits(form.phone), idType: form.idType, idLast4: form.idLast4.trim().toUpperCase() },
    checks: {
      ownership: form.checks.ownership,
      simRemoved: form.checks.simRemoved,
      imeiMatches: form.checks.imeiMatches,
      noFinanceLock: form.checks.noFinanceLock,
      kym: { status: form.kym, reference: form.kymRef.trim() || null },
      ...(imeiInvalid(head) ? { imeiCheckAck: form.imeiCheckAck } : {}),
      ...(storageClaimed(head) ? { storageSeen: form.storageSeen } : {}),
    },
  };
}

/** The server blocker to show, or null. The IMEI one is skipped while the screen asks for the IMEI itself. */
export function serverBlocker(head: LockHead): string | null {
  return head.lockBlockers.find((b) => !(b === IMEI_MISSING && !head.imei)) ?? null;
}

/**
 * The line above the pill. A server blocker first: nothing in the form can fix it, so it must be
 * read before the form is filled, not found at the end. Then the form's first problem. None while
 * the register flags the phone — the red "Do not take it" banner says what to do.
 */
export function lockCaption(form: LockForm, head: LockHead): string | null {
  if (form.kym && form.kym !== "clear") return null;
  return serverBlocker(head) ?? lockProblem(form, head);
}

/** The KYM card's instruction, the desk's words (LockForm.tsx): both IMEIs of a dual-SIM phone are checked. */
export function kymText(head: Pick<LockHead, "imei" | "imei2">): string {
  if (!head.imei) return "Record the IMEI first: the check is an SMS of the IMEI to 14422.";
  const again = head.imei2 ? ` (and again for ${head.imei2})` : "";
  return `SMS “KYM ${head.imei}” to 14422${again}, or use the Sanchar Saathi app, and record the answer.`;
}

/** The SMS buttons: IMEI 1 always (off until it is recorded), and IMEI 2 when the case has one. */
export function kymSends(head: Pick<LockHead, "imei" | "imei2">): { title: string; uri: string; disabled: boolean }[] {
  const out = [{ title: "Text KYM to 14422", uri: kymSmsUri(head.imei), disabled: !head.imei }];
  if (head.imei2) out.push({ title: "Text KYM for IMEI 2", uri: kymSmsUri(head.imei2), disabled: !head.imei });
  return out;
}

/** The KYM result chips take a tap only once there is an IMEI the SMS could have checked. */
export const kymOpen = (head: Pick<LockHead, "imei">) => !!head.imei;

/**
 * The form after the case is read again. A KYM answer (and its reference) belongs to the IMEIs it
 * was checked for, and the "matches the one recorded" / "re-read" ticks to the IMEI recorded:
 * when IMEI 1 or IMEI 2 changes (typed here, or edited on the desk), they are cleared, never
 * carried over to a number nobody checked. `before` null = the first read: nothing to compare.
 */
export function afterImeiChange(form: LockForm, before: Pick<LockHead, "imei" | "imei2"> | null, now: Pick<LockHead, "imei" | "imei2">): LockForm {
  if (!before || (before.imei === now.imei && before.imei2 === now.imei2)) return form;
  return { ...form, kym: "", kymRef: "", checks: { ...form.checks, imeiMatches: false }, imeiCheckAck: false };
}

/** Opens the SMS app with the government register's check for this IMEI (Android form of the sms: URI). */
export function kymSmsUri(imei: string | null): string {
  return `sms:14422?body=${encodeURIComponent(`KYM ${digits(imei ?? "")}`)}`;
}

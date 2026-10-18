// TAKE THE TRADE-IN from the store app: only the checks the law and the money need.
//
// The same form as the desk's "Take the trade-in" (~/projects/swapup components/counter/LockForm.tsx
// and handover.ts): its labels word for word, its order of problems, its payload. The server is the
// judge (lib/server/cases.ts lockTradeIn): the app's check only says, before the tap, the first
// thing the server would refuse.
// The four hand-over checks are ONE confirm (owner, 2026-10-17: "Reduce the flow"): "Owner
// confirmed · SIM out · IMEI matches · no EMI/lock", with what each means under it. One tick sends
// all four flags, and the server still refuses a lock missing any of them.
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

/** The four hand-over checks the server reads, one by one (lockTradeIn). */
export type CheckKey = "ownership" | "simRemoved" | "imeiMatches" | "noFinanceLock";
export const CHECK_KEYS: readonly CheckKey[] = ["ownership", "simRemoved", "imeiMatches", "noFinanceLock"];

/** The one confirm for all four — the desk's words (components/counter/handover.ts). */
export const HANDOVER_LABEL = "Owner confirmed · SIM out · IMEI matches · no EMI/lock";
export const HANDOVER_HINT = "Customer owns it; SIM and memory card out; *#06# matches; no EMI or lender lock.";

/** One tick → the four flags, each set to it. */
export function handoverChecks(on: boolean): Record<CheckKey, boolean> {
  return { ownership: on, simRemoved: on, imeiMatches: on, noFinanceLock: on };
}

/** The server's lock blocker for a case with no IMEI (cases.ts lockBlockers). */
export const IMEI_MISSING = "Record the IMEI (dial *#06#).";

export type LockForm = {
  name: string;
  phone: string;
  idType: IdType | "";
  idLast4: string;
  kym: Kym | "";
  kymRef: string;
  /** "Owner confirmed · SIM out · IMEI matches · no EMI/lock" — the four hand-over checks in one tick. */
  handover: boolean;
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
    handover: false,
    storageSeen: false,
    imeiCheckAck: false,
  };
}

const digits = (s: string) => s.replace(/\D/g, "");

/**
 * An Indian mobile however it was typed — "98765 43210", "+91 98765 43210", "098765 43210" — as its
 * 10 digits, or null. The server's own rule (~/projects/swapup lib/domain/phone.ts indianMobile).
 */
export function indianMobile(raw: string): string | null {
  let d = digits(raw);
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}
/** The customer typed the storage — the phone couldn't measure it. */
const storageClaimed = (h: LockHead) => h.variantSource === "customer";
const imeiInvalid = (h: LockHead) => h.imeiCheck === "invalid" || h.imei2Check === "invalid";

export type TickKey = "handover" | "storageSeen" | "imeiCheckAck";

/** Every tick the advisor makes, in order: the one hand-over confirm, then the conditional ones. */
export function lockTicks(head: LockHead): { key: TickKey; label: string; hint?: string }[] {
  const out: { key: TickKey; label: string; hint?: string }[] = [{ key: "handover", label: HANDOVER_LABEL, hint: HANDOVER_HINT }];
  if (storageClaimed(head)) out.push({ key: "storageSeen", label: `Settings › About phone shows ${head.variant ?? "the storage"}` });
  if (imeiInvalid(head)) out.push({ key: "imeiCheckAck", label: "IMEI re-read on *#06#: correct" });
  return out;
}

/**
 * The first reason the trade-in can't be taken yet, or null. The desk's order and words for the
 * form (LockForm.tsx submit), then the server's for what only the server checks (lockTradeIn).
 */
export function lockProblem(form: LockForm, head: LockHead): string | null {
  if (form.name.trim().length < 2) return "Enter the customer's name.";
  if (!indianMobile(form.phone)) return "Enter a 10-digit Indian mobile number.";
  if (!ID_TYPES.some((t) => t.id === form.idType)) return "Choose the customer's ID document.";
  if (!/^[A-Za-z0-9]{4}$/.test(form.idLast4.trim())) return "Enter the ID's last 4 characters.";
  // The KYM answer can't be recorded until there is an IMEI to check: the IMEI is the first thing to do.
  if (!form.kym) return head.imei ? "Do the KYM check and record it." : IMEI_MISSING;
  if (form.kym !== "clear") return "The register flags this phone — do not take it.";
  if (!form.handover) return "Tick the hand-over check.";
  if (storageClaimed(head) && !form.storageSeen) return `Check Settings › About phone shows ${head.variant ?? "the storage"}.`;
  if (imeiInvalid(head) && !form.imeiCheckAck) return "An IMEI fails its check digit — re-read *#06#.";
  if (!head.imei) return IMEI_MISSING;
  return null;
}

/**
 * The desk's payload, plus `storageSeen` when the storage was only claimed. ID last 4 uppercased,
 * the mobile digits only. The one hand-over tick goes as the four flags the server checks.
 */
export function lockBody(form: LockForm, head: LockHead): LockBody {
  return {
    customer: { name: form.name.trim(), phone: indianMobile(form.phone) ?? digits(form.phone), idType: form.idType, idLast4: form.idLast4.trim().toUpperCase() },
    checks: {
      ...handoverChecks(form.handover),
      kym: { status: form.kym, reference: form.kymRef.trim() || null },
      ...(imeiInvalid(head) ? { imeiCheckAck: form.imeiCheckAck } : {}),
      ...(storageClaimed(head) ? { storageSeen: form.storageSeen } : {}),
    },
  };
}

/** Where on the screen the first problem is, so the line above the pill can take the advisor there. */
export type LockSpot = "imei" | "customer" | "id" | "kym" | "checks";

export function lockProblemSpot(form: LockForm, head: LockHead): LockSpot | null {
  const p = lockProblem(form, head);
  if (p === null) return null;
  if (form.name.trim().length < 2 || !indianMobile(form.phone)) return "customer";
  if (!ID_TYPES.some((t) => t.id === form.idType) || !/^[A-Za-z0-9]{4}$/.test(form.idLast4.trim())) return "id";
  if (p === IMEI_MISSING) return "imei";
  if (!form.kym || form.kym !== "clear") return "kym";
  return "checks";
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
  if (!head.imei) return "Record the IMEI first.";
  const again = head.imei2 ? ` (again for ${head.imei2})` : "";
  return `SMS “KYM ${head.imei}” to 14422${again} or use Sanchar Saathi.`;
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
 * was checked for, and the hand-over confirm ("IMEI matches") and the "re-read" tick to the IMEI
 * recorded: when IMEI 1 or IMEI 2 changes (typed here, or edited on the desk), they are cleared,
 * never carried over to a number nobody checked. `before` null = the first read: nothing to compare.
 */
export function afterImeiChange(form: LockForm, before: Pick<LockHead, "imei" | "imei2"> | null, now: Pick<LockHead, "imei" | "imei2">): LockForm {
  if (!before || (before.imei === now.imei && before.imei2 === now.imei2)) return form;
  return { ...form, kym: "", kymRef: "", handover: false, imeiCheckAck: false };
}

/** Opens the SMS app with the government register's check for this IMEI (Android form of the sms: URI). */
export function kymSmsUri(imei: string | null): string {
  return `sms:14422?body=${encodeURIComponent(`KYM ${digits(imei ?? "")}`)}`;
}

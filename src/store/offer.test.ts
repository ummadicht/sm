// node --test --experimental-strip-types --no-warnings src/store/offer.test.ts
// THE ANSWER screen's reading of CaseView.offer (spec §3; ~/projects/swapup lib/domain/offer.ts)
// and the labels the app owns. Same import trick as ./pin.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";

// offer.ts imports ../shared/answer without an extension (Metro's way); this adds ".ts" for plain node.
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        try { return await next(s, c); }
        catch (e) { if (/^\\.\\.?\\//.test(s) && !/\\.[cm]?[jt]sx?$/.test(s)) return next(s + ".ts", c); throw e; }
      }`
    )
);

const O: typeof import("./offer") = await import("./offer" + ".ts");
const G: typeof import("../shared/nameGuard") = await import("../shared/nameGuard" + ".ts");
const F: typeof import("../shared/answer.fixtures") = await import("../shared/answer.fixtures" + ".ts");

/** The server's note on a PriceIQ trade-in whose data is stale (~/projects/swapup lib/domain/marketSell.ts), shown as sent. */
const STALE_NOTE = "Refurbished market price, week 2026-W35, 52 days old.";
/** The server's one note under the storage chips — the same sentence, from the chips' PriceIQ quotes. */
const CHIP_NOTE = STALE_NOTE;
const TAP_STORAGE = "Tap the storage to see the trade-in.";
const STORAGE_TEXT = "The phone couldn't measure its storage. Settings › About phone › Storage shows it.";

const signals = [
  { text: "The repair is 22% of the new phone's price.", points: "repair", strength: "soft" },
  { text: "The repair is 98% of what the phone is worth repaired.", points: "upgrade", strength: "soft" },
  { text: "Upgrading adds only ₹16,000 over the repair.", points: "upgrade", strength: "soft" },
];

/** Spec §3.4 after PATCH {variant:"256GB"}: org_samsung_svc, PriceIQ trade-in, S23 Ultra, screen_cracked. */
function priced(over: Record<string, unknown> = {}) {
  return {
    open: true,
    headline: "Either is reasonable — it's the customer's choice",
    reason: signals[0].text,
    recommendation: "either",
    recommended: null,
    asks: [],
    storage: { variant: "256GB", source: "advisor", note: null },
    repair: { amount: 34096, covered: false, basis: "book", detail: "Display + labour + GST", why: null, nothingToRepair: false, coverage: "none" },
    swap: {
      tradeIn: 18800,
      tradeInNote: STALE_NOTE,
      bonus: 6199,
      bonusBp: 400,
      bonusWhy: null,
      total: 24999,
      why: null,
      newPhone: { deviceId: "nd_s26u_256", label: "Galaxy S26 Ultra 256GB", price: 154999, suggested: true, why: "Newest Galaxy S Ultra, same storage (256GB)." },
      customerPays: 130000,
      vsRepair: 95904,
    },
    actions: { repair: null, swap: null, walkAway: null },
    signals,
    caveats: ["The bonus is never a reason to upgrade."],
    ...over,
  };
}

/** Spec §3.4 straight after Apply: storage unknown, so no trade-in yet; the repair is priced. */
function storageUnknown() {
  return priced({
    headline: "Which storage is it?",
    reason: STORAGE_TEXT,
    recommendation: "cannot_say",
    asks: [
      {
        kind: "storage",
        title: "Which storage is it?",
        text: STORAGE_TEXT,
        options: [
          { variant: "256GB", tradeIn: 18800 },
          { variant: "512GB", tradeIn: 20300 },
        ],
        note: CHIP_NOTE,
      },
    ],
    storage: { variant: null, source: null, note: null },
    swap: { tradeIn: null, tradeInNote: null, bonus: null, bonusBp: null, bonusWhy: null, total: null, why: TAP_STORAGE, newPhone: null, customerPays: null, vsRepair: null },
    actions: { repair: null, swap: TAP_STORAGE, walkAway: null },
    signals: [],
  });
}

const read = (x: unknown) => {
  const o = O.readOffer(x);
  assert.ok(o, "should read as an offer");
  return o;
};

test("readOffer: the §3.4 answer reads whole", () => {
  const o = read(priced());
  assert.equal(o.open, true);
  assert.equal(o.headline, "Either is reasonable — it's the customer's choice");
  assert.equal(o.recommendation, "either");
  assert.equal(o.recommended, null);
  assert.deepEqual(o.asks, []);
  assert.deepEqual(o.storage, { variant: "256GB", source: "advisor", note: null });
  assert.equal(o.repair.amount, 34096);
  assert.equal(o.repair.basis, "book");
  assert.equal(o.swap.tradeIn, 18800);
  assert.equal(o.swap.bonus, 6199);
  assert.equal(o.swap.total, 24999);
  assert.equal(o.swap.total, (o.swap.tradeIn ?? 0) + (o.swap.bonus ?? 0));
  assert.equal(o.swap.tradeInNote, STALE_NOTE);
  assert.deepEqual(o.swap.newPhone, { deviceId: "nd_s26u_256", label: "Galaxy S26 Ultra 256GB", price: 154999, suggested: true, why: "Newest Galaxy S Ultra, same storage (256GB)." });
  assert.equal(o.swap.customerPays, 130000);
  assert.equal(o.swap.customerPays, 154999 - 18800 - 6199);
  assert.equal(o.swap.vsRepair, 130000 - 34096);
  assert.deepEqual(o.actions, { repair: null, swap: null, walkAway: null });
  assert.equal(o.signals.length, 3);
  assert.deepEqual(o.caveats, ["The bonus is never a reason to upgrade."]);
  assert.equal(o.safety, null);
  // A swollen battery's warning is the answer's own line, in the open.
  const swollen = read(priced({ safety: "Swollen battery is a safety risk — stop using and charging it." }));
  assert.equal(swollen.safety, "Swollen battery is a safety risk — stop using and charging it.");
});

test("readOffer: storage unknown keeps the ask, its chips in the server's order, and the why", () => {
  const o = read(storageUnknown());
  assert.equal(o.headline, "Which storage is it?");
  assert.equal(o.reason, STORAGE_TEXT);
  assert.equal(o.asks.length, 1);
  const a = o.asks[0];
  assert.equal(a.kind, "storage");
  assert.ok(a.kind === "storage");
  assert.deepEqual(a.options, [
    { variant: "256GB", tradeIn: 18800 },
    { variant: "512GB", tradeIn: 20300 },
  ]);
  // The chips carry the server's note, shown under them before any tap.
  assert.equal(a.note, CHIP_NOTE);
  assert.equal(o.swap.tradeIn, null);
  assert.equal(o.swap.total, null);
  assert.equal(o.swap.why, TAP_STORAGE);
  assert.equal(o.actions.swap, TAP_STORAGE);
  assert.equal(o.repair.amount, 34096);
});

test("readOffer: junk is null, never a throw", () => {
  for (const bad of [null, undefined, "x", 3, [], {}, { open: true }, { headline: "" }, { headline: 3 }, { id: "case_1", status: "quoted" }]) {
    assert.equal(O.readOffer(bad), null, JSON.stringify(bad));
  }
});

test("readOffer: bad fields become null or empty", () => {
  const o = read({
    headline: "Not enough to compare yet",
    open: "yes",
    recommendation: "maybe",
    asks: [null, 3, { kind: "storage", title: "Which storage is it?", text: STORAGE_TEXT, options: [null, { variant: "" }, { variant: "128GB", tradeIn: "9000" }] }, { kind: "teleport", title: "t", text: "t" }, { kind: "model", title: "", text: "x" }],
    storage: { variant: 256, source: "guess", note: null },
    repair: { amount: "34096", covered: 1, basis: "estimate", coverage: "gold" },
    swap: { tradeIn: NaN, total: Infinity, newPhone: { deviceId: "nd", label: "Galaxy S26", price: null } },
    signals: [{ text: "x", points: "sideways", strength: "soft" }, "y"],
    caveats: ["", 4, "Real caveat."],
  });
  assert.equal(o.open, false);
  assert.equal(o.recommendation, null);
  assert.equal(o.recommended, null);
  assert.deepEqual(o.asks, [{ kind: "storage", title: "Which storage is it?", text: STORAGE_TEXT, options: [{ variant: "128GB", tradeIn: null }], note: null }]);
  assert.deepEqual(o.storage, { variant: null, source: null, note: null });
  assert.deepEqual(o.repair, { amount: null, covered: false, basis: null, detail: null, why: null, nothingToRepair: false, coverage: "none" });
  assert.equal(o.swap.tradeIn, null);
  assert.equal(o.swap.total, null);
  assert.equal(o.swap.newPhone, null);
  assert.deepEqual(o.signals, []);
  assert.deepEqual(o.caveats, ["Real caveat."]);
});

test("readOffer: an action the server didn't spell out is never read as allowed", () => {
  const o = read(priced({ actions: { repair: null, swap: 7 } }));
  assert.equal(o.actions.repair, null);
  assert.equal(o.actions.swap, O.ACTION_UNKNOWN);
  assert.equal(o.actions.walkAway, O.ACTION_UNKNOWN);
  assert.deepEqual(read(priced({ actions: undefined })).actions, { repair: O.ACTION_UNKNOWN, swap: O.ACTION_UNKNOWN, walkAway: O.ACTION_UNKNOWN });
});

test("readOffer: `recommended` follows the contract's mapping when the server left it out", () => {
  const rec = (recommendation: string) => read(priced({ recommendation, recommended: undefined })).recommended;
  assert.equal(rec("repair"), "repair");
  assert.equal(rec("upgrade"), "swap");
  assert.equal(rec("no_repair"), "swap");
  assert.equal(rec("either"), null);
  assert.equal(rec("cannot_say"), null);
  // An explicit null from the server stands.
  assert.equal(read(priced({ recommendation: "repair", recommended: null })).recommended, null);
});

test("readOffer: customer-typed storage carries its note", () => {
  const note = "The customer typed this — the phone couldn't measure it. Check Settings › About phone before the trade-in.";
  const o = read(priced({ storage: { variant: "512GB", source: "customer", note } }));
  assert.deepEqual(o.storage, { variant: "512GB", source: "customer", note });
});

test("readOffer: the storage chips are a size and its price; the note is only what the server says", () => {
  const ask = (options: unknown[], note?: unknown) => {
    const a = read(priced({ asks: [{ kind: "storage", title: "Which storage is it?", text: STORAGE_TEXT, options, ...(note === undefined ? {} : { note }) }] })).asks[0];
    assert.ok(a.kind === "storage");
    return a;
  };
  // Sizes from the model's list with no quote yet: no price, no note.
  const bare = ask([{ variant: "256GB", tradeIn: null }, { variant: "512GB", tradeIn: null }], null);
  assert.deepEqual(bare.options, [{ variant: "256GB", tradeIn: null }, { variant: "512GB", tradeIn: null }]);
  assert.equal(bare.note, null);
  // A priced chip with no note: none is added — the app never writes the note itself.
  assert.equal(ask([{ variant: "256GB", tradeIn: 18800 }]).note, null);
  // The server's note is read as sent; a blank one is none.
  assert.equal(ask([{ variant: "256GB", tradeIn: 18800 }], CHIP_NOTE).note, CHIP_NOTE);
  assert.equal(ask([{ variant: "256GB", tradeIn: 18800 }], "  ").note, null);
  // An older server's extra flag on a chip (its placeholder-card marker) is accepted and dropped: a chip is only its size and price.
  const old = ask([{ variant: "256GB", tradeIn: 18800, sample: true }, { variant: "512GB", tradeIn: null, sample: false }]);
  assert.deepEqual(old.options, [{ variant: "256GB", tradeIn: 18800 }, { variant: "512GB", tradeIn: null }]);
});

test("readOffer: a phone that measured a size not on file — the server's words, not 'couldn't measure', and no chip", () => {
  const text = "Phone measures 1TB, not on file — no trade-in price for that size.";
  // As the server sends it (lib/domain/offer.ts): every listed size is one the phone ruled out, so none is offered, and no note.
  const o = read(
    priced({
      headline: "Which storage is it?",
      reason: text,
      asks: [{ kind: "storage", title: "Which storage is it?", text, options: [], note: null }],
    })
  );
  const a = o.asks[0];
  assert.ok(a.kind === "storage");
  assert.equal(a.text, text);
  assert.deepEqual(a.options, []);
  assert.equal(a.note, null);
  assert.equal(o.reason, text);
  // Nothing to price per size, so the quiet re-price has nothing to fetch either.
  assert.equal(O.wantsReprice(true, false, o), false);
});

test("storageHandoff: a chip-less storage ask has no button when the phone measured a size not on file, else goes to step 1", () => {
  // Nothing prices the measured size, and nothing may be typed in: the server's text is all; step 1's chips are the sizes the phone ruled out.
  assert.equal(O.storageHandoff({ measuredStorage: "1TB" }), null);
  assert.deepEqual(O.storageHandoff({ measuredStorage: null }), { title: "Choose storage", hash: "#step-phone" });
});

test("readCaseHead: the case fields the screens need; junk is null", () => {
  const h = O.readCaseHead({
    id: "case_1",
    ref: "SU-AND-00023",
    status: "quoted",
    device: { modelId: "galaxy-s23-ultra", brand: "Samsung", model: "Galaxy S23 Ultra", variant: "256GB" },
    customer: { name: "Ravi", phone: "9876543210", idType: null, idLast4: null },
    imei: "356789012345678",
    imei2: "356789012345686",
    imeiCheck: "valid",
    imei2Check: null,
    lockBlockers: ["Choose the new phone.", 4, ""],
    variantSource: "customer",
    measuredStorage: "256GB",
    offer: priced(),
  });
  assert.deepEqual(h, {
    id: "case_1",
    ref: "SU-AND-00023",
    status: "quoted",
    deviceLabel: "Galaxy S23 Ultra",
    variant: "256GB",
    customerName: "Ravi",
    customerPhone: "9876543210",
    imei: "356789012345678",
    imei2: "356789012345686",
    imeiCheck: "valid",
    imei2Check: null,
    lockBlockers: ["Choose the new phone."],
    variantSource: "customer",
    measuredStorage: "256GB",
    imeiLookup: null,
    imeiWarnings: [],
    kymEarly: null,
  });
  const bare = O.readCaseHead({ id: "c", status: "draft", device: null, customer: null, imeiCheck: "maybe", variantSource: "guess" });
  assert.deepEqual(bare, { id: "c", ref: "", status: "draft", deviceLabel: null, variant: null, customerName: null, customerPhone: null, imei: null, imei2: null, imeiCheck: null, imei2Check: null, lockBlockers: [], variantSource: null, measuredStorage: null, imeiLookup: null, imeiWarnings: [], kymEarly: null });
  // An older server sends no measuredStorage: none measured.
  assert.equal(O.readCaseHead({ id: "c", status: "quoted", measuredStorage: 1 })?.measuredStorage, null);
  // A single-SIM phone, or a blank second IMEI, has no IMEI 2.
  assert.equal(O.readCaseHead({ id: "c", status: "quoted", imei: "356789012345678", imei2: "  " })?.imei2, null);
  for (const bad of [null, "x", [], {}, { id: "c" }, { status: "quoted" }]) assert.equal(O.readCaseHead(bad), null, JSON.stringify(bad));
});

test("readCaseHead: IMEI first — the lookup, the warnings and the early KYM answer (contract I3)", () => {
  const h = O.readCaseHead({
    id: "c",
    status: "draft",
    imei: "356789012345678",
    imeiLookup: { brand: "Samsung", model: "Galaxy S23 Ultra", modelNumber: "SM-S918B", blacklist: "clean", source: "gsma", at: "2026-10-19T10:00:00.000Z" },
    imeiWarnings: ["This IMEI is already on trade-in SU-AND-00031.", "", 3],
    kymEarly: { status: "clear", reference: "SMS 10:42" },
  })!;
  assert.deepEqual(h.imeiLookup, { brand: "Samsung", model: "Galaxy S23 Ultra", modelNumber: "SM-S918B", blacklist: "clean", source: "gsma", at: "2026-10-19T10:00:00.000Z" });
  assert.deepEqual(h.imeiWarnings, ["This IMEI is already on trade-in SU-AND-00031."]);
  assert.deepEqual(h.kymEarly, { status: "clear", reference: "SMS 10:42" });
  // A partner's view (null lookup, no warnings) and an older server (no keys) read the same.
  for (const raw of [{ id: "c", status: "draft", imeiLookup: null, imeiWarnings: [], kymEarly: null }, { id: "c", status: "draft" }]) {
    const b = O.readCaseHead(raw)!;
    assert.deepEqual([b.imeiLookup, b.imeiWarnings, b.kymEarly], [null, [], null]);
  }
  // A blacklist word the app doesn't know is never read as clean; a KYM status it doesn't know is no answer.
  assert.equal(O.readCaseHead({ id: "c", status: "draft", imeiLookup: { blacklist: "maybe" } })!.imeiLookup!.blacklist, "unknown");
  assert.equal(O.readCaseHead({ id: "c", status: "draft", kymEarly: { status: "ok" } })!.kymEarly, null);
});

// ── the labels ───────────────────────────────────────────────────────────────

const offer = (over: Record<string, unknown> = {}) => read(priced(over));
const actions = (repair: string | null, swap: string | null) => ({ actions: { repair, swap, walkAway: null } });

test("defaultPick: the recommendation when the server allows it", () => {
  assert.equal(O.defaultPick(offer({ recommendation: "repair", recommended: "repair" })), "repair");
  assert.equal(O.defaultPick(offer({ recommendation: "upgrade", recommended: "swap" })), "swap");
  assert.equal(O.defaultPick(offer({ recommendation: "either", recommended: null })), null);
  assert.equal(O.defaultPick(offer({ recommendation: "cannot_say", recommended: null })), null);
});

test("defaultPick: nothing to repair goes to swap; a refused swap leaves no pick", () => {
  assert.equal(O.defaultPick(offer({ recommendation: "no_repair", recommended: "swap", ...actions("Nothing to repair.", null) })), "swap");
  assert.equal(O.defaultPick(offer({ recommendation: "no_repair", recommended: "swap", ...actions("Nothing to repair.", TAP_STORAGE) })), null);
  // "either" with the repair refused: swap is the only thing left to do.
  assert.equal(O.defaultPick(offer({ recommendation: "either", recommended: null, ...actions("Not priced yet.", null) })), "swap");
  // The recommended repair is refused (no amount yet) but the swap is allowed.
  assert.equal(O.defaultPick(offer({ recommendation: "repair", recommended: "repair", ...actions("The repair needs a quote", null) })), "swap");
  // An upgrade verdict whose swap is refused never falls back to repair.
  assert.equal(O.defaultPick(offer({ recommendation: "upgrade", recommended: "swap", ...actions(null, TAP_STORAGE) })), null);
  // §3.4 before the storage tap: no verdict, repair allowed, swap refused.
  assert.equal(O.defaultPick(read(storageUnknown())), null);
});

test("recommendedBadge: only a repair or upgrade verdict, never 'nothing to repair'", () => {
  assert.equal(O.recommendedBadge(offer({ recommendation: "repair", recommended: "repair" })), "repair");
  assert.equal(O.recommendedBadge(offer({ recommendation: "upgrade", recommended: "swap" })), "swap");
  for (const r of ["no_repair", "either", "cannot_say"]) assert.equal(O.recommendedBadge(offer({ recommendation: r })), null, r);
});

test("pill: wording, and disabled with the server's reason", () => {
  const o = offer();
  assert.deepEqual(O.pill(o, "repair"), { title: "Customer will repair", disabled: false, caption: null });
  assert.deepEqual(O.pill(o, "swap"), { title: "Swap up", disabled: false, caption: null });
  assert.deepEqual(O.pill(o, null), { title: "Choose one", disabled: true, caption: null });
  const closed = offer({ open: false, actions: { repair: "This case is closed.", swap: "This case is closed.", walkAway: "This case is closed." } });
  assert.deepEqual(O.pill(closed, "repair"), { title: "Customer will repair", disabled: true, caption: "This case is closed." });
  assert.deepEqual(O.pill(read(storageUnknown()), "swap"), { title: "Swap up", disabled: true, caption: TAP_STORAGE });
  assert.equal(O.pickAllowed(read(storageUnknown()), "repair"), true);
  assert.equal(O.pickAllowed(read(storageUnknown()), "swap"), false);
});

test("chipLabel: the size and its trade-in, Indian grouping", () => {
  assert.equal(O.chipLabel({ variant: "256GB", tradeIn: 18800 }), "256GB · ₹18,800");
  assert.equal(O.chipLabel({ variant: "512GB", tradeIn: 20300 }), "512GB · ₹20,300");
  assert.equal(O.chipLabel({ variant: "1TB", tradeIn: 123456 }), "1TB · ₹1,23,456");
  // No price for that size: the bare size, never a guessed figure.
  assert.equal(O.chipLabel({ variant: "512GB", tradeIn: null }), "512GB");
});

test("bonusLine: trade-in + bonus with its percent, or the reason there is no bonus", () => {
  assert.equal(O.bonusLine(offer()), "Trade-in ₹18,800 + bonus ₹6,199 (4%)");
  assert.equal(O.bonusLine(offer({ swap: { ...priced().swap, bonus: 3449, bonusBp: 250 } })), "Trade-in ₹18,800 + bonus ₹3,449 (2.5%)");
  const noPhone = "Choose the new phone to see the bonus.";
  assert.equal(O.bonusLine(offer({ swap: { ...priced().swap, bonus: null, bonusBp: null, bonusWhy: noPhone, total: 18800, newPhone: null } })), `Trade-in ₹18,800 · ${noPhone}`);
  const noCampaign = "No upgrade-bonus campaign applies to this phone today.";
  assert.equal(O.bonusLine(offer({ swap: { ...priced().swap, bonus: null, bonusBp: null, bonusWhy: noCampaign, total: 18800 } })), `Trade-in ₹18,800 · ${noCampaign}`);
  assert.equal(O.bonusLine(read(storageUnknown())), null);
});

test("newPhoneLine: the phone, its price and what the customer pays", () => {
  assert.equal(O.newPhoneLine(offer()), "Galaxy S26 Ultra 256GB ₹1,54,999 · customer pays ₹1,30,000");
  assert.equal(O.newPhoneLine(offer({ swap: { ...priced().swap, customerPays: null } })), "Galaxy S26 Ultra 256GB ₹1,54,999");
  assert.equal(O.newPhoneLine(read(storageUnknown())), null);
});

test("vsRepairLine: more, less or the same as repairing", () => {
  assert.equal(O.vsRepairLine(95904), "₹95,904 more than repair");
  assert.equal(O.vsRepairLine(1234567), "₹12,34,567 more than repair");
  assert.equal(O.vsRepairLine(-4500), "₹4,500 less than repair");
  assert.equal(O.vsRepairLine(0), "Same as repair");
  assert.equal(O.vsRepairLine(null), null);
});

// ── the server's refusals on the answer screen ──────────────────────────────

const NEW_PHONE = "Choose the new phone.";
/** The server's why when a rate card is live but this phone isn't on it (~/projects/swapup lib/domain/ratecard.ts). */
const NOT_ON_CARD = "This phone isn't on the rate card yet.";

/** A priced phone with nothing to repair and no new phone chosen: the server refuses the swap until one is. */
function noNewPhone() {
  return priced({
    headline: "Nothing to repair — a straight trade-in",
    reason: null,
    recommendation: "no_repair",
    recommended: "swap",
    asks: [{ kind: "new_phone", title: "Choose the new phone", text: "Choose the new phone to see the bonus." }],
    repair: { amount: null, covered: false, basis: null, detail: null, why: "Nothing to repair.", nothingToRepair: true, coverage: "none" },
    swap: { ...priced().swap, bonus: null, bonusBp: null, bonusWhy: "Choose the new phone to see the bonus.", total: 18800, newPhone: null, customerPays: null, vsRepair: null },
    actions: { repair: "Nothing to repair.", swap: NEW_PHONE, walkAway: null },
  });
}

/** Nothing prices the phone: the server's no-price ask is its why, as text — nothing to type in. As the first ask it is the headline and the sentence. */
function noPrice(over: Record<string, unknown> = {}) {
  return priced({
    headline: "No market price yet",
    reason: NOT_ON_CARD,
    recommendation: "repair",
    recommended: "repair",
    asks: [{ kind: "no_price", title: "No market price yet", text: NOT_ON_CARD }],
    swap: { tradeIn: null, tradeInNote: null, bonus: null, bonusBp: null, bonusWhy: null, total: null, why: NOT_ON_CARD, newPhone: null, customerPays: null, vsRepair: null },
    actions: { repair: null, swap: NOT_ON_CARD, walkAway: null },
    ...over,
  });
}

test("no new phone: the swap tile and pill are refused with the server's reason", () => {
  const o = read(noNewPhone());
  assert.equal(O.pickAllowed(o, "swap"), false);
  assert.equal(O.pickAllowed(o, "repair"), false);
  assert.equal(O.defaultPick(o), null);
  // Nothing can be chosen: the pill names the verdict's action and why — never a bare "Choose one".
  assert.deepEqual(O.pill(o, null), { title: "Swap up", disabled: true, caption: NEW_PHONE });
  assert.deepEqual(O.pill(o, "swap"), { title: "Swap up", disabled: true, caption: NEW_PHONE });
  // The tile already carries the "Choose the new phone" link: the refusal isn't printed twice.
  assert.equal(O.swapRefusalLine(o), null);
  assert.equal(O.CHOOSE_PHONE, "Choose the new phone");
  // Once the phone is chosen and the server still refuses for another reason, the tile says it.
  const other = read(priced({ actions: { repair: null, swap: "This case is closed.", walkAway: null } }));
  assert.equal(O.swapRefusalLine(other), "This case is closed.");
});

test("pill: with nothing choosable and no verdict, the swap's reason; a choosable tile keeps 'Tap what the customer chose'", () => {
  const none = read(priced({ recommendation: "cannot_say", recommended: null, actions: { repair: "Not priced yet.", swap: TAP_STORAGE, walkAway: null } }));
  assert.deepEqual(O.pill(none, null), { title: "Swap up", disabled: true, caption: TAP_STORAGE });
  const repairFirst = read(priced({ recommendation: "repair", recommended: "repair", actions: { repair: "Enter the repair quote.", swap: TAP_STORAGE, walkAway: null } }));
  assert.deepEqual(O.pill(repairFirst, null), { title: "Customer will repair", disabled: true, caption: "Enter the repair quote." });
  // §3.4 before the storage tap: repair can be chosen, so the pill only asks for a tap.
  assert.deepEqual(O.pill(read(storageUnknown()), null), { title: "Choose one", disabled: true, caption: null });
  // An older server with no actions: nothing is allowed, and the pill says where to go.
  assert.deepEqual(O.pill(read(priced({ actions: undefined })), null), { title: "Swap up", disabled: true, caption: O.ACTION_UNKNOWN });
});

test("no price: the no_price ask is text only, the swap is refused with the specific why, said once; repair stays choosable", () => {
  const o = read(noPrice());
  // Its title and text, nothing else: no field the screen could turn into a box or a button.
  assert.deepEqual(o.asks, [{ kind: "no_price", title: "No market price yet", text: NOT_ON_CARD }]);
  assert.equal(o.swap.tradeIn, null);
  assert.equal(O.pickAllowed(o, "swap"), false);
  assert.equal(O.pickAllowed(o, "repair"), true);
  assert.equal(o.actions.walkAway, null, "the customer can still walk away");
  assert.equal(O.defaultPick(o), "repair");
  assert.deepEqual(O.pill(o, "swap"), { title: "Swap up", disabled: true, caption: NOT_ON_CARD });
  // Under "—" the specific why, once — never "No market price yet" again, never twice.
  assert.equal(O.swapWhyLine(o), NOT_ON_CARD);
  assert.equal(O.swapRefusalLine(o), null);
  assert.notEqual(O.swapWhyLine(o), O.NO_MARKET_PRICE);
});

test("no price: an older server's partner_quote ask (type the price in) is dropped — never a button", () => {
  const old = read(noPrice({ asks: [{ kind: "partner_quote", title: "Enter the partner's quote", text: NOT_ON_CARD }] }));
  assert.deepEqual(old.asks, []);
  // The other asks it sent still read.
  const mixed = read(noPrice({ asks: [{ kind: "partner_quote", title: "Enter the partner's quote", text: NOT_ON_CARD }, { kind: "new_phone", title: "Choose the new phone", text: NEW_PHONE }] }));
  assert.deepEqual(mixed.asks.map((a) => a.kind), ["new_phone"]);
});

test("swapRefusalLine: the why under '—' isn't repeated either", () => {
  assert.equal(O.swapRefusalLine(read(storageUnknown())), null);
  assert.equal(O.swapRefusalLine(offer()), null);
});

test("wantsReprice: an expired or unpriced quote, or storage chips with no price at all — on an open case only", () => {
  const unpriced = read(
    priced({ asks: [{ kind: "storage", title: "Which storage is it?", text: STORAGE_TEXT, options: [{ variant: "256GB", tradeIn: null }, { variant: "512GB", tradeIn: null }], note: null }] })
  );
  assert.equal(O.wantsReprice(true, false, unpriced), true);
  assert.equal(O.wantsReprice(false, false, unpriced), false, "a closed case is never re-priced");
  assert.equal(O.wantsReprice(true, true, offer()), true, "an expired quote");
  assert.equal(O.wantsReprice(false, true, offer()), false);
  assert.equal(O.wantsReprice(true, true, null), true, "an expired quote even with no answer to read");
  assert.equal(O.wantsReprice(true, false, offer()), false, "priced, nothing to ask");
  assert.equal(O.wantsReprice(true, false, read(storageUnknown())), false, "the chips already have prices");
  const onePriced = read(
    priced({ asks: [{ kind: "storage", title: "Which storage is it?", text: STORAGE_TEXT, options: [{ variant: "256GB", tradeIn: 18800 }, { variant: "512GB", tradeIn: null }], note: CHIP_NOTE }] })
  );
  assert.equal(O.wantsReprice(true, false, onePriced), false, "one size priced: the bare chip is unpriced, not a missing re-price");
  const noChips = read(priced({ asks: [{ kind: "storage", title: "Which storage is it?", text: STORAGE_TEXT, options: [], note: null }] }));
  assert.equal(O.wantsReprice(true, false, noChips), false, "no sizes to price — the full case chooses it");
  assert.equal(O.wantsReprice(true, false, null), false);
});

test("wantsReprice: a trade-in quote that isn't priced is re-asked once (a rate card may have gone live since)", () => {
  const o = read(noPrice());
  assert.equal(O.wantsReprice(true, false, o, null, "unpriced"), true);
  assert.equal(O.wantsReprice(true, false, o, null, "error"), true);
  assert.equal(O.wantsReprice(true, false, null, null, "unpriced"), true, "even with no answer to read");
  assert.equal(O.wantsReprice(false, false, o, null, "unpriced"), false, "a closed case is never re-priced");
  assert.equal(O.wantsReprice(true, false, offer(), null, "priced"), false, "priced: nothing to fetch");
  assert.equal(O.wantsReprice(true, false, offer(), null, null), false, "no quote on the case (an older server, no model yet)");
  assert.equal(O.wantsReprice(true, false, offer(), O.RULESET_VERSION, "priced"), false);
});

test("wantsReprice: a decision made under other rules is re-priced once (R8: before the premium was in what we pay)", () => {
  assert.equal(O.RULESET_VERSION, "2026-10-18.1");
  assert.equal(O.wantsReprice(true, false, offer(), "2026-10-15.2"), true);
  assert.equal(O.wantsReprice(true, false, offer(), O.RULESET_VERSION), false);
  assert.equal(O.wantsReprice(true, false, offer(), null), false, "no decision yet: nothing to re-decide");
  assert.equal(O.wantsReprice(true, false, offer()), false);
  assert.equal(O.wantsReprice(false, false, offer(), "2026-10-15.2"), false, "a closed case is never re-priced");
});

test("wantsRequote: ONE Re-quote in the quiet row — an open case whose quote has expired or isn't priced, nothing else", () => {
  assert.equal(O.wantsRequote(true, true, "priced"), true, "expired");
  assert.equal(O.wantsRequote(true, true, null), true, "expired, whatever the quote says");
  assert.equal(O.wantsRequote(true, false, "unpriced"), true, "nothing priced it (a rate card may have gone live since)");
  assert.equal(O.wantsRequote(true, false, "error"), true);
  assert.equal(O.wantsRequote(true, false, "priced"), false, "priced and valid: no Re-quote");
  assert.equal(O.wantsRequote(true, false, null), false, "no quote yet (no model, storage or condition): nothing to re-quote");
  for (const [exp, st] of [[true, "priced"], [false, "unpriced"], [true, null]] as const) assert.equal(O.wantsRequote(false, exp, st), false, "a closed case never");
  // Every case the link shows on is one the quiet re-price wanted too — the link is that same re-price, asked again.
  for (const [exp, st] of [[true, "priced"], [false, "unpriced"], [false, "error"], [true, null]] as const) {
    if (O.wantsRequote(true, exp, st)) assert.equal(O.wantsReprice(true, exp, offer(), null, st), true, `${exp} ${st}`);
  }
  assert.deepEqual(O.REPRICE, { action: "reprice", requote: false });
  // The screen posts REPRICE from both places, and draws one Re-quote.
  const src = readFileSync(new URL("./screens/Offer.tsx", import.meta.url), "utf8");
  assert.equal(src.match(/api\.post<unknown>\(`\$\{path\}\/action`, REPRICE\)/g)?.length, 2);
  assert.doesNotMatch(src, /action: "reprice"/, "no second, different re-price");
  assert.equal(src.match(/title="Re-quote"/g)?.length, 1);
  assert.match(src, /wantsRequote\(OPEN\.has\(head\.status\), extra\.quoteExpired, extra\.quoteStatus\) \? <QuietLink title="Re-quote"/);
  // The README's account of the quiet row names it too, next to Change condition.
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  const quietRow = readme.slice(readme.indexOf("**The price moves only with the condition**"), readme.indexOf("- **Test programme**"));
  assert.match(quietRow, /\*\*Change condition\*\*/);
  assert.match(quietRow, /the quiet row's one \*\*Re-quote\*\* asks\s+again \(the same re-price, never a typed price\)/);
});

// ── the answer's lines (offer.answer; answer spec §A, fixtures in ../shared/answer.fixtures.ts) ─────

test("readOffer: the answer's lines and staff notes, the premium and what we pay — F6 in its CaseView", () => {
  const o = read(priced({ answer: F.F6, swap: { ...priced().swap, ...F.F6_SWAP } }));
  assert.deepEqual(o.answer, { ready: true, final: false, headline: F.F1.headline, lines: F.F1.lines, text: null, test: false });
  assert.deepEqual(o.staffNotes, { market: null, we_pay: "Includes ₹1,000 SwapUp premium (4%).", bonus: "Upgrade bonus · 4%" });
  assert.equal(o.swap.tradeIn, 25000);
  assert.deepEqual(o.swap.premium, { amount: 1000, bp: 400 });
  assert.equal(o.swap.wePay, 26000);
  assert.equal(o.swap.total, 32199);
  assert.equal(o.swap.customerPays, 122800);
  assert.equal(O.newPhoneLine(o), "Galaxy S26 Ultra 256GB ₹1,54,999 · customer pays ₹1,22,800");
});

test("readOffer: the advisor keeps the lines while the customer waits — F8, a PriceIQ estimate", () => {
  const o = read(priced({ answer: F.F8 }));
  assert.equal(o.answer?.ready, false);
  assert.equal(o.answer?.text, "The advisor is confirming your price.");
  assert.deepEqual(o.answer?.lines, F.F1.lines);
  assert.equal(o.staffNotes.market, "Estimate from the refurbished market — not shown to the customer.");
});

test("readOffer: an older server (F7) sends no answer — the two tiles, as before", () => {
  const o = read(priced());
  assert.equal(o.answer, null);
  assert.deepEqual(o.staffNotes, { market: null, we_pay: null, bonus: null });
  assert.equal(o.swap.premium, null);
  assert.equal(o.swap.wePay, null);
  assert.equal(O.bonusLine(o), "Trade-in ₹18,800 + bonus ₹6,199 (4%)");
});

test("readOffer: a junk answer, premium or we-pay reads as none", () => {
  for (const answer of [null, "x", [], { ready: "yes" }, { ready: true, lines: [{ key: "we_pay" }] }]) assert.equal(read(priced({ answer })).answer, null, JSON.stringify(answer));
  for (const premium of [null, 1000, { amount: 1000 }, { amount: "1000", bp: 400 }, { bp: 400 }]) assert.equal(read(priced({ swap: { ...priced().swap, premium } })).swap.premium, null, JSON.stringify(premium));
  assert.equal(read(priced({ swap: { ...priced().swap, wePay: "26000" } })).swap.wePay, null);
});

// ── the SwapUp grade (CaseView.grading; grading spec §4.5 + the owner's letter) ─────

const SHA = "3f9a0c1d" + "0".repeat(56);
/** A graded, final Good, its report issued at Apply (spec §4.5 CaseView.grading). */
function grading(over: Record<string, unknown> = {}) {
  return {
    status: "graded",
    label: "Good (B)",
    grade: "Good",
    letter: "B",
    final: true,
    why: "Visible scratches on the screen.",
    report: { path: "/r/AbC123_-xyz", version: 2, sha256: SHA, issuedAt: "2026-10-17T10:00:00.000Z", final: false },
    phonecheck: { canPull: false, why: "Phonecheck isn't set up on this server: PHONECHECK_API_KEY, PHONECHECK_USERNAME and PHONECHECK_CONTRACT_CONFIRMED are not set." },
    ...over,
  };
}
const readG = (x: unknown) => {
  const g = O.readCaseGrade(x);
  assert.ok(g, "should read as a grading");
  return g;
};

test("readCaseGrade: the §4.5 block reads whole", () => {
  const g = readG(grading());
  assert.deepEqual(g, {
    status: "graded",
    label: "Good (B)",
    grade: "Good",
    letter: "B",
    final: true,
    why: "Visible scratches on the screen.",
    report: { path: "/r/AbC123_-xyz", version: 2, sha256: SHA, issuedAt: "2026-10-17T10:00:00.000Z", final: false },
    phonecheck: { canPull: false, why: grading().phonecheck.why },
  });
  assert.deepEqual(O.gradeLine(g), { text: "Good (B)", provisional: false, full: "Good (B)" });
  assert.equal(O.reportRef(g.report), "Report v2 · 3f9a0c1d");
});

test("gradeLine: the server's label is printed as sent — the app never rebuilds it", () => {
  for (const [grade, letter] of [
    ["Superb", "A"],
    ["Good", "B"],
    ["Fair", "C"],
    ["Best Value", "D"],
  ] as const) {
    const g = readG(grading({ grade, letter, label: `${grade} (${letter})` }));
    assert.equal(g.grade, grade);
    assert.equal(g.letter, letter);
    assert.equal(O.gradeLine(g).text, `${grade} (${letter})`);
  }
  // No letter added to a label that has none, and the server's letter is the one shown.
  assert.equal(O.gradeLine(readG(grading({ label: "Good", letter: undefined }))).text, "Good");
  assert.equal(O.gradeLine(readG(grading({ label: "Good (A)", letter: "A" }))).text, "Good (A)");
  // Whatever the status, the label is the server's own words.
  assert.equal(O.gradeLine(readG(grading({ status: "needs_repair", grade: null, label: "Needs repair (microphone)", final: false }))).text, "Needs repair (microphone)");
});

test("readCaseGrade: a grade and a letter only on a graded phone, and only the server's", () => {
  const repair = readG(grading({ status: "needs_repair", grade: "Good", letter: "B", label: "Needs repair", final: false, why: "Microphone failed." }));
  assert.equal(repair.grade, null, "a grade only when graded");
  assert.equal(repair.letter, null);
  assert.deepEqual(O.gradeLine(repair), { text: "Needs repair", provisional: false, full: "Needs repair" });
  // No grade, no letter — whatever letter the server sent.
  assert.equal(readG(grading({ grade: null, letter: "B", label: "(B)" })).letter, null);
  // A letter that isn't A–D is none.
  assert.equal(readG(grading({ letter: "E" })).letter, null);
  assert.equal(readG(grading({ letter: "b" })).letter, null);
});

test("gradeLine: provisional is the server's mark, drawn once", () => {
  const g = readG(grading({ final: false, label: "Good (B) · provisional" }));
  assert.equal(g.final, false);
  assert.deepEqual(O.gradeLine(g), { text: "Good (B)", provisional: true, full: "Good (B) · provisional" });
  // `final` missing is not final.
  assert.equal(readG(grading({ final: undefined })).final, false);
  // A label that is nothing but the mark is printed as it is.
  assert.deepEqual(O.gradeLine(readG(grading({ label: "· provisional" }))), { text: "· provisional", provisional: false, full: "· provisional" });
  // Never "final" or "provisional" for a status that has no grade.
  for (const [status, label] of [
    ["needs_repair", "Needs repair"],
    ["incomplete", "Not fully tested"],
    ["cannot_grade", "Can't grade"],
    ["not_tested", "Not tested"],
  ]) {
    const x = readG(grading({ status, label, grade: null, letter: null, final: true }));
    assert.equal(x.final, false, status);
    assert.deepEqual(O.gradeLine(x), { text: label, provisional: false, full: label }, status);
  }
});

test("readCaseGrade: junk is null, never a throw", () => {
  for (const bad of [null, undefined, "Good", 3, [], {}, { status: "graded" }, { label: "Good (B)" }, { status: "excellent", label: "Excellent" }, { status: "graded", label: "  " }]) {
    assert.equal(O.readCaseGrade(bad), null, JSON.stringify(bad));
  }
});

test("readCaseGrade: the report link — the server's relative path or its own http(s) address, nothing else", () => {
  const path = (p: unknown) => readG(grading({ report: { path: p, version: 1, sha256: SHA, issuedAt: null, final: true } })).report?.path ?? null;
  assert.equal(path("/r/tok"), "/r/tok");
  assert.equal(path("/r/tok?v=3"), "/r/tok?v=3");
  assert.equal(path("https://swapup.example.in/r/tok"), "https://swapup.example.in/r/tok");
  for (const bad of ["//evil.example/r/tok", "javascript:alert(1)", "r/tok", "/r/to k", "/r\\tok", "", null, 4, "http://"]) assert.equal(path(bad), null, String(bad));
  assert.equal(readG(grading({ report: null })).report, null);
  assert.equal(readG(grading({ report: undefined })).report, null);
  // A bad version or fingerprint is dropped, the link kept.
  const r = readG(grading({ report: { path: "/r/tok", version: 0, sha256: "nothex", final: "yes" } })).report;
  assert.deepEqual(r, { path: "/r/tok", version: null, sha256: null, issuedAt: null, final: false });
  assert.equal(O.reportRef(r), null);
  assert.equal(O.reportRef({ path: "/r/tok", version: 4, sha256: null, issuedAt: null, final: true }), "Report v4");
  assert.equal(O.reportRef({ path: "/r/tok", version: null, sha256: SHA.toUpperCase(), issuedAt: null, final: true }), "3F9A0C1D");
  assert.equal(readG(grading({ report: { path: "/r/tok", sha256: SHA.toUpperCase() } })).report?.sha256, SHA);
  assert.equal(O.reportRef(null), null);
});

test("readCaseGrade: Phonecheck — only an explicit true can pull; a partner's view has none", () => {
  assert.deepEqual(readG(grading({ phonecheck: { canPull: true, why: null } })).phonecheck, { canPull: true, why: null });
  assert.deepEqual(readG(grading({ phonecheck: { canPull: "yes", why: "" } })).phonecheck, { canPull: false, why: null });
  assert.equal(readG(grading({ phonecheck: null })).phonecheck, null);
  assert.equal(readG(grading({ phonecheck: undefined })).phonecheck, null);
});

test("the notes say what the grade is, in the owner's words — never CTIA, never the partner's name", () => {
  assert.equal(O.LETTER_NOTE, "A = Superb, B = Good, C = Fair, D = Best Value — not a CTIA grade.");
  assert.equal(O.SCALE_NOTE, "SwapUp grade, as tested at the store — not the buyer's own inspection.");
});

test("no app-owned words name the buyback partner", () => {
  const words = [O.SCALE_NOTE, O.LETTER_NOTE, O.ACTION_UNKNOWN, O.CHOOSE_PHONE, ...Object.values(O.PULL_TEXT), O.storageHandoff({ measuredStorage: null })!.title];
  for (const w of [...words, O.NO_MARKET_PRICE]) assert.equal(G.namesPartner(w), false, w);
});

test("the grade never moves a price: the answer reads the same with or without it", () => {
  const without = read(priced());
  for (const g of [grading(), grading({ status: "needs_repair", grade: null, label: "Needs repair" }), grading({ grade: "Best Value", label: "Best Value (D)" })]) {
    assert.deepEqual(read({ ...priced(), grading: g }), without);
  }
  // And the case head doesn't carry it either.
  const head = { id: "c", status: "quoted" };
  assert.deepEqual(O.readCaseHead({ ...head, grading: grading() }), O.readCaseHead(head));
});

test("readPull: the outcome in the app's words, and the case to paint", () => {
  const caseView = { id: "case_1", status: "quoted", grading: grading() };
  assert.deepEqual(O.readPull({ case: caseView, record: { id: "pc_1" }, outcome: "attached" }), { caseView, outcome: "attached", text: O.PULL_TEXT.attached });
  const nf = O.readPull({ case: caseView, record: null, outcome: "not_found" });
  assert.equal(nf?.outcome, "not_found");
  assert.match(nf?.text ?? "", /No Phonecheck results yet/);
  assert.equal(O.readPull({ outcome: "stale" })?.caseView, null, "no case: read it again");
  assert.equal(O.readPull({ case: { id: "x" }, outcome: "mismatch" })?.caseView, null);
  for (const bad of [null, "attached", {}, { outcome: "teleported" }, { case: caseView }]) assert.equal(O.readPull(bad), null, JSON.stringify(bad));
  for (const k of ["attached", "not_found", "stale", "mismatch"] as const) assert.ok(O.PULL_TEXT[k].endsWith("."), k);
});

test("readPull: the server's own note wins over the app's words; a blank or junk note doesn't", () => {
  const caseView = { id: "case_1", status: "quoted", grading: grading() };
  const note = "Phonecheck has no test of this IMEI on this account — test it on the station first.";
  assert.equal(O.readPull({ case: caseView, record: null, outcome: "not_found", note })?.text, note);
  assert.equal(O.readPull({ case: caseView, outcome: "stale", note: "Nothing new: this Phonecheck check is already on the case." })?.text, "Nothing new: this Phonecheck check is already on the case.");
  for (const bad of [null, "", "   ", 7, {}]) assert.equal(O.readPull({ case: caseView, outcome: "attached", note: bad })?.text, O.PULL_TEXT.attached, JSON.stringify(bad));
});

// ── how the trade-in was reached (offer.swap.tradeInDetail — PriceIQ at the grade less a % per defect) ──

test("tradeInDetail: the PriceIQ line and its details are read as sent; amounts signed for Show details", () => {
  const detail = {
    line: "Refurbished market price ₹51,399 (Good) − 2% − 2 defects · PriceIQ 2026-W35, 52 days old",
    lines: [
      { label: "Below the market price", pct: "2%", amount: -1028 },
      { label: "Battery drains / swollen", pct: "9%", amount: -4625 },
      { label: "Rear camera faulty", pct: "18%", amount: -9251 },
      { label: "Rounded down to ₹10", pct: null, amount: -5 },
      { label: "junk" },
    ],
    note: null,
  };
  const o = O.readOffer(priced({ swap: { ...priced().swap, tradeInNote: null, tradeInDetail: detail } }))!;
  assert.equal(o.swap.tradeInDetail?.line, "Refurbished market price ₹51,399 (Good) − 2% − 2 defects · PriceIQ 2026-W35, 52 days old");
  assert.deepEqual(o.swap.tradeInDetail?.lines.map((l) => [l.label, l.pct, l.amount]), [
    ["Below the market price", "2%", -1028],
    ["Battery drains / swollen", "9%", -4625],
    ["Rear camera faulty", "18%", -9251],
    ["Rounded down to ₹10", null, -5],
  ]);
  assert.equal(O.detailAmount(-9251, false), "−₹9,251");
  assert.equal(O.detailAmount(16048, false), "+₹16,048");
  assert.equal(O.detailAmount(30400, true), "₹30,400");
});

test("tradeInDetail: the rate card's fallback keeps its note; nothing to show reads as null; an older server sends none", () => {
  const fallback = O.readOffer(
    priced({ swap: { ...priced().swap, tradeInDetail: { line: null, lines: [{ label: "Best-condition price on the rate card", pct: null, amount: 30400 }], note: "PriceIQ has no refurbished market price for the Galaxy Z Fold6 256GB." } } })
  )!;
  assert.equal(fallback.swap.tradeInDetail?.line, null);
  assert.equal(fallback.swap.tradeInDetail?.note, "PriceIQ has no refurbished market price for the Galaxy Z Fold6 256GB.");
  assert.equal(O.readOffer(priced({ swap: { ...priced().swap, tradeInDetail: { line: null, lines: [], note: null } } }))!.swap.tradeInDetail, null);
  assert.equal(O.readOffer(priced())!.swap.tradeInDetail, null);
});

// ── no price from anywhere (owner, 2026-10-19: PriceIQ or the rate card, never typed in — else say so) ──

test("swapWhyLine: the server's why under '—'; with none, the one no-price line; nothing beside a total", () => {
  assert.equal(O.NO_MARKET_PRICE, "No market price yet.");
  const none = { tradeIn: null, tradeInNote: null, bonus: null, bonusBp: null, bonusWhy: null, total: null, why: null, newPhone: null, customerPays: null, vsRepair: null };
  // The server's own why wins.
  assert.equal(O.swapWhyLine(read(storageUnknown())), TAP_STORAGE);
  const serverWhy = "No trade-in price yet.";
  assert.equal(O.swapWhyLine(read(priced({ swap: { ...none, why: serverWhy } }))), serverWhy);
  // No trade-in and no why (an older or a terse server): the app's one line, never a made-up figure.
  const bare = read(priced({ swap: none, actions: { repair: null, swap: O.NO_MARKET_PRICE, walkAway: null } }));
  assert.equal(O.swapWhyLine(bare), O.NO_MARKET_PRICE);
  assert.equal(O.swapRefusalLine(bare), null, "the line is said once, not again as the refusal");
  // A total on the tile: no why line.
  assert.equal(O.swapWhyLine(read(priced())), null);
});

test("the answer screen: no box to type a trade-in price; no_price is text only; one quiet 'Change condition' to the desk's What's wrong", async () => {
  // The screens can't be rendered under plain node: this reads their code (comments stripped).
  const { readFileSync } = await import("node:fs");
  const code = (f: string) =>
    readFileSync(new URL(f, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const screen = code("./screens/Offer.tsx");
  const sheets = code("./screens/OfferSheets.tsx");
  for (const [f, s] of [["Offer.tsx", screen], ["OfferSheets.tsx", sheets]]) {
    assert.doesNotMatch(s, /partnerQuote|PartnerQuoteSheet|partner_quote|Enter the partner's quote|Enter the quote"/, f);
  }
  // The no-price ask draws no control: its case sets nothing before the next one.
  const noPriceCase = screen.slice(screen.indexOf('case "no_price":'), screen.indexOf('case "repair_quote":'));
  assert.ok(noPriceCase.length > 0);
  assert.doesNotMatch(noPriceCase, /control|btn\(|onSheet|onFull/);
  // One quiet link, in the quiet row, to the desk's "What's wrong with it?" — the desk re-prices, Back re-reads.
  assert.equal(screen.split('title="Change condition"').length - 1, 1);
  assert.match(screen, /<QuietLink title="Change condition" disabled=\{handoff\} onPress=\{\(\) => void openFull\(`\$\{answerPath\}#step-faults`\)\} \/>/);
  const walk = screen.indexOf('title="Customer walked away"');
  const quietRow = screen.slice(walk, screen.indexOf('"Open full case"', walk));
  assert.match(quietRow, /Change condition/);
});

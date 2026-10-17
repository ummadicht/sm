// node --test --experimental-strip-types --no-warnings src/store/offer.test.ts
// THE ANSWER screen's reading of CaseView.offer (spec §3; ~/projects/swapup lib/domain/offer.ts)
// and the labels the app owns. Same import trick as ./buySell.test.ts.
import test from "node:test";
import assert from "node:assert/strict";

const O: typeof import("./offer") = await import("./offer" + ".ts");

const SAMPLE = "Sample price — not a real quote.";
const TAP_STORAGE = "Tap the storage to see the trade-in.";
const STORAGE_TEXT = "The phone couldn't measure its storage. Settings › About phone › Storage shows it.";

const signals = [
  { text: "The repair is 22% of the new phone's price.", points: "repair", strength: "soft" },
  { text: "The repair is 98% of what the phone is worth repaired.", points: "upgrade", strength: "soft" },
  { text: "Upgrading adds only ₹16,000 over the repair.", points: "upgrade", strength: "soft" },
];

/** Spec §3.4 after PATCH {variant:"256GB"}: org_samsung_svc, sample card, S23 Ultra, screen_cracked. */
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
      tradeInNote: SAMPLE,
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
          { variant: "256GB", tradeIn: 18800, sample: true },
          { variant: "512GB", tradeIn: 20300, sample: true },
        ],
        note: SAMPLE,
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
  assert.equal(o.swap.tradeInNote, SAMPLE);
  assert.deepEqual(o.swap.newPhone, { deviceId: "nd_s26u_256", label: "Galaxy S26 Ultra 256GB", price: 154999, suggested: true, why: "Newest Galaxy S Ultra, same storage (256GB)." });
  assert.equal(o.swap.customerPays, 130000);
  assert.equal(o.swap.customerPays, 154999 - 18800 - 6199);
  assert.equal(o.swap.vsRepair, 130000 - 34096);
  assert.deepEqual(o.actions, { repair: null, swap: null, walkAway: null });
  assert.equal(o.signals.length, 3);
  assert.deepEqual(o.caveats, ["The bonus is never a reason to upgrade."]);
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
    { variant: "256GB", tradeIn: 18800, sample: true },
    { variant: "512GB", tradeIn: 20300, sample: true },
  ]);
  // The SAMPLE rate card's chips carry the server's note, shown under them before any tap.
  assert.equal(a.note, SAMPLE);
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
  assert.deepEqual(o.asks, [{ kind: "storage", title: "Which storage is it?", text: STORAGE_TEXT, options: [{ variant: "128GB", tradeIn: null, sample: false }], note: null }]);
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

test("readOffer: the storage ask's sample flag and note — only what the server says", () => {
  const ask = (options: unknown[], note?: unknown) => {
    const a = read(priced({ asks: [{ kind: "storage", title: "Which storage is it?", text: STORAGE_TEXT, options, ...(note === undefined ? {} : { note }) }] })).asks[0];
    assert.ok(a.kind === "storage");
    return a;
  };
  // Sizes from the model's list with no quote yet: no price, never a sample, no note.
  const bare = ask([{ variant: "256GB", tradeIn: null, sample: false }, { variant: "512GB", tradeIn: null, sample: false }], null);
  assert.deepEqual(bare.options.map((x) => x.sample), [false, false]);
  assert.equal(bare.note, null);
  // A real rate card: priced, not sample, no note.
  assert.equal(ask([{ variant: "256GB", tradeIn: 18800, sample: false }], null).note, null);
  // An older server sends neither: read as not-sample with no note — the app never writes the note itself.
  const old = ask([{ variant: "256GB", tradeIn: 18800 }]);
  assert.deepEqual(old.options, [{ variant: "256GB", tradeIn: 18800, sample: false }]);
  assert.equal(old.note, null);
  // Only an explicit true is a sample; a blank note is none.
  assert.deepEqual(ask([{ variant: "256GB", tradeIn: 18800, sample: "yes" }], "  ").options[0].sample, false);
  assert.equal(ask([{ variant: "256GB", tradeIn: 18800, sample: true }], "  ").note, null);
});

test("readOffer: a phone that measured a size not on file — the server's words, not 'couldn't measure', and no chip", () => {
  const text = "The phone measures 1TB, which isn't a size on file. Check Settings › About phone, and enter the Cashify quote on the full case if it's really 1TB.";
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

test("storageHandoff: a chip-less storage ask goes to the desk's answer card when the phone measured the size, else to step 1", () => {
  // The answer card takes the Cashify quote for the measured size (it sets the storage); step 1's chips are the sizes the phone ruled out.
  assert.deepEqual(O.storageHandoff({ measuredStorage: "1TB" }), { title: "Enter the Cashify quote on the full case", hash: "#answer" });
  assert.deepEqual(O.storageHandoff({ measuredStorage: null }), { title: "Choose it on the full case", hash: "#step-phone" });
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
  });
  const bare = O.readCaseHead({ id: "c", status: "draft", device: null, customer: null, imeiCheck: "maybe", variantSource: "guess" });
  assert.deepEqual(bare, { id: "c", ref: "", status: "draft", deviceLabel: null, variant: null, customerName: null, customerPhone: null, imei: null, imei2: null, imeiCheck: null, imei2Check: null, lockBlockers: [], variantSource: null, measuredStorage: null });
  // An older server sends no measuredStorage: none measured.
  assert.equal(O.readCaseHead({ id: "c", status: "quoted", measuredStorage: 1 })?.measuredStorage, null);
  // A single-SIM phone, or a blank second IMEI, has no IMEI 2.
  assert.equal(O.readCaseHead({ id: "c", status: "quoted", imei: "356789012345678", imei2: "  " })?.imei2, null);
  for (const bad of [null, "x", [], {}, { id: "c" }, { status: "quoted" }]) assert.equal(O.readCaseHead(bad), null, JSON.stringify(bad));
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
  assert.deepEqual(O.pill(o, "swap"), { title: "Swap up — take the trade-in", disabled: false, caption: null });
  assert.deepEqual(O.pill(o, null), { title: "Tap what the customer chose", disabled: true, caption: null });
  const closed = offer({ open: false, actions: { repair: "This case is closed.", swap: "This case is closed.", walkAway: "This case is closed." } });
  assert.deepEqual(O.pill(closed, "repair"), { title: "Customer will repair", disabled: true, caption: "This case is closed." });
  assert.deepEqual(O.pill(read(storageUnknown()), "swap"), { title: "Swap up — take the trade-in", disabled: true, caption: TAP_STORAGE });
  assert.equal(O.pickAllowed(read(storageUnknown()), "repair"), true);
  assert.equal(O.pickAllowed(read(storageUnknown()), "swap"), false);
});

test("chipLabel: the size and its trade-in, Indian grouping", () => {
  assert.equal(O.chipLabel({ variant: "256GB", tradeIn: 18800, sample: false }), "256GB · ₹18,800");
  assert.equal(O.chipLabel({ variant: "512GB", tradeIn: 20300, sample: false }), "512GB · ₹20,300");
  assert.equal(O.chipLabel({ variant: "1TB", tradeIn: 123456, sample: false }), "1TB · ₹1,23,456");
  assert.equal(O.chipLabel({ variant: "512GB", tradeIn: null, sample: false }), "512GB");
  // A sample chip stays short: the ask's one note under the row says "Sample price — not a real quote."
  assert.equal(O.chipLabel({ variant: "256GB", tradeIn: 18800, sample: true }), "256GB · ₹18,800");
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
  assert.equal(O.vsRepairLine(95904), "₹95,904 more than repairing today");
  assert.equal(O.vsRepairLine(1234567), "₹12,34,567 more than repairing today");
  assert.equal(O.vsRepairLine(-4500), "₹4,500 less than repairing");
  assert.equal(O.vsRepairLine(0), "Same as repairing");
  assert.equal(O.vsRepairLine(null), null);
});

// ── the server's refusals on the answer screen ──────────────────────────────

const NEW_PHONE = "Choose the new phone.";
const EXPIRED = "Cashify quote (ref CF-88421) expired — enter today's quote.";

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

/** A Cashify quote typed from the partner's app, now past its validity: the server asks for today's. */
function expiredCashify() {
  return priced({
    headline: "Enter the Cashify quote",
    reason: EXPIRED,
    recommendation: "upgrade",
    recommended: "swap",
    asks: [{ kind: "partner_quote", title: "Enter the Cashify quote", text: EXPIRED }],
    swap: { ...priced().swap, tradeInNote: EXPIRED },
    actions: { repair: null, swap: EXPIRED, walkAway: null },
  });
}

test("no new phone: the swap tile and pill are refused with the server's reason", () => {
  const o = read(noNewPhone());
  assert.equal(O.pickAllowed(o, "swap"), false);
  assert.equal(O.pickAllowed(o, "repair"), false);
  assert.equal(O.defaultPick(o), null);
  // Nothing can be chosen: the pill names the verdict's action and why — never a bare "Tap what the customer chose".
  assert.deepEqual(O.pill(o, null), { title: "Swap up — take the trade-in", disabled: true, caption: NEW_PHONE });
  assert.deepEqual(O.pill(o, "swap"), { title: "Swap up — take the trade-in", disabled: true, caption: NEW_PHONE });
  // The tile already carries the "Choose the new phone" link: the refusal isn't printed twice.
  assert.equal(O.swapRefusalLine(o), null);
  assert.equal(O.CHOOSE_PHONE, "Choose the new phone");
  // Once the phone is chosen and the server still refuses for another reason, the tile says it.
  const other = read(priced({ actions: { repair: null, swap: "This case is closed.", walkAway: null } }));
  assert.equal(O.swapRefusalLine(other), "This case is closed.");
});

test("pill: with nothing choosable and no verdict, the swap's reason; a choosable tile keeps 'Tap what the customer chose'", () => {
  const none = read(priced({ recommendation: "cannot_say", recommended: null, actions: { repair: "Not priced yet.", swap: TAP_STORAGE, walkAway: null } }));
  assert.deepEqual(O.pill(none, null), { title: "Swap up — take the trade-in", disabled: true, caption: TAP_STORAGE });
  const repairFirst = read(priced({ recommendation: "repair", recommended: "repair", actions: { repair: "Enter the repair quote.", swap: TAP_STORAGE, walkAway: null } }));
  assert.deepEqual(O.pill(repairFirst, null), { title: "Customer will repair", disabled: true, caption: "Enter the repair quote." });
  // §3.4 before the storage tap: repair can be chosen, so the pill only asks for a tap.
  assert.deepEqual(O.pill(read(storageUnknown()), null), { title: "Tap what the customer chose", disabled: true, caption: null });
  // An older server with no actions: nothing is allowed, and the pill says where to go.
  assert.deepEqual(O.pill(read(priced({ actions: undefined })), null), { title: "Swap up — take the trade-in", disabled: true, caption: O.ACTION_UNKNOWN });
});

test("expired Cashify quote: the ask reads whole, the swap is refused, and the tile says it once", () => {
  const o = read(expiredCashify());
  assert.deepEqual(o.asks, [{ kind: "partner_quote", title: "Enter the Cashify quote", text: EXPIRED }]);
  assert.equal(o.swap.tradeInNote, EXPIRED);
  assert.equal(O.pickAllowed(o, "swap"), false);
  // The upgrade verdict's swap is refused, the repair is not: no pick, no fall-back to repair.
  assert.equal(O.defaultPick(o), null);
  assert.deepEqual(O.pill(o, null), { title: "Tap what the customer chose", disabled: true, caption: null });
  assert.deepEqual(O.pill(o, "swap"), { title: "Swap up — take the trade-in", disabled: true, caption: EXPIRED });
  // The warn-toned trade-in note already says it.
  assert.equal(O.swapRefusalLine(o), null);
});

test("swapRefusalLine: the why under '—' isn't repeated either", () => {
  assert.equal(O.swapRefusalLine(read(storageUnknown())), null);
  assert.equal(O.swapRefusalLine(offer()), null);
});

test("wantsReprice: an expired quote, or storage chips with no price at all — on an open case only", () => {
  const unpriced = read(
    priced({ asks: [{ kind: "storage", title: "Which storage is it?", text: STORAGE_TEXT, options: [{ variant: "256GB", tradeIn: null, sample: false }, { variant: "512GB", tradeIn: null, sample: false }], note: null }] })
  );
  assert.equal(O.wantsReprice(true, false, unpriced), true);
  assert.equal(O.wantsReprice(false, false, unpriced), false, "a closed case is never re-priced");
  assert.equal(O.wantsReprice(true, true, offer()), true, "an expired quote");
  assert.equal(O.wantsReprice(false, true, offer()), false);
  assert.equal(O.wantsReprice(true, true, null), true, "an expired quote even with no answer to read");
  assert.equal(O.wantsReprice(true, false, offer()), false, "priced, nothing to ask");
  assert.equal(O.wantsReprice(true, false, read(storageUnknown())), false, "the chips already have prices");
  const onePriced = read(
    priced({ asks: [{ kind: "storage", title: "Which storage is it?", text: STORAGE_TEXT, options: [{ variant: "256GB", tradeIn: 18800, sample: true }, { variant: "512GB", tradeIn: null, sample: false }], note: SAMPLE }] })
  );
  assert.equal(O.wantsReprice(true, false, onePriced), false, "the partner priced one size: the bare chip is the partner's, not a missing re-price");
  const noChips = read(priced({ asks: [{ kind: "storage", title: "Which storage is it?", text: STORAGE_TEXT, options: [], note: null }] }));
  assert.equal(O.wantsReprice(true, false, noChips), false, "no sizes to price — the full case chooses it");
  assert.equal(O.wantsReprice(true, false, null), false);
});

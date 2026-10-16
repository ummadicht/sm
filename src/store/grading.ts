// The camera step (GradeIQ) as the store app reads it: session.grading from
// GET /api/test-sessions/<id>, normalised once here so the screens never guess.
//
// Server contract: ~/projects/swapup/docs/MOBILE-API.md ("grading" on the staff
// TestSessionView) and docs/GRADEIQ-INTEGRATION.md §2–§4. That section was being
// written in parallel with this file, so the reader accepts the GradeIQ field
// names (cosmetic_grade, screen.displayCheck, capture.verdict…) as well as the
// camelCase ones the SwapUp view uses, and treats anything it can't read as
// ABSENT. Honesty rules, from the contract:
//   - no grade is ever invented: an empty / missing grade is "Not camera-graded";
//   - a grade is "final" only when every condition in §3.3 holds — the server's
//     own `final` can only make it LESS final here, never more;
//   - the camera URL is the only key to the GradeIQ session, so it is opened on
//     this device only, never shown as a QR or copied anywhere.

export type GradingPhase =
  /** The server sent no grading object (older server, or camera grading not set up). */
  | "absent"
  /** GRADEIQ_ENABLED=0 — the labelled kill switch. */
  | "disabled"
  /** GradeIQ unreachable / wrong tenant / grading failed. */
  | "failed"
  /** The GradeIQ session is being created. */
  | "pending"
  /** Ready for photos (or already photographed). */
  | "ready";

export type CaptureVerdict = "ok" | "retake" | null;

export type CameraFinding = {
  type: string;
  label: string;
  severity: string | null;
  confidence: number | null;
  /** 1-based, ready to show ("photo 3"). */
  photo: number | null;
  location: string | null;
  /** Only one of two passes saw it. */
  uncorroborated: boolean;
  /** Which part (front/back/frame/cameras/display), when the server lists findings flat. */
  component: string | null;
  /** SwapUp's words for it ("Cracked glass"), when the server mapped it. */
  meaning: string | null;
  /** Meets the confirmed bar (≥ 70 %, corroborated, located), when the server said. */
  confirmed: boolean | null;
};

/** A fault the camera found, in the server's words ("Camera saw … (86 %, photo 1)"). */
export type CameraFault = { id: string; because: string | null; confidence: number | null; photo: number | null };

export type CameraComponent = {
  id: string;
  name: string;
  /** "" = the camera did not see this part (NOT a grade). */
  grade: string;
  confidence: number | null;
  findings: CameraFinding[];
  notes: string | null;
};

export type DisplayVerdict = "pass" | "fail" | "unknown";

export type CameraDisplayCheck = {
  verdict: DisplayVerdict;
  confidence: number | null;
  reason: string | null;
  note: string | null;
  missing: string[];
  findings: CameraFinding[];
};

export type CameraResult = {
  /** "" = not graded. Premium / A / B / C / D otherwise. */
  grade: string;
  final: boolean;
  /** The server's finality: none | grading | provisional | final | failed. */
  status: string | null;
  /** Why it isn't final — the server's sentences. */
  reasons: string[];
  /** Confirmed by the camera; added to the case at Apply (only when final). */
  faults: CameraFault[];
  /** Shown, never added — a person decides (no part / needs a look). */
  suggested: CameraFault[];
  /** Things for a person to look at, in the server's words. */
  flags: string[];
  /** Why it is provisional, when the server said. */
  provisionalWhy: string | null;
  tierUsed: string | null;
  refining: boolean;
  conclusive: boolean | null;
  gradeRange: { best: string; worst: string } | null;
  needsHumanReview: boolean | null;
  coverage: number | null;
  score: number | null;
  components: CameraComponent[];
  /** Findings that belong to no component (or all of them when the server sent only a flat list). */
  looseFindings: CameraFinding[];
  display: CameraDisplayCheck | null;
  obstruction: { present: boolean; type: string | null; note: string | null } | null;
  oem: { verdict: string; confidence: number | null; evidence: string[] } | null;
  device: { make: string | null; model: string | null; match: string | null; reason: string | null } | null;
  identity: { verdict: string; flags: string[] } | null;
  photos: number | null;
  fetchedAt: string | null;
};

export type Disagreement = {
  /** The line exactly as the server worded it, when it sent one. */
  text: string | null;
  topic: string | null;
  customer: string | null;
  camera: string | null;
  tests: string | null;
  confidence: number | null;
  photo: number | null;
  advice: string | null;
};

export type CameraGrading = {
  phase: GradingPhase;
  /** The server's own sentence (why it failed / is off / what is happening). */
  message: string | null;
  /** The customer's phone is echoing the camera's screen patterns. */
  deviceReady: boolean;
  /** The server could not read GradeIQ's /screen — readiness unknown (fail closed). */
  screenProblem: string | null;
  /** Withheld by the server until deviceReady (or an override). */
  cameraUrl: string | null;
  /** The server's sentence for why the camera is still locked. */
  cameraLocked: string | null;
  /** The server allows "Take photos anyway" (null = it didn't say). */
  canOverride: boolean | null;
  /** The server can retry setting up camera grading. */
  canRetry: boolean;
  /** Forwarding the phone's results to GradeIQ is behind (SwapUp's own results stay authoritative). */
  outOfSync: string | null;
  /** SwapUp stopped waiting for a final grade (180 s after the photos were accepted). */
  timedOut: boolean;
  override: { reason: string | null; by: string | null; at: string | null } | null;
  capture: {
    connected: boolean;
    connectedAt: string | null;
    cosmeticDone: boolean;
    handoffDone: boolean;
    verdict: CaptureVerdict;
    reasons: string[];
    attempt: number | null;
  };
  result: CameraResult | null;
  disagreements: Disagreement[];
  /** LCD not camera-checked (override used, sweep aborted or patterns missing): why. */
  lcdNotChecked: string | null;
};

// ── tiny readers ─────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === "object" && !Array.isArray(x);
const obj = (x: unknown): Obj | null => (isObj(x) ? x : null);
function pick(o: Obj | null, ...keys: string[]): unknown {
  if (!o) return undefined;
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}
const str = (x: unknown): string | null => (typeof x === "string" && x.trim() ? x.trim() : null);
const bool = (x: unknown): boolean | null => (typeof x === "boolean" ? x : null);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const strs = (x: unknown): string[] =>
  Array.isArray(x)
    ? x
        .map((y) => (typeof y === "string" ? y : isObj(y) ? str(pick(y, "text", "message", "reason", "label")) : null))
        .filter((y): y is string => !!y && !!y.trim())
        .map((y) => y.trim())
    : typeof x === "string" && x.trim()
      ? [x.trim()]
      : [];

/** 0..1 or 0..100 → 0..1. */
function frac(x: unknown): number | null {
  const n = num(x);
  if (n === null) return null;
  return n > 1 ? Math.min(1, n / 100) : Math.max(0, n);
}

const GRADES = new Set(["Premium", "A", "B", "C", "D"]);
function gradeOf(x: unknown): string {
  const s = str(x);
  if (!s) return "";
  const norm = /^premium$/i.test(s) ? "Premium" : s.toUpperCase();
  // Anything that isn't a GradeIQ letter is not a grade we will show as one.
  return GRADES.has(norm) ? norm : "";
}

const COMPONENT_NAME: Record<string, string> = {
  front: "Front glass",
  back: "Back",
  frame: "Frame and edges",
  cameras: "Camera lenses",
  display: "Display (screen on)",
};

function finding(x: unknown): CameraFinding | null {
  const f = obj(x);
  if (!f) return null;
  const type = str(pick(f, "type", "kind")) ?? "";
  const label = str(pick(f, "label", "text", "description")) ?? "";
  if (!type && !label) return null;
  // GradeIQ's photoIndex is 0-based; a server-made `photo` is already 1-based.
  const idx = num(f.photoIndex);
  const photo = num(f.photo) ?? (idx !== null ? idx + 1 : null);
  return {
    type,
    label,
    severity: str(f.severity),
    confidence: frac(f.confidence),
    photo,
    location: str(f.location),
    uncorroborated: f.uncorroborated === true,
    component: str(f.component),
    meaning: str(f.meaning),
    confirmed: bool(f.confirmed),
  };
}

function cameraFaults(x: unknown): CameraFault[] {
  if (!Array.isArray(x)) return [];
  return x
    .map((y): CameraFault | null => {
      const f = obj(y);
      const id = str(pick(f, "id", "fault"));
      if (!f || !id) return null;
      const idx = num(f.photoIndex);
      return { id, because: str(pick(f, "because", "why")), confidence: frac(f.confidence), photo: num(f.photo) ?? (idx !== null ? idx + 1 : null) };
    })
    .filter((y): y is CameraFault => !!y);
}
const findings = (x: unknown): CameraFinding[] => (Array.isArray(x) ? x.map(finding).filter((y): y is CameraFinding => !!y) : []);

function component(x: unknown, idHint?: string): CameraComponent | null {
  const c = obj(x);
  if (!c) return null;
  const id = str(pick(c, "id", "component")) ?? idHint ?? "";
  if (!id) return null;
  return {
    id,
    name: COMPONENT_NAME[id] ?? str(c.name) ?? id,
    grade: gradeOf(pick(c, "grade", "condition")),
    confidence: frac(c.confidence),
    findings: findings(c.findings), // a count (staff view lists them flat) reads as none here; see readGrading
    notes: str(c.notes),
  };
}

function components(x: unknown): CameraComponent[] {
  if (Array.isArray(x)) return x.map((c) => component(c)).filter((y): y is CameraComponent => !!y);
  const o = obj(x);
  if (!o) return [];
  return Object.keys(o)
    .map((k) => component(o[k], k))
    .filter((y): y is CameraComponent => !!y);
}

function displayCheck(x: unknown): CameraDisplayCheck | null {
  const d = obj(x);
  if (!d) return null;
  const v = str(d.verdict);
  return {
    verdict: v === "pass" || v === "fail" ? v : "unknown",
    confidence: frac(d.confidence),
    reason: str(d.reason),
    note: str(d.note),
    missing: strs(d.missing),
    findings: findings(d.findings),
  };
}

function disagreement(x: unknown): Disagreement | null {
  if (typeof x === "string") return x.trim() ? { text: x.trim(), topic: null, customer: null, camera: null, tests: null, confidence: null, photo: null, advice: null } : null;
  const d = obj(x);
  if (!d) return null;
  const said = (v: unknown): string | null => (typeof v === "boolean" ? (v ? "yes" : "no") : str(v));
  const idx = num(d.photoIndex);
  const out: Disagreement = {
    text: str(pick(d, "text", "message", "summary", "line")),
    topic: str(pick(d, "topic", "label", "field", "what")),
    customer: said(pick(d, "customer", "declared", "customerSaid")),
    camera: said(pick(d, "camera", "cameraSaw", "ai")),
    tests: said(pick(d, "tests", "tested", "phone")),
    confidence: frac(d.confidence),
    photo: num(d.photo) ?? (idx !== null ? idx + 1 : null),
    advice: str(pick(d, "advice", "action", "hint")),
  };
  return out.text || out.customer || out.camera || out.tests ? out : null;
}

// ── the reader ───────────────────────────────────────────────────────────────

const PHASES: Record<string, GradingPhase> = {
  disabled: "disabled",
  off: "disabled",
  failed: "failed",
  error: "failed",
  unavailable: "failed",
  pending: "pending",
  creating: "pending",
  ready: "ready",
  pairing: "ready",
  photos: "ready",
  capturing: "ready",
  grading: "ready",
  graded: "ready",
};

/**
 * session.grading → CameraGrading. `raw` is the whole TestSessionView (the
 * grading object may also sit under `gradeiq`). Missing or unreadable → phase
 * "absent" and no result — never a made-up grade.
 */
export function readGrading(raw: unknown): CameraGrading {
  const v = obj(raw);
  const g = obj(pick(v, "grading", "gradeiq", "camera"));
  const empty: CameraGrading = {
    phase: "absent",
    message: null,
    deviceReady: false,
    screenProblem: null,
    cameraUrl: null,
    cameraLocked: null,
    canOverride: null,
    canRetry: false,
    outOfSync: null,
    timedOut: false,
    override: null,
    capture: { connected: false, connectedAt: null, cosmeticDone: false, handoffDone: false, verdict: null, reasons: [], attempt: null },
    result: null,
    disagreements: [],
    lcdNotChecked: null,
  };
  if (!g) return empty;

  const stateRaw = str(pick(g, "state", "status"))?.toLowerCase() ?? "";
  let phase: GradingPhase = PHASES[stateRaw] ?? (stateRaw ? "ready" : "pending");
  if (g.enabled === false) phase = "disabled";

  // /screen as the server last read it (GradeIQ's own shape, or flattened).
  const screen = obj(pick(g, "screen", "pairing"));
  const capRaw = obj(pick(g, "capture") ?? pick(screen, "capture"));
  const capV = str(capRaw?.verdict);
  const connectedAt = str(pick(g, "cameraConnectedAt", "connectedAt") ?? pick(screen, "connectedAt"));
  const capture = {
    connected: g.cameraConnected === true || !!connectedAt,
    connectedAt,
    cosmeticDone: (pick(g, "cosmeticDone") ?? pick(screen, "cosmeticDone")) === true,
    handoffDone: (pick(g, "handoffDone") ?? pick(screen, "handoffDone")) === true,
    verdict: (capV === "ok" || capV === "retake" ? capV : null) as CaptureVerdict,
    reasons: strs(capRaw?.reasons),
    attempt: num(capRaw?.attempt),
  };

  // Fail closed: only an explicit true (or GradeIQ's `shown` string) means the
  // customer's phone is echoing.
  const ready = pick(g, "deviceReady", "phoneReady", "customerReady");
  const shown = pick(screen, "shown");
  const deviceReady = ready === true || (ready === undefined && typeof shown === "string" && !!shown);

  const screenErr = pick(g, "screenError", "screenProblem", "pairingError") ?? pick(screen, "error");
  const cameraLocked = str(g.cameraLocked);
  const canOverride = bool(g.canOverride);
  // "Unreadable" is not "not read yet": with the server's own flags, only an
  // unreadable /screen that it lets staff override counts.
  const unreadable =
    canOverride !== null
      ? g.screenReadable === false && canOverride
      : pick(g, "screenReadable", "screenOk") === false || str(pick(g, "screenState", "pairingState")) === "unreadable" || str(screen?.state) === "unreadable";
  const screenProblem = str(screenErr) ?? (unreadable ? (cameraLocked ?? "SwapUp couldn't read the pairing status from GradeIQ.") : null);

  const ov = pick(g, "override", "cameraOverride");
  const ovObj = obj(ov);
  const override =
    ovObj || ov === true
      ? {
          reason: str(pick(ovObj, "reason")),
          by: str(pick(ovObj, "by", "byName", "name", "user")),
          at: str(pick(ovObj, "at", "createdAt")),
        }
      : null;

  // The assessment snapshot (§3.3). Accept it under several names, or flat on grading itself.
  const snap = obj(pick(g, "assessment", "snapshot", "result", "cosmetic")) ?? (pick(g, "cosmetic_grade", "cosmeticGrade", "grade") !== undefined ? g : null);
  let result: CameraResult | null = null;
  if (snap) {
    const cos = obj(snap.cosmetic) ?? snap; // GradeIQ nests the cascade under `cosmetic`
    const grade = gradeOf(pick(snap, "cosmeticGrade", "cosmetic_grade", "grade") ?? pick(cos, "grade"));
    const tierUsed = str(pick(snap, "tierUsed") ?? pick(cos, "tierUsed"));
    const refining = (pick(snap, "refining") ?? pick(cos, "refining")) === true;
    const obsRaw = obj(pick(snap, "obstruction") ?? pick(cos, "obstruction"));
    const obstruction = obsRaw
      ? { present: obsRaw.present === true, type: str(obsRaw.type), note: str(obsRaw.note) }
      : null;
    const rangeRaw = obj(pick(snap, "gradeRange") ?? pick(cos, "gradeRange"));
    const best = gradeOf(rangeRaw?.best);
    const worst = gradeOf(rangeRaw?.worst);
    const comps = components(pick(snap, "components", "specialists") ?? pick(cos, "specialists"));
    const flat = findings(pick(snap, "findings") ?? pick(cos, "findings"));
    // A flat list that names its component belongs under that component.
    for (const f of flat) {
      const c = f.component ? comps.find((x) => x.id === f.component) : undefined;
      if (c && !c.findings.some((y) => y.type === f.type && y.label === f.label && y.photo === f.photo)) c.findings.push(f);
    }
    const inComps = new Set(comps.flatMap((c) => c.findings.map((f) => `${f.type}|${f.label}|${f.photo}`)));
    const oemRaw = obj(pick(snap, "oem") ?? pick(cos, "oem"));
    const devRaw = obj(pick(snap, "device") ?? pick(cos, "device"));
    const idRaw = obj(pick(snap, "identity"));
    const devRaw2 = devRaw ?? obj(idRaw?.device);
    const dc = displayCheck(pick(snap, "displayCheck") ?? pick(obj(snap.screen), "displayCheck") ?? pick(g, "displayCheck"));
    const finStatus = str(pick(snap, "status"));

    // §3.3: final only when ALL hold. The server's flag may veto, never promote.
    const serverFinal = bool(pick(snap, "final", "isFinal") ?? pick(g, "final")) ?? (finStatus ? finStatus === "final" : null);
    const serverProvisional = bool(pick(snap, "provisional") ?? pick(g, "provisional"));
    const localFinal =
      !!grade && tierUsed !== "stub" && !refining && capture.verdict !== "retake" && !(obstruction?.present ?? false) && (capture.verdict === "ok" || serverFinal === true);
    const final = localFinal && serverFinal !== false && serverProvisional !== true;

    const reasons = strs(pick(snap, "reasons"));
    result = {
      grade: tierUsed === "stub" || finStatus === "failed" ? "" : grade,
      final,
      status: finStatus,
      reasons,
      faults: cameraFaults(snap.faults),
      suggested: cameraFaults(snap.suggested),
      flags: strs(snap.flags),
      provisionalWhy: reasons.length && !final ? reasons.join(" ") : str(pick(snap, "provisionalWhy", "provisionalReason", "why") ?? pick(g, "provisionalWhy")),
      tierUsed,
      refining,
      conclusive: bool(pick(snap, "conclusive") ?? pick(cos, "conclusive")),
      gradeRange: best && worst ? { best, worst } : null,
      needsHumanReview: bool(pick(snap, "needsHumanReview") ?? pick(cos, "needsHumanReview")),
      coverage: frac(pick(snap, "coverage") ?? pick(cos, "coverage")),
      score: num(pick(snap, "score") ?? pick(cos, "score")),
      components: comps,
      looseFindings: comps.length ? flat.filter((f) => !inComps.has(`${f.type}|${f.label}|${f.photo}`)) : flat,
      display: dc,
      obstruction,
      oem: oemRaw && str(oemRaw.verdict) ? { verdict: str(oemRaw.verdict)!, confidence: frac(oemRaw.confidence), evidence: strs(oemRaw.evidence) } : null,
      device: devRaw2 ? { make: str(devRaw2.make), model: str(devRaw2.model), match: str(devRaw2.match), reason: str(devRaw2.reason) } : null,
      identity: idRaw && str(idRaw.verdict) ? { verdict: str(idRaw.verdict)!, flags: strs(pick(idRaw, "reasons", "flags")) } : null,
      photos: Array.isArray(snap.photos) ? snap.photos.length : num(pick(snap, "photoCount", "photos")),
      fetchedAt: str(pick(snap, "fetchedAt") ?? pick(g, "fetchedAt")),
    };
  }

  const dis = pick(g, "disagreements") ?? pick(snap, "disagreements");
  const disagreements = Array.isArray(dis) ? dis.map(disagreement).filter((y): y is Disagreement => !!y) : [];

  // LCD not camera-checked: an override, a server flag, or a sweep that didn't cover the screen.
  const d = result?.display ?? null;
  const lcdFlag = pick(g, "lcdNotChecked", "lcdUnchecked");
  const lcd = obj(pick(snap, "lcd") ?? pick(g, "lcd"));
  if (result && !result.display && lcd && (str(lcd.verdict) === "pass" || str(lcd.verdict) === "fail")) {
    result.display = { verdict: str(lcd.verdict) as DisplayVerdict, confidence: null, reason: null, note: null, missing: [], findings: [] };
  }
  const lcdNotChecked = ((): string | null => {
    const own = str(lcdFlag);
    if (own) return own;
    if (lcdFlag === true) return "The screen sweep was not run with the customer's phone paired.";
    // The server's own LCD verdict wins when it sent one (it already folds in an override).
    if (lcd && typeof lcd.cameraChecked === "boolean") return lcd.cameraChecked ? null : (str(lcd.reason) ?? "The camera's screen sweep did not check the display.");
    if (override) return `Photos were taken without confirming the customer's phone was ready${override.reason ? ` (reason: ${override.reason})` : ""}.`;
    if (result && (capture.handoffDone || result.grade) && (!d || d.verdict === "unknown" || d.missing.length))
      return d?.reason ?? (d?.missing.length ? `Patterns not captured: ${d.missing.join(", ")}.` : "The camera's screen sweep gave no verdict.");
    return null;
  })();

  return {
    phase,
    message: str(pick(g, "message", "error", "note", "reason")),
    deviceReady,
    screenProblem: deviceReady ? null : screenProblem,
    cameraUrl: str(pick(g, "cameraUrl", "camUrl")),
    cameraLocked,
    canOverride,
    canRetry: g.canRetry === true,
    outOfSync: g.outOfSync === true ? (str(obj(g.sync)?.error) ?? "GradeIQ out of sync, retrying.") : null,
    timedOut: g.timedOut === true,
    override,
    capture,
    result,
    disagreements,
    lcdNotChecked,
  };
}

/** True when the camera has produced a grade letter we can show (final or provisional). */
export const isCameraGraded = (g: CameraGrading) => !!g.result?.grade;

/** For Home: photos still to take — the phone has joined, camera grading is on, and there is no grade. */
export function photosNeeded(raw: unknown, joined: boolean): boolean {
  if (!joined) return false;
  const g = readGrading(raw);
  if (g.phase === "absent" || g.phase === "disabled" || g.phase === "failed") return false;
  return !isCameraGraded(g);
}

// ── plain words ──────────────────────────────────────────────────────────────

const TYPE_WORD: Record<string, string> = {
  scratch: "Scratch",
  crack: "Crack",
  chip: "Chip",
  dent: "Dent",
  scuff: "Scuff",
  wear: "Wear",
  discoloration: "Discoloured patch",
  deadpixel: "Dead pixels",
};

export const pct = (x: number | null | undefined) => (x === null || x === undefined ? null : `${Math.round(x * 100)}%`);

/** "Moderate crack — top-right corner · 86% sure · photo 3". */
export function findingLine(f: CameraFinding): string {
  const what = f.label && f.type && !f.label.toLowerCase().includes(f.type.toLowerCase()) ? `${TYPE_WORD[f.type] ?? f.type}: ${f.label}` : f.label || TYPE_WORD[f.type] || f.type;
  const sev = f.severity ? `${f.severity.charAt(0).toUpperCase()}${f.severity.slice(1)} ` : "";
  const head = sev ? `${sev}${what.charAt(0).toLowerCase()}${what.slice(1)}` : what;
  const bits = [f.location, f.confidence !== null ? `${pct(f.confidence)} sure` : null, f.photo !== null ? `photo ${f.photo}` : null].filter(Boolean);
  const means = f.meaning && !head.toLowerCase().includes(f.meaning.toLowerCase()) ? ` → ${f.meaning}${f.confirmed === false ? " (not confirmed)" : ""}` : "";
  return `${head}${bits.length ? ` — ${bits.join(" · ")}` : ""}${f.uncorroborated ? " (seen on one pass only)" : ""}${means}`;
}

/** Disagreement in plain words: the server's own line when it sent one. */
export function disagreementLine(d: Disagreement): string {
  if (d.text) return d.text;
  const parts = [
    d.customer ? `Customer: ${d.customer}` : null,
    d.tests ? `Tests: ${d.tests}` : null,
    d.camera ? `Camera: ${d.camera}${d.confidence !== null || d.photo !== null ? ` (${[d.confidence !== null ? pct(d.confidence) : null, d.photo !== null ? `photo ${d.photo}` : null].filter(Boolean).join(", ")})` : ""}` : null,
  ].filter(Boolean);
  return `${d.topic ? `${d.topic}: ` : ""}${parts.join(" · ")}`;
}

export const GRADE_MEANING: Record<string, string> = {
  Premium: "Like new",
  A: "Faint micro-scratches",
  B: "Light visible scratches, no cracks",
  C: "Heavy scratches or dents",
  D: "Cracked glass, deep dents, bent frame or missing parts",
};

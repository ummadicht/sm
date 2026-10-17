// Shapes the store app reads from the SwapUp server. Source of truth:
// ~/projects/swapup/docs/MOBILE-API.md — keep these in step with it.

export type StoreRef = { id: string; name: string; code: string; city: string; kind: string; status?: "pending" | "active" | "rejected"; reviewNote?: string | null };

export type StaffUser = {
  id: string;
  name: string;
  username?: string;
  role: string;
  roleLabel: string;
  org: { id: string; name: string; demo: boolean } | null;
  store: StoreRef | null;
};

export type TokenResponse = { token: string; expiresAt: string; user: StaffUser };

export type CreditState = "ok" | "warn" | "full" | "over";

export type CreditSummary = {
  store?: StoreRef;
  policy?: { limit: number; warnAt: number; maxAgeDays: number; pickupAtCount: number; releaseOn: "collected" | "cleared" };
  position: {
    limit: number;
    exposure: number;
    available: number;
    /** 0–1; JSON turns Infinity (a zero limit with exposure) into null. */
    utilisation: number | null;
    held: number;
    chargebacksOpen: number;
    state: CreditState;
  };
  advice: { due: boolean; reasons: string[]; oldestDays: number | null };
  held: { caseId: string; value: number; heldSince: string; ref?: string; label?: string }[];
};

export type Outcome = "pass" | "fail" | "skip" | "unsupported";

export type SessionStatus = "waiting" | "opened" | "joined" | "testing" | "complete" | "applied" | "expired" | "cancelled";

export type SessionDevice = {
  brand: string | null;
  manufacturer: string | null;
  modelName: string | null;
  modelCode: string | null;
  osVersion: string | null;
  totalDiskBytes: number | null;
  totalMemoryBytes: number | null;
  batteryLevelPct: number | null;
  isPhysicalDevice: boolean | null;
  appVersion: string | null;
};

export type DiagnosticSummary = {
  model: { modelId: string | null; label: string | null; variant: string | null; match: "exact" | "family" | "none"; why: string };
  faults: { id: string; because: string }[];
  untested: { id: string; name: string; critical: boolean }[];
  notes: string[];
  verdict: "all_passed" | "faults_found" | "incomplete";
};

export type TestSessionView = {
  id: string;
  code: string;
  caseId: string;
  caseRef: string;
  status: SessionStatus;
  createdAt: string;
  expiresAt: string;
  openedAt: string | null;
  joinedAt: string | null;
  completedAt: string | null;
  appliedAt: string | null;
  device: SessionDevice | null;
  plan: { id: string; name: string; critical: boolean }[];
  results: Record<string, { outcome: Outcome; detail: Record<string, unknown> | null; at: string }>;
  declared: { screenCracked: boolean | null; backCracked: boolean | null; liquid: boolean | null; imei: string | null } | null;
  progress: { done: number; total: number };
  summary: DiagnosticSummary | null;
  /** GradeIQ camera step (MOBILE-API.md, "grading"). Read it only through ./grading.ts readGrading(). */
  grading?: unknown;
};

export type WifiSecurity = "WPA" | "WEP" | "nopass";

/** POST /api/test-sessions and …/reissue. */
export type SessionLinks = {
  session: TestSessionView;
  joinUrl: string;
  deepLink?: string;
  downloadUrl?: string;
  wifi: { ssid: string; qr: string } | null;
};

export type WifiResponse = {
  wifi: { ssid: string; password: string; security: WifiSecurity; hidden: boolean } | null;
  qr: string | null;
};

/** Where the session screen is: a session, maybe with the links the server just returned. */
export type Screen =
  | { name: "home" }
  | { name: "new" }
  | { name: "session"; id: string; links?: SessionLinks }
  | { name: "settings" }
  | { name: "web"; url: string; title: string; back: Screen };

export const TERMINAL: ReadonlySet<SessionStatus> = new Set(["applied", "expired", "cancelled"]);

/** Some endpoints wrap the view as { session }, some return it bare — accept both. */
export function unwrapSession(x: unknown): TestSessionView | null {
  if (!x || typeof x !== "object") return null;
  const o = x as { session?: unknown; status?: unknown; id?: unknown };
  if (o.session && typeof o.session === "object" && "status" in (o.session as object)) return o.session as TestSessionView;
  if (typeof o.status === "string" && typeof o.id === "string") return x as TestSessionView;
  return null;
}

// ── Store tablet (docs/STORE-TABLET.md in ~/projects/swapup) ────────────────

/** One name on "Who's serving?": an active advisor or store manager of the tablet's store. */
export type TabletStaff = { id: string; name: string; role: string; roleLabel: string; hasPin: boolean };

/** GET /api/tablet (Authorization: Device <token>). */
export type TabletView = {
  device: { id: string; name: string };
  store: { id: string; name: string; code: string; city: string; status?: "pending" | "active" | "rejected" };
  org: { name: string; demo: boolean } | null;
  staff: TabletStaff[];
};

/** POST /api/store-devices — the device token is in this answer once and never again. */
export type StoreDeviceCreated = {
  deviceToken: string;
  device: { id: string; name: string; createdAt: string };
  store: { id: string; name: string; code: string; city: string };
};

/** GET /api/store-devices — newest first, removed ones included. */
export type StoreDevice = { id: string; name: string; createdAt: string; createdBy: string | null; lastSeenAt: string | null; revokedAt: string | null };

/** The answer to GET /api/tablet, or null when it isn't one (wrong server, proxy page). */
export function readTabletView(x: unknown): TabletView | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Partial<TabletView>;
  if (!o.device || typeof o.device.id !== "string" || !o.store || typeof o.store.name !== "string" || !Array.isArray(o.staff)) return null;
  const staff = o.staff.filter((p): p is TabletStaff => !!p && typeof p.id === "string" && typeof p.name === "string");
  return { device: o.device, store: o.store, org: o.org ?? null, staff };
}

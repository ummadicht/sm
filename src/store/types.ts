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

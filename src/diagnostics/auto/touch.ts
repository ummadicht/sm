// The touch grid's automatic verdict (docs/AUTO-TESTS.md "touch": grid cleared
// = pass, timeout with a dead region = fail). No buttons: the grid decides.
//
// "Dead region" needs evidence, not just an unfinished grid: the finger kept
// arriving right next to the squares that are left (near misses — on a dead
// strip the touch stream stops at its edge and resumes on the other side) for
// a good while, with nothing new clearing. Someone who simply stops swiping is
// "not tested", never "failed". No runtime imports — node --test runs it.

export const COLS = 6;
export const ROWS = 10;
export const CELLS = COLS * ROWS;

/** Seconds of near misses without progress before the remaining squares count as dead. */
export const DEAD_AFTER_MS = 15_000;
export const DEAD_MIN_NEAR_MISSES = 25;
/** Only call it a dead region when most of the screen works — a mostly-uncleared grid is not evidence. */
export const DEAD_MAX_REMAINING = Math.floor(CELLS * 0.25);
/** No touches at all for this long → stop waiting (skip). */
export const IDLE_GIVE_UP_MS = 45_000;
/** Absolute cap. */
export const MAX_MS = 150_000;

export function cellAt(x: number, y: number, w: number, h: number): number | null {
  if (!(w > 0 && h > 0)) return null;
  const c = Math.floor((x / w) * COLS);
  const r = Math.floor((y / h) * ROWS);
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
  return r * COLS + c;
}

/** Is `cell` (cleared) one of the 8 neighbours of a square still left? */
export function nextToRemaining(cell: number, cleared: boolean[]): boolean {
  const r = Math.floor(cell / COLS), c = cell % COLS;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
      if (!cleared[rr * COLS + cc]) return true;
    }
  }
  return false;
}

export type TouchState = {
  cleared: boolean[];
  startedAt: number;
  lastTouchAt: number | null;
  lastProgressAt: number;
  /** Touches since the last newly-cleared square that landed next to a square still left. */
  nearMisses: number;
};

export function newTouchState(now: number): TouchState {
  return { cleared: Array(CELLS).fill(false), startedAt: now, lastTouchAt: null, lastProgressAt: now, nearMisses: 0 };
}

/** Fold a batch of touched cells (one touch event) into the state. */
export function applyTouches(st: TouchState, cells: (number | null)[], now: number): TouchState {
  let cleared = st.cleared;
  let progressed = false;
  let near = 0;
  for (const cell of cells) {
    if (cell == null) continue;
    if (!cleared[cell]) {
      if (cleared === st.cleared) cleared = [...st.cleared];
      cleared[cell] = true;
      progressed = true;
    } else if (nextToRemaining(cell, cleared)) near++;
  }
  return {
    cleared,
    startedAt: st.startedAt,
    lastTouchAt: now,
    lastProgressAt: progressed ? now : st.lastProgressAt,
    nearMisses: progressed ? 0 : st.nearMisses + near,
  };
}

export type TouchVerdict = { outcome: "pass" | "fail" | "skip"; detail: Record<string, string | number | boolean | null> } | null;

/** null = keep waiting. */
export function touchVerdict(st: TouchState, now: number): TouchVerdict {
  const remaining = st.cleared.reduce((n, c) => n + (c ? 0 : 1), 0);
  const base = { method: "touch grid", cells: CELLS, cleared: CELLS - remaining };
  if (remaining === 0) return { outcome: "pass", detail: { ...base, seconds: Math.round((now - st.startedAt) / 1000) } };
  const dead = remaining <= DEAD_MAX_REMAINING && st.nearMisses >= DEAD_MIN_NEAR_MISSES && now - st.lastProgressAt >= DEAD_AFTER_MS;
  const deadCells = () => st.cleared.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0).join(",");
  if (dead) {
    return { outcome: "fail", detail: { ...base, deadCells: deadCells(), nearMisses: st.nearMisses, reason: `${remaining} square${remaining === 1 ? "" : "s"} never responded although the finger kept reaching them` } };
  }
  const idleSince = st.lastTouchAt ?? st.startedAt;
  if (now - idleSince >= IDLE_GIVE_UP_MS) {
    return { outcome: "skip", detail: { ...base, reason: st.lastTouchAt == null ? "the grid was not touched" : "the grid was not finished" } };
  }
  if (now - st.startedAt >= MAX_MS) {
    return { outcome: "skip", detail: { ...base, leftCells: deadCells(), reason: "time ran out before every square was cleared" } };
  }
  return null;
}

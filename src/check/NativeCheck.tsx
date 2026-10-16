// The NATIVE SwapUp Check after joining (docs/AUTO-TESTS.md) — no questions:
//   Pairing (the store photographs this phone; GradeIQ grades the glass and the LCD)
//   → Automatic steps (one progress bar, ticks itself)
//   → Actions (swipe the grid, plug in the charger)
//   → Done ("Show this to the advisor").
// The browser build keeps the interactive flow in ./screens.tsx and never loads
// this file (Metro picks ./NativeCheck.web.tsx there).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BackHandler, Text, View } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { T } from "../shared/theme";
import { Big, BigEmoji, Fact, Say } from "../diagnostics/parts";
import { testById } from "../diagnostics/catalog";
import { NOT_IN_RUN_REASON, nativeStep, partitionPlan, rerunnable } from "../diagnostics/auto/plan";
import { AutoRunner } from "../diagnostics/auto/AutoRunner";
import { ChargingAction, TouchAction } from "../diagnostics/auto/Actions";
import { PairingScreen } from "./PairingScreen";
import { Screen, SyncBadge, Title, Note } from "./screens";
import { countResults, type Detail, type Outcome, type PairingRec } from "./core";
import type { CheckEngine, Snapshot } from "./engine";

const KEEP_AWAKE = "swapup-check-native";

type Rerun = { auto: string[]; actions: string[]; stage: "auto" | "actions"; n: number };

export function NativeCheck({
  engine,
  snap,
  onBleed,
  onWrongCode,
  onNewCheck,
}: {
  engine: CheckEngine;
  snap: Snapshot;
  onBleed: (on: boolean) => void;
  onWrongCode: () => void;
  onNewCheck: () => void;
}) {
  const st = snap.state!;
  const plan = useMemo(() => partitionPlan(st.session.plan.map((p) => p.id)), [st.session.plan]);
  const names = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of st.session.plan) m[p.id] = testById(p.id)?.title ?? p.name;
    return m;
  }, [st.session.plan]);
  const [rerun, setRerun] = useState<Rerun | null>(null);
  const [rerunAction, setRerunAction] = useState(0);
  const record = useCallback((id: string, o: Outcome, d: Detail | null) => void engine.record(id, o, d), [engine]);

  // The pairing screen's privacy line stands in for the browser's welcome screen.
  useEffect(() => {
    if (!st.consentAt) void engine.consent();
  }, [engine, st.consentAt]);

  const base = nativeStep(!!st.pairing, st.results, plan);
  const step = rerun ? rerun.stage : base;
  const busy = step !== "done";

  // Tests the automatic run leaves out are reported as such — never silently missing.
  useEffect(() => {
    if (step === "pairing") return;
    for (const id of plan.notInRun) if (!st.results[id]) record(id, "skip", { method: "not run", reason: NOT_IN_RUN_REASON });
    for (const id of plan.unknown) if (!st.results[id]) record(id, "unsupported", { method: "not run", reason: "not available in this app" });
  }, [step, plan, st.results, record]);

  // Screen on, and Android back does nothing, while the phone is working.
  useEffect(() => {
    if (!busy) return;
    activateKeepAwakeAsync(KEEP_AWAKE).catch(() => {});
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => {
      sub.remove();
      deactivateKeepAwake(KEEP_AWAKE).catch(() => {});
    };
  }, [busy]);

  // Done: tell the store "complete" once, then ask every few seconds whether it has applied the results.
  useEffect(() => {
    if (step === "done" && !st.completeAt) void engine.finish();
  }, [engine, step, st.completeAt]);
  useEffect(() => {
    if (step !== "done") return;
    let t: ReturnType<typeof setTimeout>;
    let alive = true;
    const tick = async () => {
      const r = await engine.pollStatus();
      if (!alive || r?.status === "applied") return;
      t = setTimeout(tick, 4000);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [engine, step]);

  const pairingDone = useCallback(
    async (rec: Omit<PairingRec, "at">) => {
      await engine.setPairing({ ...rec, at: new Date().toISOString() });
      // No camera sweep will happen: say so on `display` (the server's worse-of rule
      // still lets a later camera result win). Otherwise the phone never posts display.
      const cur = engine.getSnapshot().state;
      if ((rec.outcome === "skipped" || rec.outcome === "unavailable") && plan.server.includes("display") && cur && !cur.results.display) {
        await engine.record("display", "skip", { method: "GradeIQ camera sweep", photos: rec.outcome, reason: `not camera-checked: ${rec.reason ?? rec.outcome}` });
      }
    },
    [engine, plan]
  );

  if (step === "pairing") {
    return <PairingScreen engine={engine} state={st} onDone={(r) => void pairingDone(r)} onBleed={onBleed} onWrongCode={onWrongCode} />;
  }

  if (step === "auto") {
    const all = rerun ? rerun.auto : plan.auto;
    const todo = rerun ? rerun.auto : plan.auto.filter((id) => !st.results[id]);
    return (
      <AutoRunner
        key={rerun ? `rerun-${rerun.n}` : "main"}
        all={all}
        todo={todo}
        names={names}
        existing={st.results}
        onResult={record}
        onDone={() => {
          if (rerun) {
            if (rerun.actions.length) {
              setRerunAction(0);
              setRerun({ ...rerun, stage: "actions" });
            } else setRerun(null);
            return;
          }
          // Every test the runner was given reports something; this only guards against a silent gap.
          const now = engine.getSnapshot().state;
          for (const id of plan.auto) if (now && !now.results[id]) record(id, "skip", { method: "error", reason: "the check did not report a result" });
        }}
        status={<SyncBadge snap={snap} />}
      />
    );
  }

  if (step === "actions") {
    const list = rerun ? rerun.actions : plan.actions;
    const idx = rerun ? rerunAction : list.findIndex((id) => !st.results[id]);
    const id = list[idx];
    if (!id) return <Screen scroll={false}>{null}</Screen>;
    const onResult = (o: Outcome, d: Detail) => {
      record(id, o, d);
      if (!rerun) return;
      if (idx + 1 >= list.length) setRerun(null);
      else setRerunAction(idx + 1);
    };
    const key = `${id}-${rerun ? rerun.n : "main"}`;
    const n = { step: idx + 1, steps: list.length };
    return id === "touch" ? <TouchAction key={key} onResult={onResult} {...n} /> : <ChargingAction key={key} onResult={onResult} {...n} />;
  }

  return (
    <NativeDone
      snap={snap}
      planIds={plan}
      onRerun={(ids) => {
        setRerun({ auto: plan.auto.filter((i) => ids.includes(i)), actions: plan.actions.filter((i) => ids.includes(i)), stage: plan.auto.some((i) => ids.includes(i)) ? "auto" : "actions", n: Date.now() });
        setRerunAction(0);
      }}
      onNewCheck={onNewCheck}
    />
  );
}

function NativeDone({
  snap,
  planIds,
  onRerun,
  onNewCheck,
}: {
  snap: Snapshot;
  planIds: ReturnType<typeof partitionPlan>;
  onRerun: (ids: string[]) => void;
  onNewCheck: () => void;
}) {
  const s = snap.state!;
  const c = countResults(s.session.plan, s.results);
  const applied = snap.remote?.status === "applied";
  const redo = rerunnable(planIds, s.results);
  const photos = s.pairing?.outcome;
  return (
    <Screen>
      <BigEmoji>{applied ? "✅" : "📱"}</BigEmoji>
      <Title>{applied ? "The store has your results" : "All done — show this to the advisor"}</Title>
      <Text style={{ color: T.text, fontSize: 22, fontWeight: "800", textAlign: "center", marginBottom: 4 }}>{s.session.caseRef}</Text>
      <Say muted center>
        {s.session.storeName}
      </Say>
      <View style={{ height: 18 }} />
      <View style={{ backgroundColor: T.surface, borderRadius: T.radius, paddingHorizontal: 16, borderWidth: 1, borderColor: T.border }}>
        <Fact label="Passed" value={String(c.passed)} tone="pass" />
        <Fact label="Failed" value={String(c.failed)} tone={c.failed ? "fail" : undefined} />
        <Fact label="Not tested" value={String(c.skipped)} tone={c.skipped ? "warn" : undefined} />
        {c.unsupported ? <Fact label="Not on this phone" value={String(c.unsupported)} tone="skip" /> : null}
        {planIds.server.length ? (
          <Fact
            label="Screen and glass"
            value={photos === "handoff" || photos === "grace" ? "photographed by the advisor" : "checked by the advisor"}
            tone="skip"
          />
        ) : null}
      </View>
      <View style={{ height: 12 }} />
      <SyncBadge snap={snap} />
      {!applied ? <Say muted>The advisor is reviewing your results on their screen.</Say> : null}
      {photos === "skipped" || photos === "unavailable" ? (
        <View style={{ marginTop: 12 }}>
          <Note tone="warn">No photos were taken, so the advisor checks the screen and the body by eye.</Note>
        </View>
      ) : null}
      {redo.length && !applied ? (
        <>
          <View style={{ height: 18 }} />
          <Big title={redo.length === 1 ? "Test that again" : `Test those ${redo.length} again`} kind="secondary" onPress={() => onRerun(redo)} />
          <Text style={{ color: T.muted, fontSize: 14, textAlign: "center", marginTop: 10 }}>
            Not tested or failed: {redo.map((id) => testById(id)?.title ?? id).join(", ")}
          </Text>
        </>
      ) : null}
      <View style={{ height: 26 }} />
      <Big title="Finish and start a new check" kind="quiet" onPress={onNewCheck} />
    </Screen>
  );
}

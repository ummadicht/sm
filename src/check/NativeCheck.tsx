// The NATIVE SwapUp Check after joining — GradeIQ v2's order, the phone leading
// (swapup docs/PHONE-LED-FLOW.md, app ≥ 0.6.0), with a step rail on every
// screen: Identify · Scan · Test · Result.
//   Identify  (is this your phone? / choose it; the IMEI from *#06#)
//   → Scan    (a QR of GradeIQ's camera link; the advisor's tablet photographs the
//              phone and sweeps its screen — vision first; GradeIQ grades the
//              glass, body and LCD while the tests below run)
//   → Battery (a screenshot of the battery-health page, read by GradeIQ)
//   → Get ready (the permission dialogs, then straight on)
//   → Automatic steps (one progress bar, ticks itself)
//   → Actions (swipe the grid, plug in the charger)
//   → Result ("Checks complete — the advisor will confirm your price").
// Each step is kept on disk (identifiedAt, pairing, battery, results), so a
// restart lands where it left off; each step change is reported to the store
// (POST /api/device/phase). The customer now waits on Scan for the advisor —
// capped by the 90 s "Skip the camera check".
// The browser build runs the same steps where it can from ../CheckApp.tsx and
// never loads this file (Metro picks ./NativeCheck.web.tsx there).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Linking, Text, View } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { T } from "../shared/theme";
import { Big, BigEmoji, Fact, Say } from "../diagnostics/parts";
import { testById } from "../diagnostics/catalog";
import { NOT_IN_RUN_REASON, nativeStep, partitionPlan, rerunnable, testsStarted } from "../diagnostics/auto/plan";
import { AutoRunner } from "../diagnostics/auto/AutoRunner";
import { ChargingAction, TouchAction } from "../diagnostics/auto/Actions";
import { PairingScreen } from "./PairingScreen";
import { IdentifyScreen } from "./IdentifyScreen";
import { BatteryScreen } from "./BatteryScreen";
import { Railed } from "./StepRail";
import { GetReady, askTestPermissions } from "./GetReady";
import { Screen, SyncBadge, Title, Note } from "./screens";
import { BATTERY_HEALTH_ID, countResults, phaseFor, startedBeforeIdentify, type BatteryRec, type Detail, type Outcome, type PairingRec } from "./core";
import { batteryResultText } from "./battery";
import type { CheckEngine, IdentifyAnswers, Snapshot } from "./engine";
import { ClearDataGuide } from "./ClearDataGuide";

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
  /** The test permissions were asked for in this run of the app (GetReady). */
  const [permsAsked, setPermsAsked] = useState(false);
  /** Permissions a re-run needed that Android will no longer ask for — only Settings can turn them on. */
  const [blockedPerms, setBlockedPerms] = useState<string[]>([]);
  const rerunStarting = useRef(false);
  const [rerunAction, setRerunAction] = useState(0);
  const record = useCallback((id: string, o: Outcome, d: Detail | null) => void engine.record(id, o, d), [engine]);

  // GetReady's privacy line stands in for the browser's welcome screen.
  useEffect(() => {
    if (!st.consentAt) void engine.consent();
  }, [engine, st.consentAt]);

  const base = nativeStep(
    {
      // A check begun by an older app (no Identify step) carries on with its tests.
      identified: !!st.identifiedAt || startedBeforeIdentify(st),
      scanned: !!st.pairing,
      // Only where the server asked for it (an older server has no screenshot reader).
      battery: !!st.battery || !plan.server.includes(BATTERY_HEALTH_ID),
    },
    st.results,
    plan
  );
  // Stay on the automatic list until the runner says it is finished (its last
  // tick stays visible), rather than jumping the moment the last result lands.
  const [autoActive, setAutoActive] = useState(false);
  useEffect(() => {
    if (base === "auto" && !rerun) setAutoActive(true);
  }, [base, rerun]);
  const step = rerun ? rerun.stage : autoActive && testsStarted(base) ? "auto" : base;
  const busy = step !== "done";

  // Where the phone is, for the store's tablet ("identifying itself", "showing its scan code"…).
  useEffect(() => {
    engine.reportPhase(phaseFor(step));
  }, [engine, step]);

  // Tests the automatic run leaves out are reported as such — never silently missing.
  useEffect(() => {
    if (!testsStarted(step)) return;
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

  if (step === "identify") {
    return (
      <Railed at="identify">
        <IdentifyScreen engine={engine} state={st} onDone={(a: IdentifyAnswers) => void engine.identify(a)} onWrongCode={onWrongCode} />
      </Railed>
    );
  }

  if (step === "scan") {
    return <PairingScreen engine={engine} state={st} onDone={(r) => void pairingDone(r)} onBleed={onBleed} />;
  }

  if (step === "battery") {
    return (
      <Railed at="test">
          <BatteryScreen engine={engine} state={st} onDone={(b: Omit<BatteryRec, "at">) => void engine.setBattery({ ...b, at: new Date().toISOString() })} />
        </Railed>
      );
    }

    if (step === "auto" && !rerun && !permsAsked) {
      return (
        <Railed at="test">
          <GetReady state={st} onReady={() => setPermsAsked(true)} onWrongCode={onWrongCode} />
        </Railed>
      );
    }

    if (step === "auto") {
      const all = rerun ? rerun.auto : plan.auto;
      const todo = rerun ? rerun.auto : plan.auto.filter((id) => !st.results[id]);
      return (
        <Railed at="test">
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
            setAutoActive(false);
          }}
          status={<SyncBadge snap={snap} />}
        />
      </Railed>
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
    return (
      <Railed at="test">
        {id === "touch" ? <TouchAction key={key} onResult={onResult} {...n} /> : <ChargingAction key={key} onResult={onResult} {...n} />}
      </Railed>
    );
  }

  return (
    <Railed at="result">
      <NativeDone
        snap={snap}
        planIds={plan}
        blockedPerms={blockedPerms}
        onRerun={(ids) => {
          if (rerunStarting.current) return;
          rerunStarting.current = true;
          // A test skipped for a refused permission can only pass if it is asked for again.
          void askTestPermissions(ids)
            .then((blocked) => setBlockedPerms(blocked))
            .catch(() => setBlockedPerms([]))
            .finally(() => {
              rerunStarting.current = false;
              setRerun({ auto: plan.auto.filter((i) => ids.includes(i)), actions: plan.actions.filter((i) => ids.includes(i)), stage: plan.auto.some((i) => ids.includes(i)) ? "auto" : "actions", n: Date.now() });
              setRerunAction(0);
            });
        }}
        onNewCheck={onNewCheck}
      />
    </Railed>
  );
}

function NativeDone({
  snap,
  planIds,
  blockedPerms,
  onRerun,
  onNewCheck,
}: {
  snap: Snapshot;
  planIds: ReturnType<typeof partitionPlan>;
  blockedPerms: string[];
  onRerun: (ids: string[]) => void;
  onNewCheck: () => void;
}) {
  const s = snap.state!;
  const c = countResults(s.session.plan, s.results);
  const applied = snap.remote?.status === "applied";
  const redo = rerunnable(planIds, s.results);
  const photos = s.pairing?.outcome;
  const byCamera = photos === "handoff" || photos === "grace";
  return (
    <Screen>
      <BigEmoji>{applied ? "✅" : "📱"}</BigEmoji>
      {/* Never a price or a grade letter here: the price comes from the store and can still change. */}
      <Title>{applied ? "The store has your results" : "Checks complete — the advisor will confirm your price."}</Title>
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
        {planIds.server.includes("display") ? (
          <Fact label="Screen and glass" value={byCamera ? "checked by the store's camera" : "checked by eye"} tone="skip" />
        ) : null}
        {planIds.server.includes(BATTERY_HEALTH_ID) ? <Fact label="Battery health" value={batteryResultText(s.battery)} tone="skip" /> : null}
      </View>
      <View style={{ height: 12 }} />
      <SyncBadge snap={snap} />
      {!applied ? <Say muted>The advisor is reviewing your results on their screen.</Say> : null}
      <ClearDataGuide applied={applied} />
      {photos === "skipped" || photos === "unavailable" ? (
        <View style={{ marginTop: 12 }}>
          <Note tone="warn">The camera didn't check the screen, so the advisor checks it by eye.</Note>
        </View>
      ) : null}
      {blockedPerms.length && !applied ? (
        <View style={{ marginTop: 14, gap: 10 }}>
          <Note tone="warn">{`The ${blockedPerms.join(" and ")} ${blockedPerms.length === 1 ? "is" : "are"} turned off for SwapUp Check, so those tests can't run. Turn ${blockedPerms.length === 1 ? "it" : "them"} on in Settings, then test again.`}</Note>
          <Big title="Open Settings" kind="secondary" onPress={() => void Linking.openSettings().catch(() => {})} />
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

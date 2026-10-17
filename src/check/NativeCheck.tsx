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
import { BackHandler, Linking, View } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { Caption, Card, ChecklistArt, FactRow, Gap, Headline, Hero, Lead, Notice, PillButton, QuietLink, Screen, TickArt, Wordmark } from "../shared/kit";
import { testById } from "../diagnostics/catalog";
import { NOT_IN_RUN_REASON, nativeStep, partitionPlan, rerunnable, testsStarted } from "../diagnostics/auto/plan";
import { AutoRunner } from "../diagnostics/auto/AutoRunner";
import { ChargingAction, TouchAction } from "../diagnostics/auto/Actions";
import { PairingScreen } from "./PairingScreen";
import { IdentifyScreen } from "./IdentifyScreen";
import { BatteryScreen } from "./BatteryScreen";
import { Railed } from "./StepRail";
import { GetReady, askTestPermissions } from "./GetReady";
import { SyncBadge } from "./screens";
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
  const rows: { label: string; value: string; tone?: "pass" | "fail" | "warn" | "muted" }[] = [
    { label: "Trade-in", value: s.session.caseRef },
    { label: "Passed", value: String(c.passed), tone: "pass" },
    { label: "Failed", value: String(c.failed), tone: c.failed ? "fail" : undefined },
    { label: "Not tested", value: String(c.skipped), tone: c.skipped ? "warn" : undefined },
  ];
  if (c.unsupported) rows.push({ label: "Not on this phone", value: String(c.unsupported), tone: "muted" });
  if (planIds.server.includes("display")) rows.push({ label: "Screen and glass", value: byCamera ? "checked by the store's camera" : "checked by eye", tone: "muted" });
  if (planIds.server.includes(BATTERY_HEALTH_ID)) rows.push({ label: "Battery health", value: batteryResultText(s.battery), tone: "muted" });
  return (
    <Screen
      footer={
        <>
          {redo.length && !applied ? (
            <PillButton title={redo.length === 1 ? "Test that again" : `Test those ${redo.length} again`} kind="outline" onPress={() => onRerun(redo)} />
          ) : null}
          <QuietLink title="Finish and start a new check" onPress={onNewCheck} />
        </>
      }
    >
      <Wordmark store={s.session.storeName} />
      {/* Never a price or a grade letter here: the price comes from the store and can still change. */}
      <Headline>{applied ? "The store has your results" : "Checks complete"}</Headline>
      {!applied ? <Lead>The advisor will confirm your price.</Lead> : null}
      <Hero grow={false} minHeight={0} style={{ paddingVertical: 24 }}>
        {applied ? <TickArt width={104} /> : <ChecklistArt width={92} ticked={3} />}
      </Hero>
      <Card pad={false} style={{ paddingHorizontal: 20 }}>
        {rows.map((r, i) => (
          <FactRow key={r.label} label={r.label} value={r.value} tone={r.tone} last={i === rows.length - 1} />
        ))}
      </Card>
      <Gap h={14} />
      <SyncBadge snap={snap} center />
      {!applied ? <Caption>The advisor is reviewing your results on their screen.</Caption> : null}
      <ClearDataGuide applied={applied} />
      {photos === "skipped" || photos === "unavailable" ? (
        <Notice tone="warn" style={{ marginTop: 12 }}>
          The camera didn&apos;t check the screen, so the advisor checks it by eye.
        </Notice>
      ) : null}
      {blockedPerms.length && !applied ? (
        <View style={{ marginTop: 14, gap: 10 }}>
          <Notice tone="warn">{`The ${blockedPerms.join(" and ")} ${blockedPerms.length === 1 ? "is" : "are"} turned off for SwapUp Check, so those tests can't run. Turn ${blockedPerms.length === 1 ? "it" : "them"} on in Settings, then test again.`}</Notice>
          <PillButton title="Open Settings" kind="outline" size="sm" onPress={() => void Linking.openSettings().catch(() => {})} style={{ alignSelf: "flex-start" }} />
        </View>
      ) : null}
      {redo.length && !applied ? <Caption>Not tested or failed: {redo.map((id) => testById(id)?.title ?? id).join(", ")}</Caption> : null}
    </Screen>
  );
}

// The NATIVE SwapUp Check after joining — the phone leading (swapup docs/PHONE-LED-FLOW.md,
// app ≥ 0.6.0), with a step rail on every screen: Scan · Test · Done (owner, 2026-10-17:
// "Reduce the flow"). The customer is asked nothing about the phone's condition: the camera
// checks it, and the advisor certifies what the camera couldn't, by name, in SwapUp Store.
//   Identify  (only for a phone the store couldn't name exactly: "Is this your phone?" for a
//              regional version, "Which phone is this?" for an unknown one)
//   → Scan    (a QR of GradeIQ's camera link; the advisor's tablet photographs the
//              phone and sweeps its screen — vision first; GradeIQ grades the
//              glass, body and LCD while the tests below run). It waits for the
//              camera, or for the advisor to go on without it — never the customer.
//   → Battery (a screenshot of the battery-health page, read by GradeIQ — only when the store
//              has no other reading, e.g. an attached Phonecheck report; Skip is always there)
//   → Get ready (the permission dialogs, then straight on)
//   → Automatic steps (one progress bar, ticks itself)
//   → Actions (swipe the grid, plug in the charger)
//   → Result ("Checks complete — the advisor will confirm your price"). It shows the
//              colours full-screen when asked: a camera page that comes back, or the
//              advisor's check by eye (./ResultColours.tsx).
// Each step is kept on disk (identifiedAt, pairing, battery, results), so a
// restart lands where it left off; each step change is reported to the store
// (POST /api/device/phase).
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
import { Pattern, PairingScreen } from "./PairingScreen";
import { useResultColours } from "./ResultColours";
import { IdentifyScreen } from "./IdentifyScreen";
import { BatteryScreen } from "./BatteryScreen";
import { Railed } from "./StepRail";
import { GetReady, askTestPermissions } from "./GetReady";
import { ReportLink, SyncBadge } from "./screens";
import { customerReport, donePollMs } from "./report";
import { BATTERY_HEALTH_ID, countResults, displayAfterScan, identifyDone, phaseFor, type BatteryRec, type Detail, type Outcome, type PairingRec } from "./core";
import { batteryResultText } from "./battery";
import { APPLIED_MESSAGE, type CheckEngine, type IdentifyAnswers, type Snapshot } from "./engine";
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
      // Only an unrecognised phone has an Identify screen; a check begun by an older app carries on with its tests.
      identified: identifyDone(st),
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

  // Done: tell the store "complete" once, then ask every few seconds whether it has applied the
  // results — every 1.5 s while the advisor is checking the screen by eye (the colours stop
  // soon after they tap).
  useEffect(() => {
    if (step === "done" && !st.completeAt) void engine.finish();
  }, [engine, step, st.completeAt]);
  useEffect(() => {
    if (step !== "done") return;
    let t: ReturnType<typeof setTimeout>;
    let alive = true;
    const tick = async () => {
      const r = await engine.pollStatus();
      // Ended (cancelled, expired): nothing more to read. Applied: on, slowly — a newer report
      // version moves the grade its link already opens (./report.ts donePollMs).
      if (!alive || engine.getSnapshot().state?.ended) return;
      t = setTimeout(tick, donePollMs(r));
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
      // still lets a later camera result or the advisor's certification win). Otherwise
      // the phone never posts display.
      const cur = engine.getSnapshot().state;
      const d = cur ? displayAfterScan(rec, plan.server, cur.results) : null;
      if (d) await engine.record("display", "skip", d);
    },
    [engine, plan]
  );

  // The result screen's colours: a camera page that comes back, or the advisor's check by eye.
  const open = step === "done" && snap.remote?.status !== "applied";
  const colours = useResultColours(engine, snap, open, onBleed);

  if (step === "identify") {
    return (
      <Railed at="scan">
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

  if (colours) return <Pattern name={colours.name} caption={colours.caption} />;

  return (
    <Railed at="done">
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

/**
 * A check the store applied that this app was reopened on (state.ended === APPLIED_MESSAGE):
 * the same finish screen as when it happens live — nothing more runs, nothing is re-tested.
 */
export function NativeApplied({ snap, onNewCheck }: { snap: Snapshot; onNewCheck: () => void }) {
  const plan = useMemo(() => partitionPlan(snap.state!.session.plan.map((p) => p.id)), [snap.state]);
  return (
    <Railed at="done">
      <NativeDone snap={snap} planIds={plan} blockedPerms={[]} onRerun={() => {}} onNewCheck={onNewCheck} />
    </Railed>
  );
}

/** The one finish screen: "Checks complete", then — once the store applies the results — "The store has your results". */
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
  const applied = snap.remote?.status === "applied" || s.ended === APPLIED_MESSAGE;
  // The grade and the report link, once the store has applied the results and sent them.
  const report = applied ? customerReport(snap.remote, s.server) : null;
  const redo = rerunnable(planIds, s.results);
  const photos = s.pairing?.outcome;
  // The camera photographed it; whatever it couldn't decide, the advisor checks — never the customer.
  const byCamera = photos === "handoff" || photos === "grace";
  const rows: { label: string; value: string; tone?: "pass" | "fail" | "warn" | "muted" }[] = [
    { label: "Trade-in", value: s.session.caseRef },
    { label: "Passed", value: String(c.passed), tone: "pass" },
    { label: "Failed", value: String(c.failed), tone: c.failed ? "fail" : undefined },
    { label: "Not tested", value: String(c.skipped), tone: c.skipped ? "warn" : undefined },
  ];
  if (c.unsupported) rows.push({ label: "Not on this phone", value: String(c.unsupported), tone: "muted" });
  if (planIds.server.includes("display")) rows.push({ label: "Screen and glass", value: byCamera ? "Store camera" : "Advisor", tone: "muted" });
  if (planIds.server.includes(BATTERY_HEALTH_ID)) rows.push({ label: "Battery health", value: batteryResultText(s.battery), tone: "muted" });
  if (report?.grade) rows.push({ label: "SwapUp grade", value: report.grade });
  return (
    <Screen
      footer={
        applied ? (
          <PillButton title="Test another phone" onPress={onNewCheck} />
        ) : (
          <>
            {redo.length ? <PillButton title={redo.length === 1 ? "Retry 1 test" : `Retry ${redo.length} tests`} kind="outline" onPress={() => onRerun(redo)} /> : null}
            <QuietLink title="New check" onPress={onNewCheck} />
          </>
        )
      }
    >
      <Wordmark store={s.session.storeName} />
      {/* Never a price here: it comes from the store and can still change. The SwapUp grade
          shows only once the store has applied the results and graded them. */}
      <Headline>{applied ? "The store has your results" : "Checks complete"}</Headline>
      <Lead>{applied ? "Nothing more to do here." : "The advisor confirms your price."}</Lead>
      <Hero grow={false} minHeight={0} style={{ paddingVertical: 24 }}>
        {applied ? <TickArt width={104} /> : <ChecklistArt width={92} ticked={3} />}
      </Hero>
      <Card pad={false} style={{ paddingHorizontal: 20 }}>
        {rows.map((r, i) => (
          <FactRow key={r.label} label={r.label} value={r.value} tone={r.tone} last={i === rows.length - 1} />
        ))}
      </Card>
      <ReportLink report={report} style={{ marginTop: 14 }} />
      <Gap h={14} />
      <SyncBadge snap={snap} center />
      <ClearDataGuide applied={applied} />
      {blockedPerms.length && !applied ? (
        <View style={{ marginTop: 14, gap: 10 }}>
          <Notice tone="warn">{`${blockedPerms.join(" and ").replace(/^./, (c) => c.toUpperCase())} ${blockedPerms.length === 1 ? "is" : "are"} off — turn ${blockedPerms.length === 1 ? "it" : "them"} on in Settings.`}</Notice>
          <PillButton title="Open Settings" kind="outline" size="sm" onPress={() => void Linking.openSettings().catch(() => {})} style={{ alignSelf: "flex-start" }} />
        </View>
      ) : null}
      {redo.length && !applied ? <Caption>To retry: {redo.map((id) => testById(id)?.title ?? id).join(", ")}</Caption> : null}
    </Screen>
  );
}

// THE result screen of SwapUp Check — ONE screen for the native app and the browser (answer spec
// §F2: the two used to draw their own finish screens, and could drift). The words and states are
// ./report.ts's (resultHead, resultFacts, clearDataGuide); the answer is the server's, drawn by the
// shared ../shared/AnswerBlock exactly as SwapUp Store draws it.
//   Before the store applies the results: "Checks complete", the checklist, the facts, Retry.
//   After: the answer's own headline over the answer (the grade, the market price, what we pay, the
//   bonus, the repair) — or, while it isn't priced yet, "The store has your results" with the
//   server's one sentence; from an older server that sends no answer, as before ("Nothing more to
//   do here."), with the SwapUp grade among the facts. Then the facts, the report link, the sync line.
// Whether this screen saw the store apply the results or the app was reopened on a check that ended
// that way (state.ended === APPLIED_MESSAGE, the status read again by engine.readAppliedStatus), it
// is the same screen.
import React, { useMemo } from "react";
import { Linking, View } from "react-native";
import { Caption, Card, ChecklistArt, FactRow, Gap, Headline, Hero, Lead, Notice, PillButton, QuietLink, Screen, TickArt, Wordmark } from "../shared/kit";
import { IS_WEB } from "../shared/config";
import { readAnswer, answerSide } from "../shared/answer";
import { AnswerBlock } from "../shared/AnswerBlock";
import { partitionPlan } from "../diagnostics/auto/plan";
import { APPLIED_MESSAGE, type Snapshot } from "./engine";
import { ClearDataGuide } from "./ClearDataGuide";
import { ReportLink, SyncBadge } from "./screens";
import { clearDataGuide, customerReport, resultFacts, resultHead } from "./report";

export function ResultScreen({
  snap,
  redo,
  onRerun,
  onNewCheck,
  blockedPerms = [],
}: {
  snap: Snapshot;
  /** The tests this screen offers to run again — the caller's own list (native and browser run them differently). */
  redo: { ids: string[]; names: string[] };
  onRerun: (ids: string[]) => void;
  onNewCheck: () => void;
  /** Native only: permissions a re-run needed that only Settings can turn on now. */
  blockedPerms?: string[];
}) {
  const s = snap.state!;
  const remote = snap.remote;
  const applied = remote?.status === "applied" || s.ended === APPLIED_MESSAGE;
  // The report link and the answer, once the store has applied the results and sent them.
  const report = applied ? customerReport(remote, s.server) : null;
  const answer = applied ? readAnswer(remote?.answer) : undefined;
  const serverDecides = useMemo(() => partitionPlan(s.session.plan.map((p) => p.id)).server, [s.session.plan]);
  const facts = resultFacts(s, { web: IS_WEB, serverDecides, grade: report?.grade ?? null, answer });
  const head = resultHead(applied, answer);
  const clear = clearDataGuide(applied, answer);
  const retry = !applied && redo.ids.length > 0;
  return (
    <Screen
      footer={
        applied ? (
          <PillButton title="Test another phone" onPress={onNewCheck} />
        ) : (
          <>
            {retry ? <PillButton title={redo.ids.length === 1 ? "Retry 1 test" : `Retry ${redo.ids.length} tests`} kind="outline" onPress={() => onRerun(redo.ids)} /> : null}
            <QuietLink title="New check" onPress={onNewCheck} />
          </>
        )
      }
    >
      <Wordmark store={s.session.storeName} />
      <Headline>{head.headline}</Headline>
      {head.lead ? <Lead>{head.lead}</Lead> : null}
      {head.show === "answer" && answer?.ready ? (
        <View style={{ marginTop: 18, marginBottom: 14 }}>
          <AnswerBlock answer={answer} recommended={answerSide(answer.headline)} />
        </View>
      ) : (
        <Hero grow={false} minHeight={0} style={{ paddingVertical: 24 }}>
          {head.show === "checklist" ? <ChecklistArt width={92} ticked={3} /> : <TickArt width={104} />}
        </Hero>
      )}
      <Card pad={false} style={{ paddingHorizontal: 20 }}>
        {facts.map((r, i) => (
          <FactRow key={r.label} label={r.label} value={r.value} tone={r.tone} last={i === facts.length - 1} />
        ))}
      </Card>
      <ReportLink report={report} style={{ marginTop: 14 }} />
      <Gap h={14} />
      <SyncBadge snap={snap} center />
      {clear ? <ClearDataGuide applied={clear === "card"} /> : null}
      {blockedPerms.length && !applied ? (
        <View style={{ marginTop: 14, gap: 10 }}>
          <Notice tone="warn">{`${blockedPerms.join(" and ").replace(/^./, (c) => c.toUpperCase())} ${blockedPerms.length === 1 ? "is" : "are"} off — turn ${blockedPerms.length === 1 ? "it" : "them"} on in Settings.`}</Notice>
          <PillButton title="Open Settings" kind="outline" size="sm" onPress={() => void Linking.openSettings().catch(() => {})} style={{ alignSelf: "flex-start" }} />
        </View>
      ) : null}
      {retry ? <Caption>To retry: {redo.names.join(", ")}</Caption> : null}
    </Screen>
  );
}

// Every test renders inside this shell: header with the gamified title, the
// test body, and a verdict bar. Auto tests call `onResult` themselves; confirm
// tests rely on the tester pressing Pass / Fail. Skip is always available —
// a device that can't run a test must never be graded as if it failed it.
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { FunctionalTest, Result } from "./catalog";
import { Detail } from "../shared/types";
import { T } from "../shared/theme";
import { Btn, Pill } from "../shared/ui";

export type TestProps = {
  test: FunctionalTest;
  /** Report the outcome. `detail` is attached to the session for the export. */
  onResult: (r: Result, detail?: Detail) => void;
  index: number;
  count: number;
};

type ShellProps = TestProps & {
  instructions: string;
  children: React.ReactNode;
  /** Auto tests may pre-decide; the bar shows it and lets the tester override. */
  autoVerdict?: Result | null;
  detail?: Detail;
  /** Hide the manual Pass/Fail (purely automatic tests still get Skip). */
  hideManual?: boolean;
  /** Draw the body edge-to-edge (display and touch tests). */
  bleed?: boolean;
};

export function TestShell({ test, onResult, index, count, instructions, children, autoVerdict, detail, hideManual, bleed }: ShellProps) {
  // "unsupported" = this phone/browser can't run the test. Only the browser
  // build reports it today; the bar then offers just Continue (records it as
  // untested), with no "override" — there is nothing the tester could judge.
  const unsupported = autoVerdict === "unsupported";
  const pillText =
    autoVerdict === "pass" ? "Auto pass"
    : autoVerdict === "fail" ? "Auto fail"
    : unsupported && Platform.OS === "web" ? "Can't test in a browser"
    : "Not available";
  return (
    <View style={s.root}>
      {!bleed && (
        <View style={s.head}>
          <Text style={s.step}>Test {index + 1} of {count} · {test.critical ? "critical" : "non-critical"}</Text>
          <Text style={s.title}>{test.emoji} {test.name}</Text>
          <Text style={s.game}>{test.game}</Text>
          <Text style={s.instr}>{instructions}</Text>
        </View>
      )}
      <View style={[s.body, bleed && { padding: 0 }]}>{children}</View>
      <View style={s.bar}>
        {autoVerdict ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <Pill text={pillText} tone={autoVerdict === "pass" ? "pass" : autoVerdict === "fail" ? "fail" : "skip"} />
            {!unsupported && <Text style={{ color: T.muted, fontSize: 12 }}>You can override.</Text>}
          </View>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {!(hideManual && unsupported) && <Btn title="Skip" kind="skip" onPress={() => onResult("skip", detail)} style={{ flex: 1 }} />}
          {!hideManual && <Btn title="Fail" kind="fail" onPress={() => onResult("fail", detail)} style={{ flex: 1 }} />}
          {!hideManual && <Btn title="Pass" kind="pass" onPress={() => onResult("pass", detail)} style={{ flex: 1.4 }} />}
          {hideManual && autoVerdict && autoVerdict !== "skip" && (
            <Btn title="Continue" onPress={() => onResult(autoVerdict, detail)} style={{ flex: 2 }} />
          )}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  head: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 4 },
  step: { color: T.muted, fontSize: 12, textTransform: "uppercase", letterSpacing: 1 },
  title: { color: T.text, fontSize: 24, fontWeight: "800" },
  game: { color: T.accent, fontSize: 15, fontWeight: "700" },
  instr: { color: T.muted, fontSize: 14, lineHeight: 20, marginTop: 4 },
  body: { flex: 1, padding: 20 },
  bar: { padding: 16, borderTopWidth: 1, borderTopColor: T.border, backgroundColor: T.surface },
});

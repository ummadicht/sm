// "Show to customer": the phone's grade report as a QR the customer scans with their own
// phone (grading spec §5). The link is the public report page (/r/<token>) — what was tested
// and why the phone got its grade, never a price — so it needs no sign-in and no hand-off.
// The SwapUp grade under the code is the server's label as sent (../offer.ts gradeLine),
// " · provisional" in amber while something is still to be checked by hand.
import React from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { PillButton, QuietLink, Sheet } from "../../shared/kit";
import { P } from "../../shared/theme";
import { LETTER_NOTE, SCALE_NOTE, type CaseGrading, gradeLine, reportRef } from "../offer";
import { QR } from "../QR";
import { Details, L } from "../ui";

/** Big enough to scan across a counter, small enough to leave the gutters at 375 px. */
const QR_MAX = 260;

export function ReportQrSheet({
  visible,
  onClose,
  url,
  grading,
  onOpen,
}: {
  visible: boolean;
  onClose: () => void;
  /** The report's absolute address (staffClient absolute(base, report.path)). */
  url: string;
  grading: CaseGrading;
  /** "Open it here": the same page in the app's browser, for the advisor to walk through it. */
  onOpen?: () => void;
}) {
  const { width } = useWindowDimensions();
  const size = Math.max(160, Math.min(QR_MAX, width - P.gutter * 2 - 32));
  const line = gradeLine(grading);
  const ref = reportRef(grading.report);
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Grade report"
      lead="Scan with your camera — no prices shown."
      footer={
        <>
          <PillButton title="Done" onPress={onClose} />
          {onOpen ? (
            <QuietLink
              title="Open it here"
              onPress={() => {
                onClose();
                onOpen();
              }}
            />
          ) : null}
        </>
      }
    >
      <View style={{ alignItems: "center", gap: 12, marginTop: 18 }}>
        <View style={{ padding: 12, borderRadius: L.radius, backgroundColor: "#fff", borderWidth: 1, borderColor: L.border }}>
          <QR value={url} size={size} />
        </View>
        <Text style={{ color: L.ink, fontSize: 19, lineHeight: 25, fontWeight: "700", textAlign: "center" }} accessibilityLabel={`SwapUp grade ${line.full}`}>
          SwapUp grade: {line.text}
          {line.provisional ? <Text style={{ color: L.warn }}> · provisional</Text> : null}
        </Text>
        {grading.why ? <Text style={{ color: L.muted, fontSize: 15, lineHeight: 21, textAlign: "center" }}>{grading.why}</Text> : null}
        <Text style={{ color: L.muted, fontSize: 13, lineHeight: 18, textAlign: "center" }} selectable>
          {url}
        </Text>
        {ref ? <Text style={{ color: L.muted, fontSize: 13, lineHeight: 18, textAlign: "center", fontVariant: ["tabular-nums"] }}>{ref}</Text> : null}
      </View>
      <View style={{ marginTop: 16 }}>
        {/* What the grade is, and the letter beside it — behind "Show details", closed by default. */}
        <Details>
          <Text style={{ color: L.muted, fontSize: 14, lineHeight: 20 }}>{SCALE_NOTE}</Text>
          {grading.letter ? <Text style={{ color: L.muted, fontSize: 14, lineHeight: 20 }}>{LETTER_NOTE}</Text> : null}
        </Details>
      </View>
    </Sheet>
  );
}

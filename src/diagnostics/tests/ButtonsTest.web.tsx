// Browser version of the side-button check. CHOICE: a confirm-style self-check,
// not "unsupported". Reason: the native app can't intercept volume/power keys
// either — it is the same customer tick-list — and every one of these buttons
// gives visible OS feedback (volume bar, screen locks) that works the same with
// a browser open. Two things a page CAN observe tick themselves: the screen
// locking (the page is hidden, then shown again) and, where a browser forwards
// them, volume key presses. The Back key is left out on purpose: in a browser
// it would navigate away from the test.
import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { T } from "../../shared/theme";
import { isIOS } from "../web/browser";

function buttonList(): { POWER: string; BUTTONS: string[] } {
  const ios = isIOS(); // decided when the test opens, never at import time
  const POWER = ios ? "Side button (locks the screen)" : "Power (locks the screen)";
  return { POWER, BUTTONS: ios ? ["Volume up", "Volume down", POWER, "Ring / silent switch or Action button"] : ["Volume up", "Volume down", POWER] };
}

export function ButtonsTest(p: TestProps) {
  const [{ POWER, BUTTONS }] = useState(buttonList);
  const [ok, setOk] = useState<Record<string, boolean>>({});
  const [seen, setSeen] = useState<string[]>([]);
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    const auto = (b: string, how: string) => {
      setOk((o) => ({ ...o, [b]: true }));
      setSeen((x) => (x.includes(how) ? x : [...x, how]));
    };
    const vis = () => {
      if (document.visibilityState === "hidden") hiddenAt.current = Date.now();
      else if (hiddenAt.current != null && Date.now() - hiddenAt.current < 120000) {
        hiddenAt.current = null;
        auto(POWER, "screen-lock");
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "AudioVolumeUp" || e.key === "VolumeUp") auto("Volume up", "volume-up-key");
      if (e.key === "AudioVolumeDown" || e.key === "VolumeDown") auto("Volume down", "volume-down-key");
    };
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("keydown", key);
    };
  }, [POWER]);

  const all = BUTTONS.every((b) => ok[b]);
  const detail = {
    confirmed: BUTTONS.filter((b) => ok[b]).join(", ") || null,
    total: BUTTONS.length,
    method: "customer-confirmed",
    observedByBrowser: seen.join(", ") || null,
    runtime: "browser",
  };
  return (
    <TestShell
      {...p}
      instructions="Press each button on the side of the phone and tick it when the phone reacts — the volume bar shows, the screen locks (unlock it and come back). All ticked = pass."
      detail={detail}
      autoVerdict={all ? "pass" : null}
    >
      <View style={{ flex: 1, justifyContent: "center", gap: 10 }}>
        {BUTTONS.map((b) => (
          <Pressable key={b} accessibilityRole="checkbox" accessibilityState={{ checked: !!ok[b] }} onPress={() => setOk((o) => ({ ...o, [b]: !o[b] }))} style={[s.item, ok[b] && { borderColor: T.pass }]}>
            <Text style={[s.box, ok[b] && { color: T.pass }]}>{ok[b] ? "☑" : "☐"}</Text>
            <Text style={s.label}>{b}</Text>
          </Pressable>
        ))}
        <Text style={s.note}>Your browser can't see these buttons itself, so you tick them. Locking the screen ticks itself.</Text>
      </View>
    </TestShell>
  );
}

const s = StyleSheet.create({
  item: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 64, paddingHorizontal: 18, borderRadius: T.radius, borderWidth: 1, borderColor: T.border, backgroundColor: T.surface },
  box: { color: T.muted, fontSize: 26 },
  label: { color: T.text, fontSize: 18, fontWeight: "700", flexShrink: 1 },
  note: { color: T.muted, fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 6 },
});

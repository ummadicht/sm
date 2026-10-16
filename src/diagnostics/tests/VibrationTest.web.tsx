// Browser version of "feel the buzz": navigator.vibrate (Chrome on Android)
// from the customer's tap, then the customer says whether they felt it.
// iPhone Safari has no vibration API → the browser can't test it.
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { Big, BigEmoji, Say } from "../parts";
import { CantTest } from "../web/WebParts";

function canVibrate(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export function VibrationTest(p: TestProps) {
  const [n, setN] = useState(0);
  const [refused, setRefused] = useState(false);
  if (!canVibrate()) return <CantTest p={p} reason="This browser can't make the phone vibrate." />;

  const buzz = () => {
    const ok = navigator.vibrate([400, 150, 400]); // two strong pulses, like the app
    setRefused(!ok);
    setN((x) => x + 1);
  };
  const detail = { triggered: n, browserAccepted: n ? !refused : null, method: "navigator.vibrate", runtime: "browser" };
  return (
    <TestShell {...p} instructions="Hold the phone loosely and tap Buzz. You should feel two strong pulses. Weak, rattling or no vibration is a fail." hideManual detail={detail}>
      <View style={s.wrap}>
        <BigEmoji>📳</BigEmoji>
        <Big title={n ? "Buzz again" : "Buzz"} onPress={buzz} />
        {refused ? <Say muted center style={{ fontSize: 15 }}>The browser refused to vibrate. Make sure the phone isn't on silent / Do Not Disturb, then tap Buzz again.</Say> : null}
        {n > 0 ? (
          <>
            <Say center>Did you feel two buzzes?</Say>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Big title="No" kind="fail" onPress={() => p.onResult("fail", detail)} style={{ flex: 1 }} />
              <Big title="Yes" kind="pass" onPress={() => p.onResult("pass", detail)} style={{ flex: 1.4 }} />
            </View>
          </>
        ) : null}
      </View>
    </TestShell>
  );
}

const s = StyleSheet.create({ wrap: { flex: 1, justifyContent: "center", gap: 18 } });

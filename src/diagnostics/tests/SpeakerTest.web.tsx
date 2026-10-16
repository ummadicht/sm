// Browser version of "count the beeps". The beeps are synthesised into a WAV
// and played through an <audio> element from the customer's tap (iPhones mute
// Web Audio when the ring/silent switch is on, but not media playback). The
// right-answer logic is the native one: right count = pass, two wrong = fail.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { TestProps, TestShell } from "../TestShell";
import { T } from "../../shared/theme";
import { Big, BigEmoji, Say } from "../parts";
import { CantBody } from "../web/WebParts";
import { beepsWavUrl, errName } from "../web/browser";

export function SpeakerTest(p: TestProps) {
  const urls = useMemo(() => {
    try {
      return [beepsWavUrl(1), beepsWavUrl(2), beepsWavUrl(3)];
    } catch {
      return null;
    }
  }, []);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [answer, setAnswer] = useState(() => 1 + Math.floor(Math.random() * 3));
  const [played, setPlayed] = useState(false);
  const [wrong, setWrong] = useState(0);
  const [msg, setMsg] = useState("");
  const [playErr, setPlayErr] = useState<string | null>(null);
  const done = useRef(false);

  useEffect(() => {
    if (typeof Audio !== "undefined") audio.current = new Audio();
    return () => {
      audio.current?.pause();
      audio.current = null;
      urls?.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [urls]);

  if (!urls || typeof Audio === "undefined") {
    const reason = "This browser can't play sound.";
    return (
      <TestShell {...p} instructions={reason} autoVerdict="unsupported" hideManual detail={{ reason, runtime: "browser" }}>
        <CantBody emoji={p.test.emoji} />
      </TestShell>
    );
  }

  const play = () => {
    const a = audio.current;
    if (!a) return;
    setPlayErr(null);
    a.pause();
    a.src = urls[answer - 1];
    a.currentTime = 0;
    a.volume = 1;
    a.play().then(
      () => setPlayed(true),
      (e) => setPlayErr(errName(e))
    );
  };
  const guess = (n: number) => {
    if (done.current) return;
    if (n === answer) {
      done.current = true;
      p.onResult("pass", { beeps: answer, wrongGuesses: wrong, method: "html-audio", runtime: "browser" });
    } else {
      const w = wrong + 1;
      setWrong(w);
      if (w >= 2) {
        done.current = true;
        p.onResult("fail", { beeps: answer, wrongGuesses: w, method: "html-audio", runtime: "browser" });
        return;
      }
      setMsg("Not quite — listen once more.");
      setAnswer(1 + Math.floor(Math.random() * 3));
      setPlayed(false);
    }
  };

  return (
    <TestShell {...p} instructions="Turn the volume up (and silent mode off). Play the sound, then tap how many beeps you heard." hideManual detail={{ wrongGuesses: wrong, method: "html-audio", playError: playErr, runtime: "browser" }}>
      <View style={s.wrap}>
        <BigEmoji>🔊</BigEmoji>
        <Big title={played ? "Play again" : "Play sound"} kind="secondary" onPress={play} />
        {playErr ? <Say muted center style={{ fontSize: 15 }}>The sound didn't start ({playErr}). Tap Play again.</Say> : null}
        <Text style={s.q}>How many beeps?</Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {[1, 2, 3].map((n) => (
            <Big key={n} title={String(n)} onPress={() => guess(n)} disabled={!played} style={{ flex: 1 }} />
          ))}
        </View>
        {!!msg && <Text style={{ color: T.warn, textAlign: "center", fontSize: 17 }}>{msg}</Text>}
      </View>
    </TestShell>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", gap: 16 },
  q: { color: T.text, fontSize: 20, fontWeight: "800", textAlign: "center" },
});

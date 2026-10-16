import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { TestProps, TestShell } from "../TestShell";
import { Btn } from "../../shared/ui";
import { T } from "../../shared/theme";

const TONES = [require("../../../assets/tones/beep1.wav"), require("../../../assets/tones/beep2.wav"), require("../../../assets/tones/beep3.wav")];

// The phone plays 1–3 beeps through the loudspeaker; the tester reports how
// many they heard. Right answer = pass. Two wrong answers = fail. Nobody can
// pass this by tapping blindly, which is the point of "name that sound".
export function SpeakerTest(p: TestProps) {
  const players = [useAudioPlayer(TONES[0]), useAudioPlayer(TONES[1]), useAudioPlayer(TONES[2])];
  const [answer, setAnswer] = useState(() => 1 + Math.floor(Math.random() * 3));
  const [played, setPlayed] = useState(false);
  const [wrong, setWrong] = useState(0);
  const [msg, setMsg] = useState("");
  const done = useRef(false);

  useEffect(() => { setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {}); }, []);

  const play = () => {
    const pl = players[answer - 1];
    pl.seekTo(0).catch(() => {});
    pl.volume = 1;
    pl.play();
    setPlayed(true);
  };
  const guess = (n: number) => {
    if (done.current) return;
    if (n === answer) {
      done.current = true;
      p.onResult("pass", { beeps: answer, wrongGuesses: wrong });
    } else {
      const w = wrong + 1;
      setWrong(w);
      if (w >= 2) { done.current = true; p.onResult("fail", { beeps: answer, wrongGuesses: w }); return; }
      setMsg("Not quite — listen once more.");
      setAnswer(1 + Math.floor(Math.random() * 3));
      setPlayed(false);
    }
  };

  return (
    <TestShell {...p} instructions="Turn the volume up. Play the sound, then tap how many beeps you heard." hideManual detail={{ wrongGuesses: wrong }}>
      <View style={s.wrap}>
        <Text style={s.big}>🔊</Text>
        <Btn title={played ? "Play again" : "Play sound"} onPress={play} kind="ghost" />
        <Text style={s.q}>How many beeps?</Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {[1, 2, 3].map((n) => (
            <Btn key={n} title={String(n)} onPress={() => guess(n)} disabled={!played} style={{ flex: 1 }} />
          ))}
        </View>
        {!!msg && <Text style={{ color: T.warn, textAlign: "center" }}>{msg}</Text>}
      </View>
    </TestShell>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", gap: 16 },
  big: { fontSize: 72, textAlign: "center" },
  q: { color: T.text, fontSize: 18, fontWeight: "700", textAlign: "center" },
});

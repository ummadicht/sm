// Headline fonts. App.tsx loads Plus Jakarta Sans 700/800 once at start and
// says when they are ready through this context; until then (and if loading
// fails) headlines draw in the system font at the same weight. Nothing ever
// waits for a font.
import { createContext, useContext } from "react";
import type { TextStyle } from "react-native";
import { FONT } from "../theme";

export const FontsReady = createContext(false);

export function useFontsReady(): boolean {
  return useContext(FontsReady);
}

/**
 * The style for a headline face. A loaded custom face carries its own weight,
 * so no fontWeight goes with it (Android would otherwise look for a bold
 * variant of the file and fall back); the system fallback gets the weight.
 */
export function headlineFace(ready: boolean, weight: "800" | "700" = "800"): TextStyle {
  if (!ready) return { fontWeight: weight };
  return { fontFamily: weight === "800" ? FONT.headline : FONT.headlineBold, fontWeight: "normal" };
}

export function useHeadlineFace(weight: "800" | "700" = "800"): TextStyle {
  return headlineFace(useFontsReady(), weight);
}

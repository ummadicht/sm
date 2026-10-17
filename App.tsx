import React from "react";
import { useFonts } from "expo-font";
// Only the two headline weights (each subpath is one .ttf); the package root would bundle all 14.
import { PlusJakartaSans_700Bold } from "@expo-google-fonts/plus-jakarta-sans/700Bold";
import { PlusJakartaSans_800ExtraBold } from "@expo-google-fonts/plus-jakarta-sans/800ExtraBold";
import { VARIANT } from "./src/shared/config";
import { FontsReady } from "./src/shared/kit/fonts";
import { StoreApp } from "./src/store/StoreApp";
import { CheckApp } from "./src/check/CheckApp";

/**
 * Which app this build is (APP_VARIANT at build time) decides the whole tree.
 * The headline font loads in the background: everything renders at once in the
 * system font and headlines switch to Plus Jakarta Sans when it is ready (never
 * if it fails) — nothing waits for it.
 */
export default function App() {
  const [loaded] = useFonts({ PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold });
  return <FontsReady.Provider value={loaded}>{VARIANT === "store" ? <StoreApp /> : <CheckApp />}</FontsReady.Provider>;
}

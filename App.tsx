import React from "react";
import { VARIANT } from "./src/shared/config";
import { StoreApp } from "./src/store/StoreApp";
import { CheckApp } from "./src/check/CheckApp";

/** Which app this build is (APP_VARIANT at build time) decides the whole tree. */
export default function App() {
  return VARIANT === "store" ? <StoreApp /> : <CheckApp />;
}

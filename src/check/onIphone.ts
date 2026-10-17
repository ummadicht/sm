// The browser build on an iPhone or iPad. The app itself is Android only, so on
// native this is always false. An iPhone needs different words in a few places:
// Safari blocks *# dial codes in links, and its Settings paths differ
// (General › About, Battery Health & Charging).
import { IS_WEB } from "../shared/config";
import { parseUserAgent } from "./core";

export function onIphone(): boolean {
  if (!IS_WEB || typeof navigator === "undefined") return false;
  return parseUserAgent(navigator.userAgent || "", navigator.maxTouchPoints || 0).os === "ios";
}

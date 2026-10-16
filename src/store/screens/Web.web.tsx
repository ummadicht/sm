// Browser twin of ./Web.tsx (the native app shows the SwapUp desk in a WebView).
//
// In the browser the store app and the desk are the SAME origin, so the one-time
// hand-off link sets the desk's cookie for this site whichever tab opens it.
// We open it in a separate, named tab ("swapup-desk") rather than in this tab:
//  - this tab keeps the live trade-in exactly where it was (QR codes, the 2 s
//    poll, Apply) — no reload, no losing the screen to the Back button;
//  - every "Continue pricing" / "Credit & pickups" reuses that one desk tab,
//    so a busy counter doesn't pile up tabs.
// The hand-off POST happens before we get here, so a strict popup blocker
// (Safari) may refuse the automatic open; then a tap on a real button opens it,
// with "open it in this tab instead" as the always-works fallback.
import React, { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { Banner, Body, Btn, Card, H1, TopBar, useLayout } from "../ui";

const DESK_TAB = "swapup-desk";
/** The hand-off link lasts 60 s on the server; stop offering it a little before. */
const LINK_LIFE_MS = 55_000;

/**
 * The hand-off must run on THIS origin — that is where the desk is and where its
 * cookie has to land. The server may answer with an absolute URL built from its
 * configured public address (e.g. http://localhost:4500 behind the local proxy,
 * or another alias of the same server); keep its path and query, use our origin.
 */
export function sameOriginUrl(url: string): string {
  try {
    const u = new URL(url, window.location.href);
    return u.origin === window.location.origin ? u.href : window.location.origin + u.pathname + u.search + u.hash;
  } catch {
    return url;
  }
}

function openDeskTab(url: string): boolean {
  try {
    const w = window.open(url, DESK_TAB);
    if (!w) return false;
    try {
      w.focus();
    } catch {
      /* some browsers refuse focus; the tab is open anyway */
    }
    return true;
  } catch {
    return false;
  }
}

export function WebScreen({ url: rawUrl, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const { pad } = useLayout();
  const url = sameOriginUrl(rawUrl);
  const [blocked, setBlocked] = useState(false);
  const [stillBlocked, setStillBlocked] = useState(false);
  const [expired, setExpired] = useState(false);
  const tried = useRef(false);

  // Try straight away (Chrome allows it this soon after the tap). Success → back
  // to the screen we came from; the desk is in its own tab.
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    if (openDeskTab(url)) onClose();
    else setBlocked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setExpired(true), LINK_LIFE_MS);
    return () => clearTimeout(t);
  }, []);

  if (!blocked) return <View style={{ flex: 1 }} />;

  return (
    <View style={{ flex: 1 }}>
      <TopBar title={title} left={{ label: "✕ Close", onPress: onClose }} />
      <ScrollView contentContainerStyle={{ padding: pad, alignItems: "center" }}>
        <View style={{ width: "100%", maxWidth: 560, gap: 16 }}>
          <H1>Open {title}</H1>
          {expired ? (
            <Banner tone="warn" title="This sign-in link has expired">
              They last one minute. Close this and tap the button again for a fresh one.
            </Banner>
          ) : (
            <Card style={{ gap: 14 }}>
              <Body>
                Your browser stopped SwapUp from opening the desk in a new tab. Tap below to open it — this trade-in stays open here.
              </Body>
              <Btn
                title="Open in a new tab"
                big
                onPress={() => {
                  if (openDeskTab(url)) onClose();
                  else setStillBlocked(true);
                }}
              />
              {stillBlocked ? (
                <Banner tone="warn" title="New tabs are blocked in this browser">
                  Open it in this tab instead. To come back to the store app afterwards, use the browser's Back button.
                </Banner>
              ) : null}
              <Btn title="Open in this tab instead" kind="secondary" onPress={() => window.location.assign(url)} />
              <Body muted>The link signs you in to the desk and works for one minute.</Body>
            </Card>
          )}
          <Btn title="Close" kind="ghost" onPress={onClose} />
        </View>
      </ScrollView>
    </View>
  );
}

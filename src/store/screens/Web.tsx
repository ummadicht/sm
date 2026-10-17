// The SwapUp web desk inside the app (pricing a case, credit & pickups). It is
// opened through a one-time hand-off link that signs the WebView in, so staff
// never type their password twice.
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Text, View } from "react-native";
import * as Linking from "expo-linking";
import { WebView } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import { Banner, Btn, TopBar, L } from "../ui";

function originOf(url: string): string | null {
  const m = /^(https?:\/\/[^/?#]+)/i.exec(url);
  return m ? m[1].toLowerCase() : null;
}

export function WebScreen({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const ref = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [httpError, setHttpError] = useState<number | null>(null);
  const [key, setKey] = useState(0);
  const home = originOf(url);

  // Android back: go back inside the page first, then close.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack.current && ref.current) {
        ref.current.goBack();
      } else {
        onClose();
      }
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  // Stay on SwapUp. Phone numbers, WhatsApp, maps and other sites open in their own apps.
  function shouldStart(req: ShouldStartLoadRequest): boolean {
    const target = req.url;
    if (/^(about:|data:|blob:)/i.test(target)) return true;
    const o = originOf(target);
    if (o && home && o === home) return true;
    Linking.openURL(target).catch(() => {});
    return false;
  }

  return (
    <View style={{ flex: 1, backgroundColor: L.bg }}>
      <TopBar
        title={title}
        left={{ label: "✕ Close", onPress: onClose }}
        right={
          <Btn
            title="Reload"
            kind="ghost"
            onPress={() => {
              setFailure(null);
              setHttpError(null);
              if (ref.current) ref.current.reload();
              else setKey((k) => k + 1);
            }}
          />
        }
      />
      {failure ? (
        <View style={{ padding: 16 }}>
          <Banner
            tone="bad"
            title="The page didn't load"
            action={{
              title: "Try again",
              onPress: () => {
                setFailure(null);
                setKey((k) => k + 1);
              },
            }}
          >
            {`${failure} Check the Wi‑Fi, then try again. If it still fails, close this and tap the button again for a fresh link.`}
          </Banner>
        </View>
      ) : null}
      {httpError ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <Banner tone="warn" title={`The server answered with an error (${httpError})`}>
            {httpError === 401 || httpError === 403 || httpError === 410
              ? "The sign-in link may have expired — they last one minute. Close this and tap the button again."
              : "Close this and try again. If it keeps happening, use the SwapUp desk on the web."}
          </Banner>
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <WebView
          key={key}
          ref={ref}
          source={{ uri: url }}
          originWhitelist={["*"]}
          setSupportMultipleWindows={false}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          pullToRefreshEnabled
          onShouldStartLoadWithRequest={shouldStart}
          onLoadStart={() => {
            setLoading(true);
            setHttpError(null);
          }}
          onLoadEnd={() => setLoading(false)}
          onNavigationStateChange={(nav) => {
            canGoBack.current = nav.canGoBack;
          }}
          onError={(e) => {
            setLoading(false);
            setFailure(e.nativeEvent.description || "The page couldn't be reached.");
          }}
          onHttpError={(e) => {
            // Only the page itself, not a stray image or script.
            const u = e.nativeEvent.url || "";
            if (!/\.(png|jpe?g|svg|ico|css|js|woff2?)(\?|$)/i.test(u)) setHttpError(e.nativeEvent.statusCode);
          }}
          style={{ flex: 1, backgroundColor: L.bg }}
        />
        {loading && !failure ? (
          <View
            pointerEvents="none"
            style={{ position: "absolute", top: 0, left: 0, right: 0, paddingVertical: 10, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 10 }}
          >
            <ActivityIndicator color={L.primary} />
            <Text style={{ color: L.muted, fontSize: 15 }}>Loading…</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

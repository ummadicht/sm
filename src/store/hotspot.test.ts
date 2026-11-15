// node --test --experimental-strip-types --no-warnings src/store/hotspot.test.ts
import test from "node:test";
import assert from "node:assert/strict";

const H: typeof import("./hotspot") = await import("./hotspot" + ".ts");

test("wifiQr builds standard WIFI QR payloads and escapes special characters", () => {
  assert.equal(
    H.wifiQr({ ssid: "SwapUp-Hotspot", password: "swapup1234", security: "WPA", hidden: false }),
    "WIFI:T:WPA;S:SwapUp-Hotspot;P:swapup1234;H:false;;"
  );
  assert.equal(
    H.wifiQr({ ssid: "My;Phone:Net", password: 'p"a,s\\s', security: "WPA", hidden: true }),
    'WIFI:T:WPA;S:My\\;Phone\\:Net;P:p\\"a\\,s\\\\s;H:true;;'
  );
  assert.equal(
    H.wifiQr({ ssid: "OpenGuest", password: "ignored", security: "nopass" }),
    "WIFI:T:nopass;S:OpenGuest;P:;H:false;;"
  );
});

test("currentDeviceHotspot builds hotspot credentials for the current device", () => {
  const cfg = H.currentDeviceHotspot("Galaxy S24", "192.168.43.1");
  assert.equal(cfg.ssid, "Galaxy-S24-Hotspot-1");
  assert.equal(cfg.security, "WPA");
  assert.ok(cfg.password.length >= 8);

  const fallback = H.currentDeviceHotspot(null, "0.0.0.0");
  assert.equal(fallback.ssid, "SwapUp-Device-Hotspot");
});

test("checkWebUrl builds direct browser check links with or without a session code", () => {
  assert.equal(H.checkWebUrl("https://swapup.example.com/"), "https://swapup.example.com/app/check/");
  assert.equal(H.checkWebUrl("https://swapup.example.com", "k7m-2qx"), "https://swapup.example.com/app/check/?code=K7M2QX");
  assert.equal(H.checkWebUrl("https://swapup.example.com", "   "), "https://swapup.example.com/app/check/");
});

test("isOfflineState detects offline state from NetInfo / expo-network and browser online status", () => {
  assert.equal(H.isOfflineState(null, true), false);
  assert.equal(H.isOfflineState({ isConnected: true, isInternetReachable: true }, true), false);
  assert.equal(H.isOfflineState({ isConnected: false, isInternetReachable: false }, true), true);
  assert.equal(H.isOfflineState({ isConnected: true, isInternetReachable: false }, true), true);
  assert.equal(H.isOfflineState({ isConnected: true, isInternetReachable: true }, false), true);
});

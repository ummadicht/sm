// node --test --experimental-strip-types --no-warnings src/check/navBar.test.ts
import test from "node:test";
import assert from "node:assert/strict";

const { isAppActive, navBarHidden }: typeof import("./navBar") = await import("./navBar" + ".ts");

test("navBarHidden hides the bar on native Android while a full-screen pattern is up and the app is active", () => {
  assert.equal(navBarHidden({ bleed: true, appActive: true, web: false }), true);
  assert.equal(navBarHidden({ bleed: true, appActive: true, web: false, os: "android" }), true);
});

test("navBarHidden shows the bar again when bleed turns off after the sweep or colours", () => {
  assert.equal(navBarHidden({ bleed: false, appActive: true, web: false }), false);
  assert.equal(navBarHidden({ bleed: false, appActive: false, web: false }), false);
});

test("navBarHidden shows the bar when the app goes to the background and hides it again on return", () => {
  // Pattern is up in the foreground -> hidden
  assert.equal(navBarHidden({ bleed: true, appActive: isAppActive("active"), web: false }), true);
  // Customer or advisor presses Home / switches away -> visible immediately
  assert.equal(navBarHidden({ bleed: true, appActive: isAppActive("background"), web: false }), false);
  assert.equal(navBarHidden({ bleed: true, appActive: isAppActive("inactive"), web: false }), false);
  // App returns to foreground while the pattern is still up -> hidden again
  assert.equal(navBarHidden({ bleed: true, appActive: isAppActive("active"), web: false }), true);
});

test("navBarHidden never hides anything in the browser build or on non-Android platforms", () => {
  assert.equal(navBarHidden({ bleed: true, appActive: true, web: true }), false);
  assert.equal(navBarHidden({ bleed: false, appActive: true, web: true }), false);
  assert.equal(navBarHidden({ bleed: true, appActive: true, web: false, os: "ios" }), false);
});

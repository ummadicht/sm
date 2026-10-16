// One codebase, two Android apps. APP_VARIANT=store|check picks which one a
// build (or `expo start`) produces. Default: check (the customer test app).
const base = require("./app.json").expo;

const VARIANT = process.env.APP_VARIANT === "store" ? "store" : "check";
const DEFAULT_SERVER = process.env.SWAPUP_SERVER || "https://swapup.104-197-168-25.sslip.io";
// Browser builds only (scripts/export-web.sh): the path the app is served under
// on the SwapUp server, e.g. "/app/store". Prefixes every bundle and asset URL.
// Never set for the APKs.
const WEB_BASE = process.env.SWAPUP_WEB_BASE || "";

const CHECK_PERMISSIONS = [
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.VIBRATE",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.USE_BIOMETRIC",
  "android.permission.USE_FINGERPRINT",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.HIGH_SAMPLING_RATE_SENSORS",
];

const variants = {
  store: {
    name: "SwapUp Store",
    slug: "swapup-store",
    webDescription: "SwapUp Store — start a customer trade-in, show the test QR and watch the customer's phone test results arrive.",
    scheme: "swapupstore",
    package: "com.swapup.store",
    userInterfaceStyle: "light",
    backgroundColor: "#f5f6f8",
    permissions: ["android.permission.CAMERA", "android.permission.VIBRATE"],
    // Both apps link the same native modules, so the store app would inherit the
    // test app's permissions (mic, location, biometrics…) it never uses. Block them.
    blockedPermissions: [
      "android.permission.RECORD_AUDIO",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.USE_BIOMETRIC",
      "android.permission.USE_FINGERPRINT",
      "android.permission.READ_PHONE_STATE",
      "android.permission.ACTIVITY_RECOGNITION",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.WRITE_SETTINGS",
      "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
    ],
    plugins: [
      ["expo-camera", { cameraPermission: "Scan the IMEI barcode on the phone's box." }],
      "expo-secure-store",
    ],
  },
  check: {
    name: "SwapUp Check",
    slug: "swapup-check",
    webDescription: "SwapUp Check — test your phone in the browser for your trade-in. Results go straight to the store.",
    scheme: "swapupcheck",
    package: "com.swapup.check",
    userInterfaceStyle: "dark",
    backgroundColor: "#0f1729",
    permissions: CHECK_PERMISSIONS,
    // Drawing over other apps is never needed by the tests.
    blockedPermissions: ["android.permission.SYSTEM_ALERT_WINDOW"],
    plugins: [
      ["expo-camera", { cameraPermission: "Camera, flashlight and QR tests.", microphonePermission: "Microphone test." }],
      ["expo-audio", { microphonePermission: "Microphone test." }],
      ["expo-location", { locationWhenInUsePermission: "GPS test." }],
      ["expo-local-authentication", { faceIDPermission: "Biometric sensor test." }],
      ["expo-sensors", { motionPermission: "Accelerometer and gyroscope tests." }],
      "expo-brightness",
      "expo-asset",
    ],
  },
};

module.exports = () => {
  const v = variants[VARIANT];
  return {
    ...base,
    name: v.name,
    slug: v.slug,
    scheme: v.scheme,
    version: "0.2.0",
    orientation: VARIANT === "store" ? "default" : "portrait",
    userInterfaceStyle: v.userInterfaceStyle,
    backgroundColor: v.backgroundColor,
    icon: `./assets/${VARIANT}-icon.png`,
    ios: { ...base.ios, bundleIdentifier: v.package, supportsTablet: true },
    android: {
      package: v.package,
      // Bump with every APK published to /downloads so it installs over the previous one.
      versionCode: 2,
      adaptiveIcon: { backgroundColor: "#0f1729", foregroundImage: `./assets/${VARIANT}-icon-foreground.png` },
      permissions: v.permissions,
      blockedPermissions: v.blockedPermissions,
      predictiveBackGestureEnabled: false,
    },
    plugins: v.plugins,
    // Browser build (Expo web, react-native-web): one index.html per app, hosted
    // by the SwapUp server at /app/store/ and /app/check/ (same origin as the API).
    web: {
      ...base.web,
      bundler: "metro",
      output: "single",
      name: v.name,
      shortName: v.name,
      description: v.webDescription,
      lang: "en",
      themeColor: v.backgroundColor,
      backgroundColor: v.backgroundColor,
      favicon: `./assets/${VARIANT}-icon.png`,
    },
    ...(WEB_BASE ? { experiments: { ...(base.experiments || {}), baseUrl: WEB_BASE } } : {}),
    extra: { variant: VARIANT, defaultServer: DEFAULT_SERVER },
  };
};

// One codebase, two Android apps. APP_VARIANT=store|check picks which one a
// build (or `expo start`) produces. Default: check (the customer test app).
const base = require("./app.json").expo;

const VARIANT = process.env.APP_VARIANT === "store" ? "store" : "check";
const DEFAULT_SERVER = process.env.SWAPUP_SERVER || "https://swapup.104-197-168-25.sslip.io";

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
    scheme: "swapupstore",
    package: "com.swapup.store",
    userInterfaceStyle: "light",
    backgroundColor: "#f5f6f8",
    permissions: ["android.permission.CAMERA", "android.permission.VIBRATE"],
    plugins: [
      ["expo-camera", { cameraPermission: "Scan the IMEI barcode on the phone's box." }],
      "expo-secure-store",
    ],
  },
  check: {
    name: "SwapUp Check",
    slug: "swapup-check",
    scheme: "swapupcheck",
    package: "com.swapup.check",
    userInterfaceStyle: "dark",
    backgroundColor: "#0f1729",
    permissions: CHECK_PERMISSIONS,
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
    version: "0.1.0",
    orientation: VARIANT === "store" ? "default" : "portrait",
    userInterfaceStyle: v.userInterfaceStyle,
    backgroundColor: v.backgroundColor,
    icon: `./assets/${VARIANT}-icon.png`,
    ios: { ...base.ios, bundleIdentifier: v.package, supportsTablet: true },
    android: {
      package: v.package,
      adaptiveIcon: { backgroundColor: "#0f1729", foregroundImage: `./assets/${VARIANT}-icon-foreground.png` },
      permissions: v.permissions,
      predictiveBackGestureEnabled: false,
    },
    plugins: v.plugins,
    extra: { variant: VARIANT, defaultServer: DEFAULT_SERVER },
  };
};

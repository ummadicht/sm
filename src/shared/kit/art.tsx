// Line illustrations (Pandas style): ~2 px near-black strokes, one pale blue
// fill, nothing else — so they read on the grey screen and on a white sheet.
// Each takes a width; the height follows its own proportions.
import React from "react";
import { Platform } from "react-native";
import Svg, { Circle, G, Path, Rect, Text as SvgText } from "react-native-svg";
import { P } from "../theme";

/** SVG text: the system sans on the web too (a browser's SVG default is a serif). Native already uses the system font. */
const SANS = Platform.OS === "web" ? "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" : undefined;

const INK = P.stroke;
const TINT = P.tint;
const BAR = "#DADAE0";

type ArtProps = { width?: number };

/* ─────────── a phone, front on ─────────── */

function PhoneBody({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const r = Math.round(w * 0.19);
  return (
    <G>
      {/* side buttons */}
      <Rect x={x - 4} y={y + h * 0.26} width={5} height={h * 0.1} rx={2} fill="#fff" stroke={INK} strokeWidth={1.6} />
      <Rect x={x - 4} y={y + h * 0.39} width={5} height={h * 0.1} rx={2} fill="#fff" stroke={INK} strokeWidth={1.6} />
      <Rect x={x + w - 1} y={y + h * 0.32} width={5} height={h * 0.16} rx={2} fill="#fff" stroke={INK} strokeWidth={1.6} />
      <Rect x={x} y={y} width={w} height={h} rx={r} fill="#fff" stroke={INK} strokeWidth={2.4} />
      <Rect x={x + 6} y={y + 6} width={w - 12} height={h - 12} rx={r - 5} fill={TINT} stroke={INK} strokeWidth={1.4} />
    </G>
  );
}

/** A plain phone. */
export function PhoneArt({ width = 120 }: ArtProps) {
  return (
    <Svg width={width} height={width * (212 / 124)} viewBox="0 0 124 212">
      <PhoneBody x={10} y={4} w={104} h={204} />
    </Svg>
  );
}

/** A phone showing a white card with its IMEI (Identify, "Settings › About phone"). */
export function PhoneImeiArt({ width = 120 }: ArtProps) {
  return (
    <Svg width={width} height={width * (212 / 124)} viewBox="0 0 124 212">
      <PhoneBody x={10} y={4} w={104} h={204} />
      <Rect x={22} y={86} width={80} height={46} rx={8} fill="#fff" stroke={INK} strokeWidth={1.4} />
      <SvgText fontFamily={SANS} x={30} y={100} fontSize={9} fontWeight="700" fill={INK}>
        IMEI
      </SvgText>
      <Rect x={30} y={106} width={64} height={9} rx={4.5} fill={BAR} />
      <Rect x={30} y={120} width={38} height={5} rx={2.5} fill={BAR} />
    </Svg>
  );
}

/* ─────────── the dial code ─────────── */

/** The keys * # 0 6 # in a row — the code that shows the IMEI. */
export function DialKeysArt({ width = 220 }: ArtProps) {
  const keys = ["*", "#", "0", "6", "#"];
  const cell = 216 / keys.length;
  return (
    <Svg width={width} height={width * (54 / 220)} viewBox="0 0 220 54" accessibilityLabel="Dial star hash zero six hash">
      <Rect x={2} y={3} width={216} height={48} rx={9} fill="#fff" stroke={INK} strokeWidth={2} />
      {keys.slice(1).map((_, i) => (
        <Path key={i} d={`M${2 + cell * (i + 1)} 11 V43`} stroke={BAR} strokeWidth={1.4} />
      ))}
      {keys.map((k, i) => (
        <SvgText fontFamily={SANS} key={i} x={2 + cell * i + cell / 2} y={35} fontSize={21} fontWeight="700" fill={INK} textAnchor="middle">
          {k}
        </SvgText>
      ))}
    </Svg>
  );
}

/* ─────────── a QR being scanned ─────────── */

function Finder({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <G>
      <Rect x={x} y={y} width={s} height={s} rx={s * 0.18} fill="#fff" stroke={INK} strokeWidth={s * 0.16} />
      <Rect x={x + s * 0.32} y={y + s * 0.32} width={s * 0.36} height={s * 0.36} rx={s * 0.08} fill={INK} />
    </G>
  );
}

function MiniQr({ x, y, s }: { x: number; y: number; s: number }) {
  const f = s * 0.3;
  const m = s * 0.09;
  const dots: [number, number][] = [
    [0.44, 0.06], [0.56, 0.2], [0.44, 0.34], [0.06, 0.46], [0.22, 0.56], [0.44, 0.52], [0.6, 0.44],
    [0.78, 0.46], [0.9, 0.58], [0.5, 0.66], [0.66, 0.72], [0.46, 0.84], [0.62, 0.9], [0.8, 0.8], [0.9, 0.9],
  ];
  return (
    <G>
      <Rect x={x - 4} y={y - 4} width={s + 8} height={s + 8} rx={5} fill="#fff" stroke={INK} strokeWidth={1.4} />
      <Finder x={x} y={y} s={f} />
      <Finder x={x + s - f} y={y} s={f} />
      <Finder x={x} y={y + s - f} s={f} />
      {dots.map(([dx, dy], i) => (
        <Rect key={i} x={x + dx * s - m / 2} y={y + dy * s - m / 2} width={m} height={m} rx={m * 0.2} fill={INK} />
      ))}
    </G>
  );
}

/** A phone showing a QR, and the advisor's tablet framing it. */
export function ScanArt({ width = 260 }: ArtProps) {
  const bx = 160;
  const by = 66;
  const b = 66;
  const c = 14;
  return (
    <Svg width={width} height={width * (200 / 264)} viewBox="0 0 264 200">
      {/* the tablet */}
      <Rect x={130} y={16} width={126} height={170} rx={16} fill="#fff" stroke={INK} strokeWidth={2.4} />
      <Rect x={137} y={23} width={112} height={156} rx={10} fill={TINT} stroke={INK} strokeWidth={1.4} />
      {/* viewfinder corners */}
      <Path
        d={`M${bx} ${by + c} V${by} H${bx + c} M${bx + b - c} ${by} H${bx + b} V${by + c} M${bx + b} ${by + b - c} V${by + b} H${bx + b - c} M${bx + c} ${by + b} H${bx} V${by + b - c}`}
        stroke={INK}
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <MiniQr x={bx + 15} y={by + 15} s={36} />
      <Path d={`M${bx + 6} ${by + b / 2} H${bx + b - 6}`} stroke={P.primary} strokeWidth={2.4} strokeLinecap="round" />
      {/* the scan: from the phone's QR to the tablet */}
      <Path d={`M86 82 L${bx - 2} ${by + 4}`} stroke={INK} strokeWidth={1.4} strokeDasharray="4 5" strokeLinecap="round" />
      <Path d={`M86 136 L${bx - 2} ${by + b - 4}`} stroke={INK} strokeWidth={1.4} strokeDasharray="4 5" strokeLinecap="round" />
      {/* the phone, in front */}
      <PhoneBody x={10} y={22} w={88} h={164} />
      <MiniQr x={30} y={82} s={48} />
    </Svg>
  );
}

/* ─────────── battery ─────────── */

/** A battery on its side. `level` 0–1 fills it; `charging` adds a bolt; `label` (e.g. "92 %") is written across it. */
export function BatteryArt({ width = 200, level = 0.7, charging, label }: ArtProps & { level?: number; charging?: boolean; label?: string }) {
  const fill = Math.max(0, Math.min(1, level));
  return (
    <Svg width={width} height={width * (100 / 204)} viewBox="0 0 204 100">
      <Rect x={6} y={14} width={172} height={72} rx={16} fill="#fff" stroke={INK} strokeWidth={2.6} />
      <Rect x={181} y={37} width={14} height={26} rx={5} fill="#fff" stroke={INK} strokeWidth={2.4} />
      {fill > 0 ? <Rect x={15} y={23} width={154 * fill} height={54} rx={9} fill={TINT} /> : null}
      {charging ? (
        <Path d="M101 24 L80 55 H96 L88 77 L113 44 H97 L105 24 Z" fill="#fff" stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
      ) : null}
      {label && !charging ? (
        <SvgText fontFamily={SANS} x={92} y={61} fontSize={30} fontWeight="800" fill={INK} textAnchor="middle">
          {label}
        </SvgText>
      ) : null}
    </Svg>
  );
}

/* ─────────── checklist ─────────── */

/** A card of rows, the first `ticked` of them ticked — the tests. */
export function ChecklistArt({ width = 150, ticked = 2 }: ArtProps & { ticked?: number }) {
  const rows = [58, 100, 142];
  return (
    <Svg width={width} height={width * (200 / 160)} viewBox="0 0 160 200">
      <Rect x={14} y={16} width={132} height={176} rx={18} fill="#fff" stroke={INK} strokeWidth={2.4} />
      <Rect x={52} y={6} width={56} height={20} rx={7} fill={TINT} stroke={INK} strokeWidth={2} />
      {rows.map((y, i) => (
        <G key={y}>
          <Circle cx={44} cy={y} r={12} fill={i < ticked ? TINT : "#fff"} stroke={INK} strokeWidth={2} />
          {i < ticked ? <Path d={`M38 ${y} l4.5 4.5 l8 -9`} stroke={INK} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" fill="none" /> : null}
          <Rect x={66} y={y - 9} width={62} height={7} rx={3.5} fill={BAR} />
          <Rect x={66} y={y + 3} width={38} height={6} rx={3} fill={BAR} />
        </G>
      ))}
    </Svg>
  );
}

/* ─────────── done ─────────── */

/** A big tick in a circle. */
export function TickArt({ width = 140 }: ArtProps) {
  return (
    <Svg width={width} height={width} viewBox="0 0 160 160">
      <Circle cx={80} cy={80} r={66} fill={TINT} stroke={INK} strokeWidth={3} />
      <Path d="M50 82 L71 103 L112 60" stroke={INK} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

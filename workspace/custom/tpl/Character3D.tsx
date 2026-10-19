// 3D cartoon characters (three.js via @remotion/three): built from toon-shaded primitives, posed per frame,
// lip-synced to voice clips. Deterministic — every frame is a pure function of the frame number.
import React, { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { ThreeCanvas } from '@remotion/three';
import { getAudioData } from '@remotion/media-utils';
import { AbsoluteFill, Img, continueRender, delayRender, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { SANS, media, rand, useFonts, useUnit } from './common';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Look = {
  build?: 'kid' | 'adult';
  skin?: string; hair?: string; eyes?: string; shirt?: string; pants?: string; shoes?: string; accent?: string;
  hairStyle?: 'short' | 'spiky' | 'long' | 'bob' | 'bun' | 'ponytail' | 'pigtails' | 'curly' | 'bald';
  outfit?: 'tshirt' | 'shirt' | 'suit' | 'hoodie' | 'dress' | 'aodai';
  hat?: 'none' | 'cap' | 'nonla' | 'beanie';
  glasses?: boolean; beard?: 'none' | 'mustache' | 'beard'; tie?: boolean; blush?: boolean;
};
export type Action = 'idle' | 'talk' | 'wave' | 'point' | 'walk' | 'happy' | 'think' | 'dance' | 'nod' | 'shrug' | 'bow' | 'clap';
export type Expression = 'smile' | 'neutral' | 'happy' | 'sad' | 'surprised' | 'angry';
export type Step = { start: number; end?: number; action?: Action; expression?: Expression; to?: number; facing?: number };
export type Voice = { src: string; start?: number };
export type CastMember = {
  preset?: string; look?: Look; name?: string;
  x?: number; y?: number; size?: number; facing?: number;
  action?: Action; expression?: Expression; actions?: Step[];
  voice?: string; voiceStart?: number; voices?: Voice[];
  enter?: 'pop' | 'none'; seed?: number;
};

/** Ready-made looks (Vietnamese everyday characters). */
export const CHARACTER_PRESETS: Record<string, { label: string; look: Look }> = {
  be_trai: { label: 'Bé trai', look: { build: 'kid', skin: '#f5c9a6', hair: '#1f1a17', hairStyle: 'short', outfit: 'tshirt', shirt: '#3b82f6', pants: '#1e3a8a', shoes: '#f8fafc', blush: true } },
  be_gai: { label: 'Bé gái', look: { build: 'kid', skin: '#f8d0b0', hair: '#2a1d17', hairStyle: 'pigtails', outfit: 'dress', shirt: '#f472b6', pants: '#f8d0b0', shoes: '#be185d', accent: '#fde047', blush: true } },
  anh: { label: 'Anh nhân viên', look: { build: 'adult', skin: '#eebd96', hair: '#191514', hairStyle: 'spiky', outfit: 'shirt', shirt: '#e0f2fe', pants: '#334155', shoes: '#3f2a1d', tie: true, accent: '#2563eb' } },
  chi: { label: 'Chị văn phòng', look: { build: 'adult', skin: '#f3c8a5', hair: '#2b1b14', hairStyle: 'long', outfit: 'suit', shirt: '#0f766e', pants: '#1f2937', shoes: '#111827', accent: '#ffffff' } },
  aodai: { label: 'Cô gái áo dài', look: { build: 'adult', skin: '#f6cfae', hair: '#120d0b', hairStyle: 'long', outfit: 'aodai', shirt: '#dc2626', pants: '#ffffff', shoes: '#fbbf24', accent: '#fde68a', blush: true } },
  thay_giao: { label: 'Thầy giáo', look: { build: 'adult', skin: '#e9b98f', hair: '#262626', hairStyle: 'short', outfit: 'shirt', shirt: '#ffffff', pants: '#3f3f46', shoes: '#27272a', glasses: true, tie: true, accent: '#b91c1c' } },
  bac_si: { label: 'Bác sĩ', look: { build: 'adult', skin: '#f1c6a0', hair: '#3b2a20', hairStyle: 'bob', outfit: 'suit', shirt: '#f8fafc', pants: '#64748b', shoes: '#f8fafc', accent: '#7dd3fc', glasses: true } },
  ong: { label: 'Ông', look: { build: 'adult', skin: '#e3b088', hair: '#e5e7eb', hairStyle: 'bald', outfit: 'shirt', shirt: '#a16207', pants: '#44403c', shoes: '#292524', glasses: true, beard: 'mustache' } },
  ba: { label: 'Bà', look: { build: 'adult', skin: '#ecbd98', hair: '#d1d5db', hairStyle: 'bun', outfit: 'aodai', shirt: '#7c3aed', pants: '#1f2937', shoes: '#57534e', accent: '#c4b5fd', glasses: true } },
  nong_dan: { label: 'Bác nông dân', look: { build: 'adult', skin: '#d79c6c', hair: '#1c1917', hairStyle: 'short', outfit: 'shirt', shirt: '#92400e', pants: '#1f2937', shoes: '#57534e', hat: 'nonla', beard: 'none' } },
  hoc_sinh: { label: 'Học sinh', look: { build: 'kid', skin: '#f3c6a2', hair: '#1c1917', hairStyle: 'curly', outfit: 'shirt', shirt: '#ffffff', pants: '#1e3a8a', shoes: '#111827', tie: true, accent: '#dc2626', blush: true } },
  shipper: { label: 'Anh shipper', look: { build: 'adult', skin: '#e2ad83', hair: '#18181b', hairStyle: 'short', outfit: 'hoodie', shirt: '#16a34a', pants: '#27272a', shoes: '#f4f4f5', hat: 'cap', accent: '#16a34a' } },
};
export const CHARACTER_ACTIONS: Record<Action, string> = {
  idle: 'Đứng yên', talk: 'Nói chuyện', wave: 'Vẫy tay', point: 'Chỉ tay', walk: 'Đi bộ', happy: 'Nhảy mừng', think: 'Suy nghĩ',
  dance: 'Nhảy múa', nod: 'Gật đầu', shrug: 'Nhún vai', bow: 'Cúi chào', clap: 'Vỗ tay',
};
export const CHARACTER_EXPRESSIONS: Record<Expression, string> = { smile: 'Mỉm cười', neutral: 'Bình thường', happy: 'Vui', sad: 'Buồn', surprised: 'Ngạc nhiên', angry: 'Tức giận' };

const DEFAULT_LOOK: Required<Look> = {
  build: 'kid', skin: '#f5c9a6', hair: '#1f1a17', eyes: '#2b1a12', shirt: '#3b82f6', pants: '#1e3a8a', shoes: '#f8fafc', accent: '#f59e0b',
  hairStyle: 'short', outfit: 'tshirt', hat: 'none', glasses: false, beard: 'none', tie: false, blush: false,
};
export const resolveLook = (m: CastMember): Required<Look> => ({ ...DEFAULT_LOOK, ...(CHARACTER_PRESETS[m.preset || '']?.look || {}), ...(m.look || {}) });

/* ---------------- proportions ---------------- */
const BUILD = {
  kid: { leg: 0.5, torso: 0.46, headR: 0.43, shoulder: 0.27, arm: 0.5, bodyR: 0.25, hipW: 0.12 },
  adult: { leg: 0.86, torso: 0.66, headR: 0.36, shoulder: 0.31, arm: 0.7, bodyR: 0.26, hipW: 0.13 },
};
const heightOf = (b: typeof BUILD.kid) => b.leg + b.torso + 0.06 + b.headR * 1.95;

/* ---------------- poses ---------------- */
type Arm = { sx: number; sz: number; ex: number; ez: number };
type Pose = { bob: number; lean: number; twist: number; sway: number; hx: number; hy: number; hz: number; r: Arm; l: Arm; rl: number; ll: number; shrug: number; open: number; lookUp: number };
const arm = (sx = 0, sz = 0.12, ex = -0.15, ez = 0): Arm => ({ sx, sz, ex, ez });
const base = (): Pose => ({ bob: 0, lean: 0, twist: 0, sway: 0, hx: 0, hy: 0, hz: 0, r: arm(), l: arm(), rl: 0, ll: 0, shrug: 0, open: 0, lookUp: 0 });
const bell = (x: number) => (x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x) ** 2);

/** Pose for `action` at global time T (s) and local time t since the action began. */
function poseFor(action: Action, T: number, t: number, dir: number): Pose {
  const p = base();
  const breathe = Math.sin(T * 2.1);
  p.bob = 0.008 * breathe;
  p.hz = 0.03 * Math.sin(T * 0.7);
  p.r = arm(0.03 * breathe, 0.12, -0.18);
  p.l = arm(0.03 * breathe, 0.12, -0.18);
  switch (action) {
    case 'talk':
      p.r = arm(-0.35 - 0.12 * Math.sin(T * 2.3), 0.22, -0.9 - 0.35 * Math.sin(T * 2.3 + 1), 0);
      p.l = arm(-0.1, 0.16 + 0.06 * Math.sin(T * 1.7), -0.35 - 0.2 * Math.max(0, Math.sin(T * 1.3)));
      p.hx = 0.05 * Math.sin(T * 3.3); p.hy = 0.1 * Math.sin(T * 0.9); p.twist = 0.05 * Math.sin(T * 0.9);
      break;
    case 'wave':
      p.r = arm(-0.15, 2.55, -0.15, 0.55 * Math.sin(T * 9));
      p.hz = 0.1; p.sway = -0.03; p.open = 0.25;
      break;
    case 'point': {
      const a = dir < 0 ? 'r' : 'l';
      p[a] = arm(-0.25, 1.45, -0.05);
      p.twist = 0.18 * -dir; p.hy = 0.35 * -dir; p.hz = 0.04 * dir;
      break;
    }
    case 'walk': {
      const ph = Math.sin(T * Math.PI * 2 * 1.6);
      p.rl = 0.5 * ph; p.ll = -0.5 * ph;
      p.r = arm(-0.45 * -ph, 0.1, -0.35); p.l = arm(-0.45 * ph, 0.1, -0.35);
      p.bob = 0.035 * Math.abs(Math.cos(T * Math.PI * 2 * 1.6)); p.sway = 0.03 * ph;
      break;
    }
    case 'happy': {
      const hop = Math.abs(Math.sin(T * Math.PI * 2.2));
      p.bob = 0.22 * hop; p.r = arm(-0.1, 2.35 + 0.15 * hop, -0.25); p.l = arm(-0.1, 2.35 + 0.15 * hop, -0.25);
      p.rl = -0.15 * hop; p.ll = -0.15 * hop; p.open = 0.55; p.hx = -0.08;
      break;
    }
    case 'think':
      p.r = arm(-0.95, -0.1, -2.2, 0.15); p.l = arm(-0.7, -0.25, -1.45);
      p.hz = 0.16 + 0.02 * Math.sin(T * 1.3); p.hx = -0.12; p.hy = 0.12; p.lookUp = 1;
      break;
    case 'dance': {
      const s = Math.sin(T * 4.2);
      p.sway = 0.14 * s; p.bob = 0.05 * Math.abs(Math.sin(T * 8.4)) ** 0.7; p.hz = -0.12 * s; p.twist = 0.12 * Math.sin(T * 2.1);
      p.r = arm(-0.2, 1.3 + 0.9 * s, -0.9); p.l = arm(-0.2, 1.3 - 0.9 * s, -0.9); p.rl = 0.15 * Math.max(0, s); p.ll = 0.15 * Math.max(0, -s); p.open = 0.3;
      break;
    }
    case 'nod':
      p.hx = 0.22 * Math.max(0, Math.sin(T * 6.5)); p.r = arm(0, 0.1, -0.2); p.l = arm(0, 0.1, -0.2);
      break;
    case 'shrug': {
      const k = Math.min(1, t / 0.35);
      p.r = arm(-0.35 * k, 0.55 * k, -1.35 * k, -0.6 * k); p.l = arm(-0.35 * k, 0.55 * k, -1.35 * k, -0.6 * k);
      p.shrug = 0.06 * k; p.hz = 0.12 * k;
      break;
    }
    case 'bow': {
      const k = bell(Math.min(1, t / 1.8));
      p.lean = 0.65 * k; p.hx = 0.25 * k; p.r = arm(0.15 * k, 0.05, -0.1); p.l = arm(0.15 * k, 0.05, -0.1);
      break;
    }
    case 'clap': {
      const c = Math.sin(T * 13);
      p.r = arm(-1.05, -0.32 + 0.16 * c, -0.75); p.l = arm(-1.05, -0.32 + 0.16 * c, -0.75); p.open = 0.35; p.hx = -0.05;
      break;
    }
    default:
  }
  return p;
}
const mixN = (a: number, b: number, w: number) => a + (b - a) * w;
const mixArm = (a: Arm, b: Arm, w: number): Arm => ({ sx: mixN(a.sx, b.sx, w), sz: mixN(a.sz, b.sz, w), ex: mixN(a.ex, b.ex, w), ez: mixN(a.ez, b.ez, w) });
const mixPose = (a: Pose, b: Pose, w: number): Pose => {
  const o: any = {};
  for (const k of Object.keys(a) as (keyof Pose)[]) o[k] = k === 'r' || k === 'l' ? mixArm(a[k] as Arm, b[k] as Arm, w) : mixN(a[k] as number, b[k] as number, w);
  return o;
};
const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/** Everything that depends on time for one cast member: pose, expression, position, facing. */
function stateAt(m: CastMember, T: number) {
  const steps: Step[] = (m.actions?.length ? m.actions : [{ start: 0, action: m.action || 'idle' }]).slice().sort((a, b) => a.start - b.start);
  let x = m.x ?? 0.5, facing = m.facing ?? 0, expr: Expression = m.expression || 'smile';
  let cur: Step | null = null, prev: { action: Action; start: number } = { action: 'idle', start: 0 };
  const settle = (s: Step) => { if (s.action === 'walk' && s.to != null) x = s.to; if (s.facing != null) facing = s.facing; };
  for (const s of steps) {
    if (s.start > T) break;
    if (cur) { settle(cur); prev = { action: cur.end != null && cur.end <= s.start ? 'idle' : cur.action || 'idle', start: cur.start }; }
    cur = s;
    if (s.expression) expr = s.expression;
  }
  let action: Action = cur?.action || (m.actions?.length ? 'idle' : m.action || 'idle');
  let start = cur ? cur.start : 0;
  let fx = facing;
  if (cur && cur.end != null && T >= cur.end) {
    settle(cur); fx = facing;
    prev = { action, start: cur.start }; action = 'idle'; start = cur.end;
  } else if (cur && action === 'walk' && cur.to != null) {
    const d = Math.max(0.3, (cur.end ?? cur.start + 2) - cur.start), lt = T - cur.start;
    const dirW = Math.sign(cur.to - x) || 1;
    x += (cur.to - x) * Math.min(1, lt / d);
    fx = mixN(facing, dirW * 0.95, Math.min(smooth(lt / 0.3), smooth((d - lt) / 0.3)));
  } else if (cur && cur.facing != null) {
    fx = mixN(facing, cur.facing, smooth((T - cur.start) / 0.4));
  }
  const dir = fx !== 0 ? Math.sign(fx) : x < 0.5 ? 1 : -1; // point toward where they face / the frame centre
  const w = smooth((T - start) / 0.3);
  const now = poseFor(action, T, T - start, dir);
  const pose = w >= 1 ? now : mixPose(poseFor(prev.action, T, T - prev.start, dir), now, w);
  return { pose, action, expr, x, facing: fx };
}

/* ---------------- voice → mouth ---------------- */
type Wave = { data: Float32Array; rate: number };
const audioCache = new Map<string, Promise<Wave | null>>();
const loadWave = (src: string) => {
  const url = media(src)!;
  if (!audioCache.has(url)) audioCache.set(url, getAudioData(url).then((a) => ({ data: a.channelWaveforms[0], rate: a.sampleRate })).catch(() => null));
  return audioCache.get(url)!;
};
const voicesOf = (m: CastMember): Voice[] => [...(m.voices || []), ...(m.voice ? [{ src: m.voice, start: m.voiceStart ?? 0 }] : [])].filter((v) => v?.src);
/** Mouth opening 0..1 from the loudness of the voice around time T. */
const levelAt = (waves: Record<string, Wave | null>, vs: Voice[], T: number) => {
  let best = 0;
  for (const v of vs) {
    const w = waves[media(v.src)!];
    if (!w) continue;
    const c = (T - (v.start || 0)) * w.rate, half = Math.floor(w.rate * 0.035);
    if (c < -half || c > w.data.length + half) continue;
    let sum = 0, n = 0;
    for (let i = Math.max(0, Math.floor(c) - half); i < Math.min(w.data.length, Math.floor(c) + half); i += 4) { sum += w.data[i] * w.data[i]; n++; }
    if (n) best = Math.max(best, Math.sqrt(sum / n));
  }
  return Math.max(0, Math.min(1, (best - 0.012) * 7));
};
const useWaves = (cast: CastMember[]) => {
  const srcs = [...new Set(cast.flatMap(voicesOf).map((v) => v.src))];
  const key = srcs.join('|');
  const [waves, setWaves] = useState<Record<string, Wave | null>>({});
  const [handle] = useState(() => (srcs.length ? delayRender('Loading voice for lip-sync', { timeoutInMilliseconds: 60000 }) : null));
  useEffect(() => {
    let h: number | null = handle;
    if (h == null && srcs.length) h = delayRender('Loading voice for lip-sync', { timeoutInMilliseconds: 60000 });
    Promise.all(srcs.map(async (s) => [media(s)!, await loadWave(s)] as const)).then((e) => {
      setWaves(Object.fromEntries(e));
      if (h != null) continueRender(h);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return waves;
};

/* ---------------- materials / geometry ---------------- */
let gradTex: THREE.DataTexture | null = null;
const toonGradient = () => {
  if (!gradTex) {
    gradTex = new THREE.DataTexture(new Uint8Array([150, 215, 255]), 3, 1, THREE.RedFormat);
    gradTex.minFilter = THREE.NearestFilter; gradTex.magFilter = THREE.NearestFilter; gradTex.generateMipmaps = false; gradTex.needsUpdate = true;
  }
  return gradTex;
};
const outlineMat = new THREE.ShaderMaterial({
  uniforms: { thickness: { value: 0.014 }, color: { value: new THREE.Color('#1b1420') } },
  vertexShader: 'uniform float thickness; void main(){ vec4 p = modelViewMatrix * vec4(position, 1.0); vec3 n = normalize(normalMatrix * normal); p.xyz += n * thickness; gl_Position = projectionMatrix * p; }',
  fragmentShader: 'uniform vec3 color; void main(){ gl_FragColor = vec4(color, 1.0); }',
  side: THREE.BackSide,
});
const G = {
  sphere: new THREE.SphereGeometry(1, 40, 28),
  cap: new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.55),
  half: new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 32),
  cone: new THREE.ConeGeometry(1, 1, 40),
  smile: new THREE.TorusGeometry(1, 0.2, 10, 24, Math.PI),
  ring: new THREE.TorusGeometry(1, 0.12, 10, 32),
};
const capsules = new Map<string, THREE.CapsuleGeometry>();
const capsule = (r: number, len: number) => {
  const k = `${r.toFixed(3)}:${len.toFixed(3)}`;
  if (!capsules.has(k)) capsules.set(k, new THREE.CapsuleGeometry(r, len, 8, 24));
  return capsules.get(k)!;
};

type V3 = [number, number, number];
const Part: React.FC<{ geo: THREE.BufferGeometry; color: string; position?: V3; rotation?: V3; scale?: V3 | number; outline?: boolean; double?: boolean; opacity?: number }> = ({ geo, color, position, rotation, scale, outline = true, double, opacity }) => (
  <group position={position} rotation={rotation} scale={scale as any}>
    <mesh geometry={geo}>
      {opacity != null
        ? <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
        : <meshToonMaterial color={color} gradientMap={toonGradient()} side={double ? THREE.DoubleSide : THREE.FrontSide} />}
    </mesh>
    {outline && <mesh geometry={geo} material={outlineMat} />}
  </group>
);
/** A limb segment hanging down from its pivot (capsule from y=0 to y=-len). */
const Limb: React.FC<{ r: number; len: number; color: string }> = ({ r, len, color }) => (
  <Part geo={capsule(r, Math.max(0.001, len - 2 * r))} color={color} position={[0, -len / 2, 0]} />
);
const shade = (hex: string, k: number) => { const c = new THREE.Color(hex); c.offsetHSL(0, 0, k); return `#${c.getHexString()}`; };

/* ---------------- the character ---------------- */
const Face: React.FC<{ L: Required<Look>; R: number; expr: Expression; mouth: number; blink: number; lookUp: number }> = ({ L, R, expr, mouth, blink, lookUp }) => {
  const ex = 0.36 * R, ey = 0.08 * R, ez = 0.86 * R;
  const eyeS = (expr === 'surprised' ? 0.2 : 0.17) * R;
  const brow = { smile: [0.05, 0], neutral: [0, 0], happy: [0.1, -0.1], sad: [0.02, 0.35], surprised: [0.16, 0.05], angry: [-0.04, -0.4] }[expr];
  const open = Math.max(mouth, expr === 'surprised' ? 0.55 : 0);
  const happyEyes = expr === 'happy' && mouth < 0.3;
  return (
    <group>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * ex, ey + lookUp * 0.03 * R, ez]} scale={[1, Math.max(0.08, 1 - blink), 1]}>
          {happyEyes
            ? <Part geo={G.smile} color={L.eyes} position={[0, -0.02 * R, 0.05 * R]} rotation={[0, 0, 0]} scale={eyeS * 0.75} outline={false} />
            : (
              <>
                <Part geo={G.sphere} color="#ffffff" scale={[eyeS, eyeS * 1.25, eyeS * 0.6]} />
                <Part geo={G.sphere} color={L.eyes} position={[s * -0.015 * R, -0.01 * R + lookUp * 0.07 * R, eyeS * 0.42]} scale={[eyeS * 0.66, eyeS * 0.82, eyeS * 0.4]} outline={false} />
                <Part geo={G.sphere} color="#ffffff" position={[s * -0.015 * R + 0.045 * R, 0.045 * R + lookUp * 0.07 * R, eyeS * 0.66]} scale={eyeS * 0.22} outline={false} />
              </>
            )}
          {/* eyebrow */}
          <group position={[0, eyeS * 1.65 + brow[0] * R, 0.02 * R]} rotation={[0, 0, s * brow[1]]}>
            <Part geo={capsule(0.028 * R, 0.13 * R)} color={L.hairStyle === 'bald' ? shade(L.hair, -0.1) : L.hair} rotation={[0, 0, Math.PI / 2]} outline={false} />
          </group>
        </group>
      ))}
      {/* nose + cheeks */}
      <Part geo={G.sphere} color={shade(L.skin, -0.05)} position={[0, -0.1 * R, 0.97 * R]} scale={[0.07 * R, 0.06 * R, 0.06 * R]} outline={false} />
      {L.blush && [-1, 1].map((s) => <Part key={s} geo={G.sphere} color="#fb7185" opacity={0.35} position={[s * 0.52 * R, -0.18 * R, 0.8 * R]} scale={[0.12 * R, 0.07 * R, 0.04 * R]} outline={false} />)}
      {/* mouth: smile arc when closed, open ellipse while talking */}
      <group position={[0, -0.36 * R, 0.9 * R]} rotation={[-0.25, 0, 0]}>
        {open > 0.08
          ? (
            <>
              <Part geo={G.sphere} color="#4a0f14" scale={[(0.13 - 0.03 * open) * R, (0.03 + 0.13 * open) * R, 0.05 * R]} />
              <Part geo={G.sphere} color="#e86a73" position={[0, -0.04 * open * R, 0.01 * R]} scale={[0.07 * R, 0.035 * open * R, 0.045 * R]} outline={false} />
            </>
          )
          : expr === 'neutral' || expr === 'angry'
            ? <Part geo={capsule(0.018 * R, 0.14 * R)} color="#5b1a1a" rotation={[0, 0, Math.PI / 2]} outline={false} />
            : <Part geo={G.smile} color="#5b1a1a" rotation={[0, 0, expr === 'sad' ? 0 : Math.PI]} position={[0, expr === 'sad' ? -0.06 * R : 0.05 * R, 0]} scale={[(expr === 'happy' ? 0.15 : 0.12) * R, (expr === 'happy' ? 0.12 : 0.08) * R, 0.1 * R]} outline={false} />}
      </group>
      {L.beard === 'mustache' && [-1, 1].map((s) => <Part key={s} geo={G.sphere} color={L.hair} position={[s * 0.1 * R, -0.24 * R, 0.93 * R]} rotation={[0, 0, s * 0.35]} scale={[0.13 * R, 0.05 * R, 0.05 * R]} />)}
      {L.beard === 'beard' && <Part geo={G.half} color={L.hair} position={[0, -0.25 * R, 0.05 * R]} rotation={[Math.PI, 0, 0]} scale={[0.9 * R, 0.78 * R, 0.95 * R]} />}
      {L.glasses && (
        <group position={[0, ey, ez + 0.13 * R]}>
          {[-1, 1].map((s) => <Part key={s} geo={G.ring} color="#1f2937" position={[s * ex, 0, 0]} scale={[0.25 * R, 0.22 * R, 0.25 * R]} outline={false} />)}
          <Part geo={capsule(0.016 * R, 0.16 * R)} color="#1f2937" rotation={[0, 0, Math.PI / 2]} outline={false} />
        </group>
      )}
    </group>
  );
};

const Hair: React.FC<{ L: Required<Look>; R: number }> = ({ L, R }) => {
  const c = L.hair;
  const cap = (
    <>
      <Part geo={G.cap} color={c} rotation={[-0.42, 0, 0]} scale={[R * 1.07, R * 1.08, R * 1.07]} double />
      {/* bangs: a scalloped fringe instead of a straight bowl edge */}
      {[-0.55, -0.18, 0.2, 0.55].map((a, i) => (
        <Part key={i} geo={G.sphere} color={c} position={[Math.sin(a) * 0.9 * R, (0.42 - Math.abs(a) * 0.1 - (i === 1 ? 0.07 : 0)) * R, Math.cos(a) * 0.8 * R]} rotation={[0.45, a, -a * 0.5]} scale={[0.38 * R, 0.27 * R, 0.2 * R]} />
      ))}
    </>
  );
  switch (L.hairStyle) {
    case 'bald':
      return <>{[-1, 1].map((s) => <Part key={s} geo={G.sphere} color={c} position={[s * 0.9 * R, 0.05 * R, -0.25 * R]} scale={[0.22 * R, 0.32 * R, 0.4 * R]} />)}</>;
    case 'spiky':
      return (
        <>
          {cap}
          {Array.from({ length: 9 }, (_, i) => {
            const a = -1.1 + (i / 8) * 2.2;
            return <Part key={i} geo={G.cone} color={c} position={[Math.sin(a) * 0.62 * R, 0.82 * R + Math.cos(a) * 0.12 * R, (0.15 - Math.abs(a) * 0.12) * R]} rotation={[-0.35, 0, -a * 0.8]} scale={[0.2 * R, 0.5 * R, 0.2 * R]} />;
          })}
        </>
      );
    case 'long':
      return (
        <>
          {cap}
          <Part geo={capsule(0.82 * R, 1.0 * R)} color={c} position={[0, -0.55 * R, -0.42 * R]} scale={[1.12, 1, 0.55]} />
          {[-1, 1].map((s) => <Part key={s} geo={capsule(0.2 * R, 0.9 * R)} color={c} position={[s * 0.88 * R, -0.45 * R, 0.05 * R]} rotation={[0, 0, s * 0.06]} />)}
        </>
      );
    case 'bob':
      return (
        <>
          {cap}
          <Part geo={G.sphere} color={c} position={[0, -0.12 * R, -0.18 * R]} scale={[1.14 * R, 0.85 * R, 1.0 * R]} />
        </>
      );
    case 'bun':
      return (
        <>
          {cap}
          <Part geo={G.sphere} color={c} position={[0, 0.95 * R, -0.45 * R]} scale={0.38 * R} />
        </>
      );
    case 'pigtails':
      return (
        <>
          {cap}
          {[-1, 1].map((s) => (
            <group key={s} position={[s * 1.08 * R, 0.2 * R, -0.1 * R]} rotation={[0.1, 0, s * 0.45]}>
              <Part geo={G.sphere} color={L.accent} scale={0.13 * R} />
              <Part geo={capsule(0.2 * R, 0.55 * R)} color={c} position={[s * 0.12 * R, -0.45 * R, 0]} rotation={[0, 0, s * 0.25]} />
            </group>
          ))}
        </>
      );
    case 'ponytail':
      return (
        <>
          {cap}
          <Part geo={G.sphere} color={L.accent} position={[0, 0.45 * R, -1.0 * R]} scale={0.14 * R} />
          <Part geo={capsule(0.24 * R, 0.75 * R)} color={c} position={[0, 0.05 * R, -1.18 * R]} rotation={[0.45, 0, 0]} />
        </>
      );
    case 'curly':
      return (
        <>
          {cap}
          {Array.from({ length: 16 }, (_, i) => {
            const a = (i / 16) * Math.PI * 2, ring = i % 2 ? 0.55 : 0.85;
            return <Part key={i} geo={G.sphere} color={c} position={[Math.cos(a) * ring * R, (0.8 - ring * 0.25) * R, Math.sin(a) * ring * R - 0.15 * R]} scale={0.3 * R} />;
          })}
        </>
      );
    default: // short
      return (
        <>
          {cap}
          <Part geo={G.sphere} color={c} position={[0.25 * R, 0.68 * R, 0.55 * R]} rotation={[0.5, 0, -0.5]} scale={[0.45 * R, 0.18 * R, 0.3 * R]} />
        </>
      );
  }
};

const Hat: React.FC<{ L: Required<Look>; R: number }> = ({ L, R }) => {
  if (L.hat === 'nonla') {
    return (
      <group position={[0, 0.72 * R, 0]} rotation={[-0.08, 0, 0]}>
        <Part geo={G.cone} color="#e7d3a1" position={[0, 0.32 * R, 0]} scale={[1.6 * R, 0.8 * R, 1.6 * R]} />
      </group>
    );
  }
  if (L.hat === 'cap') {
    return (
      <group rotation={[-0.25, 0, 0]}>
        <Part geo={G.half} color={L.accent} position={[0, 0.18 * R, 0]} scale={[1.1 * R, 1.0 * R, 1.1 * R]} />
        <Part geo={G.cyl} color={shade(L.accent, -0.1)} position={[0, 0.2 * R, 0.95 * R]} scale={[0.62 * R, 0.05 * R, 0.6 * R]} />
      </group>
    );
  }
  if (L.hat === 'beanie') {
    return (
      <group rotation={[-0.3, 0, 0]}>
        <Part geo={G.half} color={L.accent} position={[0, 0.2 * R, 0]} scale={[1.1 * R, 1.08 * R, 1.1 * R]} />
        <Part geo={G.ring} color={shade(L.accent, -0.12)} position={[0, 0.25 * R, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1.07 * R, 1.07 * R, 1.4 * R]} />
      </group>
    );
  }
  return null;
};

const Figure: React.FC<{ m: CastMember; T: number; frame: number; fps: number; level: number; talking: boolean; place: (x: number) => V3; unit: number }> = ({ m, T, frame, fps, level, talking, place, unit }) => {
  const L = resolveLook(m);
  const b = BUILD[L.build] || BUILD.kid;
  const H = heightOf(b);
  const { pose: p, expr, x, facing } = stateAt(m, T);
  const R = b.headR;
  const seed = m.seed ?? 1;
  // blink every ~3 s at a pseudo-random moment
  const k = Math.floor(T / 3.1), bt = k * 3.1 + 0.4 + rand(k * 3 + seed) * 2.2;
  const blink = Math.abs(T - bt) < 0.08 ? 1 - Math.abs(T - bt) / 0.08 : 0;
  // mouth: voice loudness, or a procedural chatter while a 'talk' step runs without voice
  const chatter = talking ? Math.max(0, Math.sin(T * 15)) * (0.35 + 0.65 * rand(Math.floor(T * 6) + seed)) : 0;
  const mouth = Math.max(level, chatter, p.open);
  const scaleIn = m.enter === 'none' ? 1 : spring({ frame, fps, config: { damping: 13, stiffness: 140 } });
  const s = ((m.size ?? 0.72) * unit) / H * scaleIn;
  const pos = place(x);
  const sleeve = L.outfit === 'tshirt' || L.outfit === 'dress' ? L.skin : L.shirt;
  const legColor = L.outfit === 'dress' ? L.skin : L.pants;
  const torsoTop = b.torso;
  const armRig = (side: 1 | -1, a: Arm) => (
    <group position={[side * b.shoulder, torsoTop * 0.88 + p.shrug, 0]} rotation={[a.sx, 0, side * a.sz]}>
      <Part geo={G.sphere} color={L.shirt} scale={0.088} />
      <group>
        <Limb r={0.075} len={b.arm * 0.5} color={L.shirt} />
        {(L.outfit === 'tshirt' || L.outfit === 'dress') && <group position={[0, -b.arm * 0.22, 0]}><Limb r={0.065} len={b.arm * 0.28} color={L.skin} /></group>}
      </group>
      <group position={[0, -b.arm * 0.48, 0]} rotation={[a.ex, 0, side * a.ez]}>
        <Part geo={G.sphere} color={sleeve} scale={0.068} outline={false} />
        <Limb r={0.066} len={b.arm * 0.44} color={sleeve} />
        <Part geo={G.sphere} color={L.skin} position={[0, -b.arm * 0.47, 0]} scale={0.085} />
      </group>
    </group>
  );
  return (
    <group position={[pos[0], pos[1] + p.bob * s, pos[2]]} scale={s} rotation={[0, facing * 1.1, 0]}>
      {/* blob shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005 - p.bob, 0]} scale={[0.55 * (1 - p.bob), 0.32 * (1 - p.bob), 1]}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.22} depthWrite={false} />
      </mesh>
      {/* legs + shoes */}
      {([-1, 1] as const).map((side) => (
        <group key={side} position={[side * b.hipW, b.leg, 0]} rotation={[side < 0 ? p.rl : p.ll, 0, 0]}>
          <Limb r={0.09} len={b.leg - 0.04} color={legColor} />
          <Part geo={G.sphere} color={L.shoes} position={[0, -b.leg + 0.06, 0.06]} scale={[0.11, 0.075, 0.17]} />
        </group>
      ))}
      {/* upper body pivots at the hips */}
      <group position={[0, b.leg, 0]} rotation={[p.lean, p.twist, p.sway]}>
        {L.outfit !== 'dress' && <Part geo={G.sphere} color={L.outfit === 'aodai' ? L.shirt : L.pants} position={[0, 0.04, 0]} scale={[b.bodyR * 1.04, 0.17, b.bodyR * 0.9]} />}
        {L.outfit === 'dress' && <Part geo={G.cone} color={L.shirt} position={[0, -0.05, 0]} rotation={[0, 0, 0]} scale={[b.bodyR * 1.9, b.leg * 0.75, b.bodyR * 1.7]} />}
        {L.outfit === 'aodai' && [-1, 1].map((s2) => (
          <Part key={s2} geo={G.cyl} color={L.shirt} position={[0, -b.leg * 0.42, s2 * b.bodyR * 0.62]} scale={[b.bodyR * 0.62, b.leg * 0.85, 0.025]} />
        ))}
        <Part geo={capsule(b.bodyR, Math.max(0.01, b.torso - 2 * b.bodyR + 0.12))} color={L.shirt} position={[0, b.torso * 0.5 + 0.03, 0]} scale={[1, 1 + 0.012 * Math.sin(T * 2.1), 0.82]} />
        {L.outfit === 'suit' && <Part geo={G.cone} color={L.accent} position={[0, b.torso * 0.78, b.bodyR * 0.74]} rotation={[Math.PI, 0, 0]} scale={[b.bodyR * 0.32, b.torso * 0.36, 0.04]} outline={false} />}
        {L.outfit === 'shirt' && [-1, 1].map((s2) => <Part key={s2} geo={G.cone} color={shade(L.shirt, 0.06)} position={[s2 * 0.07, b.torso * 0.93, b.bodyR * 0.6]} rotation={[0.3, 0, s2 * 2.2]} scale={[0.07, 0.12, 0.03]} />)}
        {L.outfit === 'aodai' && <Part geo={G.cyl} color={L.accent} position={[0, b.torso + 0.0, 0]} scale={[0.1, 0.07, 0.1]} />}
        {L.outfit === 'hoodie' && <Part geo={G.ring} color={shade(L.shirt, -0.08)} position={[0, b.torso * 0.98, -0.05]} rotation={[Math.PI / 2 - 0.3, 0, 0]} scale={[0.2, 0.18, 0.6]} />}
        {L.tie && <Part geo={capsule(0.035, b.torso * 0.42)} color={L.accent} position={[0, b.torso * 0.6, b.bodyR * 0.8]} scale={[1, 1, 0.5]} />}
        {armRig(-1, p.r)}
        {armRig(1, p.l)}
        {/* neck + head */}
        <Part geo={G.cyl} color={L.skin} position={[0, b.torso + 0.04, 0]} scale={[0.075, 0.12, 0.075]} />
        <group position={[0, b.torso + 0.06, 0]} rotation={[p.hx, p.hy, p.hz]}>
          <group position={[0, R * 0.95, 0]}>
            <Part geo={G.sphere} color={L.skin} scale={[R, R * 0.97, R * 0.95]} />
            {[-1, 1].map((s2) => <Part key={s2} geo={G.sphere} color={L.skin} position={[s2 * R * 0.97, -0.05 * R, 0]} scale={[0.14 * R, 0.2 * R, 0.12 * R]} />)}
            <Face L={L} R={R} expr={expr} mouth={mouth} blink={blink} lookUp={p.lookUp} />
            <Hair L={L} R={R} />
            <Hat L={L} R={R} />
          </group>
        </group>
      </group>
    </group>
  );
};

const tagColor = (hex: string) => { const c = new THREE.Color(hex), h = { h: 0, s: 0, l: 0 }; c.getHSL(h); return h.l > 0.62 ? '#334155' : hex; };
/** Name tag under the character (DOM overlay). */
const NameTag: React.FC<{ name: string; x: number; y: number; color: string; u: number }> = ({ name, x, y, color, u }) => (
  <div style={{ position: 'absolute', left: `${x * 100}%`, top: `${y * 100}%`, transform: 'translate(-50%, 18%)', background: color, color: '#fff', fontFamily: SANS, fontWeight: 800, fontSize: 30 * u, padding: `${6 * u}px ${18 * u}px`, borderRadius: 999, boxShadow: '0 6px 18px rgba(0,0,0,.25)', whiteSpace: 'nowrap' }}>{name}</div>
);

const STAGES: Record<string, string> = {
  stage: 'radial-gradient(ellipse at 50% 35%, #fef3c7 0%, #fcd9a8 45%, #f5b382 100%)',
  sky: 'linear-gradient(180deg, #7dd3fc 0%, #bae6fd 62%, #86efac 62%, #4ade80 100%)',
  studio: 'radial-gradient(ellipse at 50% 30%, #3b3f6b 0%, #1e1b3a 60%, #0d0b1d 100%)',
  classroom: 'linear-gradient(180deg, #1f5f4a 0%, #1f5f4a 58%, #c08a5a 58%, #a0703f 100%)',
};

/**
 * Stage with one or more 3D cartoon characters. Times in `actions` / `voices` are seconds from the clip start.
 * `background`: 'none' (transparent — put it above a photo/video), 'stage' | 'sky' | 'studio' | 'classroom', a CSS colour, or an image path.
 */
export const CharacterStage: React.FC<{ cast?: CastMember[]; background?: string; names?: boolean; camera?: 'full' | 'close' }> = ({ cast = [], background = 'stage', names = false, camera = 'full' }) => {
  useFonts();
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { u } = useUnit();
  const T = frame / fps;
  const waves = useWaves(cast);
  const fov = 22, dist = 20;
  const viewH = 2 * dist * Math.tan((fov / 2) * Math.PI / 180);
  const aspect = width / height;
  const zoom = camera === 'close' ? 1.7 : 1;
  const bg = background === 'none' ? null : STAGES[background] ?? (/^(#|rgb|hsl|linear|radial)/.test(background) ? background : null);
  const bgImg = background !== 'none' && !STAGES[background] && !bg ? background : null;
  return (
    <AbsoluteFill style={{ background: bg || undefined, overflow: 'hidden' }}>
      {bgImg && <Img src={media(bgImg)!} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
      <ThreeCanvas width={width} height={height} camera={{ fov, position: [0, 0, dist], near: 0.1, far: 100 }} gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }} flat style={{ position: 'absolute', inset: 0 }}>
        <ambientLight intensity={1.15} />
        <directionalLight position={[-4, 7, 9]} intensity={1.9} />
        <directionalLight position={[6, 2, -4]} intensity={0.8} color="#bfdbfe" />
        <group scale={zoom} position={[0, camera === 'close' ? -viewH * 0.55 : 0, 0]}>
          {cast.map((m, i) => {
            const vs = voicesOf(m);
            const st = stateAt(m, T);
            return (
              <Figure
                key={i} m={{ seed: i * 7 + 1, ...m }} T={T} frame={frame} fps={fps} unit={viewH}
                level={vs.length ? levelAt(waves, vs, T) : 0}
                talking={!vs.length && st.action === 'talk'}
                place={(x) => [(x - 0.5) * viewH * aspect / zoom, (0.5 - (m.y ?? 0.93)) * viewH, i * 0.01]}
              />
            );
          })}
        </group>
      </ThreeCanvas>
      {names && cast.map((m, i) => m.name && <NameTag key={i} name={m.name} x={0.5 + (stateAt(m, T).x - 0.5)} y={m.y ?? 0.93} color={tagColor(resolveLook(m).shirt)} u={u} />)}
    </AbsoluteFill>
  );
};

/** Single 3D cartoon character — same props as one `cast` member, plus `background`. */
export const Character3D: React.FC<CastMember & { background?: string; names?: boolean; camera?: 'full' | 'close' }> = ({ background = 'none', names, camera, ...m }) => (
  <CharacterStage cast={[m]} background={background} names={names} camera={camera} />
);

/** Preset look list for UIs. */
export const characterPresetList = () => Object.entries(CHARACTER_PRESETS).map(([id, p]) => ({ id, ...p }));
export const useCharacterHeight = (look: Look) => useMemo(() => heightOf(BUILD[look.build || 'kid']), [look.build]);

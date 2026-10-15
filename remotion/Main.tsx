import React from 'react';
import {
  AbsoluteFill, Audio, Img, interpolate, OffthreadVideo, Sequence, spring,
  useCurrentFrame, useVideoConfig, type CalculateMetadataFunction,
} from 'remotion';
import { linearTiming, TransitionSeries } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { flip } from '@remotion/transitions/flip';
import { clockWipe } from '@remotion/transitions/clock-wipe';
import { components } from '@custom';
import { assetById, clipDuration, layoutTrack, normalizeProject, projectDuration } from '../shared/timeline.js';
import { lookFilter } from './looks';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Project = any;
type Clip = any;
export type MainProps = { project: Project; mediaBase?: string; hiddenTracks?: string[] };

const Ctx = React.createContext<{ project: Project; mediaBase: string }>({ project: null, mediaBase: '' });

export const mainMetadata: CalculateMetadataFunction<MainProps> = ({ props }) => {
  const p = normalizeProject(structuredClone(props.project));
  return {
    durationInFrames: Math.max(1, Math.round(projectDuration(p) * p.settings.fps)),
    fps: p.settings.fps,
    width: p.settings.width,
    height: p.settings.height,
  };
};

const sec = (s: number, fps: number) => Math.max(1, Math.round(s * fps));

function useSrc(assetId: string) {
  const { project, mediaBase } = React.useContext(Ctx);
  const a = assetById(project, assetId);
  if (!a) return null;
  return { asset: a, src: `${mediaBase}/${a.path.split('/').map(encodeURIComponent).join('/')}` };
}

function presentation(type: string, dir: string | undefined, w: number, h: number): any {
  switch (type) {
    case 'slide': return slide({ direction: (dir as any) || 'from-right' });
    case 'wipe': return wipe({ direction: (dir as any) || 'from-left' });
    case 'flip': return flip({ direction: (dir as any) || 'from-right' });
    case 'clock-wipe': return clockWipe({ width: w, height: h });
    default: return fade();
  }
}

/* ---------- clip contents ---------- */

/** Ken Burns presets → [scaleFrom, scaleTo, xFrom, xTo, yFrom, yTo] (translate as a fraction of the image box). */
const KEN_BURNS: Record<string, (k: number) => number[]> = {
  'zoom-in': (k) => [1, 1 + k, 0, 0, 0, 0],
  'zoom-out': (k) => [1 + k, 1, 0, 0, 0, 0],
  'pan-left': (k) => [1 + k, 1 + k, k / 2.4, -k / 2.4, 0, 0],
  'pan-right': (k) => [1 + k, 1 + k, -k / 2.4, k / 2.4, 0, 0],
  'pan-up': (k) => [1 + k, 1 + k, 0, 0, k / 2.4, -k / 2.4],
  'pan-down': (k) => [1 + k, 1 + k, 0, 0, -k / 2.4, k / 2.4],
  'zoom-in-left': (k) => [1, 1 + k, 0, k / 2.4, 0, 0],
  'zoom-in-right': (k) => [1, 1 + k, 0, -k / 2.4, 0, 0],
};

const Media: React.FC<{ clip: Clip; durationFrames: number; overlay?: boolean }> = ({ clip, durationFrames, overlay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const m = useSrc(clip.assetId);
  if (!m) return <Missing label={`asset ${clip.assetId}`} />;
  const fit = clip.fit || (overlay ? 'contain' : 'cover');
  const style: React.CSSProperties = { width: '100%', height: '100%', objectFit: fit, filter: lookFilter(clip.look) };
  if (m.asset.type === 'image') {
    let transform = 'none';
    if (clip.kenBurns) {
      const kb = typeof clip.kenBurns === 'object' ? clip.kenBurns : {};
      const p = interpolate(frame, [0, durationFrames], [0, 1], { extrapolateRight: 'clamp' });
      const e = p * p * (3 - 2 * p); // ease in-out
      const k = kb.amount ?? 0.15;
      const preset = KEN_BURNS[kb.preset as string];
      if (preset) {
        const [s0, s1, x0, x1, y0, y1] = preset(k);
        transform = `scale(${s0 + (s1 - s0) * e}) translate(${(x0 + (x1 - x0) * e) * 100}%, ${(y0 + (y1 - y0) * e) * 100}%)`;
      } else {
        transform = `scale(${(kb.from ?? 1) + ((kb.to ?? 1.15) - (kb.from ?? 1)) * p})`;
      }
    }
    return (
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <Img src={m.src} style={{ ...style, transform, transformOrigin: clip.kenBurns?.origin || 'center' }} />
      </AbsoluteFill>
    );
  }
  const vol = clip.volume ?? 1;
  return (
    <OffthreadVideo
      src={m.src}
      style={style}
      trimBefore={Math.round((clip.in ?? 0) * fps)}
      trimAfter={clip.out != null ? Math.round(clip.out * fps) : undefined}
      playbackRate={clip.speed || 1}
      volume={vol}
      muted={vol === 0}
      pauseWhenBuffering
    />
  );
};

function animStyle(anim: any, frame: number, total: number, fps: number): React.CSSProperties {
  const a = anim || {};
  const d = Math.max(1, Math.round((a.duration ?? 0.6) * fps));
  const bouncy = ['pop', 'bounce', 'drop'].includes(a.in);
  const pin = a.in && a.in !== 'none'
    ? spring({ frame, fps, durationInFrames: bouncy ? undefined : d, config: bouncy ? { damping: a.in === 'pop' ? 9 : 7, stiffness: 140, mass: 0.7 } : { damping: 200 } })
    : 1;
  const pout = a.out && a.out !== 'none' ? interpolate(frame, [total - d, total], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 1;
  const op = (p: number) => Math.min(1, Math.max(0, p * 1.5));
  const one = (type: string, p: number): React.CSSProperties => {
    switch (type) {
      case 'fade': case 'typewriter': return { opacity: p };
      case 'slide-up': return { opacity: p, transform: `translateY(${(1 - p) * 60}px)` };
      case 'slide-down': return { opacity: p, transform: `translateY(${(p - 1) * 60}px)` };
      case 'slide-left': return { opacity: p, transform: `translateX(${(1 - p) * 80}px)` };
      case 'slide-right': return { opacity: p, transform: `translateX(${(p - 1) * 80}px)` };
      case 'scale': return { opacity: p, transform: `scale(${0.7 + 0.3 * p})` };
      case 'blur': return { opacity: p, filter: `blur(${(1 - p) * 12}px)` };
      case 'zoom-in': return { opacity: op(p), transform: `scale(${1.6 - 0.6 * p})`, filter: `blur(${(1 - Math.min(1, p)) * 8}px)` };
      case 'zoom-out': return { opacity: op(p), transform: `scale(${0.3 + 0.7 * p})` };
      case 'pop': return { opacity: op(p), transform: `scale(${p})` };
      case 'bounce': return { opacity: op(p), transform: `translateY(${(1 - p) * 220}px)` };
      case 'drop': return { opacity: op(p), transform: `translateY(${(p - 1) * 260}px)` };
      case 'rotate': return { opacity: p, transform: `rotate(${(1 - p) * -25}deg) scale(${0.6 + 0.4 * p})` };
      case 'flip': return { opacity: op(p), transform: `perspective(900px) rotateX(${(1 - p) * 90}deg)` };
      case 'wipe': return { clipPath: `inset(0 ${(1 - Math.min(1, p)) * 100}% 0 0)` };
      case 'wipe-up': return { clipPath: `inset(${(1 - Math.min(1, p)) * 100}% 0 0 0)` };
      default: return {};
    }
  };
  // continuous emphasis while the clip is on screen
  const t = frame / fps;
  const amt = a.loopStrength ?? 1;
  const loop = (): string | undefined => {
    switch (a.loop) {
      case 'pulse': return `scale(${1 + 0.05 * amt * Math.sin(t * Math.PI * 2 * 0.8)})`;
      case 'heartbeat': { const ph = (t * 1.1) % 1; return `scale(${1 + 0.09 * amt * (Math.exp(-((ph - 0.1) ** 2) / 0.002) + 0.6 * Math.exp(-((ph - 0.3) ** 2) / 0.002))})`; }
      case 'float': return `translateY(${Math.sin(t * Math.PI * 2 * 0.4) * 14 * amt}px)`;
      case 'shake': return `translateX(${Math.sin(t * 60) * 6 * amt}px) rotate(${Math.sin(t * 47) * 1.2 * amt}deg)`;
      case 'wiggle': return `rotate(${Math.sin(t * Math.PI * 2 * 1.2) * 4 * amt}deg)`;
      case 'spin': return `rotate(${t * 90 * amt}deg)`;
      case 'zoom': return `scale(${1 + 0.12 * amt * Math.min(1, t / Math.max(0.1, total / fps))})`;
      default: return undefined;
    }
  };
  const sIn = one(a.in, pin);
  const sOut = frame > total - d ? one(a.out, pout) : {};
  return {
    opacity: (sIn.opacity as number ?? 1) * (sOut.opacity as number ?? 1),
    transform: [sIn.transform, sOut.transform, loop()].filter(Boolean).join(' ') || undefined,
    filter: sIn.filter || sOut.filter,
    clipPath: sIn.clipPath || sOut.clipPath,
  };
}

const Text: React.FC<{ clip: Clip; durationFrames: number }> = ({ clip, durationFrames }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const s = clip.style || {};
  let text: string = clip.text ?? '';
  if (clip.animation?.in === 'typewriter') {
    const cps = clip.animation.charsPerSecond ?? 25;
    text = text.slice(0, Math.floor((frame / fps) * cps));
  }
  const anim = animStyle(clip.animation, frame, durationFrames, fps);
  return (
    <div
      style={{
        position: 'absolute',
        left: `${(clip.x ?? 0.5) * 100}%`,
        top: `${(clip.y ?? 0.5) * 100}%`,
        width: clip.width ? clip.width * width : undefined,
        maxWidth: width * 0.95,
        transform: `translate(-${(s.align === 'left' ? 0 : s.align === 'right' ? 100 : 50)}%, -50%)`,
      }}
    >
      <div
        style={{
          ...anim,
          fontSize: s.fontSize ?? 72,
          fontFamily: s.fontFamily ?? 'Inter, Arial, sans-serif',
          fontWeight: s.fontWeight ?? 700,
          fontStyle: s.italic ? 'italic' : undefined,
          color: s.color ?? '#ffffff',
          textAlign: s.align ?? 'center',
          lineHeight: s.lineHeight ?? 1.15,
          letterSpacing: s.letterSpacing,
          textTransform: s.uppercase ? 'uppercase' : undefined,
          textShadow: s.shadow === false ? undefined : s.shadow ?? '0 2px 12px rgba(0,0,0,0.6)',
          background: s.background,
          padding: s.background ? s.padding ?? '0.2em 0.5em' : undefined,
          borderRadius: s.borderRadius ?? (s.background ? 12 : undefined),
          whiteSpace: 'pre-wrap',
        }}
      >
        {text}
      </div>
    </div>
  );
};

const Missing: React.FC<{ label: string }> = ({ label }) => (
  <AbsoluteFill style={{ background: '#400', color: '#fff', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>
    Missing: {label}
  </AbsoluteFill>
);

const ClipContent: React.FC<{ clip: Clip; durationFrames: number; overlay?: boolean }> = ({ clip, durationFrames, overlay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  let inner: React.ReactNode;
  switch (clip.kind) {
    case 'text': inner = <Text clip={clip} durationFrames={durationFrames} />; break;
    case 'solid': inner = <AbsoluteFill style={{ background: clip.color || '#000' }} />; break;
    case 'component': {
      const C = (components as Record<string, React.FC<any>>)[clip.component];
      inner = C ? <C {...(clip.props || {})} /> : <Missing label={`component ${clip.component}`} />;
      break;
    }
    default: inner = <Media clip={clip} durationFrames={durationFrames} overlay={overlay} />;
  }
  if (!overlay || clip.kind === 'text') return <AbsoluteFill style={{ opacity: clip.opacity ?? 1 }}>{inner}</AbsoluteFill>;
  // positioned overlay box (image / video / solid / component)
  const anim = animStyle(clip.animation, frame, durationFrames, fps);
  const w = clip.width ?? 1, h = clip.height ?? 1;
  return (
    <AbsoluteFill style={{ opacity: clip.opacity ?? 1 }}>
      <div style={{
        position: 'absolute', left: `${((clip.x ?? 0.5) - w / 2) * 100}%`, top: `${((clip.y ?? 0.5) - h / 2) * 100}%`,
        width: `${w * 100}%`, height: `${h * 100}%`, overflow: 'hidden', borderRadius: clip.borderRadius, ...anim,
      }}>
        <AbsoluteFill>{inner}</AbsoluteFill>
      </div>
    </AbsoluteFill>
  );
};

/* ---------- tracks ---------- */

const SequenceTrack: React.FC<{ track: any }> = ({ track }) => {
  const { project } = React.useContext(Ctx);
  const { fps, width, height } = useVideoConfig();
  const layout = layoutTrack(track, project);
  if (!layout.length) return null;
  const items: React.ReactNode[] = [];
  layout.forEach((l: any, i: number) => {
    const d = sec(l.duration, fps);
    items.push(
      <TransitionSeries.Sequence key={l.clip.id} durationInFrames={d} name={l.clip.name || l.clip.id}>
        <ClipContent clip={l.clip} durationFrames={d} />
      </TransitionSeries.Sequence>,
    );
    if (l.transition > 0 && i < layout.length - 1) {
      items.push(
        <TransitionSeries.Transition
          key={`${l.clip.id}-tr`}
          presentation={presentation(l.clip.transition.type, l.clip.transition.direction, width, height)}
          timing={linearTiming({ durationInFrames: Math.round(l.transition * fps) })}
        />,
      );
    }
  });
  return <TransitionSeries name={track.name}>{items}</TransitionSeries>;
};

const OverlayTrack: React.FC<{ track: any }> = ({ track }) => {
  const { project } = React.useContext(Ctx);
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill>
      {layoutTrack(track, project).map((l: any) => {
        const d = sec(l.duration, fps);
        return (
          <Sequence key={l.clip.id} from={Math.round(l.start * fps)} durationInFrames={d} name={l.clip.name || l.clip.text || l.clip.id} layout="none">
            <ClipContent clip={l.clip} durationFrames={d} overlay />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const AudioClip: React.FC<{ clip: Clip; durationFrames: number }> = ({ clip, durationFrames }) => {
  const { fps } = useVideoConfig();
  const m = useSrc(clip.assetId);
  if (!m) return null;
  const base = clip.volume ?? 1;
  const fi = Math.round((clip.fadeIn ?? 0) * fps), fo = Math.round((clip.fadeOut ?? 0) * fps);
  return (
    <Audio
      src={m.src}
      trimBefore={Math.round((clip.in ?? 0) * fps)}
      trimAfter={clip.out != null ? Math.round(clip.out * fps) : undefined}
      playbackRate={clip.speed || 1}
      volume={(f) => {
        let v = base;
        if (fi > 0) v *= Math.min(1, f / fi);
        if (fo > 0) v *= Math.min(1, Math.max(0, (durationFrames - f) / fo));
        return v;
      }}
    />
  );
};

const AudioTrack: React.FC<{ track: any }> = ({ track }) => {
  const { project } = React.useContext(Ctx);
  const { fps } = useVideoConfig();
  if (track.muted) return null;
  return (
    <>
      {layoutTrack(track, project).map((l: any) => {
        const d = sec(l.duration, fps);
        return (
          <Sequence key={l.clip.id} from={Math.round(l.start * fps)} durationInFrames={d} name={l.clip.name || l.clip.id} layout="none">
            <AudioClip clip={l.clip} durationFrames={d} />
          </Sequence>
        );
      })}
    </>
  );
};

const Subtitles: React.FC = () => {
  const { project } = React.useContext(Ctx);
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const st = project.subtitles;
  if (!st?.enabled || !st.cues?.length) return null;
  const t = frame / fps;
  const cue = st.cues.find((c: any) => t >= c.start && t < c.end);
  if (!cue) return null;
  const s = st.style;
  return (
    <AbsoluteFill style={{ alignItems: 'center' }}>
      <div style={{
        position: 'absolute', top: `${s.position * 100}%`, transform: 'translateY(-50%)', maxWidth: width * s.maxWidth,
        fontSize: s.fontSize, color: s.color, background: s.background, fontFamily: s.fontFamily, fontWeight: s.fontWeight,
        padding: '0.15em 0.5em', borderRadius: 10, textAlign: 'center', lineHeight: 1.25,
      }}>
        {cue.text}
      </div>
    </AbsoluteFill>
  );
};

const Logo: React.FC = () => {
  const { project } = React.useContext(Ctx);
  const { width, height } = useVideoConfig();
  const lg = project.logo;
  const m = useSrc(lg?.assetId);
  if (!lg?.enabled || !m || m.asset.type !== 'image') return null;
  const side = Math.min(width, height);
  const w = side * lg.size;
  const pad = side * lg.margin;
  const [v, hz] = String(lg.position).split('-');
  const style: React.CSSProperties = { position: 'absolute', width: w, height: 'auto', opacity: lg.opacity, [v === 'bottom' ? 'bottom' : 'top']: pad };
  if (hz === 'left') style.left = pad;
  else if (hz === 'right') style.right = pad;
  else { style.left = '50%'; style.transform = 'translateX(-50%)'; }
  return <AbsoluteFill style={{ pointerEvents: 'none' }}><Img src={m.src} style={style} /></AbsoluteFill>;
};

export const Main: React.FC<MainProps> = ({ project: raw, mediaBase = '', hiddenTracks = [] }) => {
  const project = React.useMemo(() => normalizeProject(structuredClone(raw)), [raw]);
  return (
    <Ctx.Provider value={{ project, mediaBase }}>
      <AbsoluteFill style={{ background: project.settings.background }}>
        {project.tracks.map((track: any) => {
          if (track.hidden || hiddenTracks.includes(track.id)) return null;
          if (track.type === 'sequence') return <AbsoluteFill key={track.id}><SequenceTrack track={track} /></AbsoluteFill>;
          if (track.type === 'audio') return <AudioTrack key={track.id} track={track} />;
          return <OverlayTrack key={track.id} track={track} />;
        })}
        <Subtitles />
        <Logo />
      </AbsoluteFill>
    </Ctx.Provider>
  );
};

export { clipDuration };

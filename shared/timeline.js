// Shared timeline model: used by the web editor, the Remotion composition and the CLI tools.
// All times in project.json are in SECONDS. Remotion converts to frames at render time.

export const TRANSITIONS = ['none', 'fade', 'slide', 'wipe', 'flip', 'clock-wipe'];
export const TEXT_ANIMATIONS = ['none', 'fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'scale', 'typewriter', 'blur',
  'zoom-in', 'zoom-out', 'pop', 'bounce', 'drop', 'rotate', 'flip', 'wipe', 'wipe-up'];
/** Continuous emphasis while a clip is on screen (`animation.loop`, strength `animation.loopStrength`). */
export const LOOP_ANIMATIONS = ['none', 'pulse', 'heartbeat', 'float', 'shake', 'wiggle', 'spin', 'zoom'];
/** Image `kenBurns.preset` (strength `kenBurns.amount`, default 0.15). */
export const KEN_BURNS_PRESETS = ['', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'zoom-in-left', 'zoom-in-right'];

export function newId(prefix = 'c') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyProject(name = 'Untitled') {
  return normalizeProject({
    version: 1,
    name,
    settings: { width: 1920, height: 1080, fps: 30, background: '#000000' },
    assets: [],
    tracks: [
      { id: 'main', name: 'Main', type: 'sequence', clips: [] },
      { id: 'overlay', name: 'Text & Overlay', type: 'overlay', clips: [] },
      { id: 'music', name: 'Music', type: 'audio', clips: [] },
    ],
    subtitles: { enabled: true, cues: [], style: {} },
  });
}

export function normalizeProject(p) {
  p = p && typeof p === 'object' ? p : {};
  p.version ??= 1;
  p.name ??= 'Untitled';
  p.settings = { width: 1920, height: 1080, fps: 30, background: '#000000', ...(p.settings || {}) };
  p.assets = Array.isArray(p.assets) ? p.assets : [];
  p.tracks = Array.isArray(p.tracks) ? p.tracks : [];
  for (const t of p.tracks) {
    t.id ??= newId('t');
    t.name ??= t.id;
    t.type ??= 'overlay';
    t.clips = Array.isArray(t.clips) ? t.clips : [];
    for (const c of t.clips) c.id ??= newId();
  }
  p.subtitles = { enabled: true, cues: [], ...(p.subtitles || {}) };
  p.subtitles.style = {
    fontSize: 48, color: '#ffffff', background: 'rgba(0,0,0,0.55)', position: 0.88,
    fontFamily: 'Inter, Arial, sans-serif', fontWeight: 700, maxWidth: 0.8,
    ...(p.subtitles.style || {}),
  };
  if (p.logo) p.logo = { ...LOGO_DEFAULTS, ...p.logo };
  return p;
}

/** Watermark/logo shown over the whole video. `size` = logo width as a fraction of the shorter frame side. */
export const LOGO_POSITIONS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];
export const LOGO_DEFAULTS = { enabled: true, assetId: null, position: 'top-right', size: 0.18, margin: 0.04, opacity: 0.9 };

export function assetById(project, id) {
  return project.assets.find((a) => a.id === id);
}

/** Duration (seconds) a clip occupies on the timeline (before transition overlap). */
export function clipDuration(clip, project) {
  if (clip.kind === 'video' || clip.kind === 'audio' || (clip.kind === undefined && clip.assetId)) {
    const asset = project && clip.assetId ? assetById(project, clip.assetId) : null;
    const inn = clip.in ?? 0;
    const out = clip.out ?? asset?.duration ?? inn + (clip.duration ?? 5);
    const speed = clip.speed || 1;
    return Math.max(0.04, (out - inn) / speed);
  }
  return Math.max(0.04, clip.duration ?? 5);
}

/**
 * Layout of a 'sequence' track: clips play back-to-back, transitions overlap neighbours.
 * clip.transition = { type, duration } describes the transition INTO THE NEXT clip.
 */
export function sequenceLayout(track, project) {
  const out = [];
  let t = 0;
  track.clips.forEach((clip, i) => {
    const duration = clipDuration(clip, project);
    const next = track.clips[i + 1];
    let trans = 0;
    if (next && clip.transition && clip.transition.type && clip.transition.type !== 'none') {
      const nextDur = clipDuration(next, project);
      trans = Math.max(0, Math.min(clip.transition.duration ?? 0.5, duration * 0.9, nextDur * 0.9));
    }
    out.push({ clip, start: t, end: t + duration, duration, transition: trans });
    t += duration - trans;
  });
  return out;
}

/** Start/end of every clip on every track (seconds). */
export function layoutTrack(track, project) {
  if (track.type === 'sequence') return sequenceLayout(track, project);
  return track.clips.map((clip) => {
    const start = clip.start ?? 0;
    const duration = clipDuration(clip, project);
    return { clip, start, end: start + duration, duration, transition: 0 };
  });
}

export function projectDuration(project) {
  let end = 0;
  for (const track of project.tracks) {
    for (const l of layoutTrack(track, project)) end = Math.max(end, l.end);
  }
  for (const c of project.subtitles?.cues || []) end = Math.max(end, c.end);
  return Math.max(end, 1);
}

export function findClip(project, clipId) {
  for (const track of project.tracks) {
    const idx = track.clips.findIndex((c) => c.id === clipId);
    if (idx >= 0) return { track, clip: track.clips[idx], index: idx };
  }
  return null;
}

/** Map a time in an asset's source media to timeline time (first match), or null if cut out. */
export function sourceToTimeline(project, assetId, t) {
  for (const track of project.tracks) {
    for (const l of layoutTrack(track, project)) {
      const c = l.clip;
      if (c.assetId !== assetId) continue;
      const inn = c.in ?? 0;
      const out = c.out ?? inn + l.duration * (c.speed || 1);
      if (t >= inn && t < out) return l.start + (t - inn) / (c.speed || 1);
    }
  }
  return null;
}

/** Split a clip at timeline time `t`. Returns the new right-hand clip, or null. */
export function splitClip(project, clipId, t) {
  const found = findClip(project, clipId);
  if (!found) return null;
  const { track, clip, index } = found;
  const l = layoutTrack(track, project).find((x) => x.clip === clip);
  if (!l || t <= l.start + 0.05 || t >= l.end - 0.05) return null;
  const local = t - l.start;
  const right = structuredClone(clip);
  right.id = newId();
  if (clip.assetId && (clip.kind === 'video' || clip.kind === 'audio' || track.type === 'audio')) {
    const speed = clip.speed || 1;
    const cut = (clip.in ?? 0) + local * speed;
    const asset = assetById(project, clip.assetId);
    right.in = cut;
    right.out = clip.out ?? asset?.duration;
    clip.out = cut;
  } else {
    right.duration = l.duration - local;
    clip.duration = local;
  }
  if (track.type !== 'sequence') right.start = t;
  else delete clip.transition;
  track.clips.splice(index + 1, 0, right);
  return right;
}

export function fmtTime(sec, fps = 30) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const f = Math.floor((sec % 1) * fps);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
}

/**
 * Put an audio asset on an audio track (created when missing) at `start`.
 * Music is trimmed to the end of the video and faded out; voice-over is kept whole.
 */
export function addAudioClip(project, asset, { trackId, trackName, start = 0, volume = 1, fadeIn = 0, fadeOut = 0, fitToVideo = false } = {}) {
  let track = project.tracks.find((t) => t.id === trackId);
  if (!track) {
    track = { id: trackId || newId('t'), name: trackName || 'Audio', type: 'audio', clips: [] };
    project.tracks.push(track);
  }
  let out = asset.duration;
  if (fitToVideo) {
    const videoEnd = projectDuration(project);
    if (videoEnd > start + 1) out = Math.min(out, videoEnd - start);
  }
  const clip = { id: newId(), name: asset.name, assetId: asset.id, start: Math.max(0, start), in: 0, out, volume };
  if (fadeIn) clip.fadeIn = fadeIn;
  if (fadeOut) clip.fadeOut = fadeOut;
  track.clips.push(clip);
  return clip;
}

/** Attribution lines for every licensed asset (e.g. CC BY music) used on the timeline — for video descriptions. */
export function creditsFor(project) {
  const used = new Set(project.tracks.flatMap((tr) => tr.clips.map((c) => c.assetId)).filter(Boolean));
  return [...new Set(project.assets.filter((a) => a.attribution && used.has(a.id)).map((a) => a.attribution))];
}

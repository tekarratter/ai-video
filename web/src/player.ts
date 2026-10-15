import type { PlayerRef } from '@remotion/player';
import { findClip, layoutTrack, splitClip, newId } from '../../shared/timeline.js';
import { useStore } from './store';

/** The single Remotion Player instance (owned by <Preview/>), shared with the timeline & shortcuts. */
export const player: { ref: PlayerRef | null } = { ref: null };

export function fps() {
  return useStore.getState().project?.settings.fps || 30;
}

export function seek(sec: number) {
  const f = Math.max(0, Math.round(sec * fps()));
  player.ref?.seekTo(f);
  useStore.setState({ frame: f });
}

export function currentTime() {
  return useStore.getState().frame / fps();
}

export function togglePlay() {
  player.ref?.toggle();
}

/** Split the selected clip at the playhead (or the main-track clip under the playhead). */
export function splitAtPlayhead() {
  const s = useStore.getState();
  const t = currentTime();
  let id = s.selection;
  if (!id || !findClip(s.project, id)) {
    const main = s.project.tracks.find((tr: any) => tr.type === 'sequence'); // eslint-disable-line @typescript-eslint/no-explicit-any
    id = main && layoutTrack(main, s.project).find((l: any) => t > l.start && t < l.end)?.clip.id; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  if (!id) return;
  s.update((p) => { const r = splitClip(p, id, t); if (r) useStore.setState({ selection: r.id }); });
}

export function deleteSelection() {
  const s = useStore.getState();
  if (!s.selection) return;
  const sub = /^sub:(\d+)$/.exec(s.selection);
  if (sub) { s.update((p) => { p.subtitles.cues.splice(Number(sub[1]), 1); }); s.select(null); return; }
  if (s.selection === 'subs') return;
  s.update((p) => { for (const t of p.tracks) t.clips = t.clips.filter((c: any) => c.id !== s.selection); }); // eslint-disable-line @typescript-eslint/no-explicit-any
  s.select(null);
}

export function duplicateSelection() {
  const s = useStore.getState();
  if (!s.selection) return;
  s.update((p) => {
    const f = findClip(p, s.selection);
    if (!f) return;
    const copy = { ...structuredClone(f.clip), id: newId() };
    if (f.track.type !== 'sequence') copy.start = (f.clip.start ?? 0) + 0.5;
    f.track.clips.splice(f.index + 1, 0, copy);
    useStore.setState({ selection: copy.id });
  });
}

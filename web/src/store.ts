import { create } from 'zustand';
import { normalizeProject } from '../../shared/timeline.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Project = any;
export type Clip = any;
export type ChatItem = {
  key: string; type: 'user' | 'assistant' | 'tool' | 'system' | 'command'; text?: string;
  name?: string; input?: any; result?: string; error?: boolean; done?: boolean; id?: string; ts?: string;
};
export type ChatStatus = { running: boolean; busy: boolean; prompt: null | { question: string; context: string; options: { key: string; label: string }[] }; sessionId: string | null };
export type Job = { id: string; type: string; label: string; stage: string; progress: number; error?: string; file?: string; url?: string; startedAt: number; cancelled?: boolean; projectId?: string; projectName?: string;
  // scene-by-scene render
  scenes?: { label: string; start: number; end: number; reused?: boolean; done?: boolean }[]; reused?: number; sceneCount?: number; current?: string };

export const CLIENT_ID = Math.random().toString(36).slice(2);

type State = {
  project: Project | null;
  past: Project[];
  future: Project[];
  selection: string | null;
  frame: number;
  playing: boolean;
  zoom: number; // px per second
  openComp: string; // 'Main' or a custom component name
  chat: ChatItem[];
  chatStatus: ChatStatus;
  tmux: string;
  jobs: Record<string, Job>;
  toasts: { id: number; text: string; level?: string }[];
  remoteFlash: number; // timestamp of the last external (AI/CLI) edit
  customVersion: number;
  hiddenTracks: string[];
  playbackRate: number;
  user: { username: string; role: string; mustChange?: boolean } | null;
  authChecked: boolean;
  projects: ProjectInfo[];
  uploads: Record<string, Upload>;
  activeProject: string | null;
  safePreview: string | null; // platform key of SAFE_ZONES shown in the preview
  layout: Layout;
  setProject: (p: Project, opts?: { record?: boolean; save?: boolean; from?: Project }) => void;
  update: (fn: (p: Project) => void, opts?: { record?: boolean; save?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  select: (id: string | null) => void;
  toast: (text: string, level?: string) => void;
};

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let unsaved: Project | null = null;
let lastRecord = 0; // coalesce rapid edits (typing in the inspector) into one undo step
const putProject = (p: Project) =>
  fetch('/api/project', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-client-id': CLIENT_ID }, body: JSON.stringify(p) })
    .then((r) => { if (!r.ok) throw new Error(String(r.status)); })
    .catch(() => useStore.getState().toast('Không lưu được project', 'error'));
function scheduleSave(p: Project) {
  clearTimeout(saveTimer);
  unsaved = p;
  saveTimer = setTimeout(() => { unsaved = null; putProject(p); }, 250);
}
/** Send a pending (debounced) save right now — call before switching project so the last edit isn't lost. */
export async function flushSave() {
  clearTimeout(saveTimer);
  const p = unsaved; unsaved = null;
  if (p) await putProject(p);
}

const lsGet = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage off */ } };

export type Layout = { left: boolean; right: boolean; timeline: boolean }; // true = collapsed
export function toggleLayout(k: keyof Layout) {
  const layout = { ...useStore.getState().layout, [k]: !useStore.getState().layout[k] };
  useStore.setState({ layout });
  lsSet('aiv.layout', layout);
}

export type Upload = {
  id: string; name: string; files: number; loaded: number; total: number; speed: number;
  state: 'uploading' | 'processing' | 'error' | 'cancelled'; error?: string; startedAt: number; abort?: () => void;
  current?: string; retry?: string;
};

export type ProjectInfo = {
  id: string; name: string; width: number; height: number; fps: number; duration: number;
  assets: number; exports: number; thumb: string | null; updatedAt: number; active: boolean;
};

export const useStore = create<State>((set, get) => ({
  project: null,
  past: [],
  future: [],
  selection: null,
  frame: 0,
  playing: false,
  zoom: 60,
  openComp: 'Main',
  chat: [],
  chatStatus: { running: false, busy: false, prompt: null, sessionId: null },
  tmux: 'ai-video',
  jobs: {},
  toasts: [],
  remoteFlash: 0,
  customVersion: 0,
  hiddenTracks: [],
  playbackRate: 1,
  user: null,
  authChecked: false,
  projects: [],
  uploads: {},
  activeProject: null,
  safePreview: null,
  layout: { left: false, right: false, timeline: false, ...lsGet<Partial<Layout>>('aiv.layout', {}) },

  setProject: (p, opts: { record?: boolean; save?: boolean; from?: Project } = {}) => {
    let { record = true } = opts;
    const { save = true, from } = opts;
    const prev = from ?? get().project;
    const next = normalizeProject(p);
    if (record && !from && Date.now() - lastRecord < 600) record = false;
    if (record) lastRecord = Date.now();
    set((s) => ({
      project: next,
      past: record && prev ? [...s.past.slice(-99), prev] : s.past,
      future: record ? [] : s.future,
    }));
    if (save) scheduleSave(next);
  },

  update: (fn, opts) => {
    const cur = get().project;
    if (!cur) return;
    const draft = structuredClone(cur);
    fn(draft);
    get().setProject(draft, opts);
  },

  undo: () => {
    const { past, project, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({ project: prev, past: past.slice(0, -1), future: [project, ...future] });
    scheduleSave(prev);
  },

  redo: () => {
    const { past, project, future } = get();
    if (!future.length) return;
    const next = future[0];
    set({ project: next, past: [...past, project], future: future.slice(1) });
    scheduleSave(next);
  },

  select: (id) => set({ selection: id }),

  toast: (text, level) => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { id, text, level }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4500);
  },
}));

/** Apply a project that came from the server (AI / CLI / another tab). Recorded in history so it can be undone. */
export function applyRemoteProject(p: Project, origin: string) {
  const s = useStore.getState();
  if (JSON.stringify(p) === JSON.stringify(s.project)) return;
  s.setProject(p, { record: !!s.project, save: false });
  if (origin === 'external') useStore.setState({ remoteFlash: Date.now() });
}

/* Per-project working state, so switching projects back and forth resumes where you left off.
   Undo history lives in memory (this tab); playhead / selection / hidden tracks / open comp / zoom also in localStorage. */
type ProjState = { past: Project[]; future: Project[]; selection: string | null; frame: number; hiddenTracks: string[]; openComp: string; zoom: number };
const projStates = new Map<string, ProjState>();
const psKey = (id: string) => `aiv.proj.${id}`;
export function rememberProject() {
  const s = useStore.getState();
  if (!s.activeProject || !s.project) return;
  const st: ProjState = { past: s.past, future: s.future, selection: s.selection, frame: s.frame, hiddenTracks: s.hiddenTracks, openComp: s.openComp, zoom: s.zoom };
  projStates.set(s.activeProject, st);
  const { past, future, ...light } = st; // eslint-disable-line @typescript-eslint/no-unused-vars
  lsSet(psKey(s.activeProject), light);
}
window.addEventListener('beforeunload', rememberProject);
window.addEventListener('pagehide', rememberProject);

/** Another project was opened: stash the current one's working state, restore the new one's. */
export function switchProject(p: Project, activeProject: string | null) {
  const s = useStore.getState();
  if (s.activeProject && s.activeProject !== activeProject) rememberProject();
  clearTimeout(saveTimer); unsaved = null;
  const saved: Partial<ProjState> = (activeProject && (projStates.get(activeProject) || lsGet<Partial<ProjState>>(psKey(activeProject), {}))) || {};
  useStore.setState({
    project: normalizeProject(p), playing: false, activeProject,
    past: saved.past || [], future: saved.future || [],
    selection: saved.selection ?? null, frame: saved.frame || 0, hiddenTracks: saved.hiddenTracks || [],
    openComp: saved.openComp || 'Main', zoom: saved.zoom || s.zoom,
  });
}

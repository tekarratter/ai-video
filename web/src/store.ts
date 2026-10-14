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
export type Job = { id: string; type: string; label: string; stage: string; progress: number; error?: string; file?: string; url?: string; startedAt: number };

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
  setProject: (p: Project, opts?: { record?: boolean; save?: boolean; from?: Project }) => void;
  update: (fn: (p: Project) => void, opts?: { record?: boolean; save?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  select: (id: string | null) => void;
  toast: (text: string, level?: string) => void;
};

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let lastRecord = 0; // coalesce rapid edits (typing in the inspector) into one undo step
function scheduleSave(p: Project) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch('/api/project', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-client-id': CLIENT_ID }, body: JSON.stringify(p) })
      .catch(() => useStore.getState().toast('Không lưu được project', 'error'));
  }, 250);
}

export type Upload = {
  id: string; name: string; files: number; loaded: number; total: number; speed: number;
  state: 'uploading' | 'processing' | 'error' | 'cancelled'; error?: string; startedAt: number; abort?: () => void;
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

/** Another project was opened: replace everything, without undo history across projects. */
export function switchProject(p: Project, activeProject: string | null) {
  clearTimeout(saveTimer);
  useStore.setState({ project: normalizeProject(p), past: [], future: [], selection: null, frame: 0, playing: false, hiddenTracks: [], activeProject });
}

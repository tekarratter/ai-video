import { CLIENT_ID, applyRemoteProject, useStore, type ChatItem } from './store';

type Listener = (m: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
const listeners = new Set<Listener>();
let socket: WebSocket | null = null;

export function onMessage(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function send(msg: unknown) {
  if (socket?.readyState === 1) socket.send(JSON.stringify(msg));
}

function mergeItems(items: ChatItem[], added: ChatItem[], updated: ChatItem[]) {
  const byId = new Map(updated.filter((u) => u.id).map((u) => [u.id, u]));
  const out = items.map((it) => (it.id && byId.has(it.id) ? { ...it, ...byId.get(it.id) } : it));
  return [...out, ...added];
}

export function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?id=${CLIENT_ID}`);
  socket = ws;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    const st = useStore.getState();
    switch (m.type) {
      case 'hello':
        if (!st.project) useStore.getState().setProject(m.project, { record: false, save: false });
        else applyRemoteProject(m.project, 'server');
        useStore.setState({
          chat: m.chat.items, chatStatus: m.chat.status, tmux: m.chat.tmux,
          jobs: Object.fromEntries(m.jobs.map((j: any) => [j.id, j])), // eslint-disable-line @typescript-eslint/no-explicit-any
        });
        break;
      case 'project':
        applyRemoteProject(m.project, m.origin);
        break;
      case 'chat-reset':
        useStore.setState({ chat: m.items, chatStatus: { ...st.chatStatus, sessionId: m.sessionId } });
        break;
      case 'chat-items':
        useStore.setState({ chat: mergeItems(st.chat, m.added, m.updated) });
        break;
      case 'chat-status':
        useStore.setState({ chatStatus: m.status });
        break;
      case 'job': {
        const prev = st.jobs[m.job.id];
        useStore.setState({ jobs: { ...st.jobs, [m.job.id]: m.job } });
        if (m.job.stage === 'done' && prev?.stage !== 'done') st.toast(m.job.label ? `✓ ${m.job.label}` : 'Hoàn tất');
        if (m.job.stage === 'error' && prev?.stage !== 'error') st.toast(`Lỗi: ${m.job.error}`, 'error');
        break;
      }
      case 'custom-changed':
        useStore.setState({ customVersion: st.customVersion + 1 });
        break;
      case 'toast':
        st.toast(m.text, m.level);
        break;
    }
    for (const l of listeners) l(m);
  };
  ws.onopen = () => {
    for (const l of listeners) l({ type: 'open' });
  };
  ws.onclose = () => {
    socket = null;
    setTimeout(connect, 1500);
  };
}

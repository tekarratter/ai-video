import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { connect, disconnect } from '../ws';
import { Icon } from './Icon';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const api = async (url: string, method = 'GET', body?: unknown) => {
  const r = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};

/** Check the session once at start-up; connect the socket only when logged in. */
export async function checkAuth() {
  try {
    const { user } = await api('/api/auth/me');
    useStore.setState({ user, authChecked: true });
    connect();
  } catch {
    useStore.setState({ user: null, authChecked: true });
  }
}

// Any API call answered with 401 (session expired / revoked) sends the user back to the login screen.
const origFetch = window.fetch.bind(window);
window.fetch = async (...args: Parameters<typeof fetch>) => {
  const r = await origFetch(...args);
  const url = String(args[0] instanceof Request ? args[0].url : args[0]);
  if (r.status === 401 && !url.includes('/api/auth/') && useStore.getState().user) {
    disconnect();
    useStore.setState({ user: null });
  }
  return r;
};

export const LoginScreen: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const { user } = await api('/api/auth/login', 'POST', { username, password });
      useStore.setState({ user, project: null });
      connect();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand big"><span className="logo">▶</span> AI Video Studio</div>
        <label className="field col"><span>Tên đăng nhập</span><input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></label>
        <label className="field col"><span>Mật khẩu</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {err && <div className="error small">{err}</div>}
        <button className="btn primary" disabled={busy || !username || !password}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
      </form>
    </div>
  );
};

const PasswordForm: React.FC<{ onDone: () => void; forced?: boolean }> = ({ onDone, forced }) => {
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) return setErr('Hai mật khẩu mới không khớp');
    try {
      const { user } = await api('/api/auth/password', 'POST', { current, password: pw });
      useStore.setState({ user });
      useStore.getState().toast('Đã đổi mật khẩu');
      onDone();
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <form className="form" onSubmit={submit}>
      {forced && <div className="warn small">Bạn đang dùng mật khẩu mặc định — hãy đổi mật khẩu mới.</div>}
      <label className="field"><span>Mật khẩu hiện tại</span><input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
      <label className="field"><span>Mật khẩu mới</span><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
      <label className="field"><span>Nhập lại</span><input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
      {err && <div className="error small">{err}</div>}
      <div className="row gap"><div className="spacer" /><button type="button" className="btn" onClick={onDone}>{forced ? 'Để sau' : 'Huỷ'}</button><button className="btn primary" disabled={!current || !pw}>Đổi mật khẩu</button></div>
    </form>
  );
};

const UsersAdmin: React.FC = () => {
  const me = useStore((s) => s.user);
  const [users, setUsers] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [role, setRole] = useState('editor');
  const run = async (p: Promise<any>) => { try { setErr(''); setUsers(await p); } catch (e: any) { setErr(e.message); } };
  useEffect(() => { run(api('/api/users')); }, []);
  return (
    <div className="form">
      <table className="users">
        <thead><tr><th>Tài khoản</th><th>Quyền</th><th /></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.username}>
              <td>{u.username}{u.username === me?.username && <span className="muted small"> (bạn)</span>}{u.mustChange && <span className="muted small"> · chưa đổi MK</span>}</td>
              <td>
                <select value={u.role} onChange={(e) => run(api(`/api/users/${encodeURIComponent(u.username)}`, 'PATCH', { role: e.target.value }))}>
                  <option value="admin">Admin</option><option value="editor">Biên tập</option>
                </select>
              </td>
              <td className="row gap">
                <button className="btn small" onClick={() => { const p = prompt(`Mật khẩu mới cho ${u.username} (tối thiểu 6 ký tự):`); if (p) run(api(`/api/users/${encodeURIComponent(u.username)}`, 'PATCH', { password: p })); }}>Đặt lại MK</button>
                {u.username !== me?.username && <button className="icon-btn" title="Xoá" onClick={() => confirm(`Xoá tài khoản ${u.username}?`) && run(api(`/api/users/${encodeURIComponent(u.username)}`, 'DELETE'))}><Icon name="trash" /></button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="section-title">Thêm tài khoản</div>
      <div className="row gap">
        <input placeholder="tên đăng nhập" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="mật khẩu" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <select value={role} onChange={(e) => setRole(e.target.value)}><option value="editor">Biên tập</option><option value="admin">Admin</option></select>
        <button className="btn primary" disabled={!name || !pw} onClick={() => run(api('/api/users', 'POST', { username: name, password: pw, role }).then((r) => { setName(''); setPw(''); return r; }))}><Icon name="plus" /> Thêm</button>
      </div>
      {err && <div className="error small">{err}</div>}
      <div className="muted small">Người dùng mới phải đổi mật khẩu sau lần đăng nhập đầu. Admin quản lý được tài khoản; Biên tập chỉ dựng video.</div>
    </div>
  );
};

export const UserMenu: React.FC = () => {
  const user = useStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<'password' | 'users' | null>(null);
  const [nagged, setNagged] = useState(false);
  useEffect(() => { if (user?.mustChange && !nagged) { setDialog('password'); setNagged(true); } }, [user, nagged]);
  if (!user) return null;
  const logout = async () => {
    await api('/api/auth/logout', 'POST').catch(() => {});
    disconnect();
    useStore.setState({ user: null, project: null });
  };
  return (
    <>
      <div className="user-menu">
        <button className="btn ghost" onClick={() => setOpen(!open)} title="Tài khoản"><span className="avatar">{user.username[0]?.toUpperCase()}</span> {user.username}</button>
        {open && (
          <div className="menu right" onMouseLeave={() => setOpen(false)}>
            <button onClick={() => { setOpen(false); openClaudeAuth(); }}>Tài khoản Claude Code</button>
            <button onClick={() => { setOpen(false); window.dispatchEvent(new Event('open-telegram')); }}>Thông báo Telegram</button>
            <button onClick={() => { setOpen(false); setDialog('password'); }}>Đổi mật khẩu</button>
            {user.role === 'admin' && <button onClick={() => { setOpen(false); setDialog('users'); }}>Quản lý tài khoản</button>}
            {user.role === 'admin' && <button onClick={() => { setOpen(false); window.dispatchEvent(new Event('open-telegram-admin')); }}>Bot Telegram (admin)</button>}
            <button onClick={logout}>Đăng xuất</button>
          </div>
        )}
      </div>
      {dialog && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setDialog(null); }}>
          <div className="modal">
            <div className="modal-head">
              <b>{dialog === 'password' ? 'Đổi mật khẩu' : 'Quản lý tài khoản'}</b>
              <div className="spacer" />
              <button className="icon-btn" onClick={() => setDialog(null)}><Icon name="x" /></button>
            </div>
            {dialog === 'password' ? <PasswordForm forced={user.mustChange} onDone={() => setDialog(null)} /> : <UsersAdmin />}
          </div>
        </div>
      )}
    </>
  );
};

/* ---------------- Claude Code account ---------------- */

export function openClaudeAuth() { window.dispatchEvent(new Event('open-claude-auth')); }

type ClaudeStatus = { loggedIn: boolean; authMethod: string | null; email: string | null; orgName: string | null; method: string | null; apiKey: string | null; oauthToken: string | null; error?: string | null };

/** Small hook: Claude Code sign-in status (pushed over WS when it changes). */
export function useClaudeAuth() {
  const [st, setSt] = useState<ClaudeStatus | null>(null);
  useEffect(() => {
    api('/api/claude-auth').then(setSt).catch(() => {});
    const on = (e: Event) => setSt((e as CustomEvent).detail);
    window.addEventListener('claude-auth', on);
    return () => window.removeEventListener('claude-auth', on);
  }, []);
  return [st, setSt] as const;
}

export const ClaudeAuthDialog: React.FC = () => {
  const user = useStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [st, setSt] = useClaudeAuth();
  const [tab, setTab] = useState<'login' | 'token' | 'apikey'>('login');
  const [url, setUrl] = useState('');
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    const on = () => { setOpen(true); setErr(''); setUrl(''); setCode(''); setSecret(''); api('/api/claude-auth').then(setSt).catch(() => {}); };
    window.addEventListener('open-claude-auth', on);
    return () => window.removeEventListener('open-claude-auth', on);
  }, [setSt]);
  if (!open) return null;
  const admin = user?.role === 'admin';
  const run = async (fn: () => Promise<any>) => {
    setBusy(true); setErr('');
    try { const r = await fn(); setSt(r); return r; } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const method = st?.method === 'apikey' ? `API key ${st.apiKey}` : st?.method === 'token' ? `token ${st.oauthToken}` : st?.authMethod === 'claude.ai' ? 'tài khoản Claude (Pro/Max)' : st?.authMethod || '';
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="modal">
        <div className="modal-head">
          <b><Icon name="sparkle" /> Tài khoản Claude Code</b>
          <div className="spacer" />
          <button className="icon-btn" onClick={() => setOpen(false)}><Icon name="x" /></button>
        </div>
        <div className="form">
          {!st ? <div className="muted">Đang kiểm tra…</div> : st.loggedIn ? (
            <div className="row gap small">
              <span className="dot on" /> Đã kết nối: <b>{st.email || st.orgName || 'Claude'}</b> <span className="muted">({method})</span>
              <div className="spacer" />
              {admin && <button className="btn small" disabled={busy} onClick={() => confirm('Ngắt kết nối Claude Code? Chat với Claude sẽ dừng cho tới khi đăng nhập lại.') && run(() => api('/api/claude-auth/logout', 'POST'))}>Ngắt kết nối</button>}
            </div>
          ) : (
            <div className="warn small">Claude Code chưa đăng nhập — phần chat AI chưa dùng được. Mỗi nơi triển khai dùng tài khoản Claude của riêng mình.</div>
          )}
          {!admin ? <div className="muted small">Chỉ admin cấu hình được tài khoản Claude Code.</div> : (
            <>
              <div className="seg">
                <button className={tab === 'login' ? 'active' : ''} onClick={() => setTab('login')}>Đăng nhập Claude</button>
                <button className={tab === 'token' ? 'active' : ''} onClick={() => setTab('token')}>Token dài hạn</button>
                <button className={tab === 'apikey' ? 'active' : ''} onClick={() => setTab('apikey')}>API key</button>
              </div>
              {tab === 'login' && (
                <>
                  <ol className="small steps">
                    <li>Bấm <b>Lấy link đăng nhập</b>, mở link, đăng nhập tài khoản Claude (gói Pro/Max) và bấm <b>Authorize</b>.</li>
                    <li>Trang hiện ra một <b>mã (code)</b> — copy và dán vào ô dưới.</li>
                  </ol>
                  <div className="row gap wrap">
                    <button className="btn" disabled={busy} onClick={() => run(() => api('/api/claude-auth/login', 'POST', {})).then((r) => { if (r?.url) { setUrl(r.url); window.open(r.url, '_blank'); } })}><Icon name="link" /> Lấy link đăng nhập</button>
                    <button className="btn ghost small" disabled={busy} title="Tính phí theo API (Anthropic Console)" onClick={() => run(() => api('/api/claude-auth/login', 'POST', { console: true })).then((r) => { if (r?.url) { setUrl(r.url); window.open(r.url, '_blank'); } })}>…hoặc bằng tài khoản Console</button>
                  </div>
                  {url && (
                    <>
                      <a className="small break" href={url} target="_blank" rel="noreferrer">{url.slice(0, 90)}…</a>
                      <div className="row gap">
                        <input placeholder="Dán mã ở đây" value={code} onChange={(e) => setCode(e.target.value)} />
                        <button className="btn primary" disabled={busy || !code.trim()} onClick={() => run(() => api('/api/claude-auth/code', 'POST', { code })).then((r) => { if (r?.loggedIn) { setUrl(''); useStore.getState().toast('Đã kết nối Claude Code'); } })}>{busy ? 'Đang xác nhận…' : 'Xác nhận'}</button>
                      </div>
                    </>
                  )}
                </>
              )}
              {tab === 'token' && (
                <>
                  <div className="small muted">Trên máy bất kỳ đã cài Claude Code, chạy <code>claude setup-token</code>, đăng nhập rồi copy token <code>sk-ant-oat…</code> (dùng gói Pro/Max, hiệu lực ~1 năm).</div>
                  <div className="row gap">
                    <input type="password" placeholder="sk-ant-oat01-…" value={secret} onChange={(e) => setSecret(e.target.value)} />
                    <button className="btn primary" disabled={busy || !secret.trim()} onClick={() => run(() => api('/api/claude-auth/token', 'POST', { token: secret })).then((r) => r && setSecret(''))}>Lưu</button>
                  </div>
                </>
              )}
              {tab === 'apikey' && (
                <>
                  <div className="small muted">API key từ <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a> — tính phí theo lượng dùng.</div>
                  <div className="row gap">
                    <input type="password" placeholder="sk-ant-api03-…" value={secret} onChange={(e) => setSecret(e.target.value)} />
                    <button className="btn primary" disabled={busy || !secret.trim()} onClick={() => run(() => api('/api/claude-auth/apikey', 'POST', { key: secret })).then((r) => r && setSecret(''))}>Lưu</button>
                  </div>
                </>
              )}
              {err && <div className="error small">{err}</div>}
              <div className="muted small">Thông tin lưu trên server (<code>~/.config/ai-video</code>, <code>~/.claude</code>), không gửi đi đâu khác. Đổi tài khoản sẽ khởi động lại phiên Claude.</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

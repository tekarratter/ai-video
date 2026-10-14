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
            <button onClick={() => { setOpen(false); setDialog('password'); }}>Đổi mật khẩu</button>
            {user.role === 'admin' && <button onClick={() => { setOpen(false); setDialog('users'); }}>Quản lý tài khoản</button>}
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

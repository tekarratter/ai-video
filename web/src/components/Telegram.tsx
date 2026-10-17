import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api } from './Account';
import { Icon } from './Icon';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function openTelegram() { window.dispatchEvent(new Event('open-telegram')); }
export function openTelegramAdmin() { window.dispatchEvent(new Event('open-telegram-admin')); }

/** Per-user Telegram notifications (render finished / failed). Admin sets the bot token once. */
export const TelegramDialog: React.FC = () => {
  const user = useStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState<any>(null);
  const [chatId, setChatId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [waiting, setWaiting] = useState(false);

  const load = () => api('/api/telegram').then((s) => { setSt(s); if (s.linked) setWaiting(false); }).catch((e) => setErr(e.message));
  useEffect(() => {
    const on = () => { setOpen(true); setErr(''); setChatId(''); setWaiting(false); load(); };
    const linked = () => load();
    window.addEventListener('open-telegram', on);
    window.addEventListener('telegram-linked', linked);
    return () => { window.removeEventListener('open-telegram', on); window.removeEventListener('telegram-linked', linked); };
  }, []);
  if (!open) return null;
  const admin = user?.role === 'admin';
  const run = async (fn: () => Promise<any>, ok?: string) => {
    setBusy(true); setErr('');
    try { const r = await fn(); if (r && 'configured' in r) setSt(r); if (ok) useStore.getState().toast(ok); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const connect = () => run(async () => {
    const r = await api('/api/telegram/link', 'POST');
    window.open(r.url, '_blank', 'noopener');
    setWaiting(true);
  });

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="modal">
        <div className="modal-head">
          <b>🔔 Thông báo Telegram</b>
          <div className="spacer" />
          <button className="icon-btn" onClick={() => setOpen(false)}><Icon name="x" /></button>
        </div>
        <div className="form">
          <div className="muted small">Khi bạn bấm Render, bot Telegram sẽ nhắn cho <b>chính bạn</b> lúc render xong hoặc bị lỗi (kèm link tải; video dưới 50 MB được gửi thẳng vào Telegram). Mỗi tài khoản kết nối Telegram riêng.</div>
          {!st ? <div className="muted">Đang kiểm tra…</div> : !st.configured ? (
            <div className="warn small">Chưa có bot Telegram. {admin ? <>Vào <button className="link-btn" onClick={() => { setOpen(false); openTelegramAdmin(); }}>Bot Telegram (admin)</button> để dán token.</> : 'Nhờ admin cấu hình bot trước.'}</div>
          ) : (
            <>
              <div className="row gap small">
                <span>Bot: <b>@{st.bot?.username || '?'}</b></span>
              </div>
              {st.linked ? (
                <div className="row gap small">
                  <span className="dot on" /> Đã kết nối{st.chatName ? <> với <b>{st.chatName}</b></> : null} <span className="muted">(chat {st.chatId})</span>
                  <div className="spacer" />
                  <button className="btn small" disabled={busy} onClick={() => run(() => api('/api/telegram/test', 'POST'), 'Đã gửi tin thử — kiểm tra Telegram')}>Gửi thử</button>
                  <button className="btn small" disabled={busy} onClick={() => run(() => api('/api/telegram/chat', 'POST', { chatId: null }))}>Ngắt</button>
                </div>
              ) : (
                <>
                  <div className="row gap">
                    <button className="btn primary" disabled={busy} onClick={connect}>Kết nối Telegram</button>
                    {waiting && <span className="small muted">Mở Telegram, bấm <b>Start</b> trong cuộc trò chuyện với bot… <button className="link-btn" onClick={load}>Kiểm tra lại</button></span>}
                  </div>
                  <details className="small">
                    <summary className="muted">Hoặc nhập Chat ID</summary>
                    <div className="row gap" style={{ marginTop: 6 }}>
                      <input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="vd 123456789 (nhắn /start cho bot để biết)" />
                      <button className="btn small" disabled={busy || !chatId.trim()} onClick={() => run(() => api('/api/telegram/chat', 'POST', { chatId: chatId.trim() }))}>Lưu</button>
                    </div>
                  </details>
                </>
              )}
            </>
          )}
          {admin && st?.configured && <button className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => { setOpen(false); openTelegramAdmin(); }}>⚙ Quản lý bot Telegram (admin)</button>}
          {err && <div className="error small">{err}</div>}
        </div>
      </div>
    </div>
  );
};

const ago = (t: number) => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `${s} giây trước` : `${Math.round(s / 60)} phút trước`; };

/** Admin: the one bot token for the whole app — add / change / remove, health check, linked users. */
export const TelegramAdminDialog: React.FC = () => {
  const user = useStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState<any>(null);
  const [tok, setTok] = useState('');
  const [show, setShow] = useState(false);
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = () => api('/api/telegram/admin').then((s) => { setSt(s); if (!s.configured) setEdit(true); }).catch((e) => setErr(e.message));
  useEffect(() => {
    const on = () => { setOpen(true); setErr(''); setTok(''); setShow(false); setEdit(false); setSt(null); load(); };
    const linked = () => load();
    window.addEventListener('open-telegram-admin', on);
    window.addEventListener('telegram-linked', linked);
    return () => { window.removeEventListener('open-telegram-admin', on); window.removeEventListener('telegram-linked', linked); };
  }, []);
  // polling health shows up a moment after the token is saved
  useEffect(() => {
    if (!open || !st?.configured || st.polling?.at) return;
    const t = setTimeout(load, 3000);
    return () => clearTimeout(t);
  }, [open, st]);
  if (!open) return null;
  if (user?.role !== 'admin') return null;
  const run = async (fn: () => Promise<any>, ok?: string) => {
    setBusy(true); setErr('');
    try { const r = await fn(); if (r && 'configured' in r) setSt(r); if (ok) useStore.getState().toast(ok); return true; } catch (e: any) { setErr(e.message); return false; } finally { setBusy(false); }
  };
  const save = async () => {
    if (await run(() => api('/api/telegram/admin/token', 'POST', { token: tok.trim() }), 'Đã lưu bot Telegram')) { setTok(''); setEdit(false); }
  };
  const remove = () => confirm('Gỡ token bot Telegram? Mọi người sẽ không nhận thông báo nữa (liên kết của từng người vẫn giữ, gắn lại token cũ là dùng tiếp).')
    && run(() => api('/api/telegram/admin/token', 'POST', { token: '' }), 'Đã gỡ bot Telegram');
  const health = st?.polling;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="modal">
        <div className="modal-head">
          <b>🤖 Bot Telegram (admin)</b>
          <div className="spacer" />
          <button className="icon-btn" onClick={() => setOpen(false)}><Icon name="x" /></button>
        </div>
        <div className="form">
          <div className="muted small">Một bot dùng chung cho cả app. Khi render xong hoặc lỗi, bot nhắn cho người đã bấm Render (mỗi người tự kết nối trong menu tài khoản → Thông báo Telegram).</div>
          {!st ? <div className="muted">Đang kiểm tra…</div> : (
            <>
              {st.configured && (
                <div className="tg-status small">
                  <div className="row gap"><span>Bot</span><b>{st.bot ? <a href={`https://t.me/${st.bot.username}`} target="_blank" rel="noreferrer">@{st.bot.username}</a> : '?'}</b>{st.bot?.name && <span className="muted">({st.bot.name})</span>}</div>
                  <div className="row gap"><span>Token</span><code>{st.tokenHint}</code>{st.fromEnv && <span className="muted">· từ biến môi trường TELEGRAM_BOT_TOKEN</span>}</div>
                  <div className="row gap"><span>Trạng thái</span>
                    {!health?.at ? <><span className="dot busy" /> Đang kết nối…</>
                      : health.ok ? <><span className="dot" /> Đang nhận tin <span className="muted">({ago(health.at)})</span></>
                      : <><span className="dot off" style={{ background: '#ef4444' }} /> <span className="error">{health.error}</span></>}
                  </div>
                </div>
              )}
              {st.fromEnv ? (
                <div className="muted small">Token được đặt bằng biến môi trường nên không sửa được ở đây. Muốn đổi: sửa <code>TELEGRAM_BOT_TOKEN</code> (file .env / docker-compose) rồi khởi động lại app.</div>
              ) : edit ? (
                <>
                  <ol className="small tg-steps">
                    <li>Mở Telegram, chat với <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a>, gửi <code>/newbot</code>, đặt tên và username (kết thúc bằng “bot”).</li>
                    <li>BotFather trả về token dạng <code>123456789:AAH…</code> — dán vào ô dưới.</li>
                    <li>Không dùng chung token với bot/app khác (Telegram chỉ cho một nơi đọc tin của bot).</li>
                  </ol>
                  <div className="row gap">
                    <input type={show ? 'text' : 'password'} value={tok} autoFocus onChange={(e) => setTok(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && tok.trim()) save(); }}
                      placeholder="Bot token, vd 123456789:AAH…" style={{ flex: 1 }} autoComplete="off" spellCheck={false} />
                    <button className="btn small ghost" onClick={() => setShow(!show)} title={show ? 'Ẩn' : 'Hiện'}>{show ? 'Ẩn' : 'Hiện'}</button>
                    <button className="btn small primary" disabled={busy || !tok.trim()} onClick={save}>{busy ? 'Đang kiểm tra…' : 'Lưu'}</button>
                    {st.configured && <button className="btn small ghost" disabled={busy} onClick={() => { setEdit(false); setTok(''); }}>Huỷ</button>}
                  </div>
                </>
              ) : (
                <div className="row gap">
                  <button className="btn small" disabled={busy} onClick={() => setEdit(true)}>Đổi token</button>
                  <button className="btn small" disabled={busy} onClick={load}>Kiểm tra lại</button>
                  <div className="spacer" />
                  <button className="btn small danger" disabled={busy} onClick={remove}>Gỡ token</button>
                </div>
              )}
              {st.configured && (
                <>
                  <div className="section-title">Người nhận thông báo ({st.users.length})</div>
                  {!st.users.length && <div className="muted small">Chưa ai kết nối. Mỗi người vào menu tài khoản → Thông báo Telegram → Kết nối Telegram.</div>}
                  {st.users.map((u: any) => (
                    <div key={u.username} className="row gap small tg-user">
                      <b>{u.username}</b>
                      <span className="muted">{u.chatName || ''} · chat {u.chatId}</span>
                      <div className="spacer" />
                      <button className="btn small ghost" disabled={busy} onClick={() => run(() => api('/api/telegram/admin/test', 'POST', { username: u.username }), `Đã gửi tin thử cho ${u.username}`)}>Gửi thử</button>
                      <button className="btn small ghost" disabled={busy} onClick={() => confirm(`Ngắt Telegram của ${u.username}?`) && run(() => api('/api/telegram/admin/unlink', 'POST', { username: u.username }))}>Ngắt</button>
                    </div>
                  ))}
                  <button className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => { setOpen(false); openTelegram(); }}>Kết nối Telegram của tôi →</button>
                </>
              )}
            </>
          )}
          {err && <div className="error small">{err}</div>}
        </div>
      </div>
    </div>
  );
};

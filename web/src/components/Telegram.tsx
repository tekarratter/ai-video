import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { api } from './Account';
import { Icon } from './Icon';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function openTelegram() { window.dispatchEvent(new Event('open-telegram')); }

/** Per-user Telegram notifications (render finished / failed). Admin sets the bot token once. */
export const TelegramDialog: React.FC = () => {
  const user = useStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState<any>(null);
  const [tok, setTok] = useState('');
  const [chatId, setChatId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [waiting, setWaiting] = useState(false);

  const load = () => api('/api/telegram').then((s) => { setSt(s); if (s.linked) setWaiting(false); }).catch((e) => setErr(e.message));
  useEffect(() => {
    const on = () => { setOpen(true); setErr(''); setTok(''); setChatId(''); setWaiting(false); load(); };
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
            <div className="warn small">Chưa có bot Telegram. {admin ? 'Tạo bot bằng @BotFather trên Telegram (lệnh /newbot), dán token vào ô dưới.' : 'Nhờ admin cấu hình bot trước.'}</div>
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
          {admin && st && !st.fromEnv && (
            <details className="small" open={!st.configured}>
              <summary className="muted">Cấu hình bot (admin)</summary>
              <div className="row gap" style={{ marginTop: 6 }}>
                <input type="password" value={tok} onChange={(e) => setTok(e.target.value)} placeholder="Bot token từ @BotFather, vd 123456:ABC-…" />
                <button className="btn small" disabled={busy || !tok.trim()} onClick={() => run(() => api('/api/telegram/token', 'POST', { token: tok.trim() }), 'Đã lưu bot Telegram')}>Lưu</button>
                {st.configured && <button className="btn small" disabled={busy} onClick={() => confirm('Gỡ bot Telegram? Mọi người sẽ không nhận thông báo nữa.') && run(() => api('/api/telegram/token', 'POST', { token: '' }))}>Gỡ</button>}
              </div>
            </details>
          )}
          {err && <div className="error small">{err}</div>}
        </div>
      </div>
    </div>
  );
};

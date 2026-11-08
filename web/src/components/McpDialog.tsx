import React, { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { api } from './Account';
import { useStore } from '../store';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Open the "connect Claude via MCP" dialog (admin). */
export function openMcp() { window.dispatchEvent(new Event('open-mcp')); }

type Token = { id: string; name: string; username: string; createdAt: number; lastUsedAt: number | null };

const ago = (t: number | null) => {
  if (!t) return 'chưa dùng';
  const s = (Date.now() - t) / 1000;
  return s < 120 ? 'vừa xong' : s < 7200 ? `${Math.round(s / 60)} phút trước` : s < 172800 ? `${Math.round(s / 3600)} giờ trước` : `${Math.round(s / 86400)} ngày trước`;
};

const Snippet: React.FC<{ label: string; text: string }> = ({ label, text }) => {
  const [ok, setOk] = useState(false);
  const copy = () => { navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }).catch(() => {}); };
  return (
    <div className="mcp-snippet">
      <div className="row"><span className="small muted">{label}</span><div className="spacer" /><button className="link-btn small" onClick={copy}>{ok ? 'Đã chép ✓' : 'Chép'}</button></div>
      <pre>{text}</pre>
    </div>
  );
};

export const McpDialog: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null);
  const [err, setErr] = useState('');
  const user = useStore((s) => s.user);

  const load = () => api('/api/mcp/tokens').then(setTokens).catch((e: any) => setErr(e.message));
  useEffect(() => {
    const on = () => { setOpen(true); setFresh(null); setErr(''); setName(''); load(); };
    window.addEventListener('open-mcp', on);
    return () => window.removeEventListener('open-mcp', on);
  }, []);
  if (!open) return null;

  const base = window.location.origin;
  const create = async () => {
    setErr('');
    try {
      const r = await api('/api/mcp/tokens', 'POST', { name: name.trim() || 'Claude' });
      setFresh({ token: r.token, name: r.name });
      setName('');
      load();
    } catch (e: any) { setErr(e.message); }
  };
  const revoke = async (t: Token) => {
    if (!confirm(`Thu hồi token "${t.name}"? Claude đang dùng token này sẽ mất kết nối.`)) return;
    try { const r = await api(`/api/mcp/tokens/${t.id}`, 'DELETE'); setTokens(r.tokens); } catch (e: any) { setErr(e.message); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="modal mcp-modal">
        <div className="modal-head">
          <b><Icon name="link" /> Kết nối Claude (MCP)</b>
          <div className="spacer" />
          <button className="icon-btn" onClick={() => setOpen(false)}><Icon name="x" /></button>
        </div>
        <div className="muted small">
          Cho Claude ở nơi khác (Claude Code, Claude Desktop, claude.ai) điều khiển app này: tạo video từ tài liệu / bài viết,
          nhờ Claude trong app sửa phim, xem khung hình, đọc giọng, render và lấy link tải. Mọi thay đổi hiện ngay trong editor.
        </div>
        {user?.role !== 'admin' ? <div className="error small">Chỉ admin tạo được token.</div> : (
          <>
            {fresh ? (
              <div className="mcp-fresh">
                <b>Token "{fresh.name}" — chỉ hiện một lần, hãy chép ngay:</b>
                <Snippet label="Claude Code (terminal)" text={`claude mcp add --transport http ai-video ${base}/mcp --header "Authorization: Bearer ${fresh.token}"`} />
                <Snippet label="claude.ai / Claude Desktop: Cài đặt → Connectors → Add custom connector → URL" text={`${base}/mcp/t/${fresh.token}`} />
                <Snippet label="Ứng dụng MCP khác (Streamable HTTP + header)" text={JSON.stringify({ mcpServers: { 'ai-video': { type: 'http', url: `${base}/mcp`, headers: { Authorization: `Bearer ${fresh.token}` } } } }, null, 2)} />
                <div className="muted small">Link connector chứa token: ai có link là điều khiển được app — đừng chia sẻ. Lộ token thì thu hồi ở danh sách bên dưới.</div>
                <button className="btn small" onClick={() => setFresh(null)}>Xong</button>
              </div>
            ) : (
              <div className="row gap">
                <input placeholder="Tên gợi nhớ, vd Claude Desktop máy văn phòng" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create(); }} style={{ flex: 1 }} />
                <button className="btn primary" onClick={create}><Icon name="plus" /> Tạo token</button>
              </div>
            )}
            <div className="section-title">Token đang dùng</div>
            {!tokens.length && <div className="muted small">Chưa có token nào.</div>}
            {tokens.map((t) => (
              <div key={t.id} className="row gap mcp-token">
                <Icon name="link" />
                <div style={{ flex: 1, minWidth: 0 }}><b>{t.name}</b><div className="muted small">tạo bởi {t.username} · {new Date(t.createdAt).toLocaleDateString('vi-VN')} · dùng lần cuối: {ago(t.lastUsedAt)}</div></div>
                <button className="btn small" onClick={() => revoke(t)}>Thu hồi</button>
              </div>
            ))}
            <details className="small">
              <summary>Claude chạy ngay trên máy chủ này (không cần token)</summary>
              <Snippet label="Claude Code trên máy chủ" text="claude mcp add ai-video -- node /đường-dẫn/ai-video/mcp/stdio.mjs" />
            </details>
            <div className="muted small">
              Thử: “Dùng ai-video tạo video 2 phút từ file PDF này: &lt;link&gt;”, “Xem khung hình giây 10”, “Render bản nháp rồi gửi link”.
            </div>
          </>
        )}
        {err && <div className="error small">{err}</div>}
      </div>
    </div>
  );
};

import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { api } from './Account';
import { Icon } from './Icon';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function openCleanup() { window.dispatchEvent(new Event('open-cleanup')); }

const fmt = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} MB` : `${Math.round(n / 1024)} KB`);
const date = (t: number) => new Date(t).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: '2-digit' });
const key = (e: any) => `${e.project}/${e.name}`;

export const CleanupDialog: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<any>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [extras, setExtras] = useState<Set<string>>(new Set());
  const [days, setDays] = useState(7);
  const [keepLatest, setKeepLatest] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = () => api('/api/cleanup').then(setData).catch((e) => setErr(e.message));
  useEffect(() => {
    const on = () => { setOpen(true); setSel(new Set()); setExtras(new Set()); setErr(''); setData(null); load(); };
    window.addEventListener('open-cleanup', on);
    return () => window.removeEventListener('open-cleanup', on);
  }, []);

  const groups = useMemo(() => {
    const m = new Map<string, { name: string; items: any[] }>();
    for (const e of data?.exports || []) {
      if (!m.has(e.project)) m.set(e.project, { name: e.projectName, items: [] });
      m.get(e.project)!.items.push(e); // already newest first
    }
    return [...m.entries()];
  }, [data]);

  if (!open) return null;

  const toggle = (k: string) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const pickOld = () => {
    const cutoff = Date.now() - days * 86400e3;
    const n = new Set<string>();
    for (const [, g] of groups) g.items.forEach((e, i) => { if (!e.busy && e.mtime < cutoff && !(keepLatest && i === 0)) n.add(key(e)); });
    setSel(n);
  };
  const pickAllButLatest = () => {
    const n = new Set<string>();
    for (const [, g] of groups) g.items.forEach((e, i) => { if (!e.busy && i > 0) n.add(key(e)); });
    setSel(n);
  };
  const chosen = (data?.exports || []).filter((e: any) => sel.has(key(e)));
  const total = chosen.reduce((n: number, e: any) => n + e.size, 0) + (data?.extras || []).filter((x: any) => extras.has(x.key)).reduce((n: number, x: any) => n + x.size, 0);

  const run = async () => {
    if (!confirm(`Xoá vĩnh viễn ${chosen.length} video${extras.size ? ` và ${extras.size} mục tạm` : ''} (${fmt(total)})? Không khôi phục được.`)) return;
    setBusy(true); setErr('');
    try {
      const r = await api('/api/cleanup', 'POST', { exports: chosen.map((e: any) => ({ project: e.project, name: e.name })), extras: [...extras] });
      setData(r); setSel(new Set()); setExtras(new Set());
      useStore.getState().toast(`Đã dọn ${fmt(r.freed)}${r.skipped?.length ? ` · bỏ qua ${r.skipped.length} file đang dùng` : ''}`);
      window.dispatchEvent(new Event('exports-changed'));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const disk = data?.disk;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="modal wide cleanup">
        <div className="modal-head">
          <b><Icon name="trash" /> Dọn dẹp ổ cứng</b>
          <span className="spacer" />
          <button className="icon-btn" onClick={() => setOpen(false)} title="Đóng"><Icon name="x" /></button>
        </div>
        {disk && (
          <div className="disk">
            <div className="row"><span>Ổ đĩa còn trống <b>{fmt(disk.free)}</b> / {fmt(disk.total)}</span></div>
            <div className="bar"><div style={{ width: `${(1 - disk.free / disk.total) * 100}%`, background: disk.free / disk.total < 0.1 ? '#ef4444' : undefined }} /></div>
          </div>
        )}
        {!data && !err && <div className="muted small">Đang quét…</div>}
        {err && <div className="error small">{err}</div>}
        {data && (
          <>
            <div className="row gap cleanup-tools" style={{ flexWrap: "wrap" }}>
              <span className="small">Chọn video cũ hơn</span>
              <input type="number" min={0} value={days} onChange={(e) => setDays(Math.max(0, Number(e.target.value) || 0))} style={{ width: 60 }} />
              <span className="small">ngày</span>
              <label className="small row gap"><input type="checkbox" checked={keepLatest} onChange={(e) => setKeepLatest(e.target.checked)} /> giữ bản mới nhất mỗi dự án</label>
              <button className="btn small" onClick={pickOld}>Chọn</button>
              <button className="btn small" onClick={pickAllButLatest} title="Mỗi dự án chỉ giữ lại video render gần nhất">Chỉ giữ bản mới nhất</button>
              <button className="btn small ghost" onClick={() => setSel(new Set())}>Bỏ chọn</button>
            </div>
            {!groups.length && <div className="empty">Chưa có video render nào.</div>}
            {groups.map(([pid, g]) => (
              <div key={pid} className="cleanup-group">
                <div className="section-title">{g.name} · {g.items.length} video · {fmt(g.items.reduce((n, e) => n + e.size, 0))}</div>
                {g.items.map((e, i) => (
                  <label key={e.name} className={`cleanup-row ${e.busy ? 'disabled' : ''}`} title={e.busy ? 'Đang được dùng (render / đăng YouTube)' : ''}>
                    <input type="checkbox" disabled={e.busy} checked={sel.has(key(e))} onChange={() => toggle(key(e))} />
                    <span className="name">{e.name}{i === 0 && <span className="tag">mới nhất</span>}</span>
                    <span className="muted small">{date(e.mtime)}</span>
                    <span className="num small">{fmt(e.size)}</span>
                    <a className="icon-btn" href={e.url} target="_blank" rel="noreferrer" title="Xem" onClick={(ev) => ev.stopPropagation()}><Icon name="play" size={12} /></a>
                  </label>
                ))}
              </div>
            ))}
            <div className="section-title">Dữ liệu tạm</div>
            {data.extras.map((x: any) => (
              <label key={x.key} className={`cleanup-row ${!x.size ? 'disabled' : ''}`}>
                <input type="checkbox" disabled={!x.size} checked={extras.has(x.key)} onChange={() => setExtras((s) => { const n = new Set(s); if (n.has(x.key)) n.delete(x.key); else n.add(x.key); return n; })} />
                <span className="name">{x.label}</span>
                <span className="muted small">{x.count} mục</span>
                <span className="num small">{fmt(x.size)}</span>
                <span />
              </label>
            ))}
            <div className="row gap cleanup-foot">
              <span className="small">Đã chọn <b>{chosen.length}</b> video{extras.size ? ` + ${extras.size} mục tạm` : ''} · <b>{fmt(total)}</b></span>
              <span className="spacer" />
              <button className="btn danger" disabled={busy || (!chosen.length && !extras.size)} onClick={run}><Icon name="trash" /> {busy ? 'Đang xoá…' : 'Xoá vĩnh viễn'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

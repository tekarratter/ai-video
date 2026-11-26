import React, { useEffect, useMemo, useState } from 'react';
import { flushSave, rememberProject, useStore } from '../store';
import { uploadParts, waitJob } from '../upload';
import { api } from './Account';
import { Icon } from './Icon';
import { showEditor } from './Home';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** "Clone video mẫu": upload a reference video → local analysis (shots, words, beats, colours) → user template. */
export function openClone(opts: { referenceId?: string; assetId?: string } = {}) {
  window.dispatchEvent(new CustomEvent('open-clone', { detail: opts }));
}
export const templatesChanged = () => window.dispatchEvent(new Event('templates-changed'));

const LANGS: [string, string][] = [['auto', 'Tự nhận'], ['vi', 'Tiếng Việt'], ['en', 'Tiếng Anh'], ['zh', 'Tiếng Trung'], ['ko', 'Tiếng Hàn'], ['ja', 'Tiếng Nhật']];
const MODELS: [string, string][] = [['base', 'Cân bằng (base)'], ['tiny', 'Nhanh nhất (tiny)'], ['small', 'Chính xác hơn (small, chậm)']];
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

type Analysis = {
  id: string; name: string; source: string; transcriptError?: string;
  stats: Record<string, any>;
  beats: { i: number; start: number; end: number; dur: number; role: string; n?: number; text: string; shots: number[]; cuts: number; note?: string }[];
  shots: { i: number; start: number; end: number; dur: number; frame: string; colors?: string[]; role: string; text: string }[];
  sheets: { shots: string[]; overview: string };
  template?: { name: string; desc?: string } | null;
};

export const CloneDialog: React.FC = () => {
  const project = useStore((s) => s.project);
  const jobs = useStore((s) => s.jobs);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [assetId, setAssetId] = useState('');
  const [lang, setLang] = useState('auto');
  const [model, setModel] = useState('base');
  const [jobId, setJobId] = useState('');
  const [upload, setUpload] = useState(0);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [a, setA] = useState<Analysis | null>(null);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [roleNames, setRoleNames] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [saved, setSaved] = useState(false);
  const [sheet, setSheet] = useState(0);

  const reset = () => { setFile(null); setJobId(''); setUpload(0); setBusy(''); setErr(''); setA(null); setRoles({}); setNotes({}); setName(''); setDesc(''); setSaved(false); setSheet(0); };
  const load = async (id: string) => {
    const r: Analysis = await api(`/api/reference/${id}`);
    setA(r);
    if (r.template) { setSaved(true); setName(r.template.name); setDesc(r.template.desc || ''); } else setName((n) => n || r.name.replace(/\.[^.]+$/, ''));
    setNotes(Object.fromEntries(r.beats.filter((b) => b.note).map((b) => [b.i, b.note as string])));
  };

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      reset(); setOpen(true);
      if (d.assetId) setAssetId(d.assetId);
      if (d.referenceId) load(d.referenceId).catch((x) => setErr(x.message));
    };
    window.addEventListener('open-clone', on);
    return () => window.removeEventListener('open-clone', on);
  }, []);
  useEffect(() => { if (open) api('/api/templates').then((r) => setRoleNames(r.roles || {})).catch(() => {}); }, [open]);

  const videos = useMemo(() => (project?.assets || []).filter((x: any) => x.type === 'video'), [project]);
  const job = jobId ? jobs[jobId] : undefined;
  if (!open) return null;
  const close = () => { if (!busy) { setOpen(false); reset(); } };

  const start = async () => {
    setErr('');
    try {
      let body: any = { lang, model };
      if (file) {
        setBusy('Đang tải video lên…');
        const id = await uploadParts(file, (l, t) => setUpload(t ? l / t : 1));
        body = { ...body, uploadId: id, size: file.size, fileName: file.name };
      } else if (assetId) body = { ...body, assetId };
      else return;
      setBusy('Đang phân tích…');
      const r = await api('/api/reference/analyze', 'POST', body);
      setJobId(r.job.id);
      await waitJob(r.job.id);
      await load(r.referenceId);
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };

  const save = async () => {
    if (!a) return;
    setErr(''); setBusy('Đang lưu template…');
    try {
      await api(`/api/templates/${a.id}`, 'POST', { name: name.trim(), desc: desc.trim(), roles, notes });
      setSaved(true); templatesChanged();
      useStore.getState().toast(`Đã lưu template "${name.trim() || a.name}" — xem ở Templates → Mẫu của tôi`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };

  const useSkeleton = async () => {
    if (!a) return;
    setBusy('Đang tạo dự án…');
    try {
      await flushSave(); rememberProject();
      const r = await api(`/api/templates/${a.id}/use`, 'POST');
      if (r?.projects) useStore.setState({ projects: r.projects, activeProject: r.active });
      setOpen(false); reset(); showEditor();
    } catch (e: any) { setErr(e.message); setBusy(''); }
  };

  const st = a?.stats;
  const sheets = a ? [...a.sheets.shots, a.sheets.overview] : [];
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal tpl-modal clone-modal">
        <div className="modal-head">
          <b>🎬 Clone video mẫu → template</b>
          <div className="spacer" />
          <button className="icon-btn" onClick={close} disabled={!!busy}><Icon name="x" /></button>
        </div>

        {!a && (
          <div className="form">
            <div className="muted small">
              Tải lên một video bạn muốn "học theo" (quảng cáo, TikTok, bản tin…). Máy sẽ tự tìm các điểm cắt cảnh, chép lời theo từng từ,
              chia thành các nhịp (mở đầu → nội dung → kêu gọi hành động), đo nhịp cắt và màu chủ đạo. Từ đó bạn lưu thành <b>template</b>{' '}
              để làm video mới cùng cấu trúc với nội dung của mình. Chạy hoàn toàn trên máy (CPU), không gửi video đi đâu.
            </div>
            <div className="field"><span>Video mẫu</span>
              <div>
                <label className="btn small"><Icon name="upload" /> Chọn video
                  <input type="file" hidden accept="video/*,.mkv,.mov,.webm" onChange={(e) => { setFile(e.target.files?.[0] || null); e.target.value = ''; }} />
                </label>
                {file && <span className="small" style={{ marginLeft: 8 }}>{file.name} · {(file.size / 1048576).toFixed(1)} MB <button className="link-btn" onClick={() => setFile(null)}>bỏ</button></span>}
                {!file && !!videos.length && (
                  <div className="small" style={{ marginTop: 6 }}>hoặc video trong dự án:{' '}
                    <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                      <option value="">— chọn —</option>
                      {videos.map((v: any) => <option key={v.id} value={v.id}>{v.name}{v.duration ? ` (${Math.round(v.duration)}s)` : ''}</option>)}
                    </select>
                  </div>
                )}
                <div className="muted small">Video ở link YouTube/TikTok: nhập vào dự án trước (Assets → Link), rồi chọn ở đây.</div>
              </div>
            </div>
            <label className="field"><span>Ngôn ngữ lời nói</span><select value={lang} onChange={(e) => setLang(e.target.value)}>{LANGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="field"><span>Chép lời</span><select value={model} onChange={(e) => setModel(e.target.value)}>{MODELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            {busy && (
              <div className="clone-progress">
                <div className="small">{upload > 0 && upload < 1 ? `Tải lên ${Math.round(upload * 100)}%` : job ? `${job.stage}…` : busy}</div>
                <div className="bar"><div style={{ width: `${Math.round(((upload > 0 && upload < 1) ? upload : job?.progress || 0) * 100)}%` }} /></div>
              </div>
            )}
            {err && <div className="error small">{err}</div>}
            <div className="row gap">
              <div className="spacer" />
              <button className="btn" onClick={close} disabled={!!busy}>Huỷ</button>
              <button className="btn primary" disabled={(!file && !assetId) || !!busy} onClick={start}><Icon name="sparkle" /> Phân tích</button>
            </div>
          </div>
        )}

        {a && st && (
          <div className="clone-result">
            <div className="clone-stats">
              <span><b>{st.duration}s</b> {st.width}×{st.height} ({st.orientation})</span>
              <span><b>{st.shots}</b> cảnh · {st.avgShot}s/cảnh · {st.cutsPerMin} cắt/phút</span>
              <span><b>{a.beats.length}</b> nhịp · hook {st.hookEnd}s</span>
              <span>{st.audioKind}{st.words ? ` · ${st.wordsPerMin} từ/phút` : ''}</span>
            </div>
            {a.transcriptError && <div className="error small">Chép lời lỗi: {a.transcriptError}</div>}
            <div className="clone-body">
              <div className="clone-sheet">
                {sheets.length > 1 && <div className="seg">{sheets.map((s, k) => <button key={s} className={sheet === k ? 'active' : ''} onClick={() => setSheet(k)}>{k === sheets.length - 1 ? 'Tổng quan' : `Cảnh ${k * 24 + 1}+`}</button>)}</div>}
                <a href={`/templates/${a.id}/${sheets[sheet]}`} target="_blank" rel="noreferrer"><img src={`/templates/${a.id}/${sheets[sheet]}`} alt="bảng khung hình" /></a>
                <div className="muted small">Bấm để xem lớn. Mỗi ô: thời gian, vai trò, lời nói, dải màu. Phân tích đầy đủ: <code>templates/{a.id}/ANALYSIS.md</code></div>
              </div>
              <div className="clone-flow">
                <b>Luồng nội dung</b>
                <div className="muted small">Mỗi nhịp là một câu nói. Sửa vai trò nếu máy đoán sai; ghi chú thêm (chữ trên hình, hiệu ứng…) để template rõ hơn.</div>
                {a.beats.map((b) => (
                  <div key={b.i} className="clone-beat">
                    <div className="clone-beat-head">
                      <span className="clone-time">{fmt(b.start)}–{fmt(b.end)}</span>
                      <span className="clone-share" style={{ width: `${Math.max(4, (b.dur / st.duration) * 100)}%` }} />
                      <select value={roles[b.i] || b.role} onChange={(e) => setRoles((o) => ({ ...o, [b.i]: e.target.value }))}>
                        {Object.entries(roleNames).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                      <span className="muted small">{b.shots.length} hình{b.cuts ? ` · ${b.cuts} lần cắt` : ''}</span>
                    </div>
                    <div className="small">{b.text || <i className="muted">(không lời)</i>}</div>
                    <input className="clone-note" placeholder="Ghi chú (tuỳ chọn)" value={notes[b.i] ?? b.note ?? ''} onChange={(e) => setNotes((o) => ({ ...o, [b.i]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>
            <div className="form">
              <label className="field"><span>Tên template</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="field"><span>Mô tả</span><input placeholder="Để trống: tự tóm tắt từ phân tích" value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
              {err && <div className="error small">{err}</div>}
              <div className="row gap">
                {busy && <span className="small muted">{busy}</span>}
                <div className="spacer" />
                {!saved && <button className="btn primary" disabled={!!busy || !name.trim()} onClick={save}><Icon name="check" /> Lưu thành template</button>}
                {saved && <button className="btn" disabled={!!busy} onClick={save}><Icon name="check" /> Lưu lại</button>}
                {saved && <button className="btn primary" disabled={!!busy} onClick={useSkeleton}><Icon name="film" /> Tạo dự án từ khung mẫu</button>}
              </div>
              {saved && <div className="muted small">Hoặc mở Templates → <b>Mẫu của tôi</b> → chọn template này để nhờ Claude làm video mới theo đúng luồng với nội dung của bạn.</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

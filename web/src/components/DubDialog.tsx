import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { Icon } from './Icon';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Open the dubbing dialog, optionally for a given asset. */
export function openDub(assetId?: string) {
  window.dispatchEvent(new CustomEvent('open-dub', { detail: { assetId } }));
}

const FROM = [
  ['', 'Tự nhận diện'], ['en', 'Tiếng Anh'], ['vi', 'Tiếng Việt'], ['zh', 'Tiếng Trung'], ['ja', 'Tiếng Nhật'],
  ['ko', 'Tiếng Hàn'], ['fr', 'Tiếng Pháp'], ['de', 'Tiếng Đức'], ['es', 'Tiếng Tây Ban Nha'], ['th', 'Tiếng Thái'],
];

export const DubDialog: React.FC = () => {
  const project = useStore((s) => s.project);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'asset' | 'url'>('asset');
  const [assetId, setAssetId] = useState('');
  const [url, setUrl] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState<'vi' | 'en'>('vi');
  const [voices, setVoices] = useState<any[]>([]);
  const [voice, setVoice] = useState('vi:Trúc Ly');
  const [speed, setSpeed] = useState(1);
  const [origVol, setOrigVol] = useState(0.15);
  const [exportVideo, setExportVideo] = useState(true);
  const [addToTimeline, setAddToTimeline] = useState(true);
  const [subtitles, setSubtitles] = useState(true);
  const [context, setContext] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent).detail?.assetId;
      setOpen(true); setErr('');
      if (id) { setAssetId(id); setMode('asset'); }
      if (!voices.length) fetch('/api/tts/voices').then((r) => r.json()).then((v) => Array.isArray(v) && setVoices(v)).catch(() => {});
    };
    window.addEventListener('open-dub', on);
    return () => window.removeEventListener('open-dub', on);
  }, [voices.length]);

  const media = useMemo(() => (project?.assets || []).filter((a: any) => a.type === 'video' || (a.type === 'audio' && !a.tts && !a.dubOf && !a.libraryId)), [project]);
  useEffect(() => { if (open && !assetId && media[0]) setAssetId(media[0].id); }, [open, assetId, media]);
  const list = voices.filter((v) => v.lang === to);
  useEffect(() => { if (list.length && !list.some((v) => v.id === voice)) setVoice(list[0].id); }, [to, list, voice]);

  if (!open || !project) return null;
  const asset = media.find((a: any) => a.id === assetId);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const body = { ...(mode === 'url' ? { url: url.trim() } : { assetId }), from, to, voice, speed, originalVolume: origVol, exportVideo, addToTimeline, subtitles, context: context.trim() || undefined };
      const r = await fetch('/api/dub', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      useStore.getState().toast('Bắt đầu thuyết minh — theo dõi ở tab Jobs');
      window.dispatchEvent(new Event('show-jobs'));
      setOpen(false);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const mins = asset?.duration ? asset.duration / 60 : 0;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="modal">
        <div className="modal-head">
          <b><Icon name="mic" /> Thuyết minh / lồng tiếng</b>
          <div className="spacer" />
          <button className="icon-btn" onClick={() => setOpen(false)}><Icon name="x" /></button>
        </div>
        <div className="form">
          <div className="seg">
            <button className={mode === 'asset' ? 'active' : ''} onClick={() => setMode('asset')}>Video trong dự án</button>
            <button className={mode === 'url' ? 'active' : ''} onClick={() => setMode('url')}>Link YouTube / video</button>
          </div>
          {mode === 'asset' ? (
            <label className="field"><span>Video</span>
              <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                {!media.length && <option value="">Chưa có video — tải lên hoặc dùng link</option>}
                {media.map((a: any) => <option key={a.id} value={a.id}>{a.name}{a.duration ? ` (${(a.duration / 60).toFixed(1)} phút)` : ''}</option>)}
              </select>
            </label>
          ) : (
            <label className="field"><span>Link</span><input placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
          )}
          <label className="field"><span>Ngôn ngữ gốc</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)}>{FROM.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
          </label>
          <label className="field"><span>Thuyết minh sang</span>
            <select value={to} onChange={(e) => setTo(e.target.value as 'vi' | 'en')}>
              <option value="vi">Tiếng Việt (VieNeu)</option>
              <option value="en">Tiếng Anh (Kokoro)</option>
            </select>
          </label>
          <label className="field"><span>Giọng đọc</span>
            <select value={voice} onChange={(e) => setVoice(e.target.value)}>
              {list.map((v) => <option key={v.id} value={v.id}>{v.featured ? '⭐ ' : ''}{v.name} — {v.description}</option>)}
            </select>
          </label>
          <label className="field"><span>Tốc độ đọc</span>
            <div className="row gap"><input type="range" min={0.8} max={1.4} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /><span className="num small">{speed.toFixed(2)}×</span></div>
          </label>
          <label className="field"><span>Tiếng gốc</span>
            <div className="row gap"><input type="range" min={0} max={0.6} step={0.05} value={origVol} onChange={(e) => setOrigVol(Number(e.target.value))} /><span className="num small">{Math.round(origVol * 100)}%</span></div>
          </label>
          <label className="field"><span>Bối cảnh (tuỳ chọn)</span><input placeholder="VD: review du thuyền, thuật ngữ nhà ở…" value={context} onChange={(e) => setContext(e.target.value)} /></label>
          <label className="field checkbox"><span>Xuất file MP4 mới</span><input type="checkbox" checked={exportVideo} onChange={(e) => setExportVideo(e.target.checked)} /></label>
          <label className="field checkbox"><span>Thêm vào timeline</span><input type="checkbox" checked={addToTimeline} onChange={(e) => setAddToTimeline(e.target.checked)} /></label>
          <label className="field checkbox"><span>Phụ đề dịch</span><input type="checkbox" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)} /></label>
          <div className="muted small">
            Quy trình: lấy phụ đề YouTube (nếu có) hoặc nhận dạng giọng nói bằng Whisper → Claude dịch → đọc từng câu, tự khớp thời gian
            → trộn với tiếng gốc ({Math.round(origVol * 100)}%) → file <code>…-thuyet-minh-{to}.mp4</code> (kèm phụ đề .srt) trong Exports.
            {mins > 0 && <> Ước tính trên máy này: ~{Math.max(2, Math.round(mins * 3))}–{Math.max(4, Math.round(mins * 6))} phút.</>}
          </div>
          {err && <div className="error small">{err}</div>}
          <div className="row gap">
            <div className="spacer" />
            <button className="btn" onClick={() => setOpen(false)}>Huỷ</button>
            <button className="btn primary" disabled={busy || (mode === 'asset' ? !asset : !/^https?:\/\//.test(url.trim())) || !(exportVideo || addToTimeline)} onClick={submit}>
              <Icon name="mic" /> Bắt đầu thuyết minh
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

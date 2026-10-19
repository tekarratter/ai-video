import React, { useMemo, useState } from 'react';
import { assetById, layoutTrack, projectDuration } from '../../../shared/timeline.js';
import { useStore } from '../store';
import { currentTime, seek } from '../player';
import { Icon } from './Icon';
import { askClaude } from './ChatPanel';

/* eslint-disable @typescript-eslint/no-explicit-any */

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const post = async (url: string, body: unknown) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};

/** One voice-over line: edit the text → re-read with the same voice (job). */
const VoiceLine: React.FC<{ clip: any; asset: any; start: number }> = ({ clip, asset, start }) => {
  const [text, setText] = useState<string>(asset.tts.text);
  const [busy, setBusy] = useState(false);
  const dirty = text.trim() !== String(asset.tts.text).trim();
  const save = async () => {
    setBusy(true);
    try { await post('/api/tts/revoice', { clipIds: [clip.id], text: text.trim() }); useStore.getState().toast('Đang đọc lại câu này — xem tiến độ ở Jobs'); }
    catch (e: any) { useStore.getState().toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="scene-line">
      <button className="scene-line-time" title="Nghe từ đây" onClick={(e) => { e.stopPropagation(); seek(start); }}><Icon name="mic" size={11} /> {fmt(start)}</button>
      <textarea rows={Math.min(5, Math.max(2, Math.ceil(text.length / 34)))} value={text} onClick={(e) => e.stopPropagation()} onChange={(e) => setText(e.target.value)} />
      {dirty && (
        <div className="row gap">
          <span className="muted small">{String(asset.tts.voice || '').split(':').pop()}</span>
          <div className="spacer" />
          <button className="btn small" onClick={(e) => { e.stopPropagation(); setText(asset.tts.text); }} disabled={busy}>Huỷ</button>
          <button className="btn small primary" onClick={(e) => { e.stopPropagation(); save(); }} disabled={busy || !text.trim()}>Đọc lại</button>
        </div>
      )}
    </div>
  );
};

/** "Cảnh & Lời thoại": scenes of the main track as cards, with the voice-over lines that play during each one. */
export const ScenesPanel: React.FC = () => {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const { scenes, voices } = useMemo(() => {
    const main = project.tracks.find((t: any) => t.type === 'sequence');
    const scenes = main ? layoutTrack(main, project) : [];
    const voices = project.tracks.filter((t: any) => t.type === 'audio' && !t.muted).flatMap((t: any) => layoutTrack(t, project))
      .map((l: any) => ({ ...l, asset: assetById(project, l.clip.assetId) })).filter((l: any) => l.asset?.tts?.text);
    return { scenes, voices };
  }, [project]);
  const subs = project.subtitles?.cues || [];
  // each voice line belongs to one scene: the last one that has started by then (transitions overlap neighbours)
  const owner = (t: number) => { let k = 0; scenes.forEach((s: any, j: number) => { if (s.start <= t) k = j; }); return k; };
  const lastVoice = voices.reduce((m: any, v: any) => (v.asset.tts.voice ? v.asset.tts : m), null);

  const addLine = async (start: number) => {
    if (!draft.trim()) return;
    try {
      await post('/api/tts', { text: draft.trim(), voice: lastVoice?.voice || 'vi:Mai Anh', speed: lastVoice?.speed || 1, start: +start.toFixed(2) });
      useStore.getState().toast('Đang tạo giọng đọc — xem ở Jobs');
      setAdding(null); setDraft('');
    } catch (e: any) { useStore.getState().toast(e.message, 'error'); }
  };

  if (!scenes.length) {
    return (
      <div className="panel-body">
        <div className="empty">Chưa có cảnh nào trên track chính.<br />Thêm ảnh/video từ Media, hoặc chọn một template ở Trang chủ.</div>
      </div>
    );
  }
  return (
    <div className="panel-body scenes">
      <div className="muted small" style={{ marginBottom: 6 }}>{scenes.length} cảnh · {voices.length} câu đọc · {fmt(projectDuration(project))}. Sửa lời rồi bấm <b>Đọc lại</b>; bấm cảnh để nhảy tới.</div>
      {scenes.map((l: any, i: number) => {
        const c = l.clip;
        const asset = c.assetId ? assetById(project, c.assetId) : null;
        const lines = voices.filter((v: any) => owner(v.start + Math.min(0.5, v.duration / 2)) === i);
        const cues = lines.length ? [] : subs.filter((q: any) => q.start >= l.start - 0.05 && q.start < l.end - 0.05);
        const thumb = asset ? `/cache/thumbs/${asset.id}.jpg` : '';
        const label = c.kind === 'component' ? c.component : c.kind === 'solid' ? 'Màu nền' : c.name || asset?.name || c.kind;
        return (
          <div key={c.id} className={`scene-card ${selection === c.id ? 'selected' : ''}`} onClick={() => { useStore.getState().select(c.id); seek(l.start + 0.01); }}>
            <div className="scene-head">
              <div className="scene-thumb" style={c.kind === 'solid' ? { background: c.color } : undefined}>
                {thumb ? <img src={thumb} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} /> : <Icon name={c.kind === 'component' ? 'motion' : 'square'} size={16} />}
                <span className="scene-no">{i + 1}</span>
              </div>
              <div className="scene-meta">
                <b title={label}>{label}</b>
                <span className="muted small">{fmt(l.start)} · {l.duration.toFixed(1)}s{c.kenBurns?.preset ? ` · ${c.kenBurns.preset}` : ''}</span>
              </div>
              <button className="icon-btn" title="Nhờ Claude sửa cảnh này" onClick={(e) => { e.stopPropagation(); askClaude(`Sửa cảnh ${i + 1} (clip ${c.id}, ${fmt(l.start)}–${fmt(l.end)}): `); }}><Icon name="sparkle" size={13} /></button>
            </div>
            {lines.map((v: any) => <VoiceLine key={v.clip.id + v.asset.id} clip={v.clip} asset={v.asset} start={v.start} />)}
            {cues.slice(0, 3).map((q: any, k: number) => <div key={k} className="scene-cue small muted">“{q.text}”</div>)}
            {adding === c.id ? (
              <div className="scene-line" onClick={(e) => e.stopPropagation()}>
                <textarea rows={2} autoFocus placeholder="Lời đọc cho cảnh này…" value={draft} onChange={(e) => setDraft(e.target.value)} />
                <div className="row gap"><div className="spacer" /><button className="btn small" onClick={() => setAdding(null)}>Huỷ</button><button className="btn small primary" disabled={!draft.trim()} onClick={() => addLine(Math.max(l.start, currentTime() >= l.start && currentTime() < l.end ? currentTime() : l.start + 0.2))}>Tạo giọng đọc</button></div>
              </div>
            ) : (
              <button className="link-btn small scene-add" onClick={(e) => { e.stopPropagation(); setAdding(c.id); setDraft(''); }}>+ Lời đọc</button>
            )}
          </div>
        );
      })}
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { componentDefaults } from '@custom';
import { assetById, clipDuration, findClip, layoutTrack, LOGO_DEFAULTS, LOGO_POSITIONS, projectDuration, TEXT_ANIMATIONS, TRANSITIONS } from '../../../shared/timeline.js';
import { useStore } from '../store';
import { addComponentClip, addSolidClip, addTextClip, uploadFiles, UploadProgress } from './LeftPanel';
import { askClaude } from './ChatPanel';
import { Icon } from './Icon';
import { openYouTube } from './YouTubeDialog';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Field = { key: string; label: string; type: 'number' | 'text' | 'textarea' | 'color' | 'select' | 'checkbox' | 'range'; step?: number; min?: number; max?: number; options?: string[] };

const get = (o: any, path: string) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const setPath = (o: any, path: string, v: any) => {
  const ks = path.split('.');
  let cur = o;
  for (const k of ks.slice(0, -1)) cur = cur[k] ??= {};
  if (v === '' || v === undefined) delete cur[ks.at(-1)!];
  else cur[ks.at(-1)!] = v;
};

const POS: Field[] = [
  { key: 'x', label: 'X (0-1)', type: 'number', step: 0.01 },
  { key: 'y', label: 'Y (0-1)', type: 'number', step: 0.01 },
  { key: 'width', label: 'Rộng (0-1)', type: 'number', step: 0.01 },
  { key: 'height', label: 'Cao (0-1)', type: 'number', step: 0.01 },
  { key: 'opacity', label: 'Opacity', type: 'range', min: 0, max: 1, step: 0.01 },
];
const ANIM: Field[] = [
  { key: 'animation.in', label: 'Hiệu ứng vào', type: 'select', options: TEXT_ANIMATIONS },
  { key: 'animation.out', label: 'Hiệu ứng ra', type: 'select', options: TEXT_ANIMATIONS },
  { key: 'animation.duration', label: 'Thời lượng hiệu ứng', type: 'number', step: 0.1 },
];
const TRANS: Field[] = [
  { key: 'transition.type', label: 'Chuyển cảnh →', type: 'select', options: TRANSITIONS },
  { key: 'transition.duration', label: 'Thời lượng (s)', type: 'number', step: 0.1 },
  { key: 'transition.direction', label: 'Hướng', type: 'select', options: ['', 'from-left', 'from-right', 'from-top', 'from-bottom'] },
];

function fieldsFor(clip: any, trackType: string): Field[] {
  const overlay = trackType === 'overlay';
  const timing: Field[] = trackType === 'sequence' ? [] : [{ key: 'start', label: 'Bắt đầu (s)', type: 'number', step: 0.1 }];
  const tail = trackType === 'sequence' ? TRANS : overlay ? [...POS, ...ANIM] : [];
  switch (clip.kind) {
    case 'text':
      return [
        { key: 'text', label: 'Nội dung', type: 'textarea' }, ...timing,
        { key: 'duration', label: 'Thời lượng (s)', type: 'number', step: 0.1 },
        { key: 'style.fontSize', label: 'Cỡ chữ', type: 'number', step: 2 },
        { key: 'style.color', label: 'Màu chữ', type: 'color' },
        { key: 'style.fontFamily', label: 'Font', type: 'select', options: ['Inter, Arial, sans-serif', 'Georgia, serif', '"Times New Roman", serif', 'Montserrat, sans-serif', '"Playfair Display", serif', 'Impact, sans-serif', 'monospace'] },
        { key: 'style.fontWeight', label: 'Độ đậm', type: 'select', options: ['300', '400', '600', '700', '800', '900'] },
        { key: 'style.align', label: 'Canh lề', type: 'select', options: ['center', 'left', 'right'] },
        { key: 'style.background', label: 'Nền chữ', type: 'text' },
        { key: 'style.letterSpacing', label: 'Giãn chữ', type: 'number', step: 1 },
        { key: 'style.uppercase', label: 'IN HOA', type: 'checkbox' },
        { key: 'x', label: 'X (0-1)', type: 'number', step: 0.01 },
        { key: 'y', label: 'Y (0-1)', type: 'number', step: 0.01 },
        { key: 'width', label: 'Rộng (0-1)', type: 'number', step: 0.01 },
        ...ANIM,
      ];
    case 'video':
      return [...timing,
        { key: 'in', label: 'Điểm vào (s)', type: 'number', step: 0.04 },
        { key: 'out', label: 'Điểm ra (s)', type: 'number', step: 0.04 },
        { key: 'speed', label: 'Tốc độ', type: 'number', step: 0.25 },
        { key: 'volume', label: 'Âm lượng', type: 'range', min: 0, max: 2, step: 0.05 },
        { key: 'fit', label: 'Khung', type: 'select', options: ['cover', 'contain'] }, ...tail];
    case 'image':
      return [...timing,
        { key: 'duration', label: 'Thời lượng (s)', type: 'number', step: 0.1 },
        { key: 'fit', label: 'Khung', type: 'select', options: ['cover', 'contain'] },
        { key: 'kenBurns.from', label: 'Ken Burns từ', type: 'number', step: 0.05 },
        { key: 'kenBurns.to', label: 'Ken Burns đến', type: 'number', step: 0.05 }, ...tail];
    case 'solid':
      return [...timing, { key: 'color', label: 'Màu', type: 'color' }, { key: 'duration', label: 'Thời lượng (s)', type: 'number', step: 0.1 }, ...tail];
    case 'component':
      return [...timing, { key: 'duration', label: 'Thời lượng (s)', type: 'number', step: 0.1 }, ...tail];
    default: // audio
      return [...timing,
        { key: 'in', label: 'Điểm vào (s)', type: 'number', step: 0.04 },
        { key: 'out', label: 'Điểm ra (s)', type: 'number', step: 0.04 },
        { key: 'volume', label: 'Âm lượng', type: 'range', min: 0, max: 2, step: 0.05 },
        { key: 'fadeIn', label: 'Fade in (s)', type: 'number', step: 0.1 },
        { key: 'fadeOut', label: 'Fade out (s)', type: 'number', step: 0.1 }];
  }
}

const FieldInput: React.FC<{ f: Field; value: any; onChange: (v: any) => void }> = ({ f, value, onChange }) => {
  const num = (s: string) => (s === '' ? undefined : Number(s));
  switch (f.type) {
    case 'textarea': return <textarea rows={3} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'color': return (
      <div className="row gap">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)} />
        <input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
    case 'select': return (
      <select value={value ?? ''} onChange={(e) => onChange(/^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value || undefined)}>
        {!f.options!.includes(String(value ?? '')) && <option value={value ?? ''}>{String(value ?? '—')}</option>}
        {f.options!.map((o) => <option key={o} value={o}>{o || '—'}</option>)}
      </select>
    );
    case 'checkbox': return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked || undefined)} />;
    case 'range': return (
      <div className="row gap">
        <input type="range" min={f.min} max={f.max} step={f.step} value={value ?? 1} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="num">{Number(value ?? 1).toFixed(2)}</span>
      </div>
    );
    case 'number': return <input type="number" step={f.step} value={value ?? ''} onChange={(e) => onChange(num(e.target.value))} />;
    default: return <input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
};

const JsonEditor: React.FC<{ value: any; onApply: (v: any) => void }> = ({ value, onApply }) => {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [err, setErr] = useState('');
  useEffect(() => { setText(JSON.stringify(value, null, 2)); setErr(''); }, [value]);
  return (
    <div className="json-editor">
      <textarea spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} rows={16} />
      {err && <div className="error small">{err}</div>}
      <button className="btn small" onClick={() => { try { onApply(JSON.parse(text)); setErr(''); } catch (e: any) { setErr(e.message); } }}>Áp dụng JSON</button>
    </div>
  );
};

const ClipInspector: React.FC<{ id: string }> = ({ id }) => {
  const project = useStore((s) => s.project);
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const found = findClip(project, id);
  if (!found) return null;
  const { clip, track } = found;
  const asset = clip.assetId ? assetById(project, clip.assetId) : null;
  const l = layoutTrack(track, project).find((x: any) => x.clip.id === id);
  const set = (key: string, v: any) => useStore.getState().update((p) => { const c = findClip(p, id)?.clip; if (c) setPath(c, key, v); }, { record: true });
  const fields = fieldsFor(clip, track.type);
  const propKeys = clip.kind === 'component' ? Object.keys({ ...((componentDefaults as any)?.[clip.component] || {}), ...(clip.props || {}) }) : [];

  return (
    <div className="inspector-body">
      <div className="insp-title">
        <Icon name={clip.kind === 'text' ? 'text' : clip.kind === 'component' ? 'motion' : clip.kind === 'image' ? 'image' : clip.kind === 'solid' ? 'square' : clip.kind === 'video' ? 'film' : 'music'} />
        <input value={clip.name ?? (clip.text ? String(clip.text).split('\n')[0] : clip.component ?? clip.id)} onChange={(e) => set('name', e.target.value)} placeholder="Tên clip" />
      </div>
      <div className="meta-grid">
        <span>Track</span><b>{track.name}</b>
        <span>Thời gian</span><b>{l?.start.toFixed(2)}s → {l?.end.toFixed(2)}s</b>
        <span>Thời lượng</span><b>{clipDuration(clip, project).toFixed(2)}s</b>
        {asset && <><span>Nguồn</span><b title={asset.path}>{asset.name}</b></>}
      </div>
      <div className="seg">
        <button className={mode === 'form' ? 'active' : ''} onClick={() => setMode('form')}>Schema</button>
        <button className={mode === 'json' ? 'active' : ''} onClick={() => setMode('json')}>JSON</button>
      </div>
      {mode === 'form' ? (
        <div className="form">
          {fields.map((f) => (
            <label key={f.key} className={`field ${f.type}`}>
              <span>{f.label}</span>
              <FieldInput f={f} value={get(clip, f.key)} onChange={(v) => set(f.key, v)} />
            </label>
          ))}
          {clip.kind === 'component' && (
            <>
              <div className="section-title">Props · {clip.component}</div>
              {propKeys.map((k) => {
                const v = clip.props?.[k] ?? (componentDefaults as any)?.[clip.component]?.[k];
                const t: Field['type'] = typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'checkbox' : /^#[0-9a-f]{3,8}$/i.test(String(v)) ? 'color' : 'text';
                return (
                  <label key={k} className={`field ${t}`}>
                    <span>{k}</span>
                    <FieldInput f={{ key: k, label: k, type: t }} value={v} onChange={(nv) => set(`props.${k}`, nv)} />
                  </label>
                );
              })}
            </>
          )}
        </div>
      ) : (
        <JsonEditor value={clip} onApply={(v) => useStore.getState().update((p) => { const f = findClip(p, id); if (f) f.track.clips[f.index] = { ...v, id }; })} />
      )}
      <div className="section-title">Hành động</div>
      <div className="actions">
        <button onClick={() => askClaude(`Với clip ${id} (${clip.kind}${clip.text ? ` "${clip.text}"` : ''}): `)}><Icon name="sparkle" /> Hỏi Claude về clip này…</button>
        <button onClick={() => { useStore.getState().update((p) => { for (const t of p.tracks) t.clips = t.clips.filter((c: any) => c.id !== id); }); useStore.getState().select(null); }}><Icon name="trash" /> Xoá clip</button>
      </div>
    </div>
  );
};

const AssetInspector: React.FC<{ asset: any }> = ({ asset }) => (
  <div className="inspector-body">
    <div className="insp-title"><Icon name={asset.type === 'video' ? 'film' : asset.type === 'image' ? 'image' : 'music'} /> <b>{asset.name}</b></div>
    {asset.type !== 'audio' && <img className="asset-preview" src={`/cache/thumbs/${asset.id}.jpg`} alt="" />}
    <div className="meta-grid">
      <span>ID</span><b>{asset.id}</b>
      <span>Loại</span><b>{asset.type}</b>
      {asset.duration && <><span>Thời lượng</span><b>{asset.duration.toFixed(2)}s</b></>}
      {asset.width && <><span>Kích thước</span><b>{asset.width}×{asset.height}</b></>}
      {asset.fps && <><span>FPS</span><b>{asset.fps}</b></>}
      {asset.source && <><span>Nguồn</span><b><a href={asset.source} target="_blank" rel="noreferrer">link</a></b></>}
    </div>
    <div className="actions">
      {asset.type === 'video' && <button onClick={() => askClaude(`Xem video ${asset.id} và tìm các đoạn hay nhất để dựng highlight.`, true)}><Icon name="sparkle" /> Tìm highlight</button>}
      {asset.type === 'image' && <button onClick={() => { setLogo({ assetId: asset.id, enabled: true }); useStore.getState().toast('Đã đặt làm logo — chỉnh vị trí ở Inspector của project'); }}><Icon name="image" /> Dùng làm logo</button>}
      {asset.hasAudio && <button onClick={() => askClaude(`Transcribe ${asset.id} rồi tạo phụ đề cho timeline.`, true)}><Icon name="text" /> Tạo phụ đề</button>}
      <button onClick={async () => {
        const r = await fetch(`/api/assets/${asset.id}`, { method: 'DELETE' });
        if (r.status === 409 && confirm('Asset đang dùng trên timeline. Xoá cả các clip?')) await fetch(`/api/assets/${asset.id}?force=1`, { method: 'DELETE' });
        useStore.getState().select(null);
      }}><Icon name="trash" /> Xoá asset</button>
    </div>
  </div>
);

const POS_LABEL: Record<string, string> = {
  'top-left': 'Trên trái', 'top-center': 'Trên giữa', 'top-right': 'Trên phải',
  'bottom-left': 'Dưới trái', 'bottom-center': 'Dưới giữa', 'bottom-right': 'Dưới phải',
};

export function setLogo(patch: Record<string, any> | null) {
  useStore.getState().update((p) => {
    if (patch === null) delete p.logo;
    else p.logo = { ...LOGO_DEFAULTS, ...(p.logo || {}), ...patch };
  });
}

const LogoSection: React.FC = () => {
  const project = useStore((s) => s.project);
  const fileRef = useRef<HTMLInputElement>(null);
  const lg = project.logo ? { ...LOGO_DEFAULTS, ...project.logo } : null;
  const images = project.assets.filter((a: any) => a.type === 'image');
  const asset = lg?.assetId ? assetById(project, lg.assetId) : null;
  return (
    <>
      <div className="section-title">Logo</div>
      <div className="form">
        <div className="row gap">
          <button className="btn small" onClick={() => fileRef.current?.click()}><Icon name="upload" /> Tải logo</button>
          <input ref={fileRef} type="file" hidden accept="image/*" onChange={(e) => { if (e.target.files?.length) uploadFiles(e.target.files, { logo: true }); e.target.value = ''; }} />
          {lg && <button className="btn small" onClick={() => setLogo(null)}><Icon name="trash" /> Bỏ logo</button>}
        </div>
        <label className="field"><span>Ảnh</span>
          <select value={lg?.assetId || ''} onChange={(e) => (e.target.value ? setLogo({ assetId: e.target.value, enabled: true }) : setLogo(null))}>
            <option value="">— Không dùng —</option>
            {images.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        {lg && asset && (
          <>
            <label className="field checkbox"><span>Hiển thị</span><input type="checkbox" checked={lg.enabled} onChange={(e) => setLogo({ enabled: e.target.checked })} /></label>
            <div className="field"><span>Vị trí</span>
              <div className="logo-pos" style={{ aspectRatio: `${project.settings.width} / ${project.settings.height}` }}>
                {LOGO_POSITIONS.map((pos: string) => (
                  <button key={pos} className={`logo-pos-btn ${pos} ${lg.position === pos ? 'active' : ''}`} title={POS_LABEL[pos]} onClick={() => setLogo({ position: pos })} />
                ))}
              </div>
            </div>
            <label className="field"><span>Kích thước</span>
              <div className="row gap"><input type="range" min={0.04} max={0.5} step={0.01} value={lg.size} onChange={(e) => setLogo({ size: Number(e.target.value) })} /><span className="num small">{Math.round(lg.size * 100)}%</span></div>
            </label>
            <label className="field"><span>Lề</span>
              <div className="row gap"><input type="range" min={0} max={0.15} step={0.005} value={lg.margin} onChange={(e) => setLogo({ margin: Number(e.target.value) })} /><span className="num small">{Math.round(lg.margin * 100)}%</span></div>
            </label>
            <label className="field"><span>Độ mờ</span>
              <div className="row gap"><input type="range" min={0.1} max={1} step={0.05} value={lg.opacity} onChange={(e) => setLogo({ opacity: Number(e.target.value) })} /><span className="num small">{Math.round(lg.opacity * 100)}%</span></div>
            </label>
          </>
        )}
        <div className="muted small">Logo hiện trên toàn bộ video. Nên dùng PNG nền trong suốt.</div>
      </div>
    </>
  );
};

const ProjectInspector: React.FC = () => {
  const project = useStore((s) => s.project);
  const set = (k: string, v: any) => useStore.getState().update((p) => setPath(p, k, v));
  const st = project.subtitles;
  return (
    <div className="inspector-body">
      <div className="insp-title"><Icon name="comp" /> <b>{project.name}</b></div>
      <div className="section-title">Metadata</div>
      <div className="form">
        <label className="field"><span>Dimensions</span>
          <div className="row gap">
            <input type="number" value={project.settings.width} onChange={(e) => set('settings.width', Number(e.target.value))} />
            <input type="number" value={project.settings.height} onChange={(e) => set('settings.height', Number(e.target.value))} />
          </div>
        </label>
        <label className="field"><span>Preset</span>
          <select value="" onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); if (w) useStore.getState().update((p) => { p.settings.width = w; p.settings.height = h; }); }}>
            <option value="">Chọn khung…</option>
            <option value="1920x1080">16:9 · 1920×1080</option>
            <option value="1080x1920">9:16 · 1080×1920 (Reels/TikTok)</option>
            <option value="1080x1080">1:1 · 1080×1080</option>
            <option value="1080x1350">4:5 · 1080×1350</option>
            <option value="3840x2160">4K · 3840×2160</option>
          </select>
        </label>
        <label className="field"><span>Frame rate</span>
          <select value={project.settings.fps} onChange={(e) => set('settings.fps', Number(e.target.value))}>
            {[24, 25, 30, 50, 60].map((f) => <option key={f} value={f}>{f}fps</option>)}
          </select>
        </label>
        <label className="field"><span>Duration</span><b className="num">{projectDuration(project).toFixed(2)}s</b></label>
        <label className="field color"><span>Nền</span><FieldInput f={{ key: 'bg', label: '', type: 'color' }} value={project.settings.background} onChange={(v) => set('settings.background', v)} /></label>
      </div>
      <LogoSection />
      <div className="section-title">Phụ đề ({st.cues.length})</div>
      <div className="form">
        <label className="field checkbox"><span>Hiển thị</span><input type="checkbox" checked={st.enabled} onChange={(e) => set('subtitles.enabled', e.target.checked)} /></label>
        <label className="field"><span>Cỡ chữ</span><input type="number" value={st.style.fontSize} onChange={(e) => set('subtitles.style.fontSize', Number(e.target.value))} /></label>
        <label className="field color"><span>Màu</span><FieldInput f={{ key: 'c', label: '', type: 'color' }} value={st.style.color} onChange={(v) => set('subtitles.style.color', v)} /></label>
        <label className="field"><span>Vị trí Y</span><input type="number" step={0.01} value={st.style.position} onChange={(e) => set('subtitles.style.position', Number(e.target.value))} /></label>
      </div>
      <div className="section-title">Actions</div>
      <div className="actions">
        <button onClick={() => addSolidClip()}><Icon name="square" /> Add Solid</button>
        <button onClick={() => addTextClip()}><Icon name="text" /> Add Text</button>
        <button onClick={() => addComponentClip('TitleCard')}><Icon name="motion" /> Add motion title</button>
        <button onClick={() => askClaude('Tạo một motion graphic mới (component Remotion) cho video này: ', false)}><Icon name="wand" /> Generate with agent…</button>
        <button onClick={() => askClaude('Xem toàn bộ asset và dựng một bản nháp video hoàn chỉnh: sắp xếp thứ tự hợp lý, thêm chuyển cảnh, tiêu đề, nhạc nền nếu có.', false)}><Icon name="sparkle" /> Auto-edit bản nháp…</button>
      </div>
    </div>
  );
};

const Jobs: React.FC = () => {
  const jobMap = useStore((s) => s.jobs);
  const jobs = Object.values(jobMap).sort((a, b) => b.startedAt - a.startedAt);
  const hasUploads = useStore((s) => Object.keys(s.uploads).length > 0);
  const [exports, setExports] = useState<any[]>([]);
  useEffect(() => { fetch('/api/exports').then((r) => r.json()).then(setExports); }, [jobs.length, jobs[0]?.stage]);
  return (
    <div className="inspector-body">
      {hasUploads && <div className="section-title">Đang tải lên</div>}
      <UploadProgress />
      {hasUploads && !!jobs.length && <div className="section-title">Tác vụ</div>}
      {!jobs.length && !hasUploads && <div className="empty">Chưa có tác vụ nào.</div>}
      {jobs.map((j) => (
        <div key={j.id} className={`job ${j.stage}`}>
          <div className="row"><b>{j.label}</b><span className="spacer" /><span className="small muted">{j.stage}{!['done', 'error', 'queued'].includes(j.stage) && j.progress ? ` · ${Math.round(j.progress * 100)}%` : ''}</span></div>
          {!['done', 'error'].includes(j.stage) && <div className="bar"><div style={{ width: `${(j.progress || 0) * 100}%` }} /></div>}
          {j.error && <div className="error small">{j.error}</div>}
          {j.url && j.type === 'youtube' && <a href={j.url} target="_blank" rel="noreferrer">Xem trên YouTube: {j.url}</a>}
          {j.url && j.type !== 'youtube' && (
            <div className="row gap job-actions">
              <a className="btn small" href={j.url} target="_blank" rel="noreferrer"><Icon name="play" /> Mở video</a>
              <a className="btn small primary" href={j.url} download={decodeURIComponent(j.url.split('/').pop() || 'video.mp4')}><Icon name="download" /> Tải về</a>
            </div>
          )}
          {(j as any).studio && <a href={(j as any).studio} target="_blank" rel="noreferrer">Mở YouTube Studio</a>}
        </div>
      ))}
      <div className="section-title">Exports</div>
      {exports.map((e) => (
        <div key={e.name} className="export-row">
          <a className="export-item" href={e.url} target="_blank" rel="noreferrer" download><Icon name="download" /> {e.name} <span className="muted small">{(e.size / 1e6).toFixed(1)}MB</span></a>
          <button className="btn small yt" title="Đăng lên YouTube" onClick={() => openYouTube(`exports/${e.name}`)}>▶ YouTube</button>
        </div>
      ))}
    </div>
  );
};

export const Inspector: React.FC = () => {
  const selection = useStore((s) => s.selection);
  const project = useStore((s) => s.project);
  const running = useStore((s) => Object.values(s.jobs).some((j) => !['done', 'error'].includes(j.stage)) || Object.values(s.uploads).some((u) => u.state === 'uploading' || u.state === 'processing'));
  const [tab, setTab] = useState<'insp' | 'jobs'>('insp');
  useEffect(() => {
    const show = () => setTab('jobs');
    window.addEventListener('show-jobs', show);
    return () => window.removeEventListener('show-jobs', show);
  }, []);
  const asset = selection ? assetById(project, selection) : null;
  const clip = selection && findClip(project, selection);
  return (
    <div className="inspector panel">
      <div className="panel-tabs">
        <button className={tab === 'insp' ? 'active' : ''} onClick={() => setTab('insp')}>Inspector</button>
        <button className={tab === 'jobs' ? 'active' : ''} onClick={() => setTab('jobs')}>Jobs {running && <span className="dot busy" />}</button>
      </div>
      <div className="panel-body">
        {tab === 'jobs' ? <Jobs /> : clip ? <ClipInspector id={selection!} /> : asset ? <AssetInspector asset={asset} /> : <ProjectInspector />}
      </div>
    </div>
  );
};

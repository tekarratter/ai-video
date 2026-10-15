import React, { useEffect, useMemo, useRef, useState } from 'react';
import { assetById, findClip } from '../../../shared/timeline.js';
import { useStore } from '../store';
import { currentTime } from '../player';
import { askClaude } from './ChatPanel';
import { Icon } from './Icon';

/* eslint-disable @typescript-eslint/no-explicit-any */

const post = async (url: string, body: unknown) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** One shared <audio> for previews, so starting a new preview stops the previous one. */
const previewAudio = typeof Audio !== 'undefined' ? new Audio() : null;
function usePreview() {
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => {
    if (!previewAudio) return;
    const end = () => setPlaying(null);
    previewAudio.addEventListener('ended', end);
    previewAudio.addEventListener('pause', end);
    return () => { previewAudio.removeEventListener('ended', end); previewAudio.removeEventListener('pause', end); previewAudio.pause(); };
  }, []);
  const toggle = (key: string, url: string) => {
    if (!previewAudio) return;
    if (playing === key) { previewAudio.pause(); return; }
    previewAudio.src = url;
    previewAudio.play().then(() => setPlaying(key)).catch((e) => {
      // autoplay blocked (the preview finished long after the click) — the file is cached, a click on ▶ plays it
      if (e.name === 'NotAllowedError') useStore.getState().toast('Bản nghe thử đã sẵn sàng — bấm ▶ để nghe');
      else useStore.getState().toast(`Không phát được: ${e.message}`, 'error');
    });
  };
  return { playing, toggle };
}

/* ---------------- voice picker (dropdown with per-voice preview) ---------------- */

const SAMPLE: Record<string, string> = {
  vi: 'Xin chào! Đây là giọng đọc thử cho video của bạn.',
  en: 'Hello there! This is a quick preview of this voice for your video.',
};
let voicesCache: Promise<any[]> | null = null;
/** Voice list from /api/tts/voices, fetched once per page load. */
export function useVoices() {
  const [voices, setVoices] = useState<any[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    voicesCache ||= fetch('/api/tts/voices').then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      return j;
    });
    voicesCache.then(setVoices).catch((e) => { voicesCache = null; setErr(e.message); });
  }, []);
  return { voices, err };
}

const previewUrls = new Map<string, string>(); // voice|speed|text → generated preview file
/** Synthesizes a short preview (cached server- and client-side) and plays it. */
function useVoiceSample() {
  const { playing, toggle } = usePreview();
  const jobs = useStore((s) => s.jobs);
  const [pending, setPending] = useState<{ key: string; job: string } | null>(null);
  const job: any = pending ? jobs[pending.job] : null;
  useEffect(() => {
    if (!job || !pending) return;
    if (job.stage === 'error') { useStore.getState().toast(`Nghe thử lỗi: ${job.error || ''}`, 'error'); setPending(null); return; }
    if (job.stage !== 'done' || !job.previewUrl) return;
    previewUrls.set(pending.key, job.previewUrl);
    toggle(pending.key, job.previewUrl);
    setPending(null);
  }, [job, pending]); // eslint-disable-line react-hooks/exhaustive-deps
  const play = async (voice: string, text: string, speed = 1) => {
    const key = `${voice}|${speed}|${text}`;
    const url = previewUrls.get(key);
    if (url) return toggle(key, url);
    if (pending) return;
    try {
      const { job } = await post('/api/tts', { text, voice, speed, add: false });
      setPending({ key, job: job.id });
    } catch (e: any) { useStore.getState().toast(e.message, 'error'); }
  };
  const state = (voice: string, text: string, speed = 1) => {
    const key = `${voice}|${speed}|${text}`;
    return pending?.key === key ? 'loading' : playing === key ? 'playing' : 'idle';
  };
  return { play, state, busy: !!pending };
}

/**
 * Dropdown for choosing a TTS voice. Every row has a ▶ button that reads `text`
 * (or a short sample sentence) in that voice so voices can be compared before choosing.
 */
export const VoicePicker: React.FC<{
  value: string; onChange: (id: string) => void; lang?: string; text?: string; speed?: number;
}> = ({ value, onChange, lang, text, speed = 1 }) => {
  const { voices, err } = useVoices();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const { play, state } = useVoiceSample();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector('.vp-row.active')?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  const cur = voices.find((v) => v.id === value);
  const ql = q.trim().toLowerCase();
  const list = voices.filter((v) => (!lang || v.lang === lang) && (!ql || `${v.name} ${v.description}`.toLowerCase().includes(ql)));
  const groups = [...new Set(list.map((v) => v.lang))];
  const sample = (v: any) => (text?.trim() ? text.trim().slice(0, 160) : SAMPLE[v.lang] || SAMPLE.en);
  const curState = cur ? state(cur.id, sample(cur), speed) : 'idle';

  return (
    <div className="voice-picker" ref={ref}>
      <div className="vp-current">
        <button type="button" className="vp-btn" onClick={() => setOpen(!open)} title="Chọn giọng đọc">
          <span className={`voice-dot ${cur?.gender || ''}`} />
          <span className="vp-label">{cur ? <>{cur.featured ? '⭐ ' : ''}{cur.name} <span className="muted small">{cur.description}</span></> : (err || value || 'Chọn giọng…')}</span>
          <Icon name="chevdown" />
        </button>
        {cur && (
          <button type="button" className="icon-btn" title="Nghe thử giọng đang chọn" onClick={() => play(cur.id, sample(cur), speed)}>
            {curState === 'loading' ? <span className="spinner" /> : <Icon name={curState === 'playing' ? 'pause' : 'play'} />}
          </button>
        )}
      </div>
      {open && (
        <div className="vp-menu">
          {voices.length > 8 && <input className="vp-search" autoFocus placeholder="Tìm giọng (tên, nam/nữ, miền…)" value={q} onChange={(e) => setQ(e.target.value)} />}
          <div className="vp-list">
            {groups.map((g) => (
              <React.Fragment key={g}>
                {!lang && <div className="vp-group">{g === 'vi' ? 'Tiếng Việt (VieNeu)' : g === 'en' ? 'English (Kokoro)' : g}</div>}
                {list.filter((v) => v.lang === g).map((v) => {
                  const st = state(v.id, sample(v), speed);
                  return (
                    <div key={v.id} className={`vp-row ${v.id === value ? 'active' : ''}`} onClick={() => { onChange(v.id); setOpen(false); }}>
                      <button type="button" className="icon-btn" title="Nghe thử" onClick={(e) => { e.stopPropagation(); play(v.id, sample(v), speed); }}>
                        {st === 'loading' ? <span className="spinner" /> : <Icon name={st === 'playing' ? 'pause' : 'play'} />}
                      </button>
                      <span className={`voice-dot ${v.gender}`} />
                      <span className="vp-name">{v.featured ? '⭐ ' : ''}{v.name}</span>
                      <span className="muted small vp-desc">{v.description}</span>
                      {v.id === value && <Icon name="check" />}
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
            {!list.length && <div className="muted small vp-empty">{err || (voices.length ? 'Không có giọng phù hợp' : 'Đang tải danh sách giọng…')}</div>}
          </div>
          <div className="muted small vp-foot">▶ đọc {text?.trim() ? 'lời của clip' : 'câu mẫu'} bằng giọng đó · lần đầu mất ~15s để nạp model</div>
        </div>
      )}
    </div>
  );
};

/** Voice-over clip: pick another voice (▶ previews this clip's text in it), tweak text/speed, re-read. */
export const VoiceSection: React.FC<{ clipIds: string[]; tts: { text: string; voice: string; speed?: number }; title?: string }> = ({ clipIds, tts, title = 'Giọng đọc AI' }) => {
  const clipId = clipIds.join(',');
  const project = useStore((s) => s.project);
  const [voice, setVoice] = useState(tts.voice);
  const [speed, setSpeed] = useState(tts.speed || 1);
  const [text, setText] = useState(tts.text);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setVoice(tts.voice); setSpeed(tts.speed || 1); setText(tts.text); }, [clipId, tts.voice, tts.speed, tts.text]);
  // every voice-over clip in the project (for "apply to all")
  const all = (project?.tracks || []).flatMap((t: any) => t.clips).filter((c: any) => c.assetId && assetById(project, c.assetId)?.tts).map((c: any) => c.id);
  const changed = voice !== tts.voice || speed !== (tts.speed || 1) || text !== tts.text;
  const run = async (ids: string[]) => {
    setBusy(true);
    try {
      const body: any = { clipIds: ids, voice, speed };
      if (text !== tts.text) body.text = text;
      const r = await fetch('/api/tts/revoice', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      useStore.getState().toast(`Đang đọc lại ${ids.length} clip — xem tab Jobs`);
    } catch (e: any) { useStore.getState().toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="section-title">{title}</div>
      <div className="form">
        <VoicePicker value={voice} onChange={setVoice} text={text} speed={speed} />
        <label className="field range"><span>Tốc độ</span>
          <div className="row gap"><input type="range" min={0.7} max={1.5} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /><span className="num small">{speed.toFixed(2)}×</span></div>
        </label>
        <label className="field textarea"><span>Lời đọc</span><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} /></label>
        <div className="row gap wrap">
          <button className="btn small primary" disabled={busy || !clipIds.length || !changed || !text.trim()} onClick={() => run(clipIds)}><Icon name="mic" /> {clipIds.length > 1 ? `Đọc lại ${clipIds.length} clip này` : 'Đọc lại clip này'}</button>
          {!clipIds.length && <div className="muted small">Giọng này chưa được dùng trên timeline.</div>}
          {all.length > 1 && <button className="btn small" disabled={busy || text !== tts.text} title="Đọc lại mọi clip giọng đọc trong dự án bằng giọng & tốc độ này (giữ lời từng clip)" onClick={() => { if (confirm(`Đọc lại tất cả ${all.length} clip giọng đọc bằng giọng này?`)) run(all); }}>Áp dụng cho cả {all.length} clip</button>}
        </div>
      </div>
    </>
  );
};

/** Progress + seek for whatever the shared preview <audio> is playing. */
const NowPlaying: React.FC<{ title: string; onStop: () => void }> = ({ title, onStop }) => {
  const [t, setT] = useState(0);
  const [d, setD] = useState(0);
  useEffect(() => {
    if (!previewAudio) return;
    const u = () => { setT(previewAudio.currentTime); setD(previewAudio.duration || 0); };
    u();
    previewAudio.addEventListener('timeupdate', u);
    previewAudio.addEventListener('loadedmetadata', u);
    return () => { previewAudio.removeEventListener('timeupdate', u); previewAudio.removeEventListener('loadedmetadata', u); };
  }, []);
  return (
    <div className="now-playing">
      <button className="icon-btn" onClick={onStop} title="Dừng"><Icon name="pause" /></button>
      <div className="np-body">
        <div className="lib-title">{title}</div>
        <input type="range" min={0} max={d || 1} step={0.1} value={t} onChange={(e) => { if (previewAudio) previewAudio.currentTime = Number(e.target.value); }} />
      </div>
      <span className="muted small num">{fmt(t)} / {d ? fmt(d) : '…'}</span>
    </div>
  );
};

/* ---------------- music ---------------- */

export const MusicPanel: React.FC = () => {
  const [q, setQ] = useState('');
  const [genre, setGenre] = useState('');
  const [feel, setFeel] = useState('');
  const [maxDur, setMaxDur] = useState('');
  const [facets, setFacets] = useState<{ genres: string[]; feels: string[]; total: number } | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const { playing, toggle } = usePreview();

  useEffect(() => { fetch('/api/music/facets').then((r) => r.json()).then(setFacets).catch(() => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      const qs = new URLSearchParams({ q, genre, feel, maxDuration: maxDur, limit: '80' });
      fetch(`/api/music/search?${qs}`).then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setItems(j); setErr('');
      }).catch((e) => setErr(e.message)).finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, genre, feel, maxDur]);

  const add = async (t: any) => {
    try {
      await post('/api/music/add', { id: t.id, start: 0 });
      useStore.getState().toast(`Đang thêm "${t.title}"… (xem tab Jobs)`);
    } catch (e: any) { useStore.getState().toast(e.message, 'error'); }
  };

  return (
    <div className="panel-body lib">
      <input className="search" placeholder="Tìm nhạc: piano, happy, epic, travel…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="row gap">
        <select value={genre} onChange={(e) => setGenre(e.target.value)}>
          <option value="">Mọi thể loại</option>
          {facets?.genres.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={maxDur} onChange={(e) => setMaxDur(e.target.value)}>
          <option value="">Mọi độ dài</option>
          <option value="30">≤ 30s</option>
          <option value="60">≤ 1 phút</option>
          <option value="180">≤ 3 phút</option>
        </select>
      </div>
      <select value={feel} onChange={(e) => setFeel(e.target.value)}>
        <option value="">Mọi cảm xúc / không khí</option>
        {facets?.feels.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
      {err && <div className="error small">{err}</div>}
      <div className="muted small">{loading ? 'Đang tìm…' : `${items.length}${items.length === 80 ? '+' : ''} bài`} · {facets?.total ?? '…'} bài trong thư viện</div>
      {playing && items.find((t) => t.id === playing) && <NowPlaying title={items.find((t) => t.id === playing)!.title} onStop={() => previewAudio?.pause()} />}
      <div className="lib-list">
        {items.map((t) => (
          <div key={t.id} className={`lib-item ${playing === t.id ? 'playing' : ''}`} title={t.description}>
            <button className="icon-btn" onClick={() => toggle(t.id, t.url)}><Icon name={playing === t.id ? 'pause' : 'play'} /></button>
            <div className="lib-meta">
              <div className="lib-title">{t.title}</div>
              <div className="muted small">{[t.genre, t.feel.slice(0, 2).join(', '), t.bpm && `${t.bpm} bpm`].filter(Boolean).join(' · ')}</div>
            </div>
            <span className="muted small num">{fmt(t.duration)}</span>
            <button className="btn small" onClick={() => add(t)} title="Thêm vào track nhạc nền (tự cắt theo độ dài video, fade in/out)">+</button>
          </div>
        ))}
      </div>
      <div className="muted small lib-note">
        Nhạc của Kevin MacLeod (incompetech.com), giấy phép CC BY 4.0: dùng miễn phí nhưng phải ghi nguồn. Phần ghi nguồn được tự thêm vào mô tả khi đăng YouTube.
        Nhạc riêng của bạn: bỏ file vào <code>library/music/</code> (thư mục con = thể loại).
      </div>
    </div>
  );
};

/* ---------------- voice-over ---------------- */

export const VoicePanel: React.FC = () => {
  const { voices, err } = useVoices();
  const [lang, setLang] = useState<'vi' | 'en'>('vi');
  const [voice, setVoice] = useState('vi:Trúc Ly');
  const [speed, setSpeed] = useState(1);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<{ job: string; play: boolean } | null>(null);
  const jobs = useStore((s) => s.jobs);
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const [previewUrl, setPreviewUrl] = useState('');

  const list = useMemo(() => voices.filter((v) => v.lang === lang), [voices, lang]);
  useEffect(() => { if (list.length && !list.some((v) => v.id === voice)) setVoice(list[0].id); }, [list, voice]);

  // when a preview job finishes, play the generated file
  const job: any = pending ? jobs[pending.job] : null;
  useEffect(() => {
    if (!job || !pending) return;
    if (job.stage === 'error') { setPending(null); return; }
    if (job.stage !== 'done' || !job.finishedAt) return; // (the TTS engine's own 'done' stage arrives before the result)
    if (pending.play && job.previewUrl) {
      previewAudio?.pause();
      setPreviewUrl(job.previewUrl); // the <audio> below autoplays; if the browser blocks it, its ▶ is right there
    }
    setPending(null);
  }, [job, pending]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (add: boolean) => {
    if (!text.trim()) return;
    try {
      const { job } = await post('/api/tts', { text, voice, speed, start: currentTime(), add });
      setPending({ job: job.id, play: !add });
      useStore.getState().toast(add ? 'Đang tạo giọng đọc… (xem tab Jobs)' : 'Đang tạo bản nghe thử…');
    } catch (e: any) { useStore.getState().toast(e.message, 'error'); }
  };

  const busy = !!pending;
  const cur = voices.find((v) => v.id === voice);
  const selClip = selection ? findClip(project, selection)?.clip : null;
  const selAsset = selClip?.assetId ? assetById(project, selClip.assetId) : selection ? assetById(project, selection) : null;
  const selIds = !selAsset?.tts ? [] : selClip ? [selClip.id] : (project?.tracks || []).flatMap((t: any) => t.clips).filter((c: any) => c.assetId === selAsset.id).map((c: any) => c.id);
  return (
    <div className="panel-body lib">
      {err && <div className="error small">{err}</div>}
      {selAsset?.tts ? (
        <div className="voice-sel">
          <VoiceSection clipIds={selIds} tts={selAsset.tts} title={selClip ? 'Giọng của clip đang chọn' : `Giọng của ${selIds.length} clip dùng file này`} />
        </div>
      ) : (
        <div className="muted small">Mẹo: chọn một clip giọng đọc trên timeline để đổi giọng / nghe thử các giọng khác cho clip đó.</div>
      )}
      <div className="section-title">Tạo giọng đọc mới</div>
      <div className="seg">
        <button className={lang === 'vi' ? 'active' : ''} onClick={() => setLang('vi')} title="VieNeu-TTS">Tiếng Việt</button>
        <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')} title="Kokoro">English</button>
      </div>
      <VoicePicker value={voice} onChange={setVoice} lang={lang} text={text} speed={speed} />
      <textarea rows={5} placeholder={lang === 'vi' ? 'Nhập lời đọc… (VieNeu đọc được cả từ tiếng Anh xen kẽ)' : 'Type the narration…'} value={text} onChange={(e) => setText(e.target.value)} />
      <label className="field"><span>Tốc độ</span>
        <div className="row gap"><input type="range" min={0.7} max={1.5} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /><span className="num small">{speed.toFixed(2)}×</span></div>
      </label>
      <div className="row gap wrap">
        <button className="btn" disabled={busy || !text.trim()} onClick={() => run(false)}><Icon name="play" /> Nghe thử</button>
        <button className="btn primary" disabled={busy || !text.trim()} onClick={() => run(true)}><Icon name="plus" /> Thêm tại playhead</button>
      </div>
      {previewUrl && <audio key={previewUrl} className="tts-player" src={previewUrl} controls autoPlay />}
      {busy && <div className="muted small">{job ? `${job.stage}…` : 'Đang gửi…'} (lần đầu mất ~15s để nạp model)</div>}
      <button className="btn small" onClick={() => askClaude(`Viết lời dẫn (voice-over) cho video này rồi tạo giọng đọc bằng vedit tts, giọng ${cur?.name || voice}, đặt khớp với từng cảnh.`, false)}>
        <Icon name="sparkle" /> Nhờ Claude viết lời & lồng tiếng…
      </button>
      <div className="muted small lib-note">Giọng đọc được thêm vào track <b>Giọng đọc</b>. Bấm vào clip để chỉnh âm lượng, kéo để đổi vị trí.</div>
    </div>
  );
};

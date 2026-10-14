import React, { useEffect, useMemo, useRef, useState } from 'react';
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
    previewAudio.play().then(() => setPlaying(key)).catch((e) => useStore.getState().toast(`Không phát được: ${e.message}`, 'error'));
  };
  return { playing, toggle };
}

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
      <div className="chips">
        {facets?.feels.slice(0, 14).map((f) => (
          <button key={f} className={`chip ${feel === f ? 'active' : ''}`} onClick={() => setFeel(feel === f ? '' : f)}>{f}</button>
        ))}
      </div>
      {err && <div className="error small">{err}</div>}
      <div className="muted small">{loading ? 'Đang tìm…' : `${items.length}${items.length === 80 ? '+' : ''} bài`} · {facets?.total ?? '…'} bài trong thư viện</div>
      <div className="lib-list">
        {items.map((t) => (
          <div key={t.id} className="lib-item" title={t.description}>
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
  const [voices, setVoices] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [lang, setLang] = useState<'vi' | 'en'>('vi');
  const [voice, setVoice] = useState('vi:Trúc Ly');
  const [speed, setSpeed] = useState(1);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<{ job: string; play: boolean } | null>(null);
  const jobs = useStore((s) => s.jobs);
  const { playing, toggle } = usePreview();
  const lastPreview = useRef<{ key: string; url: string } | null>(null);

  useEffect(() => {
    fetch('/api/tts/voices').then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setVoices(j);
    }).catch((e) => setErr(e.message));
  }, []);

  const list = useMemo(() => voices.filter((v) => v.lang === lang), [voices, lang]);
  useEffect(() => { if (list.length && !list.some((v) => v.id === voice)) setVoice(list[0].id); }, [list, voice]);

  // when a preview job finishes, play the generated file
  const job: any = pending ? jobs[pending.job] : null;
  useEffect(() => {
    if (!job || !pending) return;
    if (job.stage === 'error') { setPending(null); return; }
    if (job.stage !== 'done') return;
    if (pending.play && job.previewUrl) {
      lastPreview.current = { key: job.previewUrl, url: job.previewUrl };
      toggle(job.previewUrl, job.previewUrl);
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
  return (
    <div className="panel-body lib">
      {err && <div className="error small">{err}</div>}
      <div className="seg">
        <button className={lang === 'vi' ? 'active' : ''} onClick={() => setLang('vi')}>Tiếng Việt (VieNeu)</button>
        <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>English (Kokoro)</button>
      </div>
      <div className="voice-grid">
        {list.map((v) => (
          <button key={v.id} className={`voice ${voice === v.id ? 'active' : ''}`} onClick={() => setVoice(v.id)} title={v.description}>
            <span className={`voice-dot ${v.gender}`} />
            <span className="voice-name">{v.featured ? '⭐ ' : ''}{v.name}</span>
            <span className="muted small">{v.description.split('·').slice(1).join('·').trim()}</span>
          </button>
        ))}
      </div>
      <textarea rows={5} placeholder={lang === 'vi' ? 'Nhập lời đọc… (VieNeu đọc được cả từ tiếng Anh xen kẽ)' : 'Type the narration…'} value={text} onChange={(e) => setText(e.target.value)} />
      <label className="field"><span>Tốc độ</span>
        <div className="row gap"><input type="range" min={0.7} max={1.5} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /><span className="num small">{speed.toFixed(2)}×</span></div>
      </label>
      <div className="row gap wrap">
        <button className="btn" disabled={busy || !text.trim()} onClick={() => run(false)}><Icon name="play" /> Nghe thử</button>
        {lastPreview.current && <button className="icon-btn" title="Phát lại" onClick={() => toggle(lastPreview.current!.key, lastPreview.current!.url)}><Icon name={playing ? 'pause' : 'volume'} /></button>}
        <button className="btn primary" disabled={busy || !text.trim()} onClick={() => run(true)}><Icon name="plus" /> Thêm tại playhead</button>
      </div>
      {busy && <div className="muted small">{job ? `${job.stage}…` : 'Đang gửi…'} (lần đầu mất ~15s để nạp model)</div>}
      <button className="btn small" onClick={() => askClaude(`Viết lời dẫn (voice-over) cho video này rồi tạo giọng đọc bằng vedit tts, giọng ${cur?.name || voice}, đặt khớp với từng cảnh.`, false)}>
        <Icon name="sparkle" /> Nhờ Claude viết lời & lồng tiếng…
      </button>
      <div className="muted small lib-note">Giọng đọc được thêm vào track <b>Giọng đọc</b>. Bấm vào clip để chỉnh âm lượng, kéo để đổi vị trí.</div>
    </div>
  );
};

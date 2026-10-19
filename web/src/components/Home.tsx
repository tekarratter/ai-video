import React, { useEffect, useMemo, useRef, useState } from 'react';
import { components, componentDefaults } from '@custom';
import { Player, Thumbnail } from '@remotion/player';
import { flushSave, rememberProject, useStore } from '../store';
import { api } from './Account';
import { Icon } from './Icon';
import { VoicePicker, useVoices } from './AudioLibrary';
import { askClaude } from './ChatPanel';
import { openArticle } from './ArticleDialog';
import { openDub } from './DubDialog';
import { openProjects } from './Projects';
import { uploadFiles } from './LeftPanel';
import { CATEGORIES, SIZE_LABEL, TEMPLATES, type Field, type Template } from '../templates';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const showHome = () => window.dispatchEvent(new Event('show-home'));
export const showEditor = () => window.dispatchEvent(new Event('show-editor'));

const dims = (s: string) => s.split('x').map(Number) as [number, number];
const timeAgo = (t?: number) => {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'vừa xong' : m < 60 ? `${m} phút trước` : m < 1440 ? `${Math.round(m / 60)} giờ trước` : new Date(t).toLocaleDateString('vi-VN');
};

/** Live preview of a template: its motion component with sample props (plays on hover). */
const TemplatePreview: React.FC<{ t: Template; play: boolean }> = ({ t, play }) => {
  const C = components[t.preview.component];
  const [w, h] = dims(t.sizes[0]);
  const Comp = useMemo(() => {
    if (!C) return null;
    const bg = t.preview.bg;
    const Wrapped: React.FC<any> = (p) => <div style={{ position: 'absolute', inset: 0, background: bg }}><C {...p} /></div>;
    return Wrapped;
  }, [C, t.preview.bg]);
  if (!Comp) return <div className="tpl-thumb-empty">{t.icon}</div>;
  const props = { ...(componentDefaults[t.preview.component] || {}), ...(t.preview.props || {}) };
  const common = { component: Comp, inputProps: props, compositionWidth: w, compositionHeight: h, fps: 30, durationInFrames: 180, acknowledgeRemotionLicense: true, style: { height: '100%', aspectRatio: `${w} / ${h}` } };
  return play
    ? <Player {...common} autoPlay loop controls={false} errorFallback={() => <div className="tpl-thumb-empty">{t.icon}</div>} />
    : <Thumbnail {...common} frameToDisplay={t.preview.frame ?? 60} errorFallback={() => <div className="tpl-thumb-empty">{t.icon}</div>} />;
};

const TemplateCard: React.FC<{ t: Template; onPick: (t: Template) => void }> = ({ t, onPick }) => {
  const [hover, setHover] = useState(false);
  return (
    <button className="tpl-card" onClick={() => onPick(t)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="tpl-thumb">
        <TemplatePreview t={t} play={hover} />
        {t.hot && <span className="tpl-hot">HOT</span>}
        <span className="tpl-size">{t.sizes[0] === '1080x1920' ? '9:16' : t.sizes[0] === '1080x1080' ? '1:1' : '16:9'}</span>
      </div>
      <div className="tpl-meta">
        <b>{t.icon} {t.name}</b>
        <span className="muted small">{t.desc}</span>
      </div>
    </button>
  );
};

/** Home: quick create, recent projects, template gallery. */
export const Home: React.FC = () => {
  const projects = useStore((s) => s.projects);
  const active = useStore((s) => s.activeProject);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Template | null>(null);
  const galleryRef = useRef<HTMLDivElement>(null);
  useEffect(() => { api('/api/projects').then((r) => useStore.setState({ projects: r.projects, activeProject: r.active })).catch(() => {}); }, []);

  const choose = (t: Template) => {
    if (t.dialog === 'article') { openArticle({ newProject: true }); return; }
    if (t.dialog === 'dub') { showEditor(); openDub(); return; }
    setPick(t);
  };
  const open = async (id: string) => {
    if (id !== active) { await flushSave(); rememberProject(); await api(`/api/projects/${id}/open`, 'POST').catch((e) => useStore.getState().toast(e.message, 'error')); }
    showEditor();
  };
  const ql = q.trim().toLowerCase();
  const list = TEMPLATES.filter((t) => (cat === 'all' || t.cat === cat) && (!ql || `${t.name} ${t.desc}`.toLowerCase().includes(ql)));
  const recent = [...projects].sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 8);

  return (
    <div className="home">
      <div className="home-inner">
        <div className="home-hero">
          <div>
            <div className="muted">Tạo video từ ý tưởng</div>
            <h1>Bắt đầu nào</h1>
          </div>
          <div className="spacer" />
          {active && <button className="btn" onClick={showEditor}><Icon name="film" /> Về dự án đang mở</button>}
        </div>

        <div className="quick-grid">
          <button className="quick-card primary" onClick={() => { showEditor(); openProjects(); }}>
            <span className="quick-icon"><Icon name="plus" size={22} /></span>
            <b>Dự án trống</b><span>Tự dựng với timeline, Claude hỗ trợ</span>
          </button>
          <button className="quick-card" onClick={() => openArticle({ newProject: true })}>
            <span className="quick-icon">📝</span>
            <b>Từ link bài viết</b><span>Báo, blog, diễn đàn → video có giọng đọc</span>
          </button>
          <button className="quick-card" onClick={() => { showEditor(); openDub(); }}>
            <span className="quick-icon">🎧</span>
            <b>Thuyết minh video</b><span>Dịch & lồng tiếng Việt / Anh</span>
          </button>
          <button className="quick-card hot" onClick={() => galleryRef.current?.scrollIntoView({ behavior: 'smooth' })}>
            <span className="quick-icon">⚡</span>
            <b>Templates</b><span>{TEMPLATES.length} kiểu video có sẵn</span>
          </button>
        </div>

        {!!recent.length && (
          <>
            <div className="home-section"><b>Dự án gần đây</b><div className="spacer" /><button className="link-btn" onClick={() => { showEditor(); openProjects(); }}>Xem tất cả</button></div>
            <div className="recent-grid">
              {recent.map((p: any) => (
                <button key={p.id} className={`recent-card ${p.id === active ? 'active' : ''}`} onClick={() => open(p.id)}>
                  <div className="recent-thumb">
                    {p.thumb ? <img src={p.thumb} alt="" loading="lazy" /> : <Icon name="film" size={28} />}
                    <span className="tpl-size">{Math.round(p.duration || 0)}s</span>
                    {p.id === active && <span className="tpl-hot open">Đang mở</span>}
                  </div>
                  <b>{p.name}</b>
                  <span className="muted small">{p.width}×{p.height} · {timeAgo(p.updatedAt)}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div ref={galleryRef} className="home-section"><b>Templates</b><div className="spacer" />
          <input className="search tpl-search" placeholder="Tìm template…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="chip-row">
          {CATEGORIES.map(([k, label, ic]) => (
            <button key={k} className={`chip ${cat === k ? 'active' : ''}`} onClick={() => setCat(k)}>{ic} {label}</button>
          ))}
        </div>
        <div className="tpl-grid">
          {list.map((t) => <TemplateCard key={t.id} t={t} onPick={choose} />)}
          {!list.length && <div className="muted">Không có template phù hợp.</div>}
        </div>
      </div>
      {pick && <TemplateDialog t={pick} onClose={() => setPick(null)} />}
    </div>
  );
};

const lsGet = (k: string, d: string) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage off */ } };
const SOURCE_LABEL = { link: 'Link', text: 'Văn bản', topic: 'Chủ đề' } as const;

/** Form for one template: creates the project, uploads the files, then hands Claude the brief. */
const TemplateDialog: React.FC<{ t: Template; onClose: () => void }> = ({ t, onClose }) => {
  const { voices } = useVoices();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const srcField = t.fields.find((f) => f.type === 'source') as Extract<Field, { type: 'source' }> | undefined;
  const [mode, setMode] = useState<'link' | 'text' | 'topic'>(srcField?.modes[0] || 'topic');
  const [lang, setLang] = useState<'vi' | 'en'>(() => (lsGet('aiv.tpl.lang', 'vi') === 'en' ? 'en' : 'vi'));
  const [voice, setVoice] = useState(() => lsGet('aiv.tpl.voice', 'vi:Mai Anh'));
  const [voice2, setVoice2] = useState(() => lsGet('aiv.tpl.voice2', 'vi:Thiện Minh'));
  const [size, setSize] = useState(t.sizes[0]);
  const [length, setLength] = useState(t.length?.[0]?.[0] || '');
  const [name, setName] = useState('');
  const [newProject, setNewProject] = useState(true);
  const [subs, setSubs] = useState(true);
  const [music, setMusic] = useState(true);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const set = (k: string, v: string) => setVals((o) => ({ ...o, [k]: v }));

  const list = voices.filter((v) => v.lang === lang);
  useEffect(() => {
    if (!list.length) return;
    if (!list.some((v) => v.id === voice)) setVoice((list.find((v) => v.featured) || list[0]).id);
    if (!list.some((v) => v.id === voice2)) setVoice2((list.filter((v) => v.featured)[1] || list[1] || list[0]).id);
  }, [lang, list, voice, voice2]);

  const missing = t.fields.some((f) => {
    if (f.type === 'source') return !(vals.source || '').trim() || (mode === 'link' && !/^https?:\/\/\S+\.\S+/.test(vals.source.trim()));
    if (f.type === 'files') return !!f.required && !files[f.k]?.length;
    if (f.type === 'text' || f.type === 'textarea') return !!f.required && !(vals[f.k] || '').trim();
    return false;
  });

  const submit = async () => {
    setErr('');
    lsSet('aiv.tpl.lang', lang); lsSet('aiv.tpl.voice', voice); lsSet('aiv.tpl.voice2', voice2);
    try {
      const [w, h] = dims(size);
      const title = name.trim() || vals.headline?.trim() || vals.show?.trim() || t.name;
      if (newProject) {
        setBusy('Đang tạo dự án…');
        await flushSave(); rememberProject();
        const r = await api('/api/projects', 'POST', { name: title, width: w, height: h, fps: 30 });
        if (r?.projects) useStore.setState({ projects: r.projects, activeProject: r.active });
      }
      const all = Object.values(files).flat();
      if (all.length) {
        setBusy(`Đang tải lên ${all.length} file…`);
        const before = new Set(Object.keys(useStore.getState().uploads));
        uploadFiles(all);
        await new Promise<void>((resolve) => {
          const check = () => Object.keys(useStore.getState().uploads).every((k) => before.has(k));
          const unsub = useStore.subscribe(() => { if (check()) { unsub(); resolve(); } });
          setTimeout(() => { if (check()) { unsub(); resolve(); } }, 1500);
        });
      }
      const lines = [`Tạo video theo template "${t.name}" — làm theo mục "## Template: ${t.recipe}" trong CLAUDE.md (đọc lại mục đó và "Video templates" trước khi làm).`];
      if (srcField) lines.push(`- ${SOURCE_LABEL[mode]}: ${(vals.source || '').trim()}`);
      for (const f of t.fields) {
        if ((f.type === 'text' || f.type === 'textarea') && (vals[f.k] || '').trim()) lines.push(`- ${f.label}: ${vals[f.k].trim()}`);
        if (f.type === 'files' && files[f.k]?.length) lines.push(`- ${f.label}: ${files[f.k].map((x) => x.name).join(', ')} (vừa tải lên, là các asset mới nhất của dự án)`);
      }
      if (t.voice) {
        lines.push(`- Giọng đọc: ${lang === 'vi' ? 'tiếng Việt' : 'tiếng Anh'}, "${voice}"${t.fields.some((f) => f.type === 'voice2') ? `; người thứ hai "${voice2}"` : ''}${lang === 'en' ? ' (nội dung tiếng Việt thì dịch sang tiếng Anh)' : ''}`);
      }
      if (length) lines.push(`- Độ dài: ${t.length?.find((x) => x[0] === length)?.[1]}`);
      lines.push(newProject ? `- Đã tạo dự án mới "${title}" khung ${size} và đang mở — dựng trong dự án này` : `- Dùng dự án đang mở, thêm vào cuối timeline`);
      lines.push(`- Phụ đề: ${subs ? 'có' : 'không'} · Nhạc nền: ${music ? 'có' : 'không'}`);
      if ((vals.extra || '').trim()) lines.push(`- Yêu cầu thêm: ${vals.extra.trim()}`);
      lines.push('Không render; xong thì báo tóm tắt các cảnh.');
      askClaude(lines.join('\n'), true);
      useStore.getState().toast('Đã gửi cho Claude — theo dõi tiến độ trong khung chat');
      onClose();
      showEditor();
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal tpl-modal">
        <div className="modal-head">
          <b>{t.icon} {t.name}</b>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose} disabled={!!busy}><Icon name="x" /></button>
        </div>
        <div className="tpl-modal-body">
          <div className="tpl-modal-preview"><TemplatePreview t={{ ...t, sizes: [size] }} play /></div>
          <div className="form">
            <div className="muted small">{t.desc}</div>
            {t.fields.map((f) => {
              if (f.type === 'source') return (
                <div key={f.k} className="field"><span>{f.label}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {f.modes.length > 1 && <div className="seg">{f.modes.map((m) => <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>{SOURCE_LABEL[m]}</button>)}</div>}
                    {mode === 'text'
                      ? <textarea rows={5} placeholder="Dán nội dung…" value={vals.source || ''} onChange={(e) => set('source', e.target.value)} />
                      : <input placeholder={mode === 'link' ? 'https://…' : 'VD: Vì sao giá vàng tăng?'} value={vals.source || ''} onChange={(e) => set('source', e.target.value)} />}
                  </div>
                </div>
              );
              if (f.type === 'text') return <label key={f.k} className="field"><span>{f.label}</span><input placeholder={f.placeholder} value={vals[f.k] || ''} onChange={(e) => set(f.k, e.target.value)} /></label>;
              if (f.type === 'textarea') return <label key={f.k} className="field"><span>{f.label}</span><textarea rows={4} placeholder={f.placeholder} value={vals[f.k] || ''} onChange={(e) => set(f.k, e.target.value)} /></label>;
              if (f.type === 'files') return (
                <div key={f.k} className="field"><span>{f.label}</span>
                  <div>
                    <label className="btn small"><Icon name="upload" /> Chọn file
                      <input type="file" hidden multiple accept={f.accept} onChange={(e) => { const l = Array.from(e.target.files || []); setFiles((o) => ({ ...o, [f.k]: [...(o[f.k] || []), ...l] })); e.target.value = ''; }} />
                    </label>
                    {!!files[f.k]?.length && <span className="small" style={{ marginLeft: 8 }}>{files[f.k].length} file <button className="link-btn" onClick={() => setFiles((o) => ({ ...o, [f.k]: [] }))}>bỏ chọn</button></span>}
                    {f.hint && <div className="muted small">{f.hint}</div>}
                  </div>
                </div>
              );
              return null;
            })}
            {t.voice && <>
              <div className="field"><span>Ngôn ngữ giọng đọc</span>
                <div className="seg"><button className={lang === 'vi' ? 'active' : ''} onClick={() => setLang('vi')}>Tiếng Việt</button><button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>English</button></div>
              </div>
              <div className="field"><span>{t.fields.some((f) => f.type === 'voice2') ? 'Giọng người thứ nhất' : 'Giọng đọc'}</span><VoicePicker value={voice} onChange={setVoice} lang={lang} /></div>
              {t.fields.filter((f) => f.type === 'voice2').map((f) => <div key={f.k} className="field"><span>{f.label}</span><VoicePicker value={voice2} onChange={setVoice2} lang={lang} /></div>)}
            </>}
            {t.length && <label className="field"><span>Độ dài</span><select value={length} onChange={(e) => setLength(e.target.value)}>{t.length.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
            <label className="field checkbox"><span>Tạo dự án mới</span><input type="checkbox" checked={newProject} onChange={(e) => setNewProject(e.target.checked)} /></label>
            {newProject && <>
              <label className="field"><span>Tên dự án</span><input placeholder={vals.headline || vals.show || t.name} value={name} onChange={(e) => setName(e.target.value)} /></label>
              {t.sizes.length > 1 && <label className="field"><span>Khung hình</span><select value={size} onChange={(e) => setSize(e.target.value)}>{t.sizes.map((s) => <option key={s} value={s}>{SIZE_LABEL[s] || s}</option>)}</select></label>}
            </>}
            <label className="field checkbox"><span>Phụ đề</span><input type="checkbox" checked={subs} onChange={(e) => setSubs(e.target.checked)} /></label>
            <label className="field checkbox"><span>Nhạc nền</span><input type="checkbox" checked={music} onChange={(e) => setMusic(e.target.checked)} /></label>
            <label className="field"><span>Yêu cầu thêm</span><input placeholder="Tuỳ chọn: màu thương hiệu, giọng vui, nhấn mạnh…" value={vals.extra || ''} onChange={(e) => set('extra', e.target.value)} /></label>
            {err && <div className="error small">{err}</div>}
            <div className="row gap">
              {busy && <span className="small muted">{busy}</span>}
              <div className="spacer" />
              <button className="btn" onClick={onClose} disabled={!!busy}>Huỷ</button>
              <button className="btn primary" disabled={missing || !!busy} onClick={submit}><Icon name="sparkle" /> Tạo video</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

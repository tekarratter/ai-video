import React, { useEffect, useRef, useState } from 'react';
import { flushSave, rememberProject, useStore } from '../store';
import { Icon } from './Icon';
import { VoicePicker, useVoices } from './AudioLibrary';
import { askClaude } from './ChatPanel';
import { api } from './Account';
import { uploadParts, waitJob } from '../upload';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Open the "video from an article / a document" dialog (`mode: 'doc'` starts on the Word/PDF tab). */
export function openArticle(opts: { newProject?: boolean; mode?: 'link' | 'doc' } = {}) { window.dispatchEvent(new CustomEvent('open-article', { detail: opts })); }

const LENGTHS = [
  ['short', 'Ngắn ~1 phút', 'khoảng 60 giây (~8 cảnh), chỉ ý chính'],
  ['medium', 'Vừa ~2–3 phút', 'khoảng 2–3 phút (~15 cảnh)'],
  ['long', 'Chi tiết ~5 phút', 'khoảng 4–5 phút, đủ các ý của bài'],
] as const;
const SIZES = [
  ['1920x1080', 'Ngang 16:9 (YouTube)'],
  ['1080x1920', 'Dọc 9:16 (TikTok, Shorts, Reels)'],
  ['1080x1080', 'Vuông 1:1 (Facebook)'],
] as const;
/** Visual style for a document: what Claude puts on screen while the narration plays. */
const VISUALS = [
  ['mix', 'Hoạt ảnh + hình trong tài liệu (khuyên dùng)', 'kết hợp hoạt ảnh minh họa (ý chính, biểu đồ, quy trình, bảng, so sánh) với hình và trang trong tài liệu'],
  ['motion', 'Chỉ hoạt ảnh minh họa', 'toàn bộ bằng hoạt ảnh minh họa (ý chính, biểu đồ, quy trình, bảng, so sánh, bảng trắng); chỉ dùng hình trong tài liệu khi thật cần'],
  ['photos', 'Hình trong tài liệu + ảnh minh họa', 'ưu tiên hình và trang trong tài liệu, thiếu thì ảnh minh họa miễn phí; hoạt ảnh cho số liệu'],
] as const;
const DOC_ACCEPT = '.pdf,.docx,.doc,.odt,.rtf,.pptx,.txt,.md';
const DOC_RE = /\.(pdf|docx|doc|odt|rtf|pptx|ppt|odp|txt|md)$/i;

const lsGet = (k: string, d: string) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage off */ } };
const dims = (s: string) => s.split('x').map(Number) as [number, number];
const mb = (b: number) => `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB`;

type Doc = { name: string; path: string; size: number };

export const ArticleDialog: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'link' | 'doc'>('link');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [pickedDoc, setPickedDoc] = useState('');
  const [lang, setLang] = useState<'vi' | 'en'>(() => (lsGet('aiv.article.lang', 'vi') === 'en' ? 'en' : 'vi'));
  const [voice, setVoice] = useState(() => lsGet('aiv.article.voice', 'vi:Mai Anh'));
  const [speed, setSpeed] = useState(1);
  const [length, setLength] = useState<string>(() => lsGet('aiv.article.length', 'medium'));
  const [size, setSize] = useState<string>(() => lsGet('aiv.article.size', '1920x1080'));
  const [visual, setVisual] = useState<string>(() => lsGet('aiv.doc.visual', 'mix'));
  const [presenter, setPresenter] = useState(false);
  const [newProject, setNewProject] = useState(true);
  const [illustrate, setIllustrate] = useState(true);
  const [subtitles, setSubtitles] = useState(true);
  const [music, setMusic] = useState(true);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { voices } = useVoices();

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      setOpen(true); setUrl(''); setNote(''); setFile(null); setPickedDoc(''); setErr(''); setBusy('');
      setNewProject(d.newProject ?? true);
      setMode(d.mode || 'link');
    };
    window.addEventListener('open-article', on);
    return () => window.removeEventListener('open-article', on);
  }, []);
  // documents already uploaded to the open project (offered when not starting a new project)
  useEffect(() => {
    if (!open || mode !== 'doc') return;
    fetch('/api/docs').then((r) => (r.ok ? r.json() : [])).then((l) => setDocs(Array.isArray(l) ? l : [])).catch(() => setDocs([]));
  }, [open, mode]);
  const list = voices.filter((v) => v.lang === lang);
  useEffect(() => {
    if (list.length && !list.some((v) => v.id === voice)) setVoice((list.find((v) => v.featured) || list[0]).id);
  }, [lang, list, voice]);

  if (!open) return null;
  const isDoc = mode === 'doc';
  const ok = isDoc ? !!file || (!newProject && !!pickedDoc) : /^https?:\/\/\S+\.\S+/.test(url.trim());
  const len = LENGTHS.find((l) => l[0] === length) || LENGTHS[1];
  const sizeName = SIZES.find((s) => s[0] === size)?.[1] || size;
  const vis = VISUALS.find((v) => v[0] === visual) || VISUALS[0];
  const close = () => { if (!busy) setOpen(false); };

  const pickFile = (f?: File | null) => {
    if (!f) return;
    if (!DOC_RE.test(f.name)) { setErr('Chỉ nhận file Word (.docx), PDF, .txt hoặc .md'); return; }
    setErr(''); setFile(f); setPickedDoc('');
  };

  const submitLink = () => {
    const langName = lang === 'vi' ? 'tiếng Việt' : 'tiếng Anh';
    const lines = [
      `Tạo video tóm tắt bài viết cho người ngại đọc, theo quy trình "Video từ bài viết" trong CLAUDE.md (đọc lại mục đó trước khi làm).`,
      `- Link: ${url.trim()}`,
      `- Giọng đọc: ${langName}, giọng "${voice}", tốc độ ${speed.toFixed(2)}${lang === 'en' ? ' (bài tiếng Việt thì dịch kịch bản sang tiếng Anh)' : ' (bài tiếng nước ngoài thì dịch kịch bản sang tiếng Việt)'}`,
      `- Độ dài: ${len[2]}`,
      newProject ? `- Tạo dự án mới khung ${size} (${sizeName}), tên theo tiêu đề bài` : `- Dùng dự án đang mở, thêm vào cuối timeline`,
      `- Ảnh: dùng ảnh trong bài${illustrate ? '; thiếu thì thêm ảnh minh họa miễn phí (vedit images) hoặc motion graphic, ghi "Ảnh minh họa"' : '; không thêm ảnh ngoài, thiếu thì dùng motion graphic/chữ'}`,
      `- Phụ đề: ${subtitles ? 'có' : 'không'} · Nhạc nền: ${music ? 'có, nhỏ dưới giọng đọc' : 'không'}`,
    ];
    if (note.trim()) lines.push(`- Yêu cầu thêm: ${note.trim()}`);
    lines.push('Không render; xong thì báo tóm tắt các cảnh.');
    askClaude(lines.join('\n'), true);
    useStore.getState().toast('Đã gửi cho Claude — theo dõi tiến độ trong khung chat');
    setOpen(false);
  };

  const submitDoc = async () => {
    setErr('');
    try {
      let docPath = pickedDoc;
      if (newProject) {
        setBusy('Đang tạo dự án…');
        const [w, h] = dims(size);
        const title = (file?.name || 'Tài liệu').replace(/\.\w+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 80);
        await flushSave(); rememberProject();
        const r = await api('/api/projects', 'POST', { name: title, width: w, height: h, fps: 30 });
        if (r?.projects) useStore.setState({ projects: r.projects, activeProject: r.active });
      }
      if (file) {
        setBusy('Đang tải tài liệu lên… 0%');
        const id = await uploadParts(file, (l, t) => setBusy(`Đang tải tài liệu lên… ${Math.round((l / (t || 1)) * 100)}%`));
        const r = await fetch('/api/upload/finish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: [{ id, name: file.name, size: file.size }] }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `Lỗi ${r.status}`);
        setBusy('Đang lưu…');
        const job = await waitJob(j.job.id);
        docPath = job.docs?.[0] || job.paths?.[0];
        if (!docPath || !/^media\/docs\//.test(docPath)) throw new Error('Máy chủ chưa nhận file tài liệu — hãy tải lại trang rồi thử lại');
      }
      const langName = lang === 'vi' ? 'tiếng Việt' : 'tiếng Anh';
      const lines = [
        `Tạo video đọc và minh họa tài liệu, theo quy trình "Video từ tài liệu (Word/PDF)" trong CLAUDE.md (đọc lại mục đó trước khi làm).`,
        `- Tài liệu: ${docPath}`,
        `- Giọng đọc: ${langName}, giọng "${voice}", tốc độ ${speed.toFixed(2)}${lang === 'en' ? ' (tài liệu tiếng Việt thì dịch kịch bản sang tiếng Anh)' : ' (tài liệu tiếng nước ngoài thì dịch kịch bản sang tiếng Việt, giữ thuật ngữ chuyên môn kèm giải thích)'}`,
        `- Độ dài: ${len[2]}`,
        newProject ? `- Đã tạo dự án mới khung ${size} (${sizeName}) và đang mở — dựng trong dự án này, đặt lại tên dự án theo tiêu đề tài liệu` : `- Dùng dự án đang mở (khung hiện tại), thêm vào cuối timeline`,
        `- Hình ảnh: ${vis[2]}`,
        `- Nhân vật 3D dẫn chuyện: ${presenter ? 'có (Character3D ở góc, nhép môi theo giọng đọc)' : 'không'}`,
        `- Phụ đề: ${subtitles ? 'có' : 'không'} · Nhạc nền: ${music ? 'có, nhỏ dưới giọng đọc' : 'không'}`,
      ];
      if (note.trim()) lines.push(`- Yêu cầu thêm: ${note.trim()}`);
      lines.push('Không render; xong thì báo tóm tắt các cảnh.');
      lsSet('aiv.doc.visual', visual);
      askClaude(lines.join('\n'), true);
      useStore.getState().toast('Đã gửi cho Claude — theo dõi tiến độ trong khung chat');
      setOpen(false);
      window.dispatchEvent(new Event('show-editor'));
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };

  const submit = () => {
    lsSet('aiv.article.lang', lang); lsSet('aiv.article.voice', voice); lsSet('aiv.article.length', length); lsSet('aiv.article.size', size);
    if (isDoc) submitDoc(); else submitLink();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal">
        <div className="modal-head">
          <b><Icon name={isDoc ? 'file' : 'text'} /> {isDoc ? 'Video từ tài liệu Word / PDF' : 'Video từ bài viết'}</b>
          <div className="spacer" />
          <button className="icon-btn" onClick={close} disabled={!!busy}><Icon name="x" /></button>
        </div>
        <div className="form">
          <div className="seg">
            <button className={!isDoc ? 'active' : ''} disabled={!!busy} onClick={() => setMode('link')}><Icon name="link" /> Link bài viết</button>
            <button className={isDoc ? 'active' : ''} disabled={!!busy} onClick={() => setMode('doc')}><Icon name="file" /> File Word / PDF</button>
          </div>
          {!isDoc && (
            <>
              <div className="muted small">Dán link bài báo, blog hoặc bài diễn đàn. Claude đọc bài, viết lời tóm tắt dễ nghe, đọc bằng giọng AI và ghép với ảnh trong bài (thêm ảnh minh họa nếu thiếu), kèm phụ đề.</div>
              <label className="field"><span>Link bài viết</span>
                <input autoFocus placeholder="https://vnexpress.net/…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && ok) submit(); }} />
              </label>
            </>
          )}
          {isDoc && (
            <>
              <div className="muted small">Báo cáo, bài giảng, tài liệu hướng dẫn, bài báo khoa học… Claude đọc tài liệu, viết lời giảng dễ hiểu, đọc bằng giọng AI và dựng hoạt ảnh minh họa: ý chính, biểu đồ số liệu, quy trình, bảng, so sánh, phóng to hình/trang trong tài liệu.</div>
              <div
                className={`doc-drop ${drag ? 'dropping' : ''} ${file ? 'has' : ''}`}
                onClick={() => !busy && fileRef.current?.click()}
                onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); pickFile(e.dataTransfer.files[0]); }}
              >
                <Icon name="file" size={26} />
                {file ? <div><b>{file.name}</b><div className="muted small">{mb(file.size)} · bấm để đổi file</div></div>
                  : <div><b>Chọn hoặc kéo thả file vào đây</b><div className="muted small">Word (.docx), PDF, .txt, .md</div></div>}
                <input ref={fileRef} type="file" hidden accept={DOC_ACCEPT} onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
              </div>
              {!newProject && !file && !!docs.length && (
                <label className="field"><span>Hoặc dùng tài liệu đã tải lên dự án này</span>
                  <select value={pickedDoc} onChange={(e) => setPickedDoc(e.target.value)}>
                    <option value="">— chọn —</option>
                    {docs.map((d) => <option key={d.path} value={d.path}>{d.name} ({mb(d.size)})</option>)}
                  </select>
                </label>
              )}
            </>
          )}
          <div className="field"><span>Ngôn ngữ giọng đọc</span>
            <div className="seg">
              <button className={lang === 'vi' ? 'active' : ''} onClick={() => setLang('vi')}>Tiếng Việt</button>
              <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>English</button>
            </div>
          </div>
          <div className="field"><span>Giọng đọc</span>
            <VoicePicker value={voice} onChange={setVoice} lang={lang} speed={speed} />
          </div>
          <label className="field"><span>Tốc độ đọc</span>
            <div className="row gap"><input type="range" min={0.8} max={1.3} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /><span className="num small">{speed.toFixed(2)}×</span></div>
          </label>
          <label className="field"><span>Độ dài</span>
            <select value={length} onChange={(e) => setLength(e.target.value)}>{LENGTHS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
          </label>
          <label className="field checkbox"><span>Tạo dự án mới</span><input type="checkbox" checked={newProject} disabled={!!busy} onChange={(e) => setNewProject(e.target.checked)} /></label>
          {newProject && (
            <label className="field"><span>Khung hình</span>
              <select value={size} onChange={(e) => setSize(e.target.value)}>{SIZES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
            </label>
          )}
          {isDoc ? (
            <>
              <label className="field"><span>Hình minh họa</span>
                <select value={visual} onChange={(e) => setVisual(e.target.value)}>{VISUALS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
              </label>
              <label className="field checkbox"><span>Nhân vật 3D dẫn chuyện (render chậm hơn)</span><input type="checkbox" checked={presenter} onChange={(e) => setPresenter(e.target.checked)} /></label>
            </>
          ) : (
            <label className="field checkbox"><span>Thêm ảnh minh họa khi bài ít ảnh</span><input type="checkbox" checked={illustrate} onChange={(e) => setIllustrate(e.target.checked)} /></label>
          )}
          <label className="field checkbox"><span>Phụ đề</span><input type="checkbox" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)} /></label>
          <label className="field checkbox"><span>Nhạc nền</span><input type="checkbox" checked={music} onChange={(e) => setMusic(e.target.checked)} /></label>
          <label className="field"><span>Yêu cầu thêm (tuỳ chọn)</span><input placeholder={isDoc ? 'VD: chỉ tóm tắt chương 2, giọng giảng bài, nhấn mạnh số liệu…' : 'VD: giọng vui, nhấn mạnh số liệu, bỏ phần quảng cáo…'} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="muted small">
            Mất khoảng {length === 'short' ? '3–5' : length === 'long' ? '12–20' : '6–10'} phút trên máy này, chủ yếu do đọc giọng AI. Xong bạn xem thử, nhắn Claude sửa từng cảnh rồi bấm Render.
            {isDoc ? ' File .doc/.pptx cũ: hãy lưu lại thành .docx hoặc PDF. PDF scan (ảnh chụp) vẫn được, Claude đọc từng trang nên chậm hơn.' : ' Trang cần đăng nhập hoặc chặn bot (voz, một số báo nước ngoài) sẽ không đọc được.'}
          </div>
          {err && <div className="error small">{err}</div>}
          <div className="row gap">
            {busy && <span className="muted small">{busy}</span>}
            <div className="spacer" />
            <button className="btn" onClick={close} disabled={!!busy}>Huỷ</button>
            <button className="btn primary" disabled={!ok || !!busy} onClick={submit}><Icon name="sparkle" /> Tạo video</button>
          </div>
        </div>
      </div>
    </div>
  );
};

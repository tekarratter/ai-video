import React, { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Icon } from './Icon';
import { VoicePicker, useVoices } from './AudioLibrary';
import { askClaude } from './ChatPanel';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Open the "video from an article" dialog. */
export function openArticle(opts: { newProject?: boolean } = {}) { window.dispatchEvent(new CustomEvent('open-article', { detail: opts })); }

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

const lsGet = (k: string, d: string) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage off */ } };

export const ArticleDialog: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [lang, setLang] = useState<'vi' | 'en'>(() => (lsGet('aiv.article.lang', 'vi') === 'en' ? 'en' : 'vi'));
  const [voice, setVoice] = useState(() => lsGet('aiv.article.voice', 'vi:Mai Anh'));
  const [speed, setSpeed] = useState(1);
  const [length, setLength] = useState<string>(() => lsGet('aiv.article.length', 'medium'));
  const [size, setSize] = useState<string>(() => lsGet('aiv.article.size', '1920x1080'));
  const [newProject, setNewProject] = useState(true);
  const [illustrate, setIllustrate] = useState(true);
  const [subtitles, setSubtitles] = useState(true);
  const [music, setMusic] = useState(true);
  const [note, setNote] = useState('');
  const { voices } = useVoices();

  useEffect(() => {
    const on = (e: Event) => { setOpen(true); setUrl(''); setNote(''); setNewProject((e as CustomEvent).detail?.newProject ?? true); };
    window.addEventListener('open-article', on);
    return () => window.removeEventListener('open-article', on);
  }, []);
  const list = voices.filter((v) => v.lang === lang);
  useEffect(() => {
    if (list.length && !list.some((v) => v.id === voice)) setVoice((list.find((v) => v.featured) || list[0]).id);
  }, [lang, list, voice]);

  if (!open) return null;
  const ok = /^https?:\/\/\S+\.\S+/.test(url.trim());
  const len = LENGTHS.find((l) => l[0] === length) || LENGTHS[1];
  const sizeName = SIZES.find((s) => s[0] === size)?.[1] || size;

  const submit = () => {
    lsSet('aiv.article.lang', lang); lsSet('aiv.article.voice', voice); lsSet('aiv.article.length', length); lsSet('aiv.article.size', size);
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

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="modal">
        <div className="modal-head">
          <b><Icon name="text" /> Video từ bài viết</b>
          <div className="spacer" />
          <button className="icon-btn" onClick={() => setOpen(false)}><Icon name="x" /></button>
        </div>
        <div className="form">
          <div className="muted small">Dán link bài báo, blog hoặc bài diễn đàn. Claude đọc bài, viết lời tóm tắt dễ nghe, đọc bằng giọng AI và ghép với ảnh trong bài (thêm ảnh minh họa nếu thiếu), kèm phụ đề.</div>
          <label className="field"><span>Link bài viết</span>
            <input autoFocus placeholder="https://vnexpress.net/…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && ok) submit(); }} />
          </label>
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
          <label className="field checkbox"><span>Tạo dự án mới</span><input type="checkbox" checked={newProject} onChange={(e) => setNewProject(e.target.checked)} /></label>
          {newProject && (
            <label className="field"><span>Khung hình</span>
              <select value={size} onChange={(e) => setSize(e.target.value)}>{SIZES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
            </label>
          )}
          <label className="field checkbox"><span>Thêm ảnh minh họa khi bài ít ảnh</span><input type="checkbox" checked={illustrate} onChange={(e) => setIllustrate(e.target.checked)} /></label>
          <label className="field checkbox"><span>Phụ đề</span><input type="checkbox" checked={subtitles} onChange={(e) => setSubtitles(e.target.checked)} /></label>
          <label className="field checkbox"><span>Nhạc nền</span><input type="checkbox" checked={music} onChange={(e) => setMusic(e.target.checked)} /></label>
          <label className="field"><span>Yêu cầu thêm (tuỳ chọn)</span><input placeholder="VD: giọng vui, nhấn mạnh số liệu, bỏ phần quảng cáo…" value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="muted small">
            Mất khoảng {length === 'short' ? '3–5' : length === 'long' ? '12–20' : '6–10'} phút trên máy này, chủ yếu do đọc giọng AI. Xong bạn xem thử, nhắn Claude sửa từng cảnh rồi bấm Render.
            Trang cần đăng nhập hoặc chặn bot (voz, một số báo nước ngoài) sẽ không đọc được.
          </div>
          <div className="row gap">
            <div className="spacer" />
            <button className="btn" onClick={() => setOpen(false)}>Huỷ</button>
            <button className="btn primary" disabled={!ok} onClick={submit}><Icon name="sparkle" /> Tạo video</button>
          </div>
        </div>
      </div>
    </div>
  );
};

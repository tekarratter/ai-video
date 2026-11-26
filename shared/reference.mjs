// "Clone video mẫu": analyse a reference video into a reusable flow, then save it as a user template.
// Idea from hypit (github.com/hypit-ai/hypit): read the whole piece through word-timed speech, shot
// boundaries and time-labelled frame grids, write ANALYSIS.md (the whole-piece model) + TIMELINE.md
// (time-locatable beats), and anchor the new video's structure to words instead of seconds.
// Everything here is local and CPU-only (ffmpeg + faster-whisper + Pillow); Claude can deepen the
// written analysis later (it reads the same files).
//
// workspace/templates/<id>/
//   reference/source.<ext>          the uploaded video
//   reference/frames/shot_NN.jpg    one frame per shot (middle)      reference/overview/o_NNN.jpg  evenly spaced frames
//   reference/sheet-shots-N.jpg     shot grid with times, roles, words, palettes
//   reference/sheet-overview.jpg    evenly spaced grid with the words spoken there
//   analysis.json  ANALYSIS.md  TIMELINE.md        (after analysis)
//   template.json  TEMPLATE.md  poster.jpg  skeleton/{project.json,media/}   (after "Lưu thành template")
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WORKSPACE, ROOT, probe } from './store.mjs';
import { PYTHON } from './platform.mjs';
import { transcribe } from './dub.mjs';

const exec = promisify(execFile);
export const TEMPLATES_DIR = path.join(WORKSPACE, 'templates');
const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

const ff = async (args) => {
  const r = await exec('ffmpeg', ['-hide_banner', '-nostdin', ...args], { maxBuffer: 1 << 27, windowsHide: true });
  return r.stderr;
};
const py = async (args) => (await exec(PYTHON, [path.join(ROOT, 'tools', 'reference.py'), ...args], {
  maxBuffer: 1 << 24, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
})).stdout;
const r2 = (x) => Math.round(x * 100) / 100;
const fmt = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const posix = (p) => p.split(path.sep).join('/');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 1) + '\n');

export const dirOf = (id) => {
  if (!ID_RE.test(String(id || ''))) throw Object.assign(new Error('Mã template không hợp lệ'), { status: 400 });
  return path.join(TEMPLATES_DIR, id);
};

/** ASCII slug for folder names (Vietnamese marks removed: "Đèn lồng" → "den-long"). */
export function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'mau';
}

/** Move an uploaded / local video into a new reference folder. Returns the id. */
export function createReference(srcFile, name, { move = true } = {}) {
  const base = slugify(path.basename(String(name || 'video'), path.extname(String(name || ''))));
  let id = `${base}-${Date.now().toString(36).slice(-5)}`;
  while (fs.existsSync(path.join(TEMPLATES_DIR, id))) id += 'x';
  const ref = path.join(TEMPLATES_DIR, id, 'reference');
  fs.mkdirSync(ref, { recursive: true });
  // the folder is served under /templates: keep only video extensions (an uploaded "x.html" must never be served as a page)
  const ext = path.extname(String(name || '')).toLowerCase();
  const dest = path.join(ref, `source${/^\.(mp4|mov|m4v|webm|mkv|avi|mpe?g|3gp|ts|flv|wmv)$/.test(ext) ? ext : '.mp4'}`);
  if (move) { try { fs.renameSync(srcFile, dest); } catch { fs.copyFileSync(srcFile, dest); fs.rmSync(srcFile, { force: true }); } } else fs.copyFileSync(srcFile, dest);
  writeJson(path.join(TEMPLATES_DIR, id, 'reference.json'), { id, name: String(name || 'video'), file: posix(path.relative(path.join(TEMPLATES_DIR, id), dest)), createdAt: Date.now() });
  return id;
}

/* ---------------- measurements ---------------- */

/** Shot boundaries — hard cuts and gradual transitions (tools/reference.py shots) — merged so no shot is
 *  shorter than `minShot`. Each shot records how it starts: 'cut' | 'transition' | 'start'. */
export async function detectShots(file, duration, { minShot = 0.4 } = {}) {
  const found = JSON.parse(await py(['shots', file])).filter((c) => c.t > 0.05 && c.t < duration - 0.05);
  const edges = [{ t: 0, kind: 'start' }];
  for (const c of found) if (c.t - edges[edges.length - 1].t >= minShot) edges.push(c);
  if (duration - edges[edges.length - 1].t < minShot && edges.length > 1) edges.pop();
  edges.push({ t: duration });
  return edges.slice(0, -1).map((e, i) => ({ i: i + 1, start: r2(e.t), end: r2(edges[i + 1].t), dur: r2(edges[i + 1].t - e.t), enter: e.kind }));
}

async function silences(file, { noise = -32, min = 0.4 } = {}) {
  const err = await ff(['-i', file, '-vn', '-af', `silencedetect=noise=${noise}dB:d=${min}`, '-f', 'null', '-']);
  const out = []; let s = null;
  for (const l of err.split('\n')) {
    const a = l.match(/silence_start: ([\d.]+)/); if (a) s = parseFloat(a[1]);
    const b = l.match(/silence_end: ([\d.]+)/); if (b && s != null) { out.push({ start: s, end: parseFloat(b[1]) }); s = null; }
  }
  return out;
}

async function loudness(file) {
  try {
    const err = await ff(['-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
    return { mean: parseFloat(err.match(/mean_volume: ([-\d.]+)/)?.[1]), max: parseFloat(err.match(/max_volume: ([-\d.]+)/)?.[1]) };
  } catch { return null; }
}

const frameAt = (file, t, out, w = 480) => ff(['-y', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', `scale=${w}:-2`, '-q:v', '3', out]);

/* ---------------- words → beats → roles ---------------- */

const CTA_RE = /(theo dõi|đăng ký|đăng kí|subscribe|follow|like|bấm|nhấn|link|liên hệ|inbox|nhắn tin|mua ngay|đặt hàng|đặt ngay|comment|bình luận|chia sẻ|share|ghé|truy cập|website|hotline|gọi ngay|order|shop now|buy|sign up|check out|tải app|download)/i;
const LIST_RE = /(thứ (nhất|hai|ba|tư|năm|sáu|bảy|tám|chín|mười)|số (một|hai|ba|bốn|năm|\d+)|top \d+|đầu tiên|tiếp theo|cuối cùng|first|second|third|next|finally|number \d+|#\d+|\b\d+\.)/i;
const QUESTION_RE = /\?|(tại sao|vì sao|bạn có biết|làm sao|làm thế nào|có phải|why|how|what if|did you know)/i;

export const ROLES = {
  hook: 'Mở đầu (hook)', setup: 'Đặt vấn đề', item: 'Ý / mục liệt kê', body: 'Nội dung', proof: 'Minh chứng', payoff: 'Cao trào / kết luận', cta: 'Kêu gọi hành động', outro: 'Kết',
};

function wordsOf(tr) { return (tr?.segments || []).flatMap((s) => (s.words?.length ? s.words : [{ start: s.start, end: s.end, word: s.text }])); }
const textIn = (words, a, b) => words.filter((w) => (w.start + w.end) / 2 >= a && (w.start + w.end) / 2 < b).map((w) => w.word.trim()).join(' ').replace(/\s+([,.!?…:;])/g, '$1').trim();

/** Beats = spoken sentences (Whisper segments, tiny ones merged); without speech, groups of shots. */
function buildBeats(tr, shots, duration) {
  const segs = (tr?.segments || []).filter((s) => s.text?.trim());
  let beats;
  if (segs.length) {
    beats = [];
    for (const s of segs) {
      const last = beats[beats.length - 1];
      if (last && (s.start - last.end < 0.35 && last.end - last.start < 1.6)) { last.end = s.end; last.text += ` ${s.text.trim()}`; } else beats.push({ start: s.start, end: s.end, text: s.text.trim() });
    }
    // beats cover the whole video: gaps go to the following beat, the tail to the last one
    beats[0].start = 0;
    for (let i = 1; i < beats.length; i++) beats[i].start = beats[i - 1].end = r2((beats[i - 1].end + beats[i].start) / 2);
    beats[beats.length - 1].end = duration;
  } else {
    const per = Math.max(1, Math.ceil(shots.length / 6));
    beats = [];
    for (let i = 0; i < shots.length; i += per) beats.push({ start: shots[i].start, end: shots[Math.min(shots.length, i + per) - 1].end, text: '' });
  }
  let item = 0;
  beats.forEach((b, i) => {
    const pos = b.start / duration;
    b.role = i === 0 ? 'hook'
      : i === beats.length - 1 ? (CTA_RE.test(b.text) ? 'cta' : 'outro')
        : CTA_RE.test(b.text) && pos > 0.7 ? 'cta'
          : LIST_RE.test(b.text) ? 'item'
            : i === 1 && QUESTION_RE.test(beats[0].text + b.text) ? 'setup'
              : pos > 0.75 ? 'payoff' : 'body';
    if (b.role === 'item') b.n = ++item;
    b.i = i + 1; b.start = r2(b.start); b.end = r2(b.end); b.dur = r2(b.end - b.start);
    b.question = QUESTION_RE.test(b.text);
  });
  return beats;
}

/* ---------------- analysis ---------------- */

/**
 * Full analysis of templates/<id>/reference/source.*. onStage(label, progress 0..1).
 * opts: lang ('vi' | 'en' | … | undefined = auto), model (whisper size).
 */
export async function analyze(id, { lang, model = process.env.WHISPER_MODEL || 'small', onStage = () => {} } = {}) {
  const dir = dirOf(id);
  const meta = readJson(path.join(dir, 'reference.json'));
  const file = path.join(dir, meta.file);
  const refDir = path.join(dir, 'reference');
  onStage('đọc thông tin video', 0.03);
  const info = await probe(file);
  if (info.type !== 'video') throw new Error('Tệp này không phải video');
  const duration = info.duration || 0;
  if (duration < 1) throw new Error('Video quá ngắn để phân tích');

  onStage('tìm điểm cắt cảnh', 0.08);
  const shots = await detectShots(file, duration);

  let tr = null, trError = null;
  if (info.hasAudio !== false) {
    onStage(`chép lời (Whisper ${model}, CPU)`, 0.2);
    try { tr = await transcribe({ id: `ref_${id}`, path: posix(path.relative(WORKSPACE, file)) }, { lang, model }); } catch (e) { trError = e.message; }
  }
  const words = wordsOf(tr);

  onStage('khoảng lặng & âm lượng', 0.55);
  const [sil, loud] = await Promise.all([silences(file).catch(() => []), loudness(file)]);

  onStage('lấy khung hình từng cảnh', 0.6);
  for (const d of ['frames', 'overview']) { fs.rmSync(path.join(refDir, d), { recursive: true, force: true }); fs.mkdirSync(path.join(refDir, d), { recursive: true }); }
  for (const s of shots) {
    s.frame = `reference/frames/shot_${String(s.i).padStart(3, '0')}.jpg`;
    await frameAt(file, Math.min(duration - 0.05, s.start + s.dur / 2), path.join(dir, s.frame));
  }
  const nOver = Math.min(24, Math.max(8, Math.round(duration)));
  await ff(['-y', '-i', file, '-vf', `fps=${nOver}/${duration.toFixed(3)},scale=360:-2`, '-q:v', '4', path.join(refDir, 'overview', 'o_%03d.jpg')]);
  const overview = fs.readdirSync(path.join(refDir, 'overview')).sort().map((f, k) => ({ img: path.join(refDir, 'overview', f), t: r2((k + 0.5) * duration / nOver) }));

  onStage('bảng màu', 0.75);
  const pal = JSON.parse(await py(['palette', ...shots.map((s) => path.join(dir, s.frame))]));
  for (const s of shots) Object.assign(s, pal[path.join(dir, s.frame)] || {});

  const beats = buildBeats(tr, shots, duration);
  const overlap = (s, b) => Math.max(0, Math.min(s.end, b.end) - Math.max(s.start, b.start));
  for (const s of shots) {
    s.text = textIn(words, s.start, s.end);
    const b = beats.reduce((best, x) => (overlap(s, x) > overlap(s, best) ? x : best), beats[0]);
    s.beat = b.i; s.role = b.role;
  }
  // pictures on screen during each beat (a long talking-head shot spans several beats)
  for (const b of beats) b.shots = shots.filter((s) => overlap(s, b) >= Math.min(0.3, b.dur / 2)).map((s) => s.i);
  // cuts that land inside a beat (= picture changes while that sentence is spoken)
  for (const b of beats) b.cuts = shots.filter((s) => s.start > b.start + 0.05 && s.start < b.end - 0.05).length;

  // speech statistics
  const speech = words.length ? words.reduce((a, w) => a + Math.max(0, w.end - w.start), 0) : 0;
  const silentTotal = sil.reduce((a, s) => a + (Math.min(s.end, duration) - s.start), 0);
  const stats = {
    duration: r2(duration), width: info.width, height: info.height, fps: info.fps, hasAudio: info.hasAudio !== false,
    shots: shots.length, cutsPerMin: r2((shots.length - 1) / (duration / 60)), avgShot: r2(duration / shots.length),
    firstCut: shots[1]?.start ?? null, shortestShot: Math.min(...shots.map((s) => s.dur)), longestShot: Math.max(...shots.map((s) => s.dur)),
    words: words.length, wordsPerMin: words.length ? Math.round(words.length / (duration / 60)) : 0,
    speechCoverage: r2(Math.min(1, speech / duration)), silence: r2(silentTotal / duration),
    language: tr?.language || null, loudness: loud,
    hookEnd: beats[0]?.end ?? null, beats: beats.length,
    brightness: r2(shots.reduce((a, s) => a + (s.luma || 0) * s.dur, 0) / duration),
    saturation: r2(shots.reduce((a, s) => a + (s.sat || 0) * s.dur, 0) / duration),
  };
  stats.orientation = info.height > info.width ? 'dọc' : info.height === info.width ? 'vuông' : 'ngang';
  stats.audioKind = !stats.hasAudio ? 'không có tiếng' : stats.words >= duration * 0.8 ? 'lời nói là chính' : stats.silence > 0.6 ? 'gần như im lặng' : 'nhạc / âm thanh, ít lời';

  onStage('ghép bảng khung hình', 0.85);
  const sheets = [];
  for (let k = 0; k < shots.length; k += 24) {
    const page = shots.slice(k, k + 24);
    const spec = path.join(refDir, `sheet-${k}.json`);
    writeJson(spec, {
      cols: stats.orientation === 'dọc' ? 6 : 4, cell: stats.orientation === 'dọc' ? 240 : 360,
      title: `${meta.name} · cảnh ${page[0].i}–${page[page.length - 1].i} / ${shots.length}`,
      items: page.map((s) => ({ img: path.join(dir, s.frame), label: `#${s.i} ${fmt(s.start)} · ${s.dur}s · ${ROLES[s.role]}`, text: s.text, colors: s.colors })),
    });
    const out = `reference/sheet-shots-${sheets.length + 1}.jpg`;
    await py(['sheet', spec, path.join(dir, out)]);
    fs.rmSync(spec, { force: true });
    sheets.push(out);
  }
  const ospec = path.join(refDir, 'sheet-overview.json');
  writeJson(ospec, {
    cols: stats.orientation === 'dọc' ? 6 : 4, cell: stats.orientation === 'dọc' ? 220 : 320, title: `${meta.name} · ${nOver} khung đều nhau`,
    items: overview.map((o) => ({ img: o.img, label: fmt(o.t), text: textIn(words, o.t - duration / nOver / 2, o.t + duration / nOver / 2) })),
  });
  await py(['sheet', ospec, path.join(refDir, 'sheet-overview.jpg')]);
  fs.rmSync(ospec, { force: true });

  const analysis = {
    id, name: meta.name, source: meta.file, analyzedAt: Date.now(), model, lang: lang || null, transcriptError: trError,
    stats, beats, shots, silences: sil.map((s) => ({ start: r2(s.start), end: r2(s.end) })),
    transcript: (tr?.segments || []).map((s) => ({ start: s.start, end: s.end, text: s.text })),
    words: words.map((w) => ({ start: w.start, end: w.end, word: w.word.trim() })),
    sheets: { shots: sheets, overview: 'reference/sheet-overview.jpg' },
  };
  writeJson(path.join(dir, 'analysis.json'), analysis);
  writeDocs(dir, analysis);
  onStage('xong', 1);
  return analysis;
}

/* ---------------- written account (for people and for Claude) ---------------- */

/** Colours weighted by screen time and rank inside each shot's palette. */
function paletteSummary(shots) {
  const w = new Map();
  for (const s of shots) (s.colors || []).forEach((c, k) => w.set(c, (w.get(c) || 0) + s.dur * (5 - k)));
  return [...w.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => c);
}

function pacingWords(st) {
  const p = st.avgShot < 1.5 ? 'rất nhanh (cắt liên tục, kiểu TikTok/Reels)' : st.avgShot < 3 ? 'nhanh' : st.avgShot < 6 ? 'vừa' : 'chậm, ít cắt';
  const t = !st.words ? '' : st.wordsPerMin > 190 ? ', nói rất nhanh' : st.wordsPerMin > 150 ? ', nói nhanh' : st.wordsPerMin > 110 ? ', nói tự nhiên' : ', nói chậm';
  return p + t;
}

export function writeDocs(dir, a) {
  const st = a.stats;
  const pal = paletteSummary(a.shots);
  const lines = [
    `# Phân tích video mẫu: ${a.name}`, '',
    `> Tạo tự động bởi AI Video Studio (ffmpeg + faster-whisper + Pillow, chạy CPU). Số đo là **dữ kiện**; vai trò từng đoạn là **suy đoán** theo vị trí và từ khoá — Claude/người dùng nên đọc lại các bảng khung hình và sửa phần diễn giải.`, '',
    '## Tổng quan', '',
    '| | |', '|---|---|',
    `| Thời lượng | ${st.duration}s · ${st.width}×${st.height} (${st.orientation}) · ${st.fps || '?'} fps |`,
    `| Nhịp cắt | ${st.shots} cảnh, trung bình ${st.avgShot}s/cảnh, ${st.cutsPerMin} lần cắt/phút — ${pacingWords(st)} |`,
    `| Cảnh đầu | cắt lần đầu ở ${st.firstCut ?? '—'}s; cảnh ngắn nhất ${st.shortestShot}s, dài nhất ${st.longestShot}s |`,
    `| Âm thanh | ${st.audioKind}${st.words ? `; ${st.words} từ, ${st.wordsPerMin} từ/phút, lời phủ ${Math.round(st.speechCoverage * 100)}% thời lượng` : ''}${st.language ? `; ngôn ngữ ${st.language}` : ''} |`,
    `| Âm lượng | ${st.loudness?.mean != null ? `trung bình ${st.loudness.mean} dB, đỉnh ${st.loudness.max} dB` : '—'}; khoảng lặng ${Math.round(st.silence * 100)}% |`,
    `| Hình ảnh | độ sáng ${Math.round(st.brightness * 100)}%, độ bão hoà ${Math.round(st.saturation * 100)}%; màu chủ đạo ${pal.map((c) => `\`${c}\``).join(' ')} |`,
    `| Hook | ${st.hookEnd}s đầu (${Math.round((st.hookEnd / st.duration) * 100)}% video) |`,
    '',
    '## Luồng nội dung', '',
    'Mỗi nhịp (beat) là một câu nói (hoặc một nhóm cảnh nếu video không có lời). Thời gian neo theo **lời nói**: khi thay nội dung, giữ thứ tự và tỉ lệ các nhịp, để thời lượng mới theo giọng đọc mới.', '',
    '| # | Thời gian | Tỉ lệ | Vai trò | Cảnh | Lời |', '|---|---|---|---|---|---|',
    ...a.beats.map((b) => `| ${b.i} | ${b.start}–${b.end}s | ${Math.round((b.dur / st.duration) * 100)}% | ${ROLES[b.role]}${b.n ? ` ${b.n}` : ''} | ${b.shots.length ? `#${b.shots.join(', #')}` : '—'} | ${b.text.replace(/\|/g, '/') || '_(không lời)_'} |`),
    '',
    '## Vì sao video này hiệu quả (giả thuyết ban đầu)', '',
    `- **Mở đầu:** ${a.beats[0]?.question ? 'đặt câu hỏi ngay câu đầu để giữ người xem' : 'vào thẳng nội dung'}; hook dài ${st.hookEnd}s${st.firstCut != null && st.firstCut < 2 ? `, cắt cảnh đầu tiên rất sớm (${st.firstCut}s) để tạo nhịp` : ''}.`,
    `- **Thân bài:** ${a.beats.filter((b) => b.role === 'item').length ? `${a.beats.filter((b) => b.role === 'item').length} mục liệt kê nối tiếp — cấu trúc danh sách dễ theo dõi` : `${a.beats.filter((b) => ['body', 'setup', 'payoff'].includes(b.role)).length} nhịp nội dung`}; trung bình ${(a.beats.reduce((x, b) => x + b.shots.length, 0) / Math.max(1, a.beats.length)).toFixed(1)} cảnh mỗi nhịp.`,
    `- **Kết:** ${a.beats.some((b) => b.role === 'cta') ? 'có lời kêu gọi hành động rõ ràng' : 'không có lời kêu gọi hành động rõ — có thể thêm CTA khi làm bản mới'}.`,
    '',
    '## Cần xem kỹ thêm (Claude làm tiếp)', '',
    `Đọc các bảng khung hình (${[...a.sheets.shots, a.sheets.overview].map((s) => `\`${s}\``).join(', ')}) và bổ sung:`,
    '- Chữ trên màn hình: phụ đề (vị trí, cỡ, màu, kiểu nhấn từ), tiêu đề, nhãn, số liệu — xuất hiện / biến mất lúc nào so với lời.',
    '- Ai/cái gì trên hình: người nói (A-roll) hay hình minh hoạ (B-roll), sản phẩm, màn hình app…',
    '- Hiệu ứng: chuyển cảnh, zoom, rung, sticker, emoji, âm thanh nhấn (whoosh, ding), nhạc nền.',
    '- Hệ thống lặp lại suốt video (khung, logo, thanh tiến trình, kiểu phụ đề) — mô tả một lần, ghi những lúc nó đổi.',
    `- Dùng \`node ../tools/vedit.mjs frames\`/\`frame\` trên \`templates/${a.id}/${a.source}\` khi cần xem dày hơn một đoạn.`,
    '',
    a.transcriptError ? `> Chép lời lỗi: ${a.transcriptError}\n` : '',
    '## Lời thoại đầy đủ', '',
    ...(a.transcript.length ? a.transcript.map((s) => `- \`${fmt(s.start)}\` ${s.text}`) : ['_(không có lời nói)_']),
    '',
  ];
  fs.writeFileSync(path.join(dir, 'ANALYSIS.md'), lines.join('\n'));

  const tl = [`# Timeline: ${a.name}`, '', 'Từng nhịp theo thời gian video gốc. Mỗi cảnh: thời gian, khung hình đại diện, màu chủ đạo, lời nói trong cảnh.', ''];
  for (const b of a.beats) {
    tl.push(`## ${b.start}–${b.end}s · ${ROLES[b.role]}${b.n ? ` ${b.n}` : ''}`, '');
    if (b.text) tl.push(`> ${b.text}`, '');
    for (const i of b.shots) {
      const s = a.shots[i - 1];
      tl.push(`- **Cảnh ${s.i}** ${s.start}–${s.end}s (${s.dur}s) · \`${s.frame}\` · màu ${(s.colors || []).slice(0, 3).join(' ')} · sáng ${Math.round((s.luma || 0) * 100)}%${s.text ? ` — “${s.text}”` : ''}`);
    }
    tl.push('');
  }
  fs.writeFileSync(path.join(dir, 'TIMELINE.md'), tl.join('\n'));
}

export function readAnalysis(id) {
  const f = path.join(dirOf(id), 'analysis.json');
  if (!fs.existsSync(f)) throw Object.assign(new Error('Chưa có kết quả phân tích'), { status: 404 });
  return readJson(f);
}

/* ---------------- template ---------------- */

/** Subtitle cues from words: ≤ maxWords words / ≤ maxChars chars, break on pauses and punctuation. */
function cuesFromWords(words, { maxWords = 7, maxChars = 38 } = {}) {
  const cues = []; let cur = null;
  for (const w of words) {
    const t = w.word.trim(); if (!t) continue;
    if (cur && (cur.n >= maxWords || (cur.text + ' ' + t).length > maxChars || w.start - cur.end > 0.6 || /[.!?…]$/.test(cur.text))) { cues.push(cur); cur = null; }
    if (!cur) cur = { start: w.start, end: w.end, text: t, n: 1 };
    else { cur.end = w.end; cur.text += ` ${t}`; cur.n++; }
  }
  if (cur) cues.push(cur);
  return cues.map(({ start, end, text }) => ({ start: r2(start), end: r2(end), text: text.replace(/\s+([,.!?…:;])/g, '$1') }));
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Save the analysed reference as a user template.
 * edits: { name, desc, roles: { <beatIndex>: role }, notes: { <beatIndex>: text }, keepFrames: true }
 */
export function saveTemplate(id, edits = {}) {
  const dir = dirOf(id);
  const a = readAnalysis(id);
  for (const b of a.beats) {
    const r = edits.roles?.[b.i]; if (r && ROLES[r]) b.role = r;
    const n = edits.notes?.[b.i]; if (typeof n === 'string') b.note = n.trim().slice(0, 500);
  }
  for (const s of a.shots) s.role = a.beats.find((b) => b.i === s.beat)?.role || s.role;
  writeJson(path.join(dir, 'analysis.json'), a);
  writeDocs(dir, a);

  const st = a.stats;
  const name = String(edits.name || a.name).trim().slice(0, 80) || a.name;
  const desc = String(edits.desc || '').trim().slice(0, 300)
    || `${st.duration}s ${st.orientation}, ${st.shots} cảnh (${pacingWords(st)}), ${a.beats.length} nhịp: ${[...new Set(a.beats.map((b) => ROLES[b.role]))].join(' → ')}.`;
  const W = even(st.width), H = even(st.height);
  // shown size in the gallery: snap to the app's standard sizes when the ratio matches
  const ratio = W / H;
  const size = Math.abs(ratio - 9 / 16) < 0.03 ? '1080x1920' : Math.abs(ratio - 16 / 9) < 0.03 ? '1920x1080' : Math.abs(ratio - 1) < 0.03 ? '1080x1080' : `${W}x${H}`;
  const [SW, SH] = size.split('x').map(Number);

  // poster: the hook's first shot
  fs.copyFileSync(path.join(dir, a.shots[0].frame), path.join(dir, 'poster.jpg'));

  // skeleton project: one placeholder per shot (the reference frame), subtitles = original words, timings kept
  const sk = path.join(dir, 'skeleton');
  fs.rmSync(sk, { recursive: true, force: true });
  fs.mkdirSync(path.join(sk, 'media'), { recursive: true });
  const keep = edits.keepFrames !== false;
  const assets = [], main = [];
  for (const s of a.shots) {
    const label = `Cảnh ${s.i} · ${ROLES[s.role]}`;
    if (keep) {
      const fname = `mau_canh_${String(s.i).padStart(3, '0')}.jpg`;
      fs.copyFileSync(path.join(dir, s.frame), path.join(sk, 'media', fname));
      const aid = `img_tpl${String(s.i).padStart(3, '0')}`;
      assets.push({ id: aid, name: `${label} (thay bằng hình của bạn).jpg`, path: `media/${fname}`, type: 'image', width: 480, height: Math.round(480 * st.height / st.width) });
      main.push({ id: `c_tpl${String(s.i).padStart(3, '0')}`, kind: 'image', assetId: aid, duration: s.dur, fit: 'cover', name: label });
    } else {
      main.push({ id: `c_tpl${String(s.i).padStart(3, '0')}`, kind: 'solid', color: s.colors?.[0] || '#222222', duration: s.dur, name: label });
    }
  }
  const project = {
    name, settings: { width: SW, height: SH, fps: 30, background: '#000000' }, assets,
    tracks: [
      { id: 'main', name: 'Main', type: 'sequence', clips: main },
      { id: 'overlay', name: 'Text & Overlay', type: 'overlay', clips: [] },
      { id: 'music', name: 'Music', type: 'audio', clips: [] },
      { id: 'voice', name: 'Giọng đọc', type: 'audio', clips: [] },
    ],
    subtitles: { enabled: a.words.length > 0, style: { fontSize: Math.round(Math.min(SW, SH) / 20), color: '#ffffff', background: 'rgba(0,0,0,.55)', position: 0.8 }, cues: cuesFromWords(a.words) },
    template: { id, name },
  };
  writeJson(path.join(sk, 'project.json'), project);

  const tpl = {
    id, name, desc, size, duration: st.duration, shots: st.shots, beats: a.beats.length, createdAt: readJson(path.join(dir, 'reference.json')).createdAt, savedAt: Date.now(),
    flow: a.beats.map((b) => ({ i: b.i, role: b.role, label: ROLES[b.role], share: r2(b.dur / st.duration), dur: b.dur, shots: b.shots.length, words: b.text.split(/\s+/).filter(Boolean).length, sample: b.text, note: b.note || '' })),
    pacing: { avgShot: st.avgShot, cutsPerMin: st.cutsPerMin, wordsPerMin: st.wordsPerMin, hookEnd: st.hookEnd, firstCut: st.firstCut },
    palette: paletteSummary(a.shots), language: st.language, audioKind: st.audioKind,
  };
  writeJson(path.join(dir, 'template.json'), tpl);
  fs.writeFileSync(path.join(dir, 'TEMPLATE.md'), templateRecipe(tpl, a));
  return tpl;
}

/** The recipe Claude follows to make a NEW video in this template's flow. */
function templateRecipe(t, a) {
  const st = a.stats;
  return [
    `# Template: ${t.name}`, '',
    `Template tự tạo từ video mẫu \`templates/${t.id}/${a.source}\`. Phân tích đầy đủ: \`templates/${t.id}/ANALYSIS.md\`, \`TIMELINE.md\`, bảng khung hình \`templates/${t.id}/reference/sheet-*.jpg\` (**Read các JPG này** để thấy bố cục, chữ trên hình, màu).`, '',
    '## Giữ nguyên (đây là "công thức")', '',
    `- Khung ${t.size} (${st.orientation}), tổng ~${Math.round(st.duration)}s (được co giãn theo lời mới, lệch tối đa ±30%).`,
    `- Thứ tự và tỉ lệ các nhịp bên dưới. Hook ≤ ${Math.max(1.5, st.hookEnd).toFixed(1)}s, ${a.beats[0]?.question ? 'mở bằng một câu hỏi' : 'mở thẳng vào điểm hấp dẫn nhất'}.`,
    `- Nhịp cắt: trung bình ${st.avgShot}s/cảnh (~${st.cutsPerMin} lần cắt/phút)${st.firstCut != null ? `, cắt lần đầu ở ~${st.firstCut}s` : ''}. Cắt theo **lời** (đầu cụm từ / từ khoá), không theo giây cố định.`,
    st.words ? `- Tốc độ lời ~${st.wordsPerMin} từ/phút; phụ đề ngắn ≤ 7 từ/dòng, khớp từng từ.` : '- Video gốc không có lời: kể bằng hình, chữ trên màn hình và nhạc.',
    `- Màu chủ đạo: ${t.palette.map((c) => `\`${c}\``).join(' ')} (dùng cho chữ, khung, nền đồ hoạ nếu hợp thương hiệu).`,
    '',
    '## Luồng (thay nội dung, giữ vai trò)', '',
    '| # | Vai trò | Tỉ lệ | Số cảnh | Số từ mẫu | Lời mẫu (chỉ để tham khảo cách nói) | Ghi chú |', '|---|---|---|---|---|---|---|',
    ...t.flow.map((b) => `| ${b.i} | ${b.label} | ${Math.round(b.share * 100)}% | ${b.shots} | ${b.words} | ${(b.sample || '—').replace(/\|/g, '/')} | ${(b.note || '').replace(/\|/g, '/')} |`),
    '',
    '## Cách dựng video mới', '',
    '1. Viết lời mới theo đúng số nhịp và vai trò ở bảng trên (độ dài mỗi nhịp ≈ số từ mẫu). Không chép lời mẫu — chỉ giữ cấu trúc.',
    '2. Tạo giọng đọc từng nhịp (`vedit tts`), đặt nối tiếp trên track `voice`; thời lượng thật của giọng đọc quyết định thời gian các cảnh.',
    '3. Mỗi nhịp dùng đúng số cảnh như mẫu: ảnh/video người dùng tải lên, ảnh minh hoạ (`vedit images`), hoặc component đồ hoạ trong `custom/`. Cảnh đổi ở đầu cụm từ quan trọng.',
    '4. Chữ trên màn hình / phụ đề / hiệu ứng theo mô tả trong ANALYSIS.md (đọc thêm bảng khung hình nếu ANALYSIS chưa ghi).',
    '5. Nhịp kêu gọi hành động (nếu có) thay bằng CTA của người dùng.',
    '6. `vedit subtitles` sau khi xong lời; `vedit still` vài thời điểm để tự kiểm tra; không render trừ khi được yêu cầu.',
    '',
    'Bắt đầu nhanh: nút "Tạo dự án từ khung mẫu" tạo sẵn dự án có đủ cảnh (ảnh khung hình mẫu làm chỗ giữ chỗ, đặt tên "Cảnh N · vai trò") và phụ đề lời mẫu — thay dần từng cảnh và lời.',
    '',
  ].join('\n');
}

export function listTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) return [];
  return fs.readdirSync(TEMPLATES_DIR).filter((d) => ID_RE.test(d) && fs.existsSync(path.join(TEMPLATES_DIR, d, 'template.json')))
    .map((d) => { try { return { ...readJson(path.join(TEMPLATES_DIR, d, 'template.json')), poster: `/templates/${d}/poster.jpg` }; } catch { return null; } })
    .filter(Boolean).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

export function deleteTemplate(id) {
  const dir = dirOf(id);
  if (!fs.existsSync(dir)) throw Object.assign(new Error('Không có template này'), { status: 404 });
  const trash = path.join(TEMPLATES_DIR, '.trash');
  fs.mkdirSync(trash, { recursive: true });
  fs.renameSync(dir, path.join(trash, `${id}-${Date.now()}`));
}

/** Skeleton folder for projects.fromDemo(). */
export function skeletonDir(id) {
  const d = path.join(dirOf(id), 'skeleton');
  if (!fs.existsSync(path.join(d, 'project.json'))) throw Object.assign(new Error('Template chưa được lưu'), { status: 404 });
  return d;
}

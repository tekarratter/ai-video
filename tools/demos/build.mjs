#!/usr/bin/env node
// Builds the demo projects shown in the home-screen template gallery:
//   demos/<id>/project.json + media/   → "Dùng mẫu này" copies it into a new project
//   web/public/demos/<id>.mp4 / .jpg  → preview video + poster on the template card
// Usage: node tools/demos/build.mjs [id…] [--no-render] [--render-only]
// Sources (CC photos, Big Buck Bunny, Incompetech music) are listed in sources.json with their attributions.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, CACHE_DIR, probe } from '../../shared/store.mjs';
import { synthesize } from '../../shared/tts.mjs';
import { trackById } from '../../shared/library.mjs';
import { layoutTrack, projectDuration } from '../../shared/timeline.js';

const exec = promisify(execFile);
const SRC = JSON.parse(fs.readFileSync(new URL('./sources.json', import.meta.url), 'utf8'));
const DEMOS = path.join(ROOT, 'demos');
const PUBLIC = path.join(ROOT, 'web', 'public', 'demos');
const DL = path.join(CACHE_DIR, 'demo-src');
const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('--'));
const NO_RENDER = args.includes('--no-render'), RENDER_ONLY = args.includes('--render-only');
const ff = (a) => exec('ffmpeg', ['-v', 'error', '-y', ...a], { maxBuffer: 1 << 26 });
const h8 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const UA = { 'user-agent': 'Mozilla/5.0 (ai-video demo builder)' };

async function download(url, file) {
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  fs.writeFileSync(`${file}.part`, Buffer.from(await r.arrayBuffer()));
  fs.renameSync(`${file}.part`, file);
  return file;
}

/** One demo project being built. */
class Demo {
  constructor(id, name, w, h) {
    this.id = id; this.dir = path.join(DEMOS, id); this.media = path.join(this.dir, 'media');
    this.p = {
      name, settings: { width: w, height: h, fps: 30, background: '#000000' }, assets: [],
      tracks: [
        { id: 'main', name: 'Main', type: 'sequence', clips: [] },
        { id: 'overlay', name: 'Text & Overlay', type: 'overlay', clips: [] },
        { id: 'music', name: 'Music', type: 'audio', clips: [] },
        { id: 'voice', name: 'Giọng đọc', type: 'audio', clips: [] },
      ],
      subtitles: { enabled: false, style: { fontSize: Math.round(Math.min(w, h) / 22), color: '#ffffff', background: 'rgba(0,0,0,.55)', position: 0.86 }, cues: [] },
      demo: id,
    };
    fs.mkdirSync(this.media, { recursive: true });
    this.n = 0;
  }
  track(id) { return this.p.tracks.find((t) => t.id === id); }
  cid() { return `c_${this.id.replace(/\W/g, '').slice(0, 6)}${String(++this.n).padStart(3, '0')}`; }
  addAsset(a) { if (!this.p.assets.some((x) => x.id === a.id)) this.p.assets.push(a); return a; }

  /** CC photo from sources.json → media/<key>.jpg (≤1600 px). */
  async image(key) {
    const s = SRC.images[key];
    const out = path.join(this.media, `${key}.jpg`);
    if (!fs.existsSync(out)) {
      const raw = await download(s.url, path.join(DL, `${key}${path.extname(new URL(s.url).pathname) || '.jpg'}`));
      await ff(['-i', raw, '-vf', "scale='min(1600,iw)':-2", '-q:v', '3', out]);
    }
    const info = await probe(out);
    return this.addAsset({ id: `img_${key}`, name: `${key}.jpg`, path: `media/${key}.jpg`, type: 'image', width: info.width, height: info.height, source: s.page || s.url, attribution: `Ảnh: ${s.attribution}` });
  }
  /** Path for components' image props. */
  src(key) { return `/media/${key}.jpg`; }

  /** Voice line (TTS, cached) → media/v_<hash>.m4a, placed on the voice track at `start`. */
  async voice(text, voice, start, { speed = 1 } = {}) {
    const key = h8(`${text}|${voice}|${speed}`);
    const out = path.join(this.media, `v_${key}.m4a`);
    if (!fs.existsSync(out)) {
      process.stderr.write(`  tts ${voice}: ${text.slice(0, 50)}…\n`);
      const wav = await synthesize({ text, voice, speed });
      await ff(['-i', wav, '-c:a', 'aac', '-b:a', '80k', out]);
    }
    const info = await probe(out);
    const a = this.addAsset({ id: `aud_${key}`, name: `v_${key}.m4a`, path: `media/v_${key}.m4a`, type: 'audio', duration: info.duration, tts: { text, voice, speed } });
    this.track('voice').clips.push({ id: this.cid(), name: a.name, assetId: a.id, start: +start.toFixed(2), in: 0, out: a.duration, volume: 1 });
    return { start, end: start + a.duration, dur: a.duration, text };
  }
  /** Lines read one after another (gap s), first at `lead`. */
  async lines(list, voice, { lead = 0.4, gap = 0.35 } = {}) {
    const out = []; let t = lead;
    for (const l of list) { const v = await this.voice(typeof l === 'string' ? l : l.text, (typeof l === 'object' && l.voice) || voice, t); out.push(v); t = v.end + gap; }
    return out;
  }
  /** Incompetech track trimmed to `dur` with fades. */
  async music(trackId, dur, { volume = 0.18, start = 0 } = {}) {
    const t = await trackById(trackId);
    if (!t) throw new Error(`music ${trackId} not found`);
    const raw = await download(t.url, path.join(DL, `music_${h8(trackId)}.mp3`));
    const name = `music_${h8(trackId)}_${Math.round(dur)}.m4a`;
    const out = path.join(this.media, name);
    if (!fs.existsSync(out)) await ff(['-ss', String(start), '-i', raw, '-t', String(dur), '-af', `afade=t=in:d=0.5,afade=t=out:st=${Math.max(0, dur - 1.8)}:d=1.8`, '-c:a', 'aac', '-b:a', '96k', out]);
    const info = await probe(out);
    const a = this.addAsset({ id: `aud_m${h8(trackId)}`, name, path: `media/${name}`, type: 'audio', duration: info.duration, libraryId: trackId, attribution: t.attribution });
    this.track('music').clips.push({ id: this.cid(), name: t.title, assetId: a.id, start: 0, in: 0, out: a.duration, volume });
  }
  /** Big Buck Bunny clip (CC BY). */
  async video(key) {
    const s = SRC.video[key];
    const out = path.join(this.media, `${key}.mp4`);
    if (!fs.existsSync(out)) await ff(['-ss', String(s.start), '-i', s.url, '-t', String(s.duration), '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out]);
    const info = await probe(out);
    return this.addAsset({ id: `vid_${key}`, name: `${key}.mp4`, path: `media/${key}.mp4`, ...info, type: 'video', attribution: s.attribution });
  }
  main(clip) { const c = { id: this.cid(), ...clip }; this.track('main').clips.push(c); return c; }
  over(clip) { const c = { id: this.cid(), ...clip }; this.track('overlay').clips.push(c); return c; }
  /** Subtitle cues from voice lines (split ≤ max chars, timed by length). */
  subs(vs, { max = 42, text } = {}) {
    this.p.subtitles.enabled = true;
    vs.forEach((v, i) => {
      const words = String(text ? text[i] : v.text).split(/\s+/); const chunks = []; let cur = '';
      for (const w of words) { if (cur && (cur + ' ' + w).length > max) { chunks.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; }
      if (cur) chunks.push(cur);
      const total = chunks.reduce((n, c) => n + c.length, 0); let t = v.start;
      for (const c of chunks) { const d = v.dur * (c.length / total); this.p.subtitles.cues.push({ start: +t.toFixed(2), end: +(t + d).toFixed(2), text: c }); t += d; }
    });
  }
  /** Scene durations so each scene starts with its voice line (transition `tr` overlaps the next). */
  spans(vs, { lead = 0.4, tail = 1.2, tr = 0 } = {}) {
    return vs.map((v, i) => {
      const next = vs[i + 1]?.start ?? v.end + tail;
      const from = i === 0 ? 0 : v.start;
      return +(next - from + (i < vs.length - 1 ? tr : 0)).toFixed(2);
    });
  }
  save() {
    fs.writeFileSync(path.join(this.dir, 'project.json'), JSON.stringify(this.p, null, 1));
    // drop media no longer referenced (re-runs with changed text)
    const used = new Set(this.p.assets.map((a) => path.basename(a.path)));
    for (const f of fs.readdirSync(this.media)) if (!used.has(f)) fs.rmSync(path.join(this.media, f));
    return this;
  }
}

const KB = ['zoom-in', 'pan-left', 'zoom-out', 'pan-right', 'zoom-in-left', 'pan-up', 'zoom-in-right'];
const fade = (d = 0.5) => ({ type: 'fade', duration: d });

/* ---------------- the demos ---------------- */
const BUILDERS = {
  async cartoon3d() {
    const d = new Demo('cartoon3d', 'Demo · Hoạt hình 3D', 1920, 1080);
    const LAN = 'vi:Mai Anh', NAM = 'vi:Thiện Minh';
    const vs = await d.lines([
      { text: 'Nam ơi, sao bầu trời lại có màu xanh nhỉ?', voice: LAN },
      { text: 'Ánh nắng có đủ bảy màu. Khi đi qua không khí, ánh sáng xanh bị tán xạ mạnh hơn.', voice: NAM },
      { text: 'À, vậy ánh xanh tỏa khắp bầu trời, nên mình thấy trời màu xanh!', voice: LAN },
      { text: 'Đúng rồi! Hiện tượng đó gọi là tán xạ Rayleigh.', voice: NAM },
    ], '', { lead: 2.2, gap: 0.45 });
    const total = +(vs[3].end + 1.8).toFixed(2);
    const r = (x) => +x.toFixed(2);
    d.main({
      kind: 'component', component: 'CharacterStage', name: 'Lan & Nam', duration: total,
      props: {
        background: 'sky', names: true,
        cast: [
          { preset: 'be_gai', name: 'Lan', voiceName: LAN, x: 0.3, y: 0.8, size: 0.6, facing: 0.35, actions: [
            { start: 0, action: 'wave' }, { start: r(vs[0].start), action: 'think', expression: 'surprised' }, { start: r(vs[0].end), action: 'idle', expression: 'smile' },
            { start: r(vs[2].start), action: 'talk', expression: 'happy' }, { start: r(vs[2].end), action: 'clap' }, { start: r(vs[3].end), action: 'happy', expression: 'happy' }] },
          { preset: 'be_trai', name: 'Nam', voiceName: NAM, x: 1.15, y: 0.8, size: 0.6, facing: -0.35, actions: [
            { start: 0, action: 'walk', to: 0.7, end: 1.9 }, { start: 1.9, action: 'wave' }, { start: r(vs[0].start), action: 'idle' },
            { start: r(vs[1].start), action: 'talk' }, { start: r(vs[1].end), action: 'idle' }, { start: r(vs[2].end), action: 'nod' },
            { start: r(vs[3].start), action: 'point', expression: 'happy' }, { start: r(vs[3].end), action: 'happy', expression: 'happy' }] },
        ],
      },
    });
    d.over({ kind: 'component', component: 'NewsGradient', start: 0, duration: 2.1, props: { kicker: 'HOẠT HÌNH 3D', headline: 'Vì sao *bầu trời* màu xanh?', accent: '#38bdf8', bottom: 0.08 } });
    d.subs(vs); d.p.subtitles.style.position = 0.93;
    await d.music('inc:Carefree.mp3', total, { volume: 0.1 });
    d.p.demoPoster = 0.55;
    return d.save();
  },

  async 'news-60s'() {
    const d = new Demo('news-60s', 'Demo · Tin nóng 60s', 1080, 1920);
    const vs = await d.lines([
      'Vịnh Hạ Long ở Quảng Ninh là di sản thiên nhiên thế giới đầu tiên của Việt Nam.',
      'Năm 1994, UNESCO ghi danh vịnh vì vẻ đẹp cảnh quan ngoại hạng.',
      'Đến năm 2000, vịnh được công nhận lần thứ hai nhờ giá trị địa chất, địa mạo.',
      'Vịnh có gần hai nghìn hòn đảo đá vôi lớn nhỏ, phần lớn chưa có người ở.',
      'Theo UNESCO.',
    ], 'vi:Mai Anh');
    const sp = d.spans(vs, { tr: 0.4 });
    const imgs = ['halong1', 'halong3', 'halong2', 'halong4'];
    for (const k of imgs) await d.image(k);
    d.main({ kind: 'component', component: 'BreakingIntro', duration: sp[0], props: { label: 'TIN DU LỊCH', headline: 'Vịnh Hạ Long: *di sản thế giới* của Việt Nam', date: 'Bản tin mẫu', image: d.src('halong1'), channel: 'AI VIDEO NEWS' }, transition: fade(0.4) });
    const heads = [['DI SẢN', 'UNESCO ghi danh *năm 1994*'], ['ĐỊA CHẤT', 'Công nhận *lần hai* năm 2000'], ['CON SỐ', 'Gần *2.000* đảo đá vôi'], ['NGUỒN', 'Theo *UNESCO*']];
    for (let i = 1; i < vs.length; i++) {
      d.main({ kind: 'image', assetId: `img_${imgs[i % imgs.length]}`, duration: sp[i], fit: 'cover', kenBurns: { preset: KB[i], amount: 0.16 }, ...(i < vs.length - 1 ? { transition: fade(0.4) } : {}) });
      d.over({ kind: 'component', component: 'NewsGradient', start: +vs[i].start.toFixed(2), duration: +(vs[i].dur + 0.3).toFixed(2), props: { kicker: heads[i - 1][0], headline: heads[i - 1][1], accent: '#facc15', bottom: 0.2 } });
    }
    const total = projectDuration(d.p);
    d.over({ kind: 'component', component: 'NewsTicker', start: 0, duration: total, props: { label: 'TIN NÓNG', items: ['Vịnh Hạ Long được UNESCO ghi danh năm 1994', 'Công nhận lần hai năm 2000', 'Gần 2.000 đảo đá vôi', 'Bản tin mẫu của AI Video Studio'], clock: '24H' } });
    await d.music('inc:Hitman.mp3', total, { volume: 0.14 });
    return d.save();
  },

  async 'news-short'() {
    const d = new Demo('news-short', 'Demo · Tin ngắn 1/3 gradient', 1080, 1920);
    const vs = await d.lines([
      'Mỗi tối, phố cổ Hội An rực rỡ với những chiếc đèn lồng đủ màu sắc.',
      'Phố cổ Hội An được UNESCO công nhận là di sản văn hóa thế giới năm 1999.',
    ], 'vi:Mai Anh');
    const sp = d.spans(vs, { tr: 0.5, tail: 1.5 });
    for (const k of ['lantern1', 'lantern2', 'lantern3']) await d.image(k);
    d.main({ kind: 'image', assetId: 'img_lantern1', duration: sp[0], fit: 'cover', kenBurns: { preset: 'zoom-in', amount: 0.15 }, transition: fade() });
    d.main({ kind: 'image', assetId: 'img_lantern3', duration: sp[1], fit: 'cover', kenBurns: { preset: 'pan-left', amount: 0.18 } });
    d.over({ kind: 'component', component: 'NewsGradient', start: 0, duration: +projectDuration(d.p).toFixed(2), props: { kicker: 'DU LỊCH', headline: 'Phố cổ Hội An *lung linh* đèn lồng', sub: 'Tin mẫu · AI Video Studio', accent: '#f59e0b', bottom: 0.24 } });
    d.subs(vs); d.p.subtitles.style.position = 0.9;
    await d.music('inc:Carefree.mp3', projectDuration(d.p), { volume: 0.12 });
    return d.save();
  },

  async article() {
    const d = new Demo('article', 'Demo · Video từ bài viết', 1920, 1080);
    const vs = await d.lines([
      'Bánh mì Việt Nam là ổ bánh vỏ giòn, ruột mềm, kẹp pa tê, thịt, rau thơm và đồ chua.',
      'Bánh mì du nhập vào Việt Nam từ thời Pháp thuộc, rồi được người Việt biến tấu theo cách riêng.',
      'Năm 2011, từ bánh mì được đưa vào Từ điển tiếng Anh Oxford.',
      'Theo Wikipedia.',
    ], 'vi:Trúc Ly');
    const sp = d.spans(vs, { tr: 0.5 });
    const imgs = ['banhmi3', 'banhmi1', 'banhmi2', 'banhmi4'];
    for (const k of imgs) await d.image(k);
    vs.forEach((v, i) => d.main({ kind: 'image', assetId: `img_${imgs[i]}`, duration: sp[i], fit: 'cover', kenBurns: { preset: KB[i], amount: 0.15 }, ...(i < vs.length - 1 ? { transition: fade() } : {}) }));
    d.over({ kind: 'text', text: 'Bánh mì Việt Nam', start: 0.3, duration: 3.6, x: 0.5, y: 0.42, style: { fontSize: 110, color: '#ffffff', fontWeight: 900, shadow: '0 6px 30px rgba(0,0,0,.7)' }, animation: { in: 'pop', out: 'fade', duration: 0.6 } });
    d.over({ kind: 'text', text: 'Nguồn: Wikipedia', start: +vs[3].start.toFixed(2), duration: +(vs[3].dur + 1.2).toFixed(2), x: 0.04, y: 0.07, align: 'left', style: { fontSize: 30, color: '#ffffff', fontWeight: 600, background: 'rgba(0,0,0,.45)', align: 'left' }, animation: { in: 'fade', out: 'fade', duration: 0.3 } });
    d.subs(vs);
    await d.music('inc:Wholesome.mp3', projectDuration(d.p), { volume: 0.14 });
    return d.save();
  },

  async podcast() {
    const d = new Demo('podcast', 'Demo · Podcast 2 người', 1920, 1080);
    const A = 'vi:Mai Anh', B = 'vi:Thiện Minh';
    const vs = await d.lines([
      { text: 'Xin chào, mình là Thu Hà. Hôm nay mình cùng anh Minh Quân nói về chuyện uống nước.', voice: A },
      { text: 'Chào Hà. Nước chiếm hơn một nửa trọng lượng cơ thể, nên thiếu nước là mình thấy mệt ngay.', voice: B },
      { text: 'Vậy làm sao biết mình uống đủ chưa anh?', voice: A },
      { text: 'Mẹo đơn giản là uống rải rác cả ngày, đừng đợi khát mới uống.', voice: B },
    ], A, { gap: 0.3 });
    const total = +(vs.at(-1).end + 1.2).toFixed(2);
    d.main({ kind: 'component', component: 'PodcastStudio', duration: total, props: {
      title: 'SỐNG KHỎE MỖI NGÀY', episode: 'Tập mẫu · Uống nước sao cho đủ',
      hosts: [{ name: 'Thu Hà', role: 'Dẫn chương trình', color: '#38bdf8' }, { name: 'Minh Quân', role: 'Khách mời', color: '#f59e0b' }],
      turns: vs.map((v, i) => ({ speaker: i % 2, start: +v.start.toFixed(2), end: +v.end.toFixed(2), text: v.text })), caption: true,
    } });
    await d.music('inc:Airport Lounge.mp3', total, { volume: 0.1 });
    return d.save();
  },

  async dialogue() {
    const d = new Demo('dialogue', 'Demo · Hội thoại tình huống', 1080, 1920);
    const A = 'en:af_heart', B = 'en:am_michael';
    const lines = [
      ['Excuse me, is this the check-in counter for Hanoi?', A, 'Xin lỗi, đây có phải quầy làm thủ tục đi Hà Nội không?'],
      ['Yes, it is. May I see your passport, please?', B, 'Đúng rồi. Cho tôi xem hộ chiếu của bạn nhé?'],
      ['Here you are. Can I have a window seat?', A, 'Đây ạ. Cho tôi ghế cạnh cửa sổ được không?'],
      ['Sure. Here is your boarding pass. Have a nice flight!', B, 'Được chứ. Thẻ lên máy bay của bạn đây. Chúc chuyến bay vui vẻ!'],
    ];
    const vs = await d.lines(lines.map(([text, voice]) => ({ text, voice })), A, { gap: 0.5 });
    await d.image('airport1'); await d.image('airport2');
    const total = +(vs.at(-1).end + 1.3).toFixed(2);
    const half = +(vs[2].start).toFixed(2);
    d.main({ kind: 'image', assetId: 'img_airport1', duration: +(half + 0.5).toFixed(2), fit: 'cover', kenBurns: { preset: 'zoom-in', amount: 0.12 }, transition: fade() });
    d.main({ kind: 'image', assetId: 'img_airport2', duration: +(total - half).toFixed(2), fit: 'cover', kenBurns: { preset: 'pan-right', amount: 0.12 } });
    vs.forEach((v, i) => d.over({ kind: 'component', component: 'ChatBubble', start: +v.start.toFixed(2), duration: +(v.dur + 0.4).toFixed(2), props: { text: lines[i][0], name: i % 2 ? 'Staff' : 'Lan', side: i % 2 ? 'right' : 'left', x: 0.5, y: i % 2 ? 0.4 : 0.16, width: 0.8, color: i % 2 ? '#dbeafe' : '#ffffff' } }));
    d.over({ kind: 'text', text: 'TIẾNG ANH SÂN BAY', start: 0, duration: total, x: 0.5, y: 0.05, style: { fontSize: 44, color: '#facc15', fontWeight: 900, background: 'rgba(0,0,0,.5)' }, animation: { in: 'slide-down', out: 'fade', duration: 0.5 } });
    d.subs(vs, { text: lines.map((l) => l[2]) }); d.p.subtitles.style.position = 0.8;
    await d.music('inc:Carefree.mp3', total, { volume: 0.08 });
    return d.save();
  },

  async whiteboard() {
    const d = new Demo('whiteboard', 'Demo · Whiteboard giải thích', 1920, 1080);
    d.p.demoPoster = 0.22;
    const vs = await d.lines([
      'Lãi kép là khi tiền lãi được cộng vào gốc, rồi lại tiếp tục sinh lãi.',
      'Ví dụ, gửi một trăm triệu với lãi suất sáu phần trăm một năm. Sau năm đầu bạn có một trăm lẻ sáu triệu, sang năm thứ hai là hơn một trăm mười hai triệu.',
    ], 'vi:Thiện Minh');
    const sp = d.spans(vs, { tr: 0.5, tail: 1.5 });
    await d.image('coins1');
    d.main({ kind: 'component', component: 'WhiteboardScene', duration: sp[0], transition: fade(), props: { title: 'Lãi kép là gì?', lines: ['Lãi sinh ra *lãi*', 'Tiền lớn dần theo thời gian'], image: d.src('coins1'), lineSeconds: 1.4 } });
    d.main({ kind: 'component', component: 'WhiteboardScene', duration: sp[1], props: { title: 'Ví dụ', lines: ['Gửi 100 triệu, lãi 6%/năm', 'Sau 1 năm: *106 triệu*', 'Sau 2 năm: *112,36 triệu*'], lineSeconds: 2.2 } });
    d.subs(vs);
    await d.music('inc:Wholesome.mp3', projectDuration(d.p), { volume: 0.1 });
    return d.save();
  },

  async doodle() {
    const d = new Demo('doodle', 'Demo · Doodle màu nước', 1920, 1080);
    d.p.demoPoster = 0.3;
    const vs = await d.lines([
      'Buổi sáng bắt đầu bằng một bát phở nóng hổi.',
      'Buổi trưa nhâm nhi ly cà phê phin, nhìn phố xá qua lại.',
      'Và buổi tối dạo bước dưới những chiếc đèn lồng lung linh.',
    ], 'vi:Trúc Ly');
    const sp = d.spans(vs, { tr: 0.6, tail: 1.6 });
    const shots = [['pho1', 'Sáng: bát phở nóng'], ['coffee1', 'Trưa: ly cà phê phin'], ['lantern2', 'Tối: phố đèn lồng']];
    for (const [k] of shots) await d.image(k);
    shots.forEach(([k, cap], i) => d.main({ kind: 'component', component: 'DoodleImage', duration: sp[i], props: { image: d.src(k), caption: cap }, ...(i < 2 ? { transition: fade(0.6) } : {}) }));
    await d.music('inc:Carefree.mp3', projectDuration(d.p), { volume: 0.14 });
    return d.save();
  },

  async vox() {
    const d = new Demo('vox', 'Demo · Phóng sự cắt giấy', 1920, 1080);
    const vs = await d.lines([
      'Vì sao một ổ bánh mì lại nổi tiếng khắp thế giới?',
      'Câu chuyện bắt đầu từ ổ bánh mì Pháp, được người Việt kẹp thêm pa tê, rau thơm và đồ chua.',
      'Đến năm 2011, bánh mì chính thức có mặt trong từ điển tiếng Anh Oxford.',
    ], 'vi:Thiện Minh');
    const sp = d.spans(vs, { tr: 0.5, tail: 1.6 });
    for (const k of ['banhmi2', 'banhmi1', 'banhmi3']) await d.image(k);
    const sc = [['banhmi2', 'CÂU HỎI', 'Vì sao bánh mì *nổi tiếng*?', '', '#efe6d2'], ['banhmi1', 'BỐI CẢNH', 'Từ ổ bánh Pháp đến *món Việt*', 'thời Pháp thuộc', '#e9eef2'], ['banhmi3', 'CỘT MỐC', 'Có mặt trong *từ điển Oxford*', 'năm 2011 ✓', '#efe6d2']];
    sc.forEach(([k, kicker, title, note, paper], i) => d.main({ kind: 'component', component: 'PaperCutout', duration: sp[i], props: { image: d.src(k), kicker, title, note, paper, seed: 3 + i * 7 }, ...(i < 2 ? { transition: fade() } : {}) }));
    await d.music('inc:Hitman.mp3', projectDuration(d.p), { volume: 0.12 });
    return d.save();
  },

  async strobe() {
    const d = new Demo('strobe', 'Demo · Strobe Teaser', 1080, 1920);
    d.p.demoPoster = 0.9;
    const keys = ['halong1', 'lantern1', 'pho2', 'terrace1', 'street1', 'halong3', 'coffee2', 'lantern3', 'market1', 'halong4'];
    for (const k of keys) await d.image(k);
    d.main({ kind: 'component', component: 'StrobeTeaser', duration: 12, props: { images: keys.map((k) => d.src(k)), title: 'KHÁM PHÁ *VIỆT NAM*', subtitle: 'TOUR MẪU · 2026', beat: 8, revealSeconds: 3 } });
    await d.music('inc:Volatile Reaction.mp3', 12, { volume: 0.8, start: 4 });
    return d.save();
  },

  async menu() {
    const d = new Demo('menu', 'Demo · Menu F&B', 1080, 1920);
    for (const k of ['pho2', 'banhmi3', 'coffee2', 'pho3']) await d.image(k);
    d.main({ kind: 'component', component: 'MenuShowcase', duration: 13, props: { brand: 'BẾP NHÀ MỘC · MẪU', accent: '#f59e0b', items: [
      { image: d.src('pho2'), name: 'Phở bò tái', price: '65K', desc: 'Nước dùng ninh xương 12 giờ' },
      { image: d.src('banhmi3'), name: 'Bánh mì thịt', price: '30K', desc: 'Vỏ giòn, pa tê nhà làm' },
      { image: d.src('coffee2'), name: 'Cà phê phin', price: '29K', desc: 'Pha phin, đá xay mịn' },
      { image: d.src('pho3'), name: 'Phở gà', price: '60K', desc: 'Gà ta, hành lá, chanh ớt' },
    ] } });
    d.over({ kind: 'component', component: 'CallToAction', start: 10.5, duration: 2.5, props: { label: 'ĐẶT NGAY', doneLabel: 'ĐÃ ĐẶT', color: '#ef4444', icon: '🛵' } });
    await d.music('inc:Carefree.mp3', 13, { volume: 0.5 });
    return d.save();
  },

  async apple() {
    const d = new Demo('apple', 'Demo · Giới thiệu sản phẩm', 1920, 1080);
    d.p.demoPoster = 0.24;
    await d.image('halong3'); await d.image('lantern1');
    const sc = [
      { headline: 'Kỳ nghỉ *trong tầm tay*.', sub: 'Đặt tour Hạ Long chỉ với một chạm.', image: d.src('halong3'), theme: 'light', device: 'phone', duration: 5 },
      { headline: 'Đẹp đến *từng khoảnh khắc*.', sub: 'Ảnh và video sắc nét, lưu trọn hành trình.', image: d.src('lantern1'), theme: 'dark', device: 'laptop', duration: 5 },
      { headline: 'Travel *Mẫu*.', sub: 'Sản phẩm demo · AI Video Studio', theme: 'light', device: 'none', duration: 4 },
    ];
    sc.forEach(({ duration, ...props }, i) => d.main({ kind: 'component', component: 'AppleMotion', duration, props, ...(i < sc.length - 1 ? { transition: fade() } : {}) }));
    await d.music('inc:Wholesome.mp3', projectDuration(d.p), { volume: 0.4 });
    return d.save();
  },

  async 'movie-short'() {
    const d = new Demo('movie-short', 'Demo · Movie Short', 1080, 1920);
    const v = await d.video('bbb');
    d.main({ kind: 'component', component: 'BlurFrame', duration: +v.duration.toFixed(2), props: { video: '/media/bbb.mp4', start: 0, title: 'Big Buck Bunny', tag: 'REVIEW PHIM', volume: 1 } });
    d.p.subtitles = { ...d.p.subtitles, enabled: true, cues: [
      { start: 0.3, end: 4.2, text: 'Một buổi sáng yên bình trong khu rừng…' },
      { start: 4.4, end: 8.6, text: 'chú thỏ khổng lồ ra khỏi hang, vươn vai đón nắng.' },
      { start: 8.8, end: 12.8, text: 'Nhưng rắc rối sắp sửa bắt đầu!' },
    ] };
    d.p.subtitles.style.position = 0.78;
    d.over({ kind: 'text', text: '© Blender Foundation · CC BY 3.0', start: 0, duration: +v.duration.toFixed(2), x: 0.5, y: 0.95, style: { fontSize: 24, color: 'rgba(255,255,255,.7)', fontWeight: 500 }, animation: { in: 'none', out: 'none', duration: 0.3 } });
    return d.save();
  },
};

/* ---------------- preview render ---------------- */
async function renderPreviews(ids) {
  const { bundle } = await import('@remotion/bundler');
  const { renderMedia, renderStill, selectComposition } = await import('@remotion/renderer');
  // serve demos/<id>/media at http://127.0.0.1:<port>/<id>/media/…
  const srv = http.createServer((req, res) => {
    const f = path.join(DEMOS, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(DEMOS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
    const size = fs.statSync(f).size, m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    const type = { '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.m4a': 'audio/mp4' }[path.extname(f)] || 'application/octet-stream';
    if (m) { const a = +m[1], b = m[2] ? +m[2] : size - 1; res.writeHead(206, { 'access-control-allow-origin': '*', 'content-type': type, 'content-range': `bytes ${a}-${b}/${size}`, 'accept-ranges': 'bytes', 'content-length': b - a + 1 }); fs.createReadStream(f, { start: a, end: b }).pipe(res); }
    else { res.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' }); fs.createReadStream(f).pipe(res); }
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const serveUrl = await bundle({ entryPoint: path.join(ROOT, 'remotion', 'index.ts'), webpackOverride: (c) => ({ ...c, resolve: { ...c.resolve, alias: { ...(c.resolve?.alias || {}), '@custom': path.join(ROOT, 'workspace', 'custom') } } }) });
  fs.mkdirSync(PUBLIC, { recursive: true });
  for (const id of ids) {
    const project = JSON.parse(fs.readFileSync(path.join(DEMOS, id, 'project.json'), 'utf8'));
    const inputProps = { project, mediaBase: `http://127.0.0.1:${port}/${id}` };
    const composition = await selectComposition({ serveUrl, id: 'Main', inputProps });
    const tmp = path.join(PUBLIC, `${id}.tmp.mp4`), out = path.join(PUBLIC, `${id}.mp4`);
    process.stderr.write(`render ${id} (${(composition.durationInFrames / 30).toFixed(1)}s)\n`);
    let last = 0;
    await renderMedia({ serveUrl, composition, inputProps, codec: 'h264', outputLocation: tmp, scale: 0.5, crf: 27, concurrency: 2,
      onProgress: ({ progress }) => { if (progress - last > 0.25) { last = progress; process.stderr.write(`  ${Math.round(progress * 100)}%\n`); } } });
    await ff(['-i', tmp, '-c', 'copy', '-movflags', '+faststart', out]); fs.rmSync(tmp);
    // poster: a frame ~40% in (after the intro animations)
    const frame = Math.min(composition.durationInFrames - 1, Math.round(composition.durationInFrames * (project.demoPoster ?? 0.4)));
    await renderStill({ serveUrl, composition, inputProps, frame, output: path.join(PUBLIC, `${id}.jpg`), imageFormat: 'jpeg', jpegQuality: 78, scale: 0.5 });
  }
  srv.close();
}

const ids = only.length ? only : Object.keys(BUILDERS);
if (!RENDER_ONLY) {
  for (const id of ids) {
    if (!BUILDERS[id]) throw new Error(`no demo "${id}"`);
    process.stderr.write(`build ${id}\n`);
    const d = await BUILDERS[id]();
    process.stderr.write(`  → ${projectDuration(d.p).toFixed(1)}s, ${d.p.assets.length} assets, ${d.p.tracks.reduce((n, t) => n + layoutTrack(t, d.p).length, 0)} clips\n`);
  }
}
if (!NO_RENDER) await renderPreviews(ids);
// index for the gallery
const index = Object.fromEntries(fs.readdirSync(DEMOS).filter((id) => fs.existsSync(path.join(DEMOS, id, 'project.json'))).map((id) => {
  const p = JSON.parse(fs.readFileSync(path.join(DEMOS, id, 'project.json'), 'utf8'));
  return [id, { name: p.name, duration: +projectDuration(p).toFixed(1), size: `${p.settings.width}x${p.settings.height}`, video: fs.existsSync(path.join(PUBLIC, `${id}.mp4`)) }];
}));
fs.mkdirSync(PUBLIC, { recursive: true });
fs.writeFileSync(path.join(PUBLIC, 'index.json'), JSON.stringify(index, null, 1));
console.log(JSON.stringify(index, null, 1));

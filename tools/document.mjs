// Word / PDF / text documents → title, text blocks and images in reading order (for "video from a document").
// .docx is read directly (zip + XML); .pdf with poppler (pdftotext / pdfimages / pdftoppm). Other office formats
// (.doc .odt .rtf .pptx …) are converted to PDF first when LibreOffice is installed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DOMParser } from 'linkedom';

const exec = promisify(execFile);
const run = (cmd, args, o = {}) => exec(cmd, args, { maxBuffer: 1 << 28, timeout: 300_000, ...o });

export const DOC_RE = /\.(pdf|docx|doc|odt|rtf|pptx|ppt|odp|txt|md)$/i;
const IMG_RE = /\.(png|jpe?g|gif|bmp|tiff?|webp)$/i;

/** Cache key: content hash (same file uploaded twice → same extraction). */
export const docKey = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 16);

const words = (s) => (String(s).match(/[\p{L}\p{N}]+/gu) || []).length;
const clean = (s) => String(s).normalize('NFC').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').trim();

async function has(cmd) { try { await run('which', [cmd]); return true; } catch { return false; } }

/* ---------------- .docx ---------------- */

async function readDocx(file, dir) {
  const x = path.join(dir, 'docx');
  fs.rmSync(x, { recursive: true, force: true });
  fs.mkdirSync(x, { recursive: true });
  // exit code 1 = warnings only; unzip refuses entries escaping the folder
  await run('unzip', ['-qq', '-o', file, '-d', x]).catch((e) => { if (e.code !== 1) throw new Error('không mở được file .docx (hỏng hoặc có mật khẩu)'); });
  const xml = (p) => { const f = path.join(x, p); return fs.existsSync(f) ? new DOMParser().parseFromString(fs.readFileSync(f, 'utf8'), 'text/xml') : null; };
  const doc = xml('word/document.xml');
  if (!doc) throw new Error('file .docx không có nội dung (word/document.xml)');

  const rels = {};
  for (const r of xml('word/_rels/document.xml.rels')?.getElementsByTagName('Relationship') || []) rels[r.getAttribute('Id')] = r.getAttribute('Target');
  const styles = {};
  for (const s of xml('word/styles.xml')?.getElementsByTagName('w:style') || []) {
    const name = s.getElementsByTagName('w:name')[0]?.getAttribute('w:val') || '';
    const lvl = s.getElementsByTagName('w:outlineLvl')[0]?.getAttribute('w:val');
    styles[s.getAttribute('w:styleId')] = { name: name.toLowerCase(), lvl: lvl != null ? Number(lvl) : null };
  }
  const core = xml('docProps/core.xml');
  const metaTitle = core?.getElementsByTagName('dc:title')[0]?.textContent?.trim() || '';
  const author = core?.getElementsByTagName('dc:creator')[0]?.textContent?.trim() || '';

  const blocks = [];
  const imgDir = path.join(dir, 'images');
  fs.mkdirSync(imgDir, { recursive: true });
  let nImg = 0;
  const seenImg = new Map();
  const addImage = (rid) => {
    const target = rels[rid];
    if (!target || /^https?:/.test(target)) return;
    const src = path.join(x, 'word', target.replace(/^\/?word\//, ''));
    if (!fs.existsSync(src)) return;
    if (seenImg.has(src)) { blocks.push({ ...seenImg.get(src) }); return; }
    const ext = path.extname(src).toLowerCase();
    const b = { type: 'img', ext };
    if (IMG_RE.test(src)) {
      const dest = path.join(imgDir, `img${String(++nImg).padStart(3, '0')}${ext}`);
      fs.copyFileSync(src, dest);
      b.file = dest;
    } else b.skip = `định dạng ${ext.slice(1).toUpperCase()} (hình vẽ Office) chưa hỗ trợ`;
    seenImg.set(src, b);
    blocks.push(b);
  };

  const paraText = (p) => {
    let s = '';
    const walk = (n) => {
      for (const c of n.childNodes || []) {
        const t = c.nodeName;
        if (t === 'w:t' || t === 'w:delText') { if (t === 'w:t') s += c.textContent; }
        else if (t === 'w:tab') s += '\t';
        else if (t === 'w:br' || t === 'w:cr') s += '\n';
        else if (t === 'w:noBreakHyphen') s += '-';
        else if (t === 'w:del' || t === 'w:instrText' || t === 'w:pPr' || t === 'w:rPr') continue; // tracked deletions, field codes
        else walk(c);
      }
    };
    walk(p);
    return clean(s.replace(/\t/g, ' '));
  };
  const paraImages = (p) => {
    for (const el of p.getElementsByTagName('a:blip')) addImage(el.getAttribute('r:embed') || el.getAttribute('r:link'));
    for (const el of p.getElementsByTagName('v:imagedata')) addImage(el.getAttribute('r:id'));
  };

  const para = (p) => {
    const sid = p.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') || '';
    const st = styles[sid] || { name: sid.toLowerCase(), lvl: null };
    const own = p.getElementsByTagName('w:outlineLvl')[0]?.getAttribute('w:val');
    const text = paraText(p);
    if (text) {
      const m = st.name.match(/^heading (\d)/);
      if (/^title$/.test(st.name)) blocks.push({ type: 'title', text });
      else if (/^subtitle$/.test(st.name)) blocks.push({ type: 'h', level: 1, text });
      else if (m || st.lvl != null || own != null) blocks.push({ type: 'h', level: m ? Number(m[1]) : Number(st.lvl ?? own) + 1, text });
      else if (/quote/.test(st.name)) blocks.push({ type: 'quote', text });
      else if (/caption/.test(st.name)) blocks.push({ type: 'caption', text });
      else if (p.getElementsByTagName('w:numPr').length || /list/.test(st.name)) blocks.push({ type: 'li', text });
      else blocks.push({ type: 'p', text });
    }
    paraImages(p);
  };

  const table = (tbl) => {
    const rows = [];
    for (const tr of tbl.childNodes) {
      if (tr.nodeName !== 'w:tr') continue;
      const row = [];
      for (const tc of tr.childNodes) {
        if (tc.nodeName !== 'w:tc') continue;
        row.push([...tc.getElementsByTagName('w:p')].map(paraText).filter(Boolean).join(' '));
        for (const p of tc.getElementsByTagName('w:p')) paraImages(p);
      }
      if (row.some(Boolean)) rows.push(row);
    }
    if (rows.length) blocks.push({ type: 'table', rows });
  };

  const walkBody = (n) => {
    for (const c of n.childNodes || []) {
      if (c.nodeName === 'w:p') para(c);
      else if (c.nodeName === 'w:tbl') table(c);
      else if (c.nodeName === 'w:sdt' || c.nodeName === 'w:sdtContent' || c.nodeName === 'w:customXml' || c.nodeName === 'w:ins') walkBody(c);
    }
  };
  walkBody(doc.getElementsByTagName('w:body')[0]);
  fs.rmSync(x, { recursive: true, force: true });

  const t0 = blocks.find((b) => b.type === 'title') || blocks.find((b) => b.type === 'h');
  return { title: metaTitle || t0?.text || '', author, blocks };
}

/* ---------------- .pdf ---------------- */

async function pdfInfo(file) {
  const { stdout } = await run('pdfinfo', ['-enc', 'UTF-8', file]).catch(() => { throw new Error('không đọc được PDF (hỏng hoặc có mật khẩu)'); });
  const get = (k) => stdout.match(new RegExp(`^${k}:[ \\t]*(.*)$`, 'm'))?.[1]?.trim() || '';
  return { pages: Number(get('Pages')) || 0, title: get('Title'), author: get('Author') };
}

// Vietnamese syllable (tone marks stripped): initial consonant + vowel cluster + final consonant.
const VN_SYL = /^(ngh|ng|gh|gi|kh|nh|ph|qu|th|tr|ch|[bcdđghklmnpqrstvx])?(uyê|uya|uyu|ươu|iêu|yêu|oai|oay|oeo|uây|uôi|ươi|uơ|uâ|uê|uô|uy|ươ|iê|yê|oa|oă|oe|ai|ao|au|ay|âu|ây|eo|êu|ia|iu|oi|ôi|ơi|ua|ui|ưa|ưi|ưu|[aăâeêioôơuưy])(ch|ng|nh|[cmnpt])?$/;
const stripTone = (s) => s.normalize('NFD').replace(/[̣̀́̃̉]/g, '').normalize('NFC').toLowerCase();
const isVowelStart = (s) => /^[aăâeêioôơuưy]/.test(stripTone(s));
const noVowel = (s) => !/[aăâeêioôơuưy]/.test(stripTone(s));
/**
 * PDFs whose font lacks Vietnamese glyphs (fallback font for "ố", "ấ"…) come out of pdftotext as "s ốt xu ất".
 * Join such fragments when the result is one valid syllable. Only applied to a page that shows the problem
 * (several consonant-only fragments), so normal text is left alone.
 */
function fixVnSplit(text) {
  const toks = text.split(' ');
  const bad = toks.filter((t, i) => i < toks.length - 1 && /^\p{L}+$/u.test(t) && noVowel(t) && !/^\p{Lu}{2,}$/u.test(t) && isVowelStart(toks[i + 1])).length;
  if (bad < 2) return text;
  const out = [];
  for (const t of toks) {
    const prev = out[out.length - 1];
    if (prev && /^\p{L}+$/u.test(prev) && /^\p{L}/u.test(t) && isVowelStart(t) && !/^\p{Lu}{2,}$/u.test(prev)) {
      const word = t.match(/^\p{L}+/u)[0];
      const joined = prev + word;
      const tones = (joined.normalize('NFD').match(/[̣̀́̃̉]/g) || []).length;
      if (VN_SYL.test(stripTone(joined)) && tones <= 1 && (noVowel(prev) || !VN_SYL.test(stripTone(word)) || /^[âêôơư]/.test(stripTone(word)))) { out[out.length - 1] = prev + t; continue; }
    }
    out.push(t);
  }
  return out.join(' ');
}

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const BULLET = /^([•●▪■◦○◆►▶✓✔\-–—*]|\d{1,2}[.)]|[a-z][.)])\s+/;

/** pdftotext -bbox-layout → per page: blocks of lines with their height (≈ font size). */
async function pdfLayout(file, pages) {
  const { stdout } = await run('pdftotext', ['-bbox-layout', '-enc', 'UTF-8', '-f', '1', '-l', String(pages), file, '-']);
  return stdout.split(/<page /).slice(1).map((pg) => pg.split(/<block /).slice(1).map((bl) => [...bl.matchAll(/<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"[^>]*>([\s\S]*?)<\/line>/g)]
    .map((m) => {
      const h = Number(m[4]) - Number(m[2]), w = Number(m[3]) - Number(m[1]);
      if (h > w * 0.9) return { h, text: '' }; // vertical / rotated text (margins, figure labels)
      // words split where the font changes (fallback glyphs) have no gap → join them without a space
      let text = '', end = -1e9;
      for (const w of m[5].matchAll(/<word xMin="([\d.]+)"[^>]*xMax="([\d.]+)"[^>]*>([\s\S]*?)<\/word>/g)) {
        text += (text && Number(w[1]) - end > h * 0.12 ? ' ' : '') + unesc(w[3]);
        end = Number(w[2]);
      }
      return { h, text: text.normalize('NFC') };
    })
    .filter((l) => l.text.trim())).filter((b) => b.length));
}

/** One layout block → heading / list items / paragraph. */
function blockToItems(lines, bodyH) {
  const text = (ls) => ls.map((l) => l.text).join('\n').replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const h = lines.reduce((n, l) => n + l.h, 0) / lines.length;
  const all = text(lines);
  if (h >= bodyH * 1.18 && lines.length <= 3 && words(all) <= 18) return [{ type: 'h', level: h >= bodyH * 1.6 ? 1 : 2, text: all }];
  if (lines.some((l) => BULLET.test(l.text))) {
    const items = [];
    for (const l of lines) {
      if (BULLET.test(l.text) || !items.length) items.push([l]);
      else items[items.length - 1].push(l);
    }
    return items.map((ls) => {
      const t = text(ls);
      return BULLET.test(ls[0].text) ? { type: 'li', text: t.replace(BULLET, '') } : { type: 'p', text: t };
    });
  }
  return [{ type: 'p', text: all }];
}

async function readPdf(file, dir, { maxPages = 80 } = {}) {
  const info = await pdfInfo(file);
  const pages = Math.min(info.pages, maxPages);
  const layout = await pdfLayout(file, pages);
  // body text size = the most common line height
  const hs = new Map();
  for (const pg of layout) for (const bl of pg) for (const l of bl) { const k = Math.round(l.h * 2) / 2; hs.set(k, (hs.get(k) || 0) + l.text.length); }
  const bodyH = [...hs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 12;
  const texts = layout.map((pg) => pg.flatMap((bl) => blockToItems(bl, bodyH)).map((it) => ({ ...it, text: fixVnSplit(it.text) }))
    .filter((it) => /[\p{L}\p{N}]/u.test(it.text))
    // "3.1" alone, then "Encoder and Decoder Stacks" → one numbered heading
    .reduce((acc, it) => {
      const prev = acc[acc.length - 1];
      if (prev?.num && words(it.text) <= 14) acc[acc.length - 1] = { type: 'h', level: prev.text.includes('.') ? 3 : 2, text: `${prev.text} ${it.text}` };
      else acc.push(/^\d{1,2}(\.\d{1,2}){0,3}\.?$/.test(it.text) ? { ...it, num: true } : it);
      return acc;
    }, []).map(({ num, ...it }) => it));
  // running headers / footers / page numbers: short lines repeated on many pages
  const norm = (p) => p.replace(/\d+/g, '#');
  const count = new Map();
  for (const ps of texts) for (const p of new Set(ps.map((x) => norm(x.text)))) if (p.length < 90) count.set(p, (count.get(p) || 0) + 1);
  const repeated = (p) => pages >= 3 && p.length < 90 && count.get(norm(p)) >= Math.max(3, pages * 0.5);
  const pageNo = (p) => /^(page\s*|trang\s*)?\d{1,4}(\s*(\/|of|trên)\s*\d{1,4})?$/i.test(p);

  // embedded images: pdfimages -list gives page + size per image number (masks skipped)
  const imgDir = path.join(dir, 'images');
  fs.rmSync(imgDir, { recursive: true, force: true });
  fs.mkdirSync(imgDir, { recursive: true });
  const list = (await run('pdfimages', ['-list', '-l', String(pages), file])).stdout.split('\n').slice(2)
    .map((l) => l.trim().split(/\s+/)).filter((c) => c.length > 4)
    .map((c) => ({ page: Number(c[0]), num: Number(c[1]), type: c[2], width: Number(c[3]), height: Number(c[4]) }));
  await run('pdfimages', ['-png', '-p', '-l', String(pages), file, path.join(imgDir, 'img')]);
  const byPage = new Map();
  const seen = new Map(); // same picture on many pages (logo) → keep once
  for (const im of list) {
    if (im.type !== 'image') continue;
    const f = path.join(imgDir, `img-${String(im.page).padStart(3, '0')}-${String(im.num).padStart(3, '0')}.png`);
    if (!fs.existsSync(f)) continue;
    const b = { type: 'img', page: im.page, file: f, width: im.width, height: im.height };
    if (Math.min(im.width, im.height) < 120) { fs.rmSync(f); continue; }
    const h = crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
    if (seen.has(h)) { seen.get(h).repeats++; fs.rmSync(f); continue; }
    b.repeats = 1; seen.set(h, b);
    if (!byPage.has(im.page)) byPage.set(im.page, []);
    byPage.get(im.page).push(b);
  }
  for (const f of fs.readdirSync(imgDir)) if (![...seen.values()].some((b) => b.file === path.join(imgDir, f))) fs.rmSync(path.join(imgDir, f), { force: true });

  const blocks = [];
  for (let i = 1; i <= pages; i++) {
    blocks.push({ type: 'page', page: i });
    for (const it of texts[i - 1] || []) if (!repeated(it.text) && !pageNo(it.text)) blocks.push(it);
    for (const b of byPage.get(i) || []) if (b.repeats < Math.max(3, pages * 0.5)) blocks.push(b);
  }
  const textWords = blocks.reduce((n, b) => n + (b.text ? words(b.text) : 0), 0);
  return {
    title: info.title && !/^(untitled|microsoft word|document|slide)/i.test(info.title) ? info.title : (blocks.find((b) => b.type === 'h')?.text || ''),
    author: info.author, pages: info.pages, pagesRead: pages, blocks,
    scanned: textWords < Math.max(30, pages * 25), // little or no text layer → scanned / image-only PDF
  };
}

/** Page images: thumbnails for a contact sheet (Claude looks at them), or one big page to use as a visual. */
export async function renderPages(file, dir, { pages, size = 360, prefix = 'thumb' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  for (const n of pages) {
    const base = path.join(dir, `${prefix}-${String(n).padStart(3, '0')}`);
    if (!fs.existsSync(`${base}.png`)) await run('pdftoppm', ['-png', '-singlefile', '-f', String(n), '-l', String(n), '-scale-to', String(size), file, base]);
    out.push(`${base}.png`);
  }
  return out;
}

/** Contact sheet(s) of page thumbnails, 4 × 3 pages per JPG, in reading order. */
export async function pageSheets(file, dir, pages) {
  const thumbs = await renderPages(file, path.join(dir, 'thumbs'), { pages, size: 360 });
  const sheets = [];
  for (let i = 0; i < thumbs.length; i += 12) {
    const group = thumbs.slice(i, i + 12);
    const out = path.join(dir, `pages-${String(i / 12 + 1)}.jpg`);
    const inputs = group.flatMap((f) => ['-i', f]);
    const cells = group.map((_, k) => `[${k}:v]scale=360:470:force_original_aspect_ratio=decrease,pad=380:490:(ow-iw)/2:(oh-ih)/2:color=0x666666[c${k}]`);
    const cols = Math.min(4, group.length), rows = Math.ceil(group.length / 4);
    const layout = group.map((_, k) => `${(k % 4) * 380}_${Math.floor(k / 4) * 490}`).join('|');
    const filter = `${cells.join(';')};${group.map((_, k) => `[c${k}]`).join('')}xstack=inputs=${group.length}:layout=${layout}:fill=0x666666,crop=${cols * 380}:${rows * 490}:0:0`;
    if (group.length === 1) await run('ffmpeg', ['-y', '-v', 'error', '-i', group[0], '-vf', 'scale=360:470:force_original_aspect_ratio=decrease,pad=380:490:(ow-iw)/2:(oh-ih)/2:color=0x666666', '-q:v', '4', out]);
    else await run('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', filter, '-frames:v', '1', '-q:v', '4', out]);
    sheets.push({ file: out, from: pages[i], to: group.length ? pages[i + group.length - 1] : pages[i] });
  }
  return sheets;
}

/* ---------------- text / markdown ---------------- */

function readText(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const blocks = [];
  for (const chunk of raw.split(/\n\s*\n/)) {
    for (const line of chunk.split('\n').length > 1 && chunk.split('\n').every((l) => /^\s*([-*+•]|\d+[.)])\s/.test(l)) ? chunk.split('\n') : [chunk]) {
      const t = line.trim();
      if (!t) continue;
      const h = t.match(/^(#{1,6})\s+(.*)$/);
      if (h) blocks.push({ type: 'h', level: h[1].length, text: h[2] });
      else if (/^\s*([-*+•]|\d+[.)])\s/.test(t)) blocks.push({ type: 'li', text: t.replace(/^\s*([-*+•]|\d+[.)])\s+/, '') });
      else if (/^>/.test(t)) blocks.push({ type: 'quote', text: t.replace(/^>\s?/gm, '') });
      else blocks.push({ type: 'p', text: t.replace(/\s*\n\s*/g, ' ') });
    }
  }
  return { title: blocks.find((b) => b.type === 'h')?.text || path.basename(file).replace(/\.\w+$/, ''), blocks };
}

/**
 * Extract a document into `dir` (images/ inside it). Returns
 * { kind, title, author, pages?, scanned?, words, pdf?, blocks: [{type: title|h|p|li|quote|caption|table|img|page, …}] }.
 * `pdf` is the PDF used for page images (the file itself, or the LibreOffice conversion).
 */
export async function extractDocument(file, dir, opts = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(file).toLowerCase();
  let r;
  if (ext === '.docx') {
    r = { kind: 'docx', ...(await readDocx(file, dir)) };
    // page images for DocZoom need a PDF: only when LibreOffice is installed (optional)
    if (await has('soffice')) r.pdf = await toPdf(file, dir).catch(() => undefined);
    if (r.pdf) r.pages = (await pdfInfo(r.pdf)).pages;
  } else if (ext === '.pdf') {
    r = { kind: 'pdf', ...(await readPdf(file, dir, opts)), pdf: file };
  } else if (ext === '.txt' || ext === '.md') {
    r = { kind: 'text', ...readText(file) };
  } else {
    if (!(await has('soffice'))) throw new Error(`file ${ext} cần LibreOffice để đọc — hãy lưu lại thành .docx hoặc .pdf rồi tải lên`);
    const pdf = await toPdf(file, dir);
    r = { kind: ext.slice(1), ...(await readPdf(pdf, dir, opts)), pdf };
  }
  r.words = r.blocks.reduce((n, b) => n + (b.text ? words(b.text) : b.rows ? b.rows.flat().reduce((m, c) => m + words(c), 0) : 0), 0);
  let n = 0;
  for (const b of r.blocks) if (b.type === 'img') b.n = ++n;
  return r;
}

async function toPdf(file, dir) {
  const out = path.join(dir, 'converted');
  fs.mkdirSync(out, { recursive: true });
  await run('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', out, file], { timeout: 180_000 });
  const pdf = path.join(out, path.basename(file).replace(/\.\w+$/, '.pdf'));
  if (!fs.existsSync(pdf)) throw new Error('LibreOffice không chuyển được file sang PDF');
  return pdf;
}

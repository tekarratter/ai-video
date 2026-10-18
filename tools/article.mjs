// Article → text + images (news sites, blogs, forums) and free illustration search (Openverse / Wikimedia Commons).
// Used by `vedit article` / `vedit images`.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const MIN_SIDE = 200; // images declared smaller than this are icons / avatars / emoji
const JUNK = /(avatar|emoji|smilie|smiley|icon|logo|sprite|badge|banner-ads?|tracking|pixel|blank|spacer|placeholder|loading|1x1)/i;

export const articleKey = (url) => crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'vi,en;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} khi tải ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  // charset from the header, else from <meta charset>, else utf-8
  let cs = /charset=([\w-]+)/i.exec(r.headers.get('content-type') || '')?.[1];
  if (!cs) cs = /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 4096).toString('latin1'))?.[1];
  let html;
  try { html = new TextDecoder(cs || 'utf-8').decode(buf); } catch { html = buf.toString('utf8'); }
  return { html, finalUrl: r.url || url };
}

const meta = (doc, ...names) => {
  for (const n of names) {
    const el = doc.querySelector(`meta[property="${n}"], meta[name="${n}"], meta[itemprop="${n}"]`);
    const v = el?.getAttribute('content')?.trim();
    if (v) return v;
  }
  return '';
};

/** Largest candidate of a srcset ("a.jpg 445w, b.jpg 1900w" / "a.jpg 1x, b.jpg 2x"). */
function largestOf(srcset, base) {
  const c = String(srcset || '').split(/,\s+(?=\S)/).map((x) => x.trim().split(/\s+/)).filter((x) => x[0]);
  c.sort((a, b) => (parseFloat(b[1]) || 0) - (parseFloat(a[1]) || 0));
  try { return c[0] ? new URL(c[0][0], base).href : ''; } catch { return ''; }
}

/**
 * From the original page: every image URL → its largest variant (srcset / <picture><source>). Readability keeps
 * only <img src>, which is often a small thumbnail.
 */
function largestVariants(doc, base) {
  const map = new Map();
  for (const img of doc.querySelectorAll('img')) {
    const attr = (el, k) => el.getAttribute(k) || el.getAttribute(k.replace('set', 'Set'));
    const sets = [attr(img, 'data-srcset'), attr(img, 'srcset')];
    if (img.parentNode?.tagName === 'PICTURE') for (const s of img.parentNode.querySelectorAll('source')) sets.push(attr(s, 'srcset') || attr(s, 'data-srcset'));
    // size of a candidate: its "1900w" descriptor, else ?width= / ?w= (× dpr) in the URL
    const size = (u, d) => parseFloat(d) || (Number(/[?&](?:width|w)=(\d+)/.exec(u)?.[1] || 0) * Number(/[?&]dpr=(\d+(?:\.\d+)?)/.exec(u)?.[1] || 1));
    const cands = sets.filter(Boolean).flatMap((s) => s.split(/,\s+(?=\S)/).map((x) => x.trim().split(/\s+/))).filter((x) => x[0]);
    const best = cands.sort((a, b) => size(b[0], b[1]) - size(a[0], a[1]))[0];
    let big = '';
    try { big = best ? new URL(best[0], base).href : ''; } catch { /* bad url */ }
    if (!big) continue;
    for (const k of ['src', 'data-src', 'data-original', 'data-lazy-src']) {
      const v = img.getAttribute(k);
      if (v && !v.startsWith('data:')) try { map.set(new URL(v, base).href, big); } catch { /* bad url */ }
    }
  }
  return map;
}

/** Best URL of an <img>: lazy-load attributes and the largest srcset candidate win over src. */
function imgUrl(img, base) {
  const pickSet = (s) => {
    if (!s) return '';
    const c = s.split(',').map((x) => x.trim().split(/\s+/)).filter((x) => x[0]);
    c.sort((a, b) => (parseFloat(b[1]) || 0) - (parseFloat(a[1]) || 0));
    return c[0]?.[0] || '';
  };
  const cand = img.getAttribute('data-original') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-url')
    || pickSet(img.getAttribute('data-srcset') || img.getAttribute('srcset')) || pickSet(img.parentNode?.tagName === 'PICTURE' ? img.parentNode.querySelector('source')?.getAttribute('srcset') : '')
    || img.getAttribute('src') || '';
  if (!cand || cand.startsWith('data:')) return '';
  try { return new URL(cand, base).href; } catch { return ''; }
}

function imgCaption(img) {
  const fig = img.closest?.('figure');
  const cap = fig?.querySelector('figcaption')?.textContent?.trim();
  const t = (cap || img.getAttribute('alt') || img.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
  return /^[\w.-]+\.(jpe?g|png|webp|gif|avif)$/i.test(t) ? '' : t; // a file name is not a caption
}

const clean = (s) => String(s || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();

/**
 * Fetch and extract an article: title, meta, ordered blocks of text and images.
 * blocks: [{ type: 'h'|'p'|'quote'|'li', text } | { type: 'img', url, caption, width, height }]
 */
export async function extractArticle(url) {
  const { html, finalUrl } = await fetchText(url);
  const { document } = parseHTML(html);
  const info = {
    url: finalUrl,
    title: meta(document, 'og:title', 'twitter:title') || clean(document.querySelector('title')?.textContent),
    site: meta(document, 'og:site_name', 'application-name') || new URL(finalUrl).hostname.replace(/^www\./, ''),
    description: meta(document, 'og:description', 'description', 'twitter:description'),
    published: meta(document, 'article:published_time', 'datePublished', 'pubdate', 'date'),
    author: meta(document, 'author', 'article:author'),
    cover: (() => { const v = meta(document, 'og:image', 'twitter:image'); try { return v ? new URL(v, finalUrl).href : ''; } catch { return ''; } })(),
  };
  // Readability mutates the document, so give it its own copy
  const parsed = new Readability(parseHTML(html).document, { charThreshold: 300, keepClasses: false }).parse();
  if (!parsed?.content) throw new Error('Không tìm thấy nội dung bài viết (trang cần đăng nhập, chạy bằng JavaScript hoặc chặn bot?)');
  info.title = clean(parsed.title) || info.title;
  info.author = clean(parsed.byline) || info.author;
  const { document: art } = parseHTML(`<!doctype html><html><body>${parsed.content}</body></html>`);

  const bigger = largestVariants(document, finalUrl);
  const blocks = [], seen = new Set();
  const pushImg = (img) => {
    let u = imgUrl(img, finalUrl);
    u = bigger.get(u) || u;
    if (!u || seen.has(u) || /\.svg(\?|$)/i.test(u) || JUNK.test(u)) return;
    const w = parseInt(img.getAttribute('width') || '0', 10), h = parseInt(img.getAttribute('height') || '0', 10);
    if ((w && w < MIN_SIDE) || (h && h < MIN_SIDE)) return;
    seen.add(u);
    blocks.push({ type: 'img', url: u, caption: imgCaption(img), width: w || undefined, height: h || undefined });
  };
  const walk = (el) => {
    for (const n of el.children) {
      const tag = n.tagName;
      if (tag === 'IMG') { pushImg(n); continue; }
      if (/^H[1-6]$/.test(tag)) { const t = clean(n.textContent); if (t) blocks.push({ type: 'h', text: t }); continue; }
      if (tag === 'P' || tag === 'BLOCKQUOTE' || tag === 'LI' || tag === 'FIGCAPTION') {
        n.querySelectorAll('img').forEach(pushImg);
        if (tag === 'FIGCAPTION') continue; // already used as the image caption
        const t = clean(n.textContent);
        if (t) blocks.push({ type: tag === 'BLOCKQUOTE' ? 'quote' : tag === 'LI' ? 'li' : 'p', text: t });
        continue;
      }
      walk(n);
    }
  };
  walk(art.body);
  // forums / sites without <p>: fall back to Readability's plain text
  if (!blocks.some((b) => b.type !== 'img')) {
    for (const t of String(parsed.textContent || '').split(/\n{2,}/).map(clean).filter(Boolean)) blocks.push({ type: 'p', text: t });
  }
  // Readability sometimes drops the lead photo: put the og:image first when the article has none of its own
  const stem = (u) => { try { return path.basename(new URL(u).pathname).replace(/\.[a-z0-9]+$/i, '').slice(0, 24); } catch { return u; } };
  const coverDup = info.cover && [...seen].some((u) => stem(u) === stem(info.cover));
  if (info.cover && !seen.has(info.cover) && !coverDup && blocks.filter((b) => b.type === 'img').length < 2) blocks.unshift({ type: 'img', url: info.cover, caption: 'Ảnh bìa bài viết', cover: true });
  const words = blocks.filter((b) => b.type !== 'img').reduce((n, b) => n + b.text.split(/\s+/).length, 0);
  return { ...info, excerpt: clean(parsed.excerpt) || info.description, words, blocks, fetchedAt: Date.now() };
}

/** Download an image (with the article as Referer — many news CDNs refuse hotlinks without it). */
export async function downloadImage(url, dir, { referer } = {}) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'image/avif,image/webp,image/*,*/*;q=0.8', ...(referer ? { referer } : {}) }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const type = r.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new Error(`không phải ảnh (${type || 'không rõ'})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 4000) throw new Error('ảnh quá nhỏ');
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif', 'image/gif': '.gif' }[type.split(';')[0]] || path.extname(new URL(url).pathname) || '.jpg';
  let base = decodeURIComponent(path.basename(new URL(url).pathname)).replace(/\.[a-z0-9]+$/i, '').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'image';
  if (base.length < 3) base = 'image';
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, base + ext);
  fs.writeFileSync(file, buf);
  return file;
}

/* ---------------- free illustrations ---------------- */

/** Openverse (CC-licensed images from Flickr, Wikimedia… no API key). Falls back to Wikimedia Commons. */
export async function searchImages(q, { count = 8, orientation } = {}) {
  const out = [];
  try {
    const u = new URL('https://api.openverse.org/v1/images/');
    u.searchParams.set('q', q);
    u.searchParams.set('page_size', String(Math.min(40, count * 2)));
    u.searchParams.set('license_type', 'commercial,modification');
    u.searchParams.set('mature', 'false');
    if (orientation) u.searchParams.set('aspect_ratio', orientation === 'portrait' ? 'tall' : orientation === 'landscape' ? 'wide' : 'square');
    const r = await fetch(u, { headers: { 'user-agent': 'ai-video-editor/1.0' }, signal: AbortSignal.timeout(20000) });
    if (r.ok) {
      for (const x of (await r.json()).results || []) {
        if ((x.width && x.width < 640) || (x.height && x.height < 400)) continue;
        out.push({
          id: `ov:${x.id}`, title: x.title || '', url: x.url, thumb: x.thumbnail, width: x.width, height: x.height, page: x.foreign_landing_url,
          attribution: x.attribution || `"${x.title}" — ${x.creator || 'không rõ'} (${String(x.license).toUpperCase()} ${x.license_version || ''})`.trim(),
          source: x.source,
        });
      }
    }
  } catch { /* fall through to Commons */ }
  if (out.length < count) {
    try {
      const u = new URL('https://commons.wikimedia.org/w/api.php');
      Object.entries({ action: 'query', format: 'json', generator: 'search', gsrsearch: `filetype:bitmap ${q}`, gsrnamespace: '6', gsrlimit: String(count * 2), prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '1920' })
        .forEach(([k, v]) => u.searchParams.set(k, v));
      const r = await fetch(u, { headers: { 'user-agent': 'ai-video-editor/1.0 (dev@localhost)' }, signal: AbortSignal.timeout(20000) });
      if (r.ok) {
        for (const pg of Object.values((await r.json()).query?.pages || {})) {
          const ii = pg.imageinfo?.[0];
          if (!ii || ii.width < 640) continue;
          const m = ii.extmetadata || {};
          const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').trim();
          out.push({
            id: `wm:${pg.pageid}`, title: pg.title.replace(/^File:/, ''), url: ii.thumburl || ii.url, thumb: ii.thumburl, width: ii.thumbwidth || ii.width, height: ii.thumbheight || ii.height, page: ii.descriptionurl,
            attribution: `"${pg.title.replace(/^File:/, '')}" — ${strip(m.Artist?.value) || 'Wikimedia Commons'} (${strip(m.LicenseShortName?.value) || 'xem trang ảnh'})`,
            source: 'wikimedia',
          });
        }
      }
    } catch { /* nothing */ }
  }
  return out.slice(0, count);
}

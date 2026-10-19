// Template catalogue for the home screen: what each video style needs from the user and the brief sent to Claude.
// The motion components live in workspace/custom/tpl (preview = the component rendered with its default props).

export type Field =
  | { k: string; type: 'source'; label: string; modes: ('link' | 'text' | 'topic')[] }
  | { k: string; type: 'text' | 'textarea'; label: string; placeholder?: string; required?: boolean }
  | { k: string; type: 'files'; label: string; accept: string; hint?: string; required?: boolean }
  | { k: string; type: 'voice2'; label: string };

export type Template = {
  id: string;
  cat: string;
  name: string;
  desc: string;
  hot?: boolean;
  icon: string;
  /** component + props shown as the card preview */
  preview: { component: string; frame?: number; props?: Record<string, unknown>; bg?: string };
  sizes: string[]; // first = default
  length?: [string, string][]; // [key, label]
  voice: boolean;
  fields: Field[];
  /** Recipe heading in workspace/CLAUDE.md ("## Template: …") */
  recipe: string;
  /** opens an existing dialog instead of the template form */
  dialog?: 'article' | 'dub';
};

export const CATEGORIES: [string, string, string][] = [
  ['all', 'Tất cả', '🔥'],
  ['news', 'Tin tức', '📰'],
  ['dialogue', 'Hội thoại & Podcast', '💬'],
  ['illustrative', 'Minh họa', '🎨'],
  ['business', 'Kinh doanh', '🛍️'],
  ['subtitle', 'Phụ đề & Ngôn ngữ', '📖'],
];

export const SIZE_LABEL: Record<string, string> = {
  '1080x1920': 'Dọc 9:16 (TikTok, Shorts, Reels)',
  '1920x1080': 'Ngang 16:9 (YouTube)',
  '1080x1080': 'Vuông 1:1 (Facebook)',
};

const LEN: [string, string][] = [['short', 'Ngắn ~30–60 giây'], ['medium', 'Vừa ~1–2 phút'], ['long', 'Dài ~3–5 phút']];

export const TEMPLATES: Template[] = [
  {
    id: 'news-60s', cat: 'news', name: 'Tin nóng 60s', hot: true, icon: '🔥',
    desc: 'Bản tin dọc 60 giây từ link báo hoặc văn bản: mở đầu "TIN NÓNG", ảnh Ken Burns, dải tiêu đề, chữ chạy, giọng đọc.',
    preview: { component: 'BreakingIntro', frame: 40 },
    sizes: ['1080x1920', '1920x1080'], length: [['short', '~45–60 giây'], ['medium', '~90 giây']], voice: true,
    fields: [{ k: 'source', type: 'source', label: 'Nội dung', modes: ['link', 'text'] }, { k: 'channel', type: 'text', label: 'Tên kênh (tuỳ chọn)', placeholder: 'VD: Tin Nhanh 24h' }],
    recipe: 'Tin nóng 60s',
  },
  {
    id: 'news-short', cat: 'news', name: 'Tin ngắn 1/3 gradient', icon: '⚡',
    desc: 'Video/ảnh của bạn + dải gradient 1/3 dưới với tiêu đề lớn, nhãn chuyên mục, phụ đề. Kiểu "Tin nóng 24h".',
    preview: { component: 'NewsGradient', frame: 40, bg: 'linear-gradient(160deg,#334155,#0f172a)' },
    sizes: ['1080x1920', '1920x1080'], voice: true,
    fields: [
      { k: 'files', type: 'files', label: 'Video / ảnh', accept: 'video/*,image/*', required: true },
      { k: 'headline', type: 'text', label: 'Tiêu đề', placeholder: 'VD: Hà Nội mưa lớn, nhiều tuyến phố ngập sâu', required: true },
      { k: 'notes', type: 'textarea', label: 'Nội dung tin (để đọc / làm phụ đề)', placeholder: 'Dán nội dung hoặc để trống nếu video đã có tiếng' },
    ],
    recipe: 'Tin ngắn 1/3 gradient',
  },
  {
    id: 'article', cat: 'news', name: 'Video từ bài viết', icon: '📝',
    desc: 'Dán link bài báo / diễn đàn → video đọc tóm tắt, ảnh trong bài + ảnh minh họa, phụ đề. Giọng Việt hoặc Anh.',
    preview: { component: 'NewsGradient', frame: 40, props: { kicker: 'TÓM TẮT', headline: 'Đọc bài *thay bạn* trong 60 giây' }, bg: 'linear-gradient(160deg,#1e3a8a,#0f172a)' },
    sizes: ['1920x1080', '1080x1920'], voice: true, fields: [], recipe: 'Video từ bài viết', dialog: 'article',
  },
  {
    id: 'podcast', cat: 'dialogue', name: 'Podcast 2 người', hot: true, icon: '🎙️',
    desc: 'Hai MC trò chuyện về một chủ đề hoặc một bài viết: 2 giọng AI xen kẽ, người đang nói sáng lên, sóng âm, phụ đề.',
    preview: { component: 'PodcastStudio', frame: 100 },
    sizes: ['1920x1080', '1080x1920', '1080x1080'], length: LEN, voice: true,
    fields: [
      { k: 'source', type: 'source', label: 'Chủ đề', modes: ['topic', 'link', 'text'] },
      { k: 'show', type: 'text', label: 'Tên chương trình', placeholder: 'VD: Podcast Kinh Tế' },
      { k: 'voice2', type: 'voice2', label: 'Giọng người thứ hai' },
      { k: 'files', type: 'files', label: 'Ảnh 2 MC (tuỳ chọn)', accept: 'image/*', hint: 'Không có thì dùng avatar chữ cái' },
    ],
    recipe: 'Podcast 2 người',
  },
  {
    id: 'dialogue', cat: 'dialogue', name: 'Hội thoại tình huống', icon: '💬',
    desc: 'Đoạn hội thoại 2 nhân vật với bong bóng thoại trên ảnh bối cảnh: học tiếng Anh, chăm sóc khách hàng, kịch ngắn.',
    preview: { component: 'ChatBubble', frame: 45, bg: 'linear-gradient(160deg,#475569,#1e293b)' },
    sizes: ['1080x1920', '1920x1080'], length: [['short', '~30 giây (6–8 câu)'], ['medium', '~1 phút (12–16 câu)']], voice: true,
    fields: [
      { k: 'source', type: 'source', label: 'Tình huống', modes: ['topic', 'text'] },
      { k: 'voice2', type: 'voice2', label: 'Giọng nhân vật thứ hai' },
      { k: 'files', type: 'files', label: 'Ảnh bối cảnh / nhân vật (tuỳ chọn)', accept: 'image/*', hint: 'Không có thì Claude tìm ảnh minh họa miễn phí' },
    ],
    recipe: 'Hội thoại tình huống',
  },
  {
    id: 'whiteboard', cat: 'illustrative', name: 'Whiteboard giải thích', hot: true, icon: '✏️',
    desc: 'Giải thích một khái niệm trên bảng trắng: chữ viết tay hiện dần theo bút dạ, hình vẽ phác, giọng đọc.',
    preview: { component: 'WhiteboardScene', frame: 110 },
    sizes: ['1920x1080', '1080x1920'], length: LEN, voice: true,
    fields: [{ k: 'source', type: 'source', label: 'Chủ đề', modes: ['topic', 'text', 'link'] }, { k: 'files', type: 'files', label: 'Ảnh minh họa (tuỳ chọn)', accept: 'image/*' }],
    recipe: 'Whiteboard giải thích',
  },
  {
    id: 'doodle', cat: 'illustrative', name: 'Doodle màu nước', icon: '🎨',
    desc: 'Ảnh của bạn hiện ra như bản phác chì rồi tô màu nước, chú thích chữ viết tay. Hợp kể chuyện, kỷ niệm, du lịch.',
    preview: { component: 'DoodleImage', frame: 80 },
    sizes: ['1920x1080', '1080x1920', '1080x1080'], voice: true,
    fields: [{ k: 'files', type: 'files', label: 'Ảnh', accept: 'image/*', required: true }, { k: 'notes', type: 'textarea', label: 'Câu chuyện / lời kể', placeholder: 'Kể ngắn gọn, Claude chia thành từng cảnh' }],
    recipe: 'Doodle màu nước',
  },
  {
    id: 'vox', cat: 'illustrative', name: 'Phóng sự cắt giấy (VOX)', icon: '📰',
    desc: 'Phong cách điều tra/tài liệu: ảnh xé giấy, băng dính, nền chấm in, khoanh đỏ bằng bút dạ, chữ serif lớn.',
    preview: { component: 'PaperCutout', frame: 60 },
    sizes: ['1920x1080', '1080x1920'], length: LEN, voice: true,
    fields: [{ k: 'source', type: 'source', label: 'Chủ đề', modes: ['link', 'topic', 'text'] }, { k: 'files', type: 'files', label: 'Ảnh (tuỳ chọn)', accept: 'image/*' }],
    recipe: 'Phóng sự cắt giấy',
  },
  {
    id: 'strobe', cat: 'business', name: 'Strobe Teaser', icon: '⚡',
    desc: 'Teaser 10–15 giây: ảnh chớp cắt theo nhịp nhạc, đèn flash, cú "big reveal" tên thương hiệu / sự kiện.',
    preview: { component: 'StrobeTeaser', frame: 140 },
    sizes: ['1080x1920', '1920x1080', '1080x1080'], voice: false,
    fields: [
      { k: 'files', type: 'files', label: 'Ảnh (6–15 ảnh)', accept: 'image/*', required: true },
      { k: 'headline', type: 'text', label: 'Chữ reveal', placeholder: 'VD: KHAI TRƯƠNG', required: true },
      { k: 'sub', type: 'text', label: 'Dòng phụ', placeholder: 'VD: 20.10 · 123 Lê Lợi' },
    ],
    recipe: 'Strobe Teaser',
  },
  {
    id: 'menu', cat: 'business', name: 'Menu F&B 22s', icon: '🍔',
    desc: 'Reel giới thiệu món: từng món một với ảnh đẩy chậm, tên, mô tả, nhãn giá xoay. Hợp quán ăn, cà phê.',
    preview: { component: 'MenuShowcase', frame: 50 },
    sizes: ['1080x1920', '1080x1080', '1920x1080'], voice: false,
    fields: [
      { k: 'files', type: 'files', label: 'Ảnh món (theo thứ tự)', accept: 'image/*', required: true },
      { k: 'headline', type: 'text', label: 'Tên quán', placeholder: 'VD: Phở Gia Truyền', required: true },
      { k: 'notes', type: 'textarea', label: 'Tên món – giá (mỗi dòng một món)', placeholder: 'Phở bò tái – 65K – Nước dùng ninh 12 giờ\nGỏi cuốn – 45K', required: true },
    ],
    recipe: 'Menu F&B',
  },
  {
    id: 'apple', cat: 'business', name: 'Giới thiệu sản phẩm (Apple style)', icon: '✨',
    desc: 'Chuyển động tối giản kiểu Apple: chữ mờ dần hiện, khung điện thoại/laptop trượt lên với ảnh hoặc video sản phẩm.',
    preview: { component: 'AppleMotion', frame: 70 },
    sizes: ['1920x1080', '1080x1920'], length: [['short', '~20–30 giây'], ['medium', '~50 giây']], voice: true,
    fields: [
      { k: 'files', type: 'files', label: 'Ảnh / video sản phẩm', accept: 'image/*,video/*', required: true },
      { k: 'headline', type: 'text', label: 'Tên sản phẩm', required: true },
      { k: 'notes', type: 'textarea', label: 'Điểm nổi bật', placeholder: 'Mỗi dòng một ý' },
    ],
    recipe: 'Giới thiệu sản phẩm',
  },
  {
    id: 'movie-short', cat: 'subtitle', name: 'Movie Short (nền mờ)', hot: true, icon: '🎬',
    desc: 'Video ngang → dọc: video rõ ở giữa, nền là chính video làm mờ, tiêu đề trên, phụ đề dưới (có thể dịch/thuyết minh).',
    preview: { component: 'BlurFrame', frame: 30, bg: 'linear-gradient(#111,#333,#111)' },
    sizes: ['1080x1920'], voice: false,
    fields: [
      { k: 'files', type: 'files', label: 'Video ngang', accept: 'video/*', required: true },
      { k: 'headline', type: 'text', label: 'Tiêu đề', placeholder: 'VD: Review phim · Tập 1' },
      { k: 'notes', type: 'textarea', label: 'Yêu cầu', placeholder: 'VD: cắt đoạn 1:20–2:10, phụ đề tiếng Việt, thuyết minh…' },
    ],
    recipe: 'Movie Short',
  },
  {
    id: 'dub', cat: 'subtitle', name: 'Thuyết minh / lồng tiếng', icon: '🎧',
    desc: 'Dịch lời thoại video hoặc link YouTube sang tiếng Việt/Anh và đọc lại bằng giọng AI, kèm phụ đề.',
    preview: { component: 'NewsGradient', frame: 40, props: { kicker: 'THUYẾT MINH', headline: 'Xem video nước ngoài *bằng tiếng Việt*' }, bg: 'linear-gradient(160deg,#4c1d95,#0f172a)' },
    sizes: ['1920x1080'], voice: true, fields: [], recipe: '', dialog: 'dub',
  },
];

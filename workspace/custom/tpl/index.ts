// Template motion components (news, dialogue/podcast, whiteboard/doodle/VOX, business). Registered from ../index.tsx.
import type React from 'react';
import { BreakingIntro, NewsGradient, NewsTicker } from './News';
import { ChatBubble, PodcastStudio } from './Dialogue';
import { DoodleImage, PaperCutout, WhiteboardScene } from './Sketch';
import { AppleMotion, BlurFrame, MenuShowcase, StrobeTeaser } from './Business';
import { SAMPLE } from './samples';
import { Character3D, CharacterStage } from './Character3D';

export const templateComponents: Record<string, React.FC<any>> = {
  BreakingIntro, NewsGradient, NewsTicker,
  PodcastStudio, ChatBubble,
  WhiteboardScene, DoodleImage, PaperCutout,
  StrobeTeaser, MenuShowcase, AppleMotion, BlurFrame,
  Character3D, CharacterStage,
};

/** Preview props for the Motion library / template gallery (sample photos are CC images on Wikimedia Commons). */
export const templateDefaults: Record<string, Record<string, unknown>> = {
  BreakingIntro: { label: 'TIN NÓNG', headline: 'Hà Nội khởi công *tuyến đường mới* 26,5 km', date: '19/10/2026', image: SAMPLE.city, accent: '#e11d2a' },
  NewsGradient: { kicker: 'THỜI SỰ', headline: 'Giá xăng *giảm mạnh* từ chiều nay', sub: 'Theo Bộ Công Thương', accent: '#facc15' },
  NewsTicker: { label: 'TIN NÓNG', items: ['Giá vàng tăng 500.000 đồng/lượng', 'Hà Nội mưa lớn chiều tối', 'Tỷ giá USD ổn định'], clock: '19:45' },
  PodcastStudio: {
    title: 'PODCAST KINH TẾ', episode: 'Tập 12 · Lạm phát và tiền lương',
    hosts: [{ name: 'Minh', role: 'MC', color: '#38bdf8' }, { name: 'Lan', role: 'Chuyên gia', color: '#f472b6' }],
    turns: [{ speaker: 0, start: 0.5, end: 2.5, text: 'Chào mừng các bạn quay lại!' }, { speaker: 1, start: 2.7, end: 5, text: 'Hôm nay ta nói về lạm phát.' }],
  },
  ChatBubble: { text: 'Bạn ơi, quầy check-in quốc tế ở đâu vậy?', name: 'Lan', side: 'left', x: 0.5, y: 0.2, width: 0.72 },
  WhiteboardScene: { title: 'Lạm phát là gì?', lines: ['Giá cả *tăng* đều', 'Tiền mất giá', 'Lương thực tế giảm'], image: SAMPLE.market, lineSeconds: 1.4 },
  DoodleImage: { image: SAMPLE.food, caption: 'Bát phở sáng Hà Nội' },
  PaperCutout: { image: SAMPLE.city, kicker: 'ĐIỀU TRA', title: 'Ai đứng *phía sau* cơn sốt đất?', note: 'giá tăng 300% ↑' },
  StrobeTeaser: { images: [SAMPLE.food, SAMPLE.city, SAMPLE.bay, SAMPLE.market], title: 'KHAI TRƯƠNG', subtitle: '20.10.2026', beat: 8 },
  MenuShowcase: { brand: 'PHỞ GIA TRUYỀN', items: [{ image: SAMPLE.food, name: 'Phở bò tái', price: '65K', desc: 'Nước dùng ninh 12 giờ' }, { image: SAMPLE.rolls, name: 'Gỏi cuốn', price: '45K', desc: 'Tôm tươi, rau sống' }] },
  AppleMotion: { headline: 'Đơn giản. *Mạnh mẽ.*', sub: 'Dựng video chỉ bằng một câu lệnh.', image: SAMPLE.bay, theme: 'light', device: 'phone' },
  BlurFrame: { video: '', title: 'Tên phim · Tập 1', tag: 'REVIEW PHIM' },
  Character3D: { preset: 'be_trai', name: 'Bé Bin', background: 'stage', actions: [{ start: 0, action: 'wave' }, { start: 2, action: 'talk' }] },
  CharacterStage: {
    background: 'sky', names: true,
    cast: [{ preset: 'be_gai', name: 'Lan', x: 0.3, actions: [{ start: 0, action: 'talk' }, { start: 2, action: 'idle' }] }, { preset: 'be_trai', name: 'Nam', x: 0.7, actions: [{ start: 0, action: 'wave' }, { start: 2, action: 'talk' }] }],
  },
};

// Custom Remotion components (motion graphics). Register each one in `components`, then use it on the timeline:
//   { "kind": "component", "component": "TitleCard", "props": { ... }, "duration": 4 }
// Both the editor preview (Vite HMR) and the renderer import this file.
import type React from 'react';
import { TitleCard } from './TitleCard';
import { LowerThird } from './LowerThird';
import { KineticText } from './KineticText';
import { StatCounter } from './StatCounter';
import { CruiseIntro } from './CruiseIntro';
import { SectionTitle } from './SectionTitle';
import { PhotoCard } from './PhotoCard';
import { EndCard } from './EndCard';
import { PanPhoto } from './PanPhoto';
import { StepTitle } from './StepTitle';
import { ProjectIntro } from './ProjectIntro';
import { FeatureList } from './FeatureList';
import { BeforeAfter } from './BeforeAfter';
import { BrandOutro } from './BrandOutro';
import { Snowfall } from './Snowfall';
import { FallingLeaves } from './FallingLeaves';
import { Countdown } from './Countdown';
import { Confetti } from './Confetti';
import { CallToAction } from './CallToAction';
import { QuoteCard } from './QuoteCard';
import { ProgressBar } from './ProgressBar';
import { LightLeak } from './LightLeak';

export const components: Record<string, React.FC<any>> = {
  TitleCard,
  LowerThird,
  KineticText,
  StatCounter,
  CruiseIntro,
  SectionTitle,
  PhotoCard,
  EndCard,
  PanPhoto,
  StepTitle,
  ProjectIntro,
  FeatureList,
  BeforeAfter,
  BrandOutro,
  Snowfall,
  FallingLeaves,
  Countdown,
  Confetti,
  CallToAction,
  QuoteCard,
  ProgressBar,
  LightLeak,
};

/** Default props shown in the editor's "Motion" library (optional). */
export const componentDefaults: Record<string, Record<string, unknown>> = {
  TitleCard: { title: 'Tiêu đề', subtitle: 'Phụ đề' },
  LowerThird: { name: 'Nguyễn Văn A', role: 'Kiến trúc sư', accent: '#f59e0b' },
  KineticText: { text: 'Biến *ý tưởng* thành video', fontSize: 120 },
  StatCounter: { value: 250, suffix: ' m²', label: 'Diện tích sàn' },
  CruiseIntro: { kicker: 'Trải nghiệm', title: 'HẠ LONG BAY', subtitle: 'Halora Nova Cruise' },
  SectionTitle: { tag: '01', title: 'Tiêu đề' },
  PhotoCard: { src: '/media/room.jpg' },
  EndCard: { src: '/media/IMG_2265.jpg' },
  PanPhoto: { src: '/media/WINDING_HOUSE_14.jpg', aspect: 1.3333 },
  StepTitle: { step: '01', label: 'STEP 1', title: 'Title' },
  ProjectIntro: { title: 'PROJECT\nNAME', subtitle: 'Subtitle' },
  FeatureList: { items: ['Feature one', 'Feature two'] },
  BeforeAfter: { before: '/media/WINDING_HOUSE_4.jpg', after: '/media/WINDING_HOUSE_14.jpg' },
  BrandOutro: { logo: '/media/Logo_SolidLine_US_rounded.png' },
  Snowfall: { count: 70 },
  FallingLeaves: { count: 22 },
  Countdown: { from: 3, endText: 'GO!', accent: '#f59e0b' },
  Confetti: { count: 140, mode: 'burst' },
  CallToAction: { label: 'ĐĂNG KÝ', doneLabel: 'ĐÃ ĐĂNG KÝ', color: '#ef4444', icon: '🔔' },
  QuoteCard: { quote: 'Đội ngũ làm việc rất chuyên nghiệp, đúng tiến độ và kết quả vượt mong đợi.', author: 'Anh Minh', role: 'Khách hàng' },
  ProgressBar: { color: '#f59e0b', thickness: 10, position: 'bottom' },
  LightLeak: { color: '#ff8a3d', color2: '#ffd166', intensity: 0.85 },
};

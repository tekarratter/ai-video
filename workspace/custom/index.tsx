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

export const components: Record<string, React.FC<any>> = {
  TitleCard,
  LowerThird,
  KineticText,
  StatCounter,
  CruiseIntro,
  SectionTitle,
  PhotoCard,
  EndCard,
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
};

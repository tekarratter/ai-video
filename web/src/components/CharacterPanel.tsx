import React, { useEffect, useMemo, useState } from 'react';
import { Player } from '@remotion/player';
import { components } from '@custom';
import { CHARACTER_ACTIONS, CHARACTER_EXPRESSIONS, CHARACTER_PRESETS, resolveLook, type Look } from '@custom/tpl/Character3D';
import { newId } from '../../../shared/timeline.js';
import { useStore } from '../store';
import { currentTime } from '../player';
import { Icon } from './Icon';
import { VoicePicker } from './AudioLibrary';
import { askClaude } from './ChatPanel';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SKINS = ['#fde3cf', '#f8d0b0', '#f1c6a0', '#e9b98f', '#e2ad83', '#d79c6c', '#b67a50', '#8d5a3b'];
const HAIRS = ['#120d0b', '#2b1b14', '#5b3a29', '#8b5a2b', '#d6a85b', '#b91c1c', '#d1d5db', '#e5e7eb'];
const HAIR_STYLES: [string, string][] = [['short', 'Ngắn'], ['spiky', 'Dựng'], ['curly', 'Xoăn'], ['long', 'Dài'], ['bob', 'Bob'], ['bun', 'Búi'], ['ponytail', 'Đuôi ngựa'], ['pigtails', 'Hai bím'], ['bald', 'Hói']];
const OUTFITS: [string, string][] = [['tshirt', 'Áo phông'], ['shirt', 'Sơ mi'], ['suit', 'Vest'], ['hoodie', 'Hoodie'], ['dress', 'Váy'], ['aodai', 'Áo dài']];
const HATS: [string, string][] = [['none', 'Không'], ['cap', 'Mũ lưỡi trai'], ['nonla', 'Nón lá'], ['beanie', 'Mũ len']];
const BEARDS: [string, string][] = [['none', 'Không'], ['mustache', 'Ria mép'], ['beard', 'Râu quai nón']];
const BACKGROUNDS: [string, string][] = [['stage', 'Sân khấu'], ['sky', 'Trời & cỏ'], ['studio', 'Studio tối'], ['classroom', 'Lớp học'], ['none', 'Trong suốt (đặt trên ảnh/video)']];

type Cfg = { name: string; look: Look; voice: string; action: string; expression: string; background: string };
const lsGet = (k: string, d = '') => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage off */ } };
const fromPreset = (id: string, voice: string): Cfg => ({
  name: CHARACTER_PRESETS[id].label, look: { ...resolveLook({ preset: id }) }, voice, action: 'wave', expression: 'smile', background: 'stage',
});
/** Clip props for one character (the renderer adds `voices` for lip-sync from `voiceName`). */
const propsOf = (c: Cfg, background: string) => ({
  name: c.name, look: c.look, voiceName: c.voice || undefined, background, x: 0.5, y: 0.93, size: 0.72,
  actions: [{ start: 0, action: c.action, expression: c.expression }],
});
/** Read a character back from a selected Character3D clip. */
const fromClip = (clip: any, voice: string): Cfg | null => {
  if (clip?.kind !== 'component' || clip.component !== 'Character3D') return null;
  const p = clip.props || {};
  const step = p.actions?.[0] || {};
  return { name: p.name || 'Nhân vật', look: { ...resolveLook(p) }, voice: p.voiceName || voice, action: step.action || p.action || 'idle', expression: step.expression || p.expression || 'smile', background: p.background || 'none' };
};

const Swatches: React.FC<{ list: string[]; value?: string; onChange: (c: string) => void }> = ({ list, value, onChange }) => (
  <div className="swatches">
    {list.map((c) => <button key={c} className={`swatch ${value?.toLowerCase() === c ? 'active' : ''}`} style={{ background: c }} onClick={() => onChange(c)} title={c} />)}
    <input type="color" value={value || '#000000'} onChange={(e) => onChange(e.target.value)} title="Màu khác" />
  </div>
);
const Chips: React.FC<{ list: [string, string][]; value?: string; onChange: (v: string) => void }> = ({ list, value, onChange }) => (
  <div className="char-chips">{list.map(([k, n]) => <button key={k} className={`char-chip ${value === k ? 'active' : ''}`} onClick={() => onChange(k)}>{n}</button>)}</div>
);

/** "Nhân vật 3D": pick a ready-made cartoon character, customise it, give it a voice, put it in the video. */
export const CharacterPanel: React.FC = () => {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const { fps } = project.settings;
  const [cfg, setCfg] = useState<Cfg>(() => {
    try { const s = JSON.parse(lsGet('aiv.char')); if (s?.look) return s; } catch { /* first use */ }
    return fromPreset('be_trai', lsGet('aiv.char.voice', 'vi:Mai Anh'));
  });
  const [line, setLine] = useState('');
  const [more, setMore] = useState(false);
  useEffect(() => { lsSet('aiv.char', JSON.stringify(cfg)); if (cfg.voice) lsSet('aiv.char.voice', cfg.voice); }, [cfg]);

  const selClip = useMemo(() => project.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === selection), [project, selection]);
  const editing = fromClip(selClip, cfg.voice);
  const saved: any[] = project.characters || [];
  const L = cfg.look as Required<Look>;
  const setLook = (patch: Partial<Look>) => setCfg((c) => ({ ...c, look: { ...c.look, ...patch } }));
  const set = (patch: Partial<Cfg>) => setCfg((c) => ({ ...c, ...patch }));

  const preview = useMemo(() => ({ ...propsOf(cfg, cfg.background === 'none' ? 'stage' : cfg.background), voiceName: undefined, enter: 'none', size: 0.8, y: 0.95 }), [cfg]);
  const Comp = (components as any).Character3D;

  const add = (where: 'sequence' | 'overlay') => {
    const bg = where === 'sequence' ? (cfg.background === 'none' ? 'stage' : cfg.background) : 'none';
    useStore.getState().update((p) => {
      let t = p.tracks.find((x: any) => x.type === where);
      if (!t) { t = { id: newId('t'), name: where === 'sequence' ? 'Main' : 'Overlay', type: where, clips: [] }; p.tracks.push(t); }
      const clip: any = { id: newId(), kind: 'component', name: cfg.name, component: 'Character3D', props: propsOf(cfg, bg), duration: 5 };
      if (where === 'overlay') clip.start = +currentTime().toFixed(2);
      t.clips.push(clip);
      useStore.setState({ selection: clip.id });
    });
    useStore.getState().toast(where === 'sequence' ? 'Đã thêm cảnh nhân vật vào cuối track chính' : 'Đã đặt nhân vật lên video tại playhead');
  };
  const updateSelected = () => {
    if (!selClip) return;
    useStore.getState().update((p) => {
      const c = p.tracks.flatMap((t: any) => t.clips).find((x: any) => x.id === selClip.id);
      if (!c) return;
      const keep = c.props || {};
      c.name = cfg.name;
      c.props = { ...keep, ...propsOf(cfg, cfg.background), x: keep.x ?? 0.5, y: keep.y ?? 0.93, size: keep.size ?? 0.72 };
      // keep a multi-step script written by Claude; only the first step's action/expression follow the panel
      if (keep.actions?.length > 1) c.props.actions = keep.actions.map((s: any, i: number) => (i === 0 ? { ...s, action: cfg.action, expression: cfg.expression } : s));
    });
    useStore.getState().toast('Đã cập nhật nhân vật đang chọn');
  };
  const save = () => {
    useStore.getState().update((p: any) => {
      const list = (p.characters ||= []);
      const i = list.findIndex((x: any) => x.name === cfg.name);
      const item = { id: i >= 0 ? list[i].id : newId('ch'), name: cfg.name, look: cfg.look, voice: cfg.voice };
      if (i >= 0) list[i] = item; else list.push(item);
    });
    useStore.getState().toast(`Đã lưu "${cfg.name}" vào dự án — Claude sẽ dùng đúng ngoại hình này`);
  };
  const remove = (id: string) => useStore.getState().update((p: any) => { p.characters = (p.characters || []).filter((x: any) => x.id !== id); });
  const speak = async () => {
    if (!line.trim()) return;
    try {
      const r = await fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: line.trim(), voice: cfg.voice, speed: 1, start: +currentTime().toFixed(2) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || r.statusText);
      useStore.getState().toast(`Đang tạo giọng "${cfg.voice.split(':').pop()}" — nhân vật dùng giọng này sẽ tự nhép môi`);
      setLine('');
    } catch (e: any) { useStore.getState().toast(e.message, 'error'); }
  };
  const ask = () => askClaude(
    `Dựng cảnh hoạt hình 3D theo mục "Nhân vật 3D" trong CLAUDE.md, với nhân vật "${cfg.name}" (giọng ${cfg.voice}, look: ${JSON.stringify(cfg.look)}). Nội dung: `,
  );

  return (
    <div className="panel-body chars">
      <div className="char-preview">
        {Comp && (
          <Player component={Comp} inputProps={preview} compositionWidth={540} compositionHeight={540} fps={fps} durationInFrames={Math.round(fps * 4)}
            autoPlay loop controls={false} acknowledgeRemotionLicense style={{ width: '100%', height: '100%' }}
            errorFallback={() => <div className="player-error">Không hiển thị được 3D (trình duyệt tắt WebGL?)</div>} />
        )}
      </div>
      {editing && (
        <div className="char-editing">
          <span>Đang chọn clip nhân vật <b>{selClip.name}</b></span>
          <div className="row gap">
            <button className="btn small" onClick={() => setCfg(editing)}>Nạp vào bảng</button>
            <button className="btn small primary" onClick={updateSelected}>Cập nhật clip</button>
          </div>
        </div>
      )}

      {saved.length > 0 && (
        <>
          <div className="section-title">Nhân vật của dự án</div>
          <div className="char-chips">
            {saved.map((c) => (
              <span key={c.id} className={`char-chip ${cfg.name === c.name ? 'active' : ''}`}>
                <button className="link-btn" onClick={() => setCfg((x) => ({ ...x, name: c.name, look: c.look, voice: c.voice || x.voice }))}>{c.name}</button>
                <button className="link-btn muted" title="Xoá khỏi dự án" onClick={() => remove(c.id)}>×</button>
              </span>
            ))}
          </div>
        </>
      )}

      <div className="section-title">Chọn mẫu</div>
      <div className="char-grid">
        {Object.entries(CHARACTER_PRESETS).map(([id, p]) => (
          <button key={id} className="char-card" onClick={() => setCfg((c) => ({ ...fromPreset(id, c.voice), action: c.action, expression: c.expression, background: c.background }))} title={p.label}>
            <img src={`/characters/${id}.png`} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')} />
            <span>{p.label}</span>
          </button>
        ))}
      </div>

      <div className="form compact">
        <label className="field"><span>Tên</span><input value={cfg.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <div className="field"><span>Giọng nói</span><VoicePicker value={cfg.voice} onChange={(v) => set({ voice: v })} /></div>
        <div className="field col"><span>Động tác</span><Chips list={Object.entries(CHARACTER_ACTIONS)} value={cfg.action} onChange={(v) => set({ action: v })} /></div>
        <div className="field col"><span>Biểu cảm</span><Chips list={Object.entries(CHARACTER_EXPRESSIONS)} value={cfg.expression} onChange={(v) => set({ expression: v })} /></div>

        <button className="link-btn small" onClick={() => setMore(!more)}><Icon name={more ? 'chevdown' : 'chevron'} size={11} /> Ngoại hình (da, tóc, trang phục…)</button>
        {more && (
          <>
            <div className="field col"><span>Dáng</span><Chips list={[['kid', 'Trẻ em'], ['adult', 'Người lớn']]} value={L.build} onChange={(v) => setLook({ build: v as any })} /></div>
            <div className="field col"><span>Màu da</span><Swatches list={SKINS} value={L.skin} onChange={(v) => setLook({ skin: v })} /></div>
            <div className="field col"><span>Kiểu tóc</span><Chips list={HAIR_STYLES} value={L.hairStyle} onChange={(v) => setLook({ hairStyle: v as any })} /></div>
            <div className="field col"><span>Màu tóc</span><Swatches list={HAIRS} value={L.hair} onChange={(v) => setLook({ hair: v })} /></div>
            <div className="field col"><span>Trang phục</span><Chips list={OUTFITS} value={L.outfit} onChange={(v) => setLook({ outfit: v as any })} /></div>
            <div className="field col"><span>Màu áo · quần · giày · điểm nhấn</span>
              <div className="row gap">
                {(['shirt', 'pants', 'shoes', 'accent'] as const).map((k) => <input key={k} type="color" value={(L as any)[k]} onChange={(e) => setLook({ [k]: e.target.value })} title={k} />)}
              </div>
            </div>
            <div className="field col"><span>Mũ</span><Chips list={HATS} value={L.hat} onChange={(v) => setLook({ hat: v as any })} /></div>
            <div className="field col"><span>Râu</span><Chips list={BEARDS} value={L.beard} onChange={(v) => setLook({ beard: v as any })} /></div>
            <div className="row gap wrap">
              <label className="row gap small"><input type="checkbox" checked={!!L.glasses} onChange={(e) => setLook({ glasses: e.target.checked })} /> Kính</label>
              <label className="row gap small"><input type="checkbox" checked={!!L.tie} onChange={(e) => setLook({ tie: e.target.checked })} /> Cà vạt</label>
              <label className="row gap small"><input type="checkbox" checked={!!L.blush} onChange={(e) => setLook({ blush: e.target.checked })} /> Má hồng</label>
            </div>
          </>
        )}
        <label className="field"><span>Nền khi thêm thành cảnh</span>
          <select value={cfg.background} onChange={(e) => set({ background: e.target.value })}>{BACKGROUNDS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        </label>
      </div>

      <div className="char-actions">
        <button className="btn small primary" onClick={() => add('sequence')} title="Thêm một cảnh 5 giây vào cuối track chính"><Icon name="plus" size={12} /> Thêm thành cảnh</button>
        <button className="btn small" onClick={() => add('overlay')} title="Đặt nhân vật (nền trong suốt) lên trên video tại playhead"><Icon name="layers" size={12} /> Đặt lên video</button>
        <button className="btn small" onClick={save} title="Lưu ngoại hình + giọng để dùng lại ở các cảnh khác"><Icon name="check" size={12} /> Lưu nhân vật</button>
      </div>

      <div className="section-title">Cho nhân vật nói</div>
      <div className="scene-line">
        <textarea rows={2} placeholder={`Câu thoại của ${cfg.name}…`} value={line} onChange={(e) => setLine(e.target.value)} />
        <div className="row gap">
          <div className="spacer" />
          <button className="btn small primary" disabled={!line.trim() || !cfg.voice} onClick={speak}><Icon name="mic" size={12} /> Nói</button>
        </div>
        <span className="muted small">Đọc tại playhead bằng giọng đã chọn; clip nhân vật cùng giọng sẽ tự nhép môi.</span>
      </div>
      <button className="btn small char-ask" onClick={ask}><Icon name="sparkle" size={12} /> Nhờ Claude dựng phim hoạt hình với nhân vật này</button>
    </div>
  );
};

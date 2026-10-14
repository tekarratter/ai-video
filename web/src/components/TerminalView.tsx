import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { onMessage, send } from '../ws';
import { useStore } from '../store';

/** Live view of the shared tmux pane running `claude`. Keystrokes go straight to the CLI. */
export const TerminalView: React.FC = () => {
  const box = useRef<HTMLDivElement>(null);
  const tmux = useStore((s) => s.tmux);

  useEffect(() => {
    const term = new Terminal({
      fontFamily: 'JetBrains Mono, Menlo, Consolas, monospace',
      fontSize: 12,
      theme: { background: '#0d1117', foreground: '#d1d5db' },
      cursorBlink: true,
      convertEol: true,
      scrollback: 0,
    });
    term.open(box.current!);
    // Measure how many cells fit, so tmux can match the panel size.
    const fit = () => {
      const el = box.current!;
      const core = (term as any)._core; // eslint-disable-line @typescript-eslint/no-explicit-any
      const cw = core?._renderService?.dimensions?.css?.cell?.width || 7.2;
      const ch = core?._renderService?.dimensions?.css?.cell?.height || 15;
      const cols = Math.max(40, Math.floor((el.clientWidth - 8) / cw));
      const rows = Math.max(10, Math.floor((el.clientHeight - 4) / ch));
      return { cols, rows };
    };
    const size = fit();
    term.resize(size.cols, size.rows);
    send({ type: 'terminal-open', ...size });

    const off = onMessage((m) => {
      if (m.type === 'open') send({ type: 'terminal-open', ...fit() });
      if (m.type !== 'terminal') return;
      if (m.cols && m.rows && (m.cols !== term.cols || m.rows !== term.rows)) term.resize(m.cols, m.rows);
      const lines = String(m.screen).replace(/\n$/, '').split('\n');
      term.write('\x1b[H\x1b[2J' + lines.join('\x1b[0m\r\n') + `\x1b[${(m.cy ?? 0) + 1};${(m.cx ?? 0) + 1}H`);
    });
    const dataSub = term.onData((d) => send({ type: 'terminal-input', data: d }));
    const ro = new ResizeObserver(() => {
      const s = fit();
      send({ type: 'terminal-resize', ...s });
    });
    ro.observe(box.current!);
    term.focus();
    return () => {
      ro.disconnect();
      off();
      dataSub.dispose();
      send({ type: 'terminal-close' });
      term.dispose();
    };
  }, []);

  return (
    <div className="term-wrap">
      <div className="term-hint">CLI dùng chung · gõ trực tiếp ở đây, hoặc trong terminal: <code>tmux attach -t {tmux}</code></div>
      <div className="term" ref={box} />
    </div>
  );
};

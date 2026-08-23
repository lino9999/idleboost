import { useEffect, useRef, useState } from 'react';
import { Terminal as TerminalIcon, Eraser } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import Tip from '../components/Tip';
import { asf } from '../lib/api';
import { formatUptime } from '../lib/format';
import { useApp } from '../App';

const STREAM_COLORS = {
  stderr: '\x1b[38;5;215m',
  system: '\x1b[38;5;117m',
  rotation: '\x1b[38;5;141m',
  scheduler: '\x1b[38;5;84m',
  storage: '\x1b[38;5;116m',
  updater: '\x1b[38;5;87m',
  datasync: '\x1b[38;5;109m',
  hours: '\x1b[38;5;183m',
  profile: '\x1b[38;5;147m',
  cards: '\x1b[38;5;220m'
};

export default function Console() {
  const { status } = useApp();
  const holderRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);

  useEffect(() => {
    const term = new Terminal({
      fontSize: 12,
      fontFamily: '"Cascadia Code", Consolas, "Courier New", monospace',
      scrollback: 6000,
      theme: {
        background: '#0a0e17',
        foreground: '#cbd5e1',
        cursor: '#66c0f4',
        selectionBackground: '#2a475e',
        blue: '#66c0f4',
        cyan: '#66c0f4'
      }
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(holderRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const write = ({ line, stream }) => {
      const color = STREAM_COLORS[stream];
      term.write(color ? `${color}${line}\x1b[0m\r\n` : `${line}\r\n`);
    };

    let alive = true;
    asf
      .logHistory()
      .then((lines) => {
        if (alive && Array.isArray(lines)) lines.forEach(write);
      })
      .catch(() => {});

    const off = asf.onLog(write);
    const onResize = () => fit.fit();
    window.addEventListener('resize', onResize);

    return () => {
      alive = false;
      off();
      window.removeEventListener('resize', onResize);
      term.dispose();
    };
  }, []);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <TerminalIcon size={16} className="text-steam" /> Live ASF Output
        </div>

        <Tip tip="Blue = system, orange = stderr, purple = rotation, green = auto-unlock, cyan = storage, bright blue = updater">
          <span className="chip border-white/10 bg-night-800 text-slate-400">stdout / stderr / system</span>
        </Tip>

        {status && (
          <Tip tip={`ASF process state — PID ${status.pid || '—'}, uptime ${formatUptime(status.uptimeMs)}, auto-restarts ${status.restarts}`}>
            <span className={`chip ${status.running ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-rose-400/30 bg-rose-400/10 text-rose-300'}`}>
              {status.running ? `PID ${status.pid} • up ${formatUptime(status.uptimeMs)}` : 'Process stopped'}
            </span>
          </Tip>
        )}

        <div className="ml-auto">
          <Tip tip="Clear the terminal screen (does not affect ASF itself)">
            <button className="btn-ghost" onClick={() => termRef.current && termRef.current.clear()}>
              <Eraser size={14} /> Clear
            </button>
          </Tip>
        </div>
      </div>

      <div className="card min-h-0 flex-1 overflow-hidden !bg-[#0a0e17] p-2">
        <div ref={holderRef} className="h-full w-full" />
      </div>
    </div>
  );
}

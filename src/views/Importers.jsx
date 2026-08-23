import { useCallback, useMemo, useState } from 'react';
import { CheckCircle2, FileUp, FilePlus2, Loader2, Upload, XCircle } from 'lucide-react';
import Tip from '../components/Tip';
import { asf } from '../lib/api';
import { useApp } from '../App';

function sanitize(name) {
  return String(name || '')
    .replace(/[^\w.\- ]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 64);
}

function parseAccounts(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'))
    .map((line) => {
      const parts = line.split(':');
      const login = (parts[0] || '').trim();
      const password = (parts[1] || '').trim();
      const sharedSecret = (parts[2] || '').trim();
      return { login, password, sharedSecret, valid: !!login && !!password };
    });
}

function ResultList({ results }) {
  if (!results || results.length === 0) return null;
  return (
    <div className="mt-4 max-h-56 space-y-1 overflow-y-auto">
      {results.map((r, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          {r.ok ? (
            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400" />
          ) : (
            <XCircle size={14} className="mt-0.5 shrink-0 text-rose-400" />
          )}
          <span className={r.ok ? 'text-slate-300' : 'text-rose-300'}>
            <span className="font-mono font-bold">{r.name || r.file}</span>
            {r.ok ? ' imported' : ` — ${r.error}`}
            {r.ok && r.hadSecret && ' (shared secret noted — import a .maFile for full 2FA)'}
            {r.ok && r.botConfigFound === false && ' (warning: no matching bot config — check the account name)'}
            {r.ok && r.bot && ` (linked to bot "${r.bot}")`}
          </span>
        </div>
      ))}
    </div>
  );
}

function AccountImporter() {
  const { toast } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);

  const parsed = useMemo(() => parseAccounts(text), [text]);
  const validCount = parsed.filter((p) => p.valid).length;

  const doImport = async () => {
    setBusy(true);
    setResults(null);
    try {
      const accounts = parsed
        .filter((p) => p.valid)
        .map((p) => ({ login: p.login, password: p.password, sharedSecret: p.sharedSecret, name: sanitize(p.login) }));
      const res = await asf.importAccounts({ accounts, overwrite: true });
      setResults(res);
      const ok = res.filter((r) => r.ok).length;
      toast(`Account import finished: ${ok}/${res.length} succeeded`, ok === res.length ? 'success' : 'warn');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center gap-2">
        <FilePlus2 size={17} className="text-steam" />
        <h2 className="text-base font-bold text-white">Account Importer</h2>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Paste lines in the format <code className="text-slate-300">username:password:sharedSecret</code> (the shared
        secret is optional). Existing bots with the same name are replaced. Bot configs are created{' '}
        <span className="text-slate-300">disabled</span> — start them from the Start Warming section.
      </p>

      <Tip tip="One account per line: username:password[:sharedSecret]. Lines starting with # are ignored." block>
        <textarea
          className="input h-40 resize-y font-mono text-xs"
          placeholder={'account1:password1\naccount2:password2:sharedSecret2FA...'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Tip>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-xs text-slate-500">
          {validCount} valid / {parsed.length} lines
        </span>
        <div className="ml-auto">
          <Tip tip="Generate bot .json configs in the ASF config folder (ASF picks them up automatically)">
            <button className="btn-primary" disabled={busy || validCount === 0} onClick={doImport}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Import {validCount}{' '}
              accounts
            </button>
          </Tip>
        </div>
      </div>

      {parsed.length > 0 && (
        <div className="mt-4 max-h-48 overflow-y-auto rounded-lg border border-white/[0.06]">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-night-800 text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2">Bot name</th>
                <th className="px-3 py-2">Login</th>
                <th className="px-3 py-2">Password</th>
                <th className="px-3 py-2">2FA secret</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {parsed.map((p, i) => (
                <tr key={i} className="border-t border-white/[0.04]">
                  <td className="px-3 py-1.5 font-mono text-slate-300">{sanitize(p.login) || '—'}</td>
                  <td className="px-3 py-1.5 text-slate-400">{p.login || '—'}</td>
                  <td className="px-3 py-1.5 text-slate-500">{p.password ? '••••••' : '—'}</td>
                  <td className="px-3 py-1.5">{p.sharedSecret ? <span className="text-emerald-300">present</span> : <span className="text-slate-600">none</span>}</td>
                  <td className="px-3 py-1.5">{p.valid ? <span className="text-emerald-300">valid</span> : <span className="text-rose-300">missing login/password</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ResultList results={results} />
    </div>
  );
}

function MaFileImporter() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);

  const doImport = useCallback(
    async (paths) => {
      setBusy(true);
      setResults(null);
      try {
        const res = await asf.importMafiles({ paths, overwrite: true });
        setResults(res);
        const ok = res.filter((r) => r.ok).length;
        toast(`maFile import finished: ${ok}/${res.length} succeeded`, ok === res.length ? 'success' : 'warn');
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        setBusy(false);
      }
    },
    [toast]
  );

  const pickFiles = async () => {
    try {
      const r = await asf.openFiles({
        title: 'Select .maFile authenticators',
        filters: [{ name: 'Mobile authenticator', extensions: ['maFile'] }],
        properties: ['openFile', 'multiSelections']
      });
      if (r.canceled || !r.filePaths.length) return;
      await doImport(r.filePaths);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center gap-2">
        <FileUp size={17} className="text-grape-soft" />
        <h2 className="text-base font-bold text-white">.maFile Importer (2FA)</h2>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Pick your Steam mobile authenticator files: each one is matched to a bot by its{' '}
        <code className="text-slate-300">account_name</code> and copied immediately as{' '}
        <code className="text-slate-300">&lt;botName&gt;.maFile</code> into the ASF config folder — the official
        MobileAuthenticator plugin then fills 2FA codes automatically at login. Existing files are replaced.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Tip tip="Choose one or more .maFile files - they are imported automatically as soon as you select them">
          <button className="btn-primary" disabled={busy} onClick={pickFiles}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />} Select .maFile files
          </button>
        </Tip>
      </div>

      <ResultList results={results} />
    </div>
  );
}

export default function Importers() {
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <AccountImporter />
      <MaFileImporter />
    </div>
  );
}

export function parseProxyLine(line) {
  const s = String(line || '').trim();
  if (!s || s.startsWith('#')) return null;
  let scheme = 'http';
  let rest = s;
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(s);
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase();
    rest = s.slice(schemeMatch[0].length);
  }
  let auth = '';
  let hostport = rest;
  const at = rest.lastIndexOf('@');
  if (at !== -1) {
    auth = rest.slice(0, at);
    hostport = rest.slice(at + 1);
  }
  let username = '';
  let password = '';
  if (auth) {
    const ci = auth.indexOf(':');
    if (ci === -1) {
      username = auth;
    } else {
      username = auth.slice(0, ci);
      password = auth.slice(ci + 1);
    }
  }
  const ci2 = hostport.lastIndexOf(':');
  if (ci2 === -1) return null;
  const host = hostport.slice(0, ci2);
  const port = hostport.slice(ci2 + 1);
  if (!host || !/^\d+$/.test(port)) return null;
  return { scheme, username, password, host, port: Number(port) };
}

export function parseProxyList(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const proxies = [];
  const invalid = [];
  for (const l of lines) {
    const p = parseProxyLine(l);
    if (p) proxies.push(p);
    else invalid.push(l);
  }
  return { proxies, invalid };
}

export function formatProxy(p) {
  if (!p || !p.host) return '';
  return `${p.scheme || 'http'}://${p.host}:${p.port}`;
}

const COUNTRY_CODES = [
  'US', 'GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'PT', 'SE',
  'NO', 'DK', 'FI', 'PL', 'CZ', 'AT', 'CH', 'IE', 'CA', 'AU',
  'BR', 'AR', 'MX', 'JP', 'KR', 'GR', 'RO', 'HU', 'TR', 'RU'
];

const PRIVACY_PUBLIC = 3;

function decodeEntities(str) {
  return String(str || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_m, d) => {
      try {
        return String.fromCharCode(parseInt(d, 10));
      } catch {
        return _m;
      }
    })
    .replace(/&amp;/g, '&');
}

function randomCountry() {
  return COUNTRY_CODES[Math.floor(Math.random() * COUNTRY_CODES.length)];
}

class SteamWeb {
  constructor({ api, log }) {
    this.api = api;
    this.log = log || (() => {});
  }

  _note(msg) {
    if (this.log) this.log(msg);
  }

  cookieHeader(cookies) {
    return `sessionid=${cookies.sessionid}; steamLoginSecure=${cookies.loginSecure}; Steam_Language=english; timezoneOffset=0,0`;
  }

  async getCookies(bot) {
    let out;
    try {
      out = await this.api.command(`cookies ${bot}`);
    } catch (e) {
      throw new Error(`cookies command failed: ${e.message}`);
    }
    const text = typeof out === 'string' ? out : JSON.stringify(out);
    let sessionid = '';
    let loginSecure = '';

    const pairs = text.match(/[a-zA-Z0-9_\-]+\s*[=:]\s*"[^"]*"|[a-zA-Z0-9_\-]+\s*[=:]\s*[^;\s"',}\]]+/g) || [];
    for (const raw of pairs) {
      const m = raw.match(/^([a-zA-Z0-9_\-]+)\s*[=:]\s*"?([^";,}\]]+)"?$/);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const val = m[2].trim();
      if (!val) continue;
      if (key === 'sessionid' && !sessionid) sessionid = val;
      if (key === 'steamloginsecure' && !loginSecure) loginSecure = val;
    }

    if (!sessionid) {
      const m = text.match(/sessionid["'=:\s]+([A-Za-z0-9%\-_]+)/i);
      if (m) sessionid = m[1];
    }
    if (!loginSecure) {
      const m = text.match(/steamLoginSecure["'=:\s]+([^;\s"',}\]]+)/i);
      if (m) loginSecure = m[1];
    }

    if (!sessionid || !loginSecure) {
      throw new Error('Could not read the web session cookies (is the bot logged in and DevFeature enabled?)');
    }
    return { sessionid, loginSecure };
  }

  async _fetch(url, cookies, options = {}) {
    const res = await fetch(url, {
      redirect: 'manual',
      ...options,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Cookie: this.cookieHeader(cookies),
        ...(options.headers || {})
      }
    });
    return res;
  }

  async resolveProfileBase(cookies) {
    const res = await this._fetch('https://steamcommunity.com/my', cookies);
    if (res.status !== 302 && res.status !== 301) {
      throw new Error(`Could not resolve the profile URL (HTTP ${res.status})`);
    }
    const location = res.headers.get('location') || '';
    const match = location.match(/steamcommunity\.com(\/(id|profiles)\/[^/?#]+)/);
    if (!match) {
      throw new Error(`Could not parse the profile URL from redirect: ${location}`);
    }
    return match[1];
  }

  async _getEditConfig(cookies, base, page) {
    const res = await this._fetch(`https://steamcommunity.com${base}/edit/${page}`, cookies);
    if (res.status !== 200) {
      throw new Error(`Failed to load profile settings (HTTP ${res.status})`);
    }
    const html = await res.text();
    const m = html.match(/data-profile-edit(?:-config)?\s*=\s*"((?:[^"\\]|\\.)*)"/) || html.match(/data-profile-edit\s*=\s*'([^']*)'/);
    if (!m) {
      throw new Error('Could not find the profile edit configuration on the page');
    }
    let raw = decodeEntities(m[1]);
    raw = decodeEntities(raw);
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error('Could not parse the profile edit configuration');
    }
  }

  async setupProfile(cookies, base) {
    try {
      await this._fetch(`https://steamcommunity.com${base}/edit?welcomed=1`, cookies);
    } catch {
      /* best effort - only needed for brand-new profiles */
    }
  }

  async getCountry(cookies) {
    try {
      const base = await this.resolveProfileBase(cookies);
      const cfg = await this._getEditConfig(cookies, base, 'info');
      return (cfg.LocationData && cfg.LocationData.locCountryCode) || '';
    } catch {
      return '';
    }
  }

  async editProfile(cookies, { summary, country } = {}) {
    const base = await this.resolveProfileBase(cookies);
    await this.setupProfile(cookies, base);
    const existing = await this._getEditConfig(cookies, base, 'info');
    const location = existing.LocationData || {};
    const values = {
      sessionID: cookies.sessionid,
      type: 'profileSave',
      weblink_1_title: '',
      weblink_1_url: '',
      weblink_2_title: '',
      weblink_2_url: '',
      weblink_3_title: '',
      weblink_3_url: '',
      personaName: existing.strPersonaName || '',
      real_name: existing.strRealName || '',
      summary: summary !== undefined ? summary : existing.strSummary || '',
      country: country !== undefined ? country : location.locCountryCode || '',
      state: location.locStateCode || '',
      city: location.locCityCode || '',
      customURL: existing.strCustomURL || '',
      json: '1'
    };
    const res = await this._fetch(`https://steamcommunity.com${base}/edit`, cookies, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values).toString()
    });
    if (res.status !== 200) {
      throw new Error(`Profile save failed (HTTP ${res.status})`);
    }
    const body = await res.text();
    try {
      const json = JSON.parse(body);
      if (json && json.success !== 1 && json.success !== true) {
        throw new Error(json.errmsg || 'Profile save was not successful');
      }
    } catch (e) {
      if (e instanceof SyntaxError) return { ok: true, base };
      throw e;
    }
    return { ok: true, base };
  }

  async setPrivacyPublic(cookies) {
    const base = await this.resolveProfileBase(cookies);
    await this.setupProfile(cookies, base);
    let existing = {};
    try {
      const cfg = await this._getEditConfig(cookies, base, 'settings');
      existing = (cfg.Privacy && cfg.Privacy.PrivacySettings) || {};
    } catch {
      existing = {};
    }
    // Skip the request entirely if every relevant setting is already public.
    const alreadyPublic =
      Number(existing.PrivacyProfile) === PRIVACY_PUBLIC &&
      Number(existing.PrivacyFriendsList) === PRIVACY_PUBLIC &&
      Number(existing.PrivacyInventory) === PRIVACY_PUBLIC &&
      Number(existing.PrivacyInventoryGifts) === PRIVACY_PUBLIC &&
      Number(existing.PrivacyOwnedGames) === PRIVACY_PUBLIC &&
      Number(existing.PrivacyPlaytime) === PRIVACY_PUBLIC;
    if (alreadyPublic) {
      return { ok: true, base, already: true };
    }
    const privacy = { ...existing };
    privacy.PrivacyProfile = PRIVACY_PUBLIC;
    privacy.PrivacyFriendsList = PRIVACY_PUBLIC;
    privacy.PrivacyInventory = PRIVACY_PUBLIC;
    privacy.PrivacyInventoryGifts = PRIVACY_PUBLIC;
    privacy.PrivacyOwnedGames = PRIVACY_PUBLIC;
    privacy.PrivacyPlaytime = PRIVACY_PUBLIC;
    const eCommentPermission = 1;

    const form = new FormData();
    form.append('sessionid', cookies.sessionid);
    form.append('Privacy', JSON.stringify(privacy));
    form.append('eCommentPermission', String(eCommentPermission));

    const res = await this._fetch(`https://steamcommunity.com${base}/ajaxsetprivacy/`, cookies, {
      method: 'POST',
      body: form
    });
    if (res.status !== 200) {
      throw new Error(`Privacy update failed (HTTP ${res.status})`);
    }
    const body = await res.text();
    try {
      const json = JSON.parse(body);
      if (json && json.success !== 1 && json.success !== true) {
        throw new Error('Privacy update was not successful');
      }
    } catch (e) {
      if (e instanceof SyntaxError) return { ok: true, base };
      throw e;
    }
    return { ok: true, base };
  }
}

module.exports = { SteamWeb, randomCountry };

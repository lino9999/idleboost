const CURRENCIES = {
  1: ['USD', '$', 2],
  2: ['GBP', '£', 2],
  3: ['EUR', '€', 2],
  4: ['CHF', 'CHF ', 2],
  5: ['RUB', '₽', 2],
  6: ['PLN', 'zł ', 2],
  7: ['BRL', 'R$', 2],
  8: ['JPY', '¥', 0],
  9: ['NOK', 'kr ', 2],
  10: ['IDR', 'Rp', 0],
  11: ['MYR', 'RM', 2],
  12: ['PHP', '₱', 2],
  13: ['SGD', 'S$', 2],
  14: ['THB', '฿', 2],
  15: ['VND', '₫', 0],
  16: ['KRW', '₩', 0],
  17: ['TRY', '₺', 2],
  18: ['UAH', '₴', 2],
  19: ['MXN', 'Mex$', 2],
  20: ['CAD', 'C$', 2],
  21: ['AUD', 'A$', 2],
  22: ['NZD', 'NZ$', 2],
  23: ['CNY', 'CN¥', 2],
  24: ['INR', '₹', 2],
  25: ['CLP', 'CL$', 0],
  26: ['PEN', 'S/', 2],
  27: ['COP', 'COL$', 0],
  28: ['ZAR', 'R', 2],
  29: ['HKD', 'HK$', 2],
  30: ['TWD', 'NT$', 2],
  31: ['SAR', 'SR ', 2],
  32: ['AED', 'AED ', 2],
  34: ['ARS', 'AR$', 2],
  35: ['ILS', '₪', 2],
  36: ['BYN', 'Br ', 2],
  37: ['KZT', '₸', 0],
  38: ['KWD', 'KD ', 2],
  39: ['QAR', 'QR ', 2],
  40: ['CRC', '₡', 0],
  41: ['UYU', '$U', 2]
};

export function formatWallet(balance, currency) {
  const c = CURRENCIES[currency];
  if (!c || !Number.isFinite(balance)) return null;
  const [, symbol, decimals] = c;
  const value = balance / (decimals === 0 ? 1 : 100);
  return `${symbol}${value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })}`;
}

export function currencyCode(currency) {
  return CURRENCIES[currency] ? CURRENCIES[currency][0] : `CUR:${currency}`;
}

export function formatMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatUptime(ms) {
  if (!ms) return '—';
  return formatMs(ms);
}

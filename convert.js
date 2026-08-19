// Pure conversion helpers. No DOM, no network — so selftest.mjs can import them.
//
// Rounding here is DISPLAY ONLY. Every value that feeds another calculation
// stays at full float precision; the converter rounds on the way to the screen
// and never on the way back in.

/** Currencies the converter offers, in display order. */
export const CURRENCIES = ['EUR', 'USD', 'RUB', 'AED'];

/**
 * Parse an amount the way a person actually types it.
 *
 * Handles both decimal conventions plus grouping, because a Russian, French or
 * German keyboard produces "1 234,56" and a US one produces "1,234.56".
 *
 * Ambiguity rule: a lone separator followed by exactly three digits is grouping
 * ("1,500" is fifteen hundred), unless the integer part is just "0" — nobody
 * means zero-thousand-something by "0,123".
 *
 * @returns {number|null} null when there is no number to read
 */
export function parseAmount(raw) {
  if (typeof raw !== 'string') return null;

  // \s already covers U+00A0 and U+202F; the apostrophe is the Swiss grouping mark.
  let s = raw.replace(/[\s'’]/g, '');
  s = s.replace(/[^\d.,]/g, ''); // drop currency signs, minus, letters
  if (!s) return null;

  const dots = (s.match(/\./g) || []).length;
  const commas = (s.match(/,/g) || []).length;

  let decimalSep = null;
  if (dots && commas) {
    // Whichever comes last is the decimal point: "1.234,56" vs "1,234.56".
    decimalSep = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
  } else if (dots + commas === 1) {
    const sep = dots ? '.' : ',';
    const [head, tail] = s.split(sep);
    const isGrouping = tail.length === 3 && head.length > 0 && head !== '0';
    decimalSep = isGrouping ? null : sep;
  }
  // More than one of a single kind ("1.234.567") can only be grouping.

  if (decimalSep === null) {
    s = s.replace(/[.,]/g, '');
  } else {
    const groupSep = decimalSep === '.' ? ',' : '.';
    s = s.split(groupSep).join('');
    const cut = s.lastIndexOf(decimalSep);
    s = `${s.slice(0, cut).split(decimalSep).join('')}.${s.slice(cut + 1)}`;
  }

  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read a whole instruction: "1000 usd to eur", "100000 rub в eur", "50 EUR->RUB".
 *
 * Shape only — whether the codes name real currencies is the caller's business,
 * so it can say "no rate for GBP" instead of going silent. Returns null unless
 * the line is complete, so a half-typed query never disturbs what is on screen.
 */
const COMMAND = /^\s*([\d\s.,'’]+?)\s*([a-z]{3,4})\s*(?:to|into|in|в|->|→|=)\s*([a-z]{3,4})\s*$/i;

export function parseCommand(text, known = null) {
  if (typeof text !== 'string') return null;
  const m = COMMAND.exec(text);
  if (!m) return null;

  const amount = parseAmount(m[1]);
  if (amount === null) return null;

  const from = m[2].toUpperCase();
  const to = m[3].toUpperCase();
  if (known && (!known.includes(from) || !known.includes(to))) return null;

  return { amount, from, to };
}

/**
 * Cross rate between two currencies given a table quoted against one base.
 * @param {Record<string, number>} rates rates per 1 unit of the table's base
 */
export function crossRate(rates, from, to) {
  const a = rates?.[from];
  const b = rates?.[to];
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  return b / a;
}

/**
 * Reduce an API payload to a plain rate table plus the moment it describes.
 *
 * Keeps every currency the feed sends, not just the four in CURRENCIES: with no
 * picker to populate there is no reason to throw the rest away, and it costs
 * nothing — the payload already carries them. A table missing any of the four
 * majors is treated as broken rather than partially usable.
 */
export function normalizeRates(payload, base) {
  const rates = payload?.rates;
  if (!rates || typeof rates !== 'object') return null;

  const table = { [base]: 1 };
  for (const [code, value] of Object.entries(rates)) {
    const v = Number(value);
    if (Number.isFinite(v) && v > 0) table[code.toUpperCase()] = v;
  }
  if (!CURRENCIES.every((code) => table[code])) return null;

  // fxratesapi gives unix seconds; open.er-api gives its own field.
  const seconds = Number(payload.timestamp ?? payload.time_last_update_unix);
  const at =
    Number.isFinite(seconds) && seconds > 0
      ? seconds * 1000
      : Date.parse(payload.date ?? payload.time_last_update_utc ?? '') || null;

  return { table, at };
}

/**
 * Math.ceil that ignores the float dust left by decimal arithmetic, so an exact
 * 85.2 does not creep up to 85.3 just because it is stored as 85.20000000000001.
 */
function ceilQuiet(x) {
  return Math.ceil(x - Math.abs(x) * Number.EPSILON * 8);
}

/**
 * Round an amount up to whole units — no kopecks, erring in the reader's favour.
 * Below one unit that would turn 0.06 into 1, so sub-unit values keep two
 * decimals; the "within a ruble" tolerance does not apply when the whole
 * number is smaller than a ruble.
 */
export function ceilAmount(n) {
  if (!Number.isFinite(n)) return n;
  if (n !== 0 && Math.abs(n) < 1) return ceilQuiet(n * 100) / 100;
  return ceilQuiet(n);
}

// Intl emits a narrow no-break space for some locales; Geist has no glyph for
// it, so fold it to the regular one to keep the number in a single face.
const singleFace = (s) => s.replace(/ /g, ' ');

/** Money, rounded up to whole units. Never feed this back into a calculation. */
export function formatAmount(n, locale) {
  if (!Number.isFinite(n)) return '';
  const v = ceilAmount(n);
  const decimals = v !== 0 && Math.abs(v) < 1 ? 2 : 0;
  return singleFace(
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(v),
  );
}

/**
 * Rates, at three significant figures: 1.15997 reads as 1.16, 85.1952 as 85.2.
 *
 * Nearest, not upward — unlike amounts. Rounding a rate up crosses a whole
 * figure on the smallest excess: 1.1604 would become 1.17, an 0.8% overstatement,
 * which is a bigger error than the stale feed this converter replaced. Amounts
 * can absorb a unit of slack; a rate cannot.
 */
export function formatRate(n, locale) {
  if (!Number.isFinite(n)) return '';
  return singleFace(
    new Intl.NumberFormat(locale, { maximumSignificantDigits: 3 }).format(n),
  );
}

/** "just now" / "3 min ago" / "yesterday", via Intl so it localises itself. */
export function formatAge(at, now, locale) {
  if (!at) return '';
  const seconds = Math.round((at - now) / 1000);
  if (Math.abs(seconds) < 45) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'second');
  }

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const steps = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
  ];

  let value = seconds;
  for (const [unit, span] of steps) {
    if (Math.abs(value) < span) return rtf.format(value, unit);
    value = Math.round(value / span);
  }
  return rtf.format(value, 'week');
}

// Run: node selftest.mjs   — exits non-zero if the money math or parsing breaks.
import assert from 'node:assert/strict';
import {
  parseAmount, parseCommand, crossRate, normalizeRates,
  ceilAmount, formatAmount, formatRate,
} from './convert.js';

let checks = 0;
const is = (actual, expected, label) => {
  checks++;
  assert.deepEqual(actual, expected, `${label}: got ${JSON.stringify(actual)}`);
};
const ok = (cond, label) => { checks++; assert.ok(cond, label); };

// --- parseAmount: the separator conventions a real keyboard produces ---
is(parseAmount('1000'), 1000, 'plain');
is(parseAmount('1234.56'), 1234.56, 'us decimal');
is(parseAmount('1234,56'), 1234.56, 'eu decimal');
is(parseAmount('1,234.56'), 1234.56, 'us grouped');
is(parseAmount('1.234,56'), 1234.56, 'eu grouped');
is(parseAmount('1 234,56'), 1234.56, 'ru grouped, plain space');
is(parseAmount('1 234,56'), 1234.56, 'ru grouped, nbsp');
is(parseAmount('1 234,56'), 1234.56, 'fr grouped, narrow nbsp');
is(parseAmount("1'234.56"), 1234.56, 'swiss apostrophe');
is(parseAmount('1.234.567'), 1234567, 'repeated dot is grouping');
is(parseAmount('1,234,567'), 1234567, 'repeated comma is grouping');
is(parseAmount('1,500'), 1500, 'lone sep + 3 digits is grouping');
is(parseAmount('0,123'), 0.123, 'leading zero forces decimal');
is(parseAmount('1,5'), 1.5, 'one trailing digit is decimal');
is(parseAmount(''), null, 'empty');
is(parseAmount('abc'), null, 'letters only');
is(parseAmount(null), null, 'non-string');
is(parseAmount('€1 000,50'), 1000.5, 'currency sign stripped');
is(parseAmount('-500'), 500, 'minus dropped — amounts are not negative');

// --- parseCommand: "1000 usd to eur" ---
is(parseCommand('1000 usd to eur'), { amount: 1000, from: 'USD', to: 'EUR' }, 'canonical');
is(parseCommand('100000 rub to eur'), { amount: 100000, from: 'RUB', to: 'EUR' }, 'rub to eur');
is(parseCommand('  50 EUR To AED '), { amount: 50, from: 'EUR', to: 'AED' }, 'case and padding');
is(parseCommand('1 234,56 eur to rub'), { amount: 1234.56, from: 'EUR', to: 'RUB' },
  'grouped amount inside a command');
is(parseCommand('1000 usd в eur'), { amount: 1000, from: 'USD', to: 'EUR' }, 'russian preposition');
is(parseCommand('1000 usd -> eur'), { amount: 1000, from: 'USD', to: 'EUR' }, 'arrow');
is(parseCommand('1000 usd into eur'), { amount: 1000, from: 'USD', to: 'EUR' }, 'into');

// Half-typed or unsupported input must leave the screen alone.
is(parseCommand('1000 usd to eu'), null, 'incomplete target');
is(parseCommand('1000 usd'), null, 'no target at all');
is(parseCommand('1000'), null, 'plain number is not a command');
is(parseCommand('usd to eur'), null, 'no amount');
is(parseCommand('1000 usdt to eur'), { amount: 1000, from: 'USDT', to: 'EUR' },
  'four-letter ticker');

// Shape and existence are separate jobs: the parser accepts any plausible code
// so the caller can say "no rate for GBP" instead of going quiet.
is(parseCommand('1000 gbp to eur'), { amount: 1000, from: 'GBP', to: 'EUR' },
  'unknown code still parses');
is(parseCommand('1000 gbp to eur', ['EUR', 'USD']), null,
  'and is refused when a known list is supplied');
is(parseCommand(''), null, 'empty');
is(parseCommand(null), null, 'non-string');

// --- crossRate ---
const table = { EUR: 1, USD: 1.160464, RUB: 98.7787, AED: 4.262386 };
is(crossRate(table, 'EUR', 'USD'), 1.160464, 'base to quote');
is(crossRate(table, 'USD', 'USD'), 1, 'identity');
is(crossRate(table, 'EUR', 'GBP'), null, 'unknown currency');
is(crossRate({ EUR: 1, USD: 0 }, 'EUR', 'USD'), null, 'zero rate rejected');
is(crossRate(null, 'EUR', 'USD'), null, 'no table');

const there = 1000 * crossRate(table, 'EUR', 'RUB');
const back = there * crossRate(table, 'RUB', 'EUR');
ok(Math.abs(back - 1000) < 1e-9, `round trip drifted: ${back}`);
ok(Math.abs(crossRate(table, 'USD', 'AED') - 3.6725) < 0.01, 'AED peg looks wrong');

// --- normalizeRates ---
const fx = normalizeRates(
  { timestamp: 1787127540, rates: { USD: 1.160464, RUB: 98.7787, AED: 4.262386 } }, 'EUR',
);
is(fx.table.EUR, 1, 'base pinned to 1');
is(fx.at, 1787127540000, 'unix seconds to ms');
is(normalizeRates({ rates: { USD: 1.16 } }, 'EUR'), null, 'missing major refused');
is(normalizeRates({ rates: { USD: 1.16, RUB: 0, AED: 4.26 } }, 'EUR'), null, 'zero refused');

// Everything the feed sends is kept, not just the four majors.
const wide = normalizeRates(
  { timestamp: 1, rates: { USD: 1.16, RUB: 98.8, AED: 4.26, gbp: '0.85', JUNK: 'x', ZERO: 0 } },
  'EUR',
);
is(wide.table.GBP, 0.85, 'extra currency kept, code upper-cased, string coerced');
is(wide.table.JUNK, undefined, 'unparseable entry dropped');
is(wide.table.ZERO, undefined, 'zero entry dropped');
ok(crossRate(wide.table, 'GBP', 'RUB') > 0, 'and it is usable as a cross');
is(normalizeRates({}, 'EUR'), null, 'no rates key');
is(normalizeRates(null, 'EUR'), null, 'no payload');

// --- rates round to nearest; amounts round up ---
is(formatRate(1.15997, 'en-US'), '1.16', 'the case that started this');
is(formatRate(1.1604, 'en-US'), '1.16', 'and it does NOT jump to 1.17');
is(formatRate(85.1952, 'en-US'), '85.2', 'rate above ten');
is(formatRate(3.6725, 'en-US'), '3.67', 'the AED peg');
is(formatRate(0.011742, 'en-US'), '0.0117', 'sub-unit rate keeps its figures');
is(formatRate(Number.NaN, 'en-US'), '', 'NaN renders empty');

// A displayed rate must never overstate by more than half a figure.
for (const r of [1.15997, 1.1604, 85.1952, 3.6725, 0.011742, 23.186]) {
  const shown = Number(formatRate(r, 'en-US'));
  ok(Math.abs(shown - r) / r < 0.005, `rate ${r} shown as ${shown} drifts too far`);
}

// Amounts round upward, and values already exact must not creep.
is(ceilAmount(1000), 1000, 'exact 1000 stays 1000');
is(ceilAmount(1159.01), 1160, 'a hundredth over rounds up a whole unit');
is(ceilAmount(1159.99), 1160, 'so does almost a whole unit');
is(ceilAmount(0.06), 0.06, 'below one unit keeps two decimals');
is(ceilAmount(0), 0, 'zero');

is(formatAmount(1159.8231, 'en-US'), '1,160', 'no kopecks');
is(formatAmount(1000, 'en-US'), '1,000', 'whole amount unchanged');
is(formatAmount(98850.04, 'en-US'), '98,851', 'rounds up');
is(formatAmount(0.058, 'en-US'), '0.06', 'sub-unit stays readable');
is(formatAmount(Number.NaN, 'en-US'), '', 'NaN renders empty');

// What is shown must survive being read back, or editing a field corrupts it.
for (const n of [1159.8231, 1000, 98850.04, 1234567.89, 0.058]) {
  const shown = formatAmount(n, 'en-US');
  is(parseAmount(shown), ceilAmount(n), `round trip through the field: ${shown}`);
}
for (const n of [1159.8231, 1000, 98850.04, 1234567.89]) {
  const shown = formatAmount(n, 'ru-RU');
  is(parseAmount(shown), ceilAmount(n), `round trip in a ru locale: ${shown}`);
}

// --- the guarantee the whole design rests on: display never feeds the model ---
// Converting 1000 EUR and reading the rounded result back must not equal the
// exact conversion — if it did, the model would be storing a rounded number.
const rate = crossRate(table, 'EUR', 'USD');
const exact = 1000 * rate;
const displayed = parseAmount(formatAmount(exact, 'en-US'));
ok(displayed !== exact, 'the displayed amount is genuinely a rounded view');
ok(Math.abs(displayed - exact) < 1, 'and it is within one unit of the truth');
// The exact value must still invert cleanly; the rounded one would not.
ok(Math.abs(exact / rate - 1000) < 1e-9, 'exact value inverts to the original');

console.log(`ok — ${checks} checks passed`);

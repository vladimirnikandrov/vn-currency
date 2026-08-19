# Currency converter

One line in, one line out. Write `1000 eur to rub` and read the answer.

**Live:** https://vladimirnikandrov.github.io/vn-currency/

    1000 eur to rub          →   98,879 RUB
    100000 rub to eur        →   1,012 EUR
    1 234,56 eur to usd      →   1,433 USD
    2000 usd в rub           →   170,408 RUB

`to` can also be `in`, `into`, `в`, `->` or `=`. Case does not matter, and the amount takes whatever your keyboard produces: `1234.56`, `1234,56`, `1 234,56`, `1'234.56`.

There is no currency picker, so there is no list to be limited by — any code the feed carries works, which is about 600 including crypto. `1000 gbp to thb` and `1 btc to usd` both answer.

## How it gets the rate

Google's converter reports Morningstar's mid-market rate, refreshed about once a minute. Matching it means using a feed that moves at the same speed, which rules out the once-a-day fixings most free APIs serve.

| Source | Role | Why |
|---|---|---|
| [Coinbase](https://api.coinbase.com/v2/exchange-rates?currency=USD) | primary | Keyless, `Access-Control-Allow-Origin: *`, continuous. Sampled against Google Finance it sat within 0.003% on USD/RUB and returns the exact 3.6725 AED peg. |
| [FXRatesAPI](https://api.fxratesapi.com/) | fallback | Same terms, different company, so one outage cannot take both. Slightly worse on RUB — its ruble is pinned at 85.12000 and only moves in the eighth decimal. |

Both are asked for a USD table and every pair is crossed from it, the way Google itself derives AED/RUB from the dollar peg. Mixing bases would be worse: Coinbase's own EUR table disagrees with its USD table by 0.026%.

Measured against Google Finance on 19 Aug 2026 — 26 paired reads of EUR/RUB, 20 seconds apart, over nine minutes:

| | Gap to Google |
|---|---|
| Coinbase, crossed through USD (shipped) | +0.040% min, **+0.065% mean**, +0.078% max |
| Coinbase, EUR base directly | +0.068% |
| fawazahmed0 | −0.071% |
| open.er-api (the old build) | −0.118% |

A single sample can look far better than that — one read showed +0.0155% — but the sustained figure is the honest one: **typically under 0.1%**, about 65 ₽ on 1000 EUR. The old build's error was worse and, being a once-daily fix, grew through the session instead of oscillating.

This is not Google's number and cannot become one. Google's converter reads Morningstar; every keyless feed is an independent aggregator of the same market. Two live feeds disagree by hundredths of a percent, and for RUB especially, since 2022 it no longer trades on major venues, so Morningstar, Coinbase and the CBR fix genuinely differ rather than one being wrong.

Nor is "byte-identical to Google" a coherent target: Google serves the same tick at two precisions from one second to the next — 98.5032432 and 98.5032, 98.5184791 and 98.5185 — while its printed UI rounds to four decimals anyway.

Google produces about one genuine move every 75–90 seconds, so this polls every 60 seconds while the tab is open, and again the moment you return to it. Faster polling returns the identical number.

## Rounding

The screen rounds; the arithmetic does not. Conversion runs on the parsed amount at full precision, and rounding happens once, on the way to the text.

Amounts round **up** to whole units, so a total lands within a ruble rather than showing kopecks nobody wants. Below one unit that would turn 0.06 into 1, so sub-unit values keep two decimals.

Rates round to the **nearest** three significant figures, not up, and carry a `≈`. Rounding a rate up crosses a whole figure on the smallest excess — 1.1604 would read as 1.17, an 0.8% overstatement, worse than the stale feed this converter replaced. Amounts can absorb a unit of slack; a rate cannot.

## Files

    index.html      markup, styles, and the DOM wiring
    convert.js      pure parsing, cross-rate and formatting helpers
    selftest.mjs    node selftest.mjs — asserts the money math
    fonts/          Geist Sans, subset to the glyphs used

No build step, no dependencies. Open `index.html` through any static server; ES modules will not load over `file://`.

## Notes

A half-typed line changes nothing on screen — the query applies only once it is complete. An unknown code says so rather than going quiet.

Rates are mid-market and carry no spread, so they are a reference, not what a bank will quote you.

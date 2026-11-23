# cbBTC Trend-Breakout Bot

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/aint965/btc-race-24h-20261123/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/aint965/btc-race-24h-20261123/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

A trading bot for the [make.fun bounty **btc-race-24h-20261123-0511**](https://make.fun/bounty/btc-race-24h-20261123-0511):
race a BTC trading bot live for 24 hours. It trades Coinbase Wrapped BTC
(cbBTC) against USDC, minute by minute, in a replay of on-chain 1-minute bars
from the Orca Whirlpool, starting with 1,000 USDC of paper money. Long only,
no shorts, no leverage.

## Strategy

On 1-minute bars the price barely moves most minutes (median |1-minute move|
~3 bps on the dev window) while a full-size round trip costs ~26–35 bps in
fees, slippage and price impact — so frequent trading is a guaranteed bleed.
This bot trades rarely: it waits for a genuine uptrend, rides it with a
trailing stop, and otherwise sits in cash.

**Entry** (flat only, needs 90 bars of history):

- **Slow trend filter:** SMA(20) above SMA(90), and the close above SMA(20) —
  buy strength, never a falling knife.
- **Breakout:** the close is the highest close of the last 30 bars.
- **Momentum gate:** the close is at least 100 bps above the close 30 bars
  ago, so a flat drift through the moving averages never triggers a buy.
- **Cooldown:** no re-entry within 60 bars of an exit, to stop whipsaw churn.
- **No entries in the final 45 bars:** too little time left to out-earn the
  round-trip cost before the window flattens everything at the last close.
- **Size:** 100% of cash. One asset, one position; the trailing stop — not
  position size — caps the downside.

**Exit** (holding):

- **Trend flip:** SMA(20) crosses back below SMA(90).
- **Trailing stop:** the close falls 200 bps below the highest close seen
  since entry — well above normal hourly chop, so ordinary pullbacks do not
  shake the bot out, but a real reversal locks in most of the gain.
- **Fade exit:** the position is up more than 300 bps and the last 15 minutes
  turned down more than 20 bps — momentum is fading after a big run, so bank
  it instead of giving it back.

Every order caps slippage at 100 bps (1%): wide enough that normal fills are
never rejected, tight enough that a fill into a liquidity hole is refused and
retried next bar. All decisions use only the bars seen so far and the account
the harness reports; no clock, no network, no randomness — two runs on the
same data produce the same orders.

## Local dev grade

Graded with the kit's `grade-local` on the frozen 24-hour dev window
(1,440 one-minute bars):

| Metric | Value |
| --- | --- |
| Net PnL | **+7.36 USDC** (+0.74%) |
| Trades | 4 (win rate 50%) |
| Max drawdown | 2.11% (guardrail: ≤ 25%) |
| Sharpe (per bar) | 0.0092 |
| Fees | 1.61 USDC (net PnL at 2× fees: +5.76 USDC) |
| Rejected orders | 0 |

Guardrails met. The bot was revised twice after its first grade: the first
draft overtraded (18 trades, −16.13 USDC) on a 60-bar slow average, a 25 bps
momentum gate and an 80 bps trailing stop; slowing the trend filter to 90
bars, raising the momentum gate to 100 bps and widening the trailing stop to
150 bps cut it to 4 trades and +6.05 USDC; widening the stop to 200 bps so a
normal pullback inside an intact uptrend no longer shakes it out brought it
to +7.36 USDC.

## Running it

The bot speaks `agent-fun/bars-replay/v1` (newline-delimited JSON on
stdin/stdout) via the kit SDK shim vendored at `vendor/makefun-bars.ts`. It
runs on Node 22 with no dependencies to install:

```sh
node main.ts
```

Grade it locally from the kit directory:

```sh
node cli/makefun.mjs grade-local --kit . --bot <this repository> --driver process
```

## Files

- `main.ts` — the bot (entrypoint).
- `vendor/makefun-bars.ts` — the kit SDK shim, copied byte-for-byte.
- `README.md` — this file.
- `LICENSE` — MIT.
- `.makefun/owner.json` — entry claim file.

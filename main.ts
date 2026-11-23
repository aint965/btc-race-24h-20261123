// cbBTC trend-breakout bot — original design.
//
// Idea: on 1-minute bars the price barely moves most minutes (median |1m move|
// ~3 bps on the dev window) while a full-size round trip costs ~26-35 bps, so
// frequent trading is a guaranteed bleed. This bot therefore trades rarely:
// it waits for a genuine uptrend, rides it with a trailing stop, and otherwise
// sits in cash. It never shorts and never uses leverage.
//
// Entry (flat only, needs 60 bars of history):
//   * SMA(20) above SMA(60) — the slow trend filter; price must also sit above
//     SMA(20), so we only buy strength, never a falling knife.
//   * Breakout: the close is the highest close of the last 30 bars.
//   * Momentum gate: the close is at least 100 bps above the close 30 bars ago,
//     so a flat drift through the moving averages does not trigger a buy.
//   * Cooldown: no re-entry within 60 bars of an exit, to stop whipsaw churn
//     after a stop-out.
//   * No entries in the final 45 bars: too little time left to out-earn the
//     round-trip cost before the window flattens everything at the last close.
//   * Size: 100% of cash. One asset, one position, and the trailing stop — not
//     position size — is what caps the downside.
//
// Exit (holding):
//   * Trend flip: SMA(20) crosses back below SMA(60).
//   * Trailing stop: the close falls 200 bps below the highest close seen since
//     entry. 200 bps is well above the typical 1-minute noise and the normal
//     hourly chop, so ordinary pullbacks do not shake the bot out, but a real
//     reversal locks in most of the gain.
//   * Fade exit: the position is up more than 300 bps and the last 15 minutes
//     turned down more than 20 bps — momentum is fading after a big run, so
//     bank it instead of giving it back.
//
// Slippage cap 100 bps (1%) on every order: wide enough that normal fills are
// never rejected, tight enough that a fill into a liquidity hole is refused
// and retried next bar. All decisions use only the bars seen so far and the
// account the harness reports; no clock, no network, no randomness.

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const FAST_BARS = 20;
const SLOW_BARS = 90;
const BREAKOUT_BARS = 30;
const MOMENTUM_BARS = 30;
/** Entry needs a 30-bar return above this, in bps. */
const ENTRY_MOMENTUM_BPS = 100;
/** Bars to wait after an exit before a new entry. */
const COOLDOWN_BARS = 60;
/** No new entries in the last N bars of the window (1440 bars). */
const NO_ENTRY_TAIL_BARS = 45;
/** Trailing stop: exit when the close is this many bps below the peak since entry. */
const TRAIL_BPS = 200;
/** Fade exit: gain above this (bps) plus a 15-bar fall above this (bps) exits. */
const FADE_GAIN_BPS = 300;
const FADE_FALL_BPS = 20;
const FADE_BARS = 15;
const MAX_SLIPPAGE_BPS = 100;

/** Closes seen so far, oldest first, as plain numbers (ratios are scale-free). */
const closes: number[] = [];
/** Highest close since the current entry (raw price units), 0 when flat. */
let peakSinceEntry = 0;
/** Seq of the last exit; -1e9 until the first one. */
let lastExitSeq = -1000000;

function sma(n: number): number | null {
  if (closes.length < n) return null;
  let sum = 0;
  for (let i = closes.length - n; i < closes.length; i++) sum += closes[i];
  return sum / n;
}

/** Highest close of the last n bars including the current one. */
function highest(n: number): number {
  let hi = -Infinity;
  for (let i = Math.max(0, closes.length - n); i < closes.length; i++) {
    if (closes[i] > hi) hi = closes[i];
  }
  return hi;
}

/** Return in bps between the current close and the close n bars ago, or null. */
function retBps(n: number): number | null {
  if (closes.length <= n) return null;
  const then = closes[closes.length - 1 - n];
  const now = closes[closes.length - 1];
  return ((now / then) - 1) * 10000;
}

await runBars({
  onBatch(state: BarsState, batch) {
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      closes.push(Number(bar.c));
    }
    if (state.warmingUp) return [];
    if (closes.length === 0) return [];

    const close = closes[closes.length - 1];
    const held = state.positions.get(SYMBOL);
    const fast = sma(FAST_BARS);
    const slow = sma(SLOW_BARS);
    if (fast === null || slow === null) return [];

    // --- exit logic (holding) -------------------------------------------
    if (held !== undefined) {
      if (close > peakSinceEntry) peakSinceEntry = close;
      const value = state.value(SYMBOL, held.qty);
      const gainBps = value > 0n && held.cost > 0n
        ? Number(((value - held.cost) * 10000n) / held.cost)
        : 0;
      const trailHit = peakSinceEntry > 0 && close < peakSinceEntry * (1 - TRAIL_BPS / 10000);
      const trendDown = fast < slow;
      const fade15 = retBps(FADE_BARS);
      const fadeHit = gainBps > FADE_GAIN_BPS && fade15 !== null && fade15 < -FADE_FALL_BPS;
      if (trendDown || trailHit || fadeHit) {
        lastExitSeq = state.seq;
        peakSinceEntry = 0;
        const sell: SellInput = { side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS };
        return [sell];
      }
      return [];
    }

    // --- entry logic (flat) ---------------------------------------------
    // Too close to the end of the 1440-bar window to earn back the round trip.
    if (state.seq >= 1440 - NO_ENTRY_TAIL_BARS) return [];
    if (state.seq - lastExitSeq < COOLDOWN_BARS) return [];
    if (state.cash < BigInt(state.hello.fees.min_notional_quote_units)) return [];

    const mom30 = retBps(MOMENTUM_BARS);
    const breakout = close >= highest(BREAKOUT_BARS);
    const uptrend = fast > slow && close > fast;
    if (uptrend && breakout && mom30 !== null && mom30 > ENTRY_MOMENTUM_BPS) {
      peakSinceEntry = close;
      const buy: BuyInput = {
        side: 'buy',
        symbol: SYMBOL,
        notional_quote_units: state.cash,
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      };
      return [buy];
    }
    return [];
  },
});

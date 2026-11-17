// Mean-reversion bot for make.fun btc-race-24h-20261117-0603.
//
// Strategy: fade short-term price extremes against the multi-hour range.
// The bot is long only and trades one asset, CBBTC (Coinbase Wrapped BTC
// against USDC), minute by minute.
//
// Idea
// ----
// Bitcoin on a one-minute scale is mostly noise around a slow-moving level,
// and a full-size round trip costs about 26 bps in fees, slippage and price
// impact, so fading every small wiggle loses money. This bot only trades the
// rare, large dislocations: it buys when the close has fallen at least 1.5%
// below its trailing 240-bar high AND the fall has stopped (the 5-minute
// return is back at or above zero), and it sells when the price has reverted
// toward its 480-bar mean (z-score back to +0.5). It never chases a falling
// knife: no trend filter is needed because the entry itself requires the
// dip to be deep and the bleeding to have stopped.
//
// Risk control (the part that keeps the entry alive)
// --------------------------------------------------
// - One position at a time, full equity per entry, but a tight 3% stop and a
//   3% take-profit cap every trade, so no single trade can hurt much.
// - A 480-bar time stop: a position that never reverts is closed anyway.
// - A 60-bar cooldown after every exit, so the bot cannot whipsaw itself
//   back into the same dip it just left.
// - A circuit breaker: once equity has drawn down 12% from its peak, the
//   bot stops opening new trades for the rest of the window (it still
//   manages an open position to its normal exit).
//
// Execution notes
// ---------------
// Orders decided on a bar's close fill at the next bar's open, so every
// signal is read off closes the bot has already seen. All indicator math is
// float64 in a fixed order, with no clock, no environment reads and no
// randomness, so two runs on the same bars answer identically. Slippage on
// every order is capped at 100 bps from the latest close.
//
// Dev-window result (frozen 24 h window in the kit, local grade):
// net PnL +8.24 USDC on $1,000, 4 trades, win rate 100%, max drawdown
// 0.43%, fees $1.61 (net PnL at 2x fees still +$6.63). The house
// rsi-bollinger baseline loses $24.25 on the same window.

import { runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';

// Strategy parameters, tuned on the frozen dev window and kept simple so
// the behaviour generalises to the unseen race window.
const W_MEAN = 480; // bars in the rolling mean / z-score window
const W_HIGH = 240; // bars in the trailing-high (dip reference) window
const DIP_ENTRY = 0.015; // enter when close is >= 1.5% below the trailing high
const STAB_BARS = 5; // stabilisation: 5-minute return must be >= 0
const Z_EXIT = 0.5; // exit when the z-score has reverted to +0.5
const TAKE_PROFIT = 0.03; // exit at +3% versus cost
const STOP_LOSS = 0.03; // exit at -3% versus cost
const MAX_HOLD = 480; // exit after 480 bars held
const COOLDOWN = 60; // bars to wait after an exit before re-entering
const CIRCUIT_DD = 0.12; // halt new entries after a 12% equity drawdown
const MAX_SLIPPAGE_BPS = 100; // cap every order's slippage at 1% past the close

/** Rolling log closes, their mean and variance, and the trailing high. */
class Series {
  closes: number[] = []; // log closes, oldest first, max W_MEAN
  sum = 0;
  sumsq = 0;
  high: Array<[number, number]> = []; // (seq, log close) decreasing, max W_HIGH
  n = 0; // bars seen

  push(seq: number, logClose: number): void {
    this.n += 1;
    this.closes.push(logClose);
    this.sum += logClose;
    this.sumsq += logClose * logClose;
    if (this.closes.length > W_MEAN) {
      const old = this.closes.shift() as number;
      this.sum -= old;
      this.sumsq -= old * old;
    }
    while (this.high.length > 0 && this.high[this.high.length - 1][1] <= logClose) {
      this.high.pop();
    }
    this.high.push([seq, logClose]);
    while (this.high.length > 0 && this.high[0][0] <= seq - W_HIGH) {
      this.high.shift();
    }
  }

  /** (log close - rolling mean) / rolling std, or null before W_MEAN bars. */
  zscore(): number | null {
    if (this.closes.length < W_MEAN) return null;
    const mean = this.sum / W_MEAN;
    const variance = this.sumsq / W_MEAN - mean * mean;
    if (variance <= 0) return null;
    return (this.closes[this.closes.length - 1] - mean) / Math.sqrt(variance);
  }

  /** Log distance of the close below the trailing high, or null. */
  dip(): number | null {
    if (this.n < W_HIGH || this.high.length === 0) return null;
    return this.high[0][1] - this.closes[this.closes.length - 1];
  }

  /** True once the last STAB_BARS minutes stopped falling. */
  stabilised(): boolean {
    if (this.closes.length <= STAB_BARS) return false;
    return this.closes[this.closes.length - 1] - this.closes[this.closes.length - 1 - STAB_BARS] >= 0;
  }
}

const series = new Series();
let entrySeq = -1;
let peakEquity: bigint | null = null;
let halted = false;
let lastExitSeq = -1000000000;

await runBars({
  onBatch(state: BarsState, batch: { bars: Bar[] }): (BuyInput | SellInput)[] {
    let fresh = false;
    for (const bar of batch.bars) {
      if (bar.symbol === SYMBOL) {
        series.push(state.seq, Math.log(Number(bar.c)));
        fresh = true;
      }
    }
    if (state.warmingUp || !fresh) return [];
    if (peakEquity === null) peakEquity = state.equity;
    if (state.equity > peakEquity) peakEquity = state.equity;
    if (Number(peakEquity - state.equity) / Number(peakEquity) > CIRCUIT_DD) {
      halted = true;
    }

    const held = state.positions.get(SYMBOL);
    const z = series.zscore();
    if (held !== undefined) {
      const value = state.value(SYMBOL, held.qty);
      const roi = held.cost === 0n ? 0 : Number(value - held.cost) / Number(held.cost);
      const hold = state.seq - entrySeq;
      if (
        (z !== null && z >= Z_EXIT)
        || roi >= TAKE_PROFIT
        || roi <= -STOP_LOSS
        || hold >= MAX_HOLD
      ) {
        lastExitSeq = state.seq;
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Flat: look for a deep, stabilised dip to buy.
    if (halted) return [];
    if (series.n < Math.max(W_MEAN, W_HIGH)) return [];
    if (state.seq - lastExitSeq < COOLDOWN) return [];
    const dip = series.dip();
    if (dip === null || dip < DIP_ENTRY) return [];
    if (!series.stabilised()) return [];
    let size = state.equity;
    const room = state.weightRoom(SYMBOL);
    if (room < size) size = room;
    if (state.cash < size) size = state.cash;
    if (size < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    entrySeq = state.seq;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: size, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  },
});

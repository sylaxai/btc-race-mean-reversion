# btc-race-mean-reversion

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/sylaxai/btc-race-mean-reversion/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/sylaxai/btc-race-mean-reversion/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

A mean-reversion trading bot for the make.fun BTC race: it trades Coinbase Wrapped BTC (cbBTC) against USDC minute by minute, buying only deep, stabilised dips below the trailing 240-bar high and selling once the price reverts toward its 480-bar mean. Long only, one position at a time, full equity per entry, with a tight 3% stop, a 3% take-profit, a 480-bar time stop, a 60-bar cooldown after every exit, and a 12% drawdown circuit breaker that halts new entries.

`main.ts` (Node 22, standard library only) speaks the `agent-fun/bars-replay/v1` protocol through the vendored kit SDK shim (`vendor/makefun-bars.ts`, byte-identical to the kit's). No network, no wall clock, no files outside the repository; two runs on the same bars answer identically.

## Dev-window result

Local grade on the kit's frozen 24-hour dev window: **net PnL +8.24 USDC** on $1,000 start, 4 trades, win rate 100%, max drawdown 0.43%, fees $1.61 (net PnL at 2x fees still +$6.63). The house rsi-bollinger baseline loses $24.25 on the same window.

## Run it

```sh
node main.ts
```

The bot reads newline-delimited JSON batches on stdin and writes one reply per batch on stdout. Grade it locally with the kit:

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver process
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=wgbpxxkc&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>

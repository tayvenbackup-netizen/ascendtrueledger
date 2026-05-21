## Coin Detail Overlay

A full-screen overlay that slides in when you tap an asset row in the wallet's asset list. Replicates the reference screenshots/video 1:1.

### Behavior

- Tap any asset row in the asset list → overlay slides in from the right
- Back arrow (top-left) closes it
- Settings icon (top-right) opens existing settings overlay
- Header is sticky and matches the screen background; once you scroll, it collapses to `{Name} \n {$balance}` centered (per ref image 2/4)

### Layout (top to bottom)

1. **Sticky header** — back arrow, settings cog
2. **Account name + native balance** — e.g. "Ethereum 2" / "0.01895688 ETH"
3. **Fiat balance** — `$40.61` (large)
4. **24h change pill** — `↗ 0.89% (+$0.36)` green/red
5. **Address pill** — QR icon + truncated address (`0x2FE7C1…FFEE406A0`)
6. **Price chart** — full-width SVG, reuses existing `fetchCoinChart` + render code, single-coin variant. Bottom-aligned, fades into background.
7. **Range tabs** — `1D 1W 1M 1Y ALL` (1D selected = filled chip)
8. **"Powered by [chain] Labs · More info"** card (chain-specific label)
9. **QUICK ACTIONS** grid (2 rows × 3):
   - Row 1: Receive · Send · Stake (ETH/SOL only — others show Earn or hide)
   - Row 2: Sell · Buy · Swap
10. **TOKENS (n)** section — chain-specific token list (USDC, CRO, cbBTC for ETH; USDC, PUMP, RCON for SOL; etc.) with "Display more Tokens ▾" expander
11. **TRANSACTION HISTORY** — same renderer as main wallet but filtered to this coin, with date pills

### Where it goes

All injected via `scripts/build-bundle.mjs` so the obfuscated bundle stays the single source:
- HTML: new `<div id="coinDetailOverlay">` appended before `</body>`
- CSS: appended to `ledgerCss` (header, chart container, quick-action grid, token rows, etc.)
- JS: appended to `ledgerJs` — `openCoinDetail(coinKey)`, `closeCoinDetail()`, range tabs, single-coin chart builder (mirrors existing `buildChart` against `fetchCoinChart(coin, range)`), tokens list (static per chain), txn list filtered by `coin`
- Asset row click handler wired in the same injection block

### Token data

Each native coin shows a fixed list of "tokens on that chain" with mocked balances/prices that match the reference (USDC at ~$1, etc.). Values are deterministic per session so refresh stays consistent.

### Technical notes

- Reuses `RANGE_CONFIG`, `fetchCoinChart`, `getCachedPrice`, `fmtUSD`, `fmtAmount`, `loadTxns`
- Address per coin pulled from existing `loadSettings().addresses[coin]` (already generated)
- Chart line color = `COIN_COLORS[coin]`
- Overlay z-index above wallet, below settings overlay
- After build, copy `protected-build/bundle.json` → `supabase/functions/get-app-bundle/bundle.json` (already done by build script)

### Out of scope (this round)

- Functional Sell/Buy/Stake/Earn flows — buttons are visual only, tap = no-op or toast
- Live on-chain token balances — tokens are static reference list

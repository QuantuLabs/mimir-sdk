# AGENTS.md: integrating Mimir with `@quantulabs/mimir-sdk`

For coding agents adding Mimir prices to an application or a Solana program.

## Facts

- Mainnet program id: `hBYrGHXVCQsnduDERkVnViCXNYawpHCvN5y3GsMiMiR`. Do not use any other id for mainnet.
- Package: `@quantulabs/mimir-sdk`, Node.js 20.18+, ESM and CJS. The root exports one client, `Mimir`, and `MimirError`; it also runs in a browser. Everything else is in `@quantulabs/mimir-sdk/advanced` and may change.
- `new Mimir()` reads from the free keyless Mimir API (no RPC, no key). `new Mimir({ rpc })` reads on chain from your RPC only. Transactions always go to your `rpc`, else Solana's public RPC (rate-limited, refuses browsers): pass your own `rpc` to send transactions.
- `mimir.price` returns USDC prices, also for a SOL-quoted feed (converted through Mimir's own SOL/USDC feed). `getPrice` (`/advanced`) returns the feed's own quote: for a SOL-quoted feed, `quote: "SOL"` and `price` in SOL. Mimir uses no external price feed.

## The 5 snippets

**1. First price**

```ts
import { Mimir } from "@quantulabs/mimir-sdk";
const mimir = new Mimir();
const sol = await mimir.price("SOL");
console.log(sol.price, sol.slot, sol.confidenceBps); // e.g. 182.41 462544186n 12
```

**2. Live**

```ts
import { Mimir } from "@quantulabs/mimir-sdk";
const mimir = new Mimir();
const stop = mimir.watch(["SOL", "TSLAX"], (p) => console.log(p.ticker, p.price, p.quote?.symbol));
setTimeout(stop, 60_000);
```

**3. Create a feed** (Node; in a browser pass the connected wallet and your RPC: `new Mimir({ wallet, rpc })`)

```ts
import { Mimir } from "@quantulabs/mimir-sdk";
import { readFileSync } from "node:fs";
const mimir = new Mimir({ wallet: JSON.parse(readFileSync("wallet.json", "utf8")), rpc: process.env.RPC });
const feed = await mimir.createFeed({ mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" }); // WIF; 2 approvals
console.log(feed.ticker, feed.price.price, feed.price.quote);
```

**4. Create an index**

```ts
import { Mimir } from "@quantulabs/mimir-sdk";
import { readFileSync } from "node:fs";
const mimir = new Mimir({ wallet: JSON.parse(readFileSync("wallet.json", "utf8")), rpc: process.env.RPC });
const index = await mimir.createIndex({ ticker: "CHIPS", components: { MRVL: 1, INTC: 1, SKHY: 1 } });
console.log(index.ticker, index.price.price);
```

**5. On-chain** (refresh, then your instruction, in one transaction)

```ts
import { Mimir } from "@quantulabs/mimir-sdk";
import { Transaction } from "@solana/web3.js";
const mimir = new Mimir({ wallet, rpc: process.env.RPC });
const tx = new Transaction().add(...await mimir.withFreshPrice("SOL", [yourInstruction]));
// your program reads the SOL feed account after the refresh: see "Read the price onchain"
```

Variants, one line each:
- **Dry run:** `await mimir.createFeed({ mint, dryRun: true })` returns the steps, the approvals and the full SOL cost; it needs `rpc` but no wallet, and signs nothing.
- **RPC mode:** `new Mimir({ rpc })` reads and finds pools on your RPC only, with zero Mimir API calls.
- **Server + browser:** the server calls `createFeed({ mint, skipSend: true, payer })` and returns the next unsigned step; the browser signs it with `mimir.sign(step)` and posts it back with `resume` and `signed` (below).

## Read a price (offchain)

- `mimir.price` returns `price` (USDC, `null` with a `reason` when not priced), `quote`, `slot`, `updatedAt`, `confidenceBps`. The fields below come from `getPrice` in `/advanced`.
- Check `p.status` before using `p.price`: `"fresh"` use it; `"needs-refresh"` display only, or refresh in the same transaction (`withFreshPrice`); `"degraded"` display only; `"none"` no price.
- `p.mode === "current-point"`: one pool's price at this slot, no history; cap what you risk on it.
- `p.price` is a `number` for display. For math, use `p.priceX64` (exact, Q64.64, in the feed's own quote).
- `mimir.watch(feeds, onPrice, onError)` polls one batch request every 5 s (minimum 2 s); an error with `retry: "never"` stops it. It returns the unsubscribe function.

## Use a price in a transaction (onchain)

```ts
const ixs = await mimir.withFreshPrice("COLA", [yourInstruction]); // [compute budget, refresh(COLA), yourInstruction]
```

- Keep the returned order. Do not insert any instruction (compute budget, ATA creation, another refresh) between the last refresh and the consumer instruction.
- `withFreshPrice` takes SDK or `@solana/web3.js` `TransactionInstruction`s and returns the same type. `simulate: true` sets the compute limit to the simulated units plus the planned refresh units; it needs a payer that exists on chain with SOL.
- Pin `(p.feed, p.generation)` from `getPrice` (`/advanced`) in your program.
- In the consumer program: check the feed account owner equals the program id, check through the Instructions sysvar that the Mimir refreshes sit just before it (with k feeds, at relative positions -k to -1, in the order given), then read the feed account. Examples: https://github.com/QuantuLabs/mimir-cookbook.
- Onchain freshness (cookbook `fresh_at`): snapshot revision non-zero, status byte 0, quote status 0, routeability below 4, `valid_from_slot <= Clock.slot <= valid_until_slot`, lower bound non-zero. For a classic feed the refresh at −k..−1 has program id = Mimir, data[0] = 89, account 0 = the feed. A composite refresh is 87 with the composite at account 1 (account 0 = payer) and a different layout; no composite consumer example yet. A Rust consumer crate is coming.

## Create a feed (from code)

- `mimir.createFeed({ mint })` takes the token's MINT address, never a symbol (symbols are not unique). The ticker comes from the token's verified symbol (first free of `SYMBOL`, `SYMBOL1` … `SYMBOL19`); `ticker` overrides it.
- Run `createFeed({ mint, dryRun: true })` first and show `plan.steps`, `plan.totalLamports`, `plan.tariffCola` and `plan.warnings` before asking for any approval. It needs `rpc`, not a wallet.
- Two approvals by default: the COLA purchase (`buy-cola`), then CREATE with the first price (`create+price`). Never merge them.
- An existing feed for the mint → `FEED_EXISTS` with `error.feeds` (read it with `mimir.price(ticker)`); `variant: "new"` creates another one on purpose.
- `WALLET_REJECTED` or `PENDING`: call `createFeed` again with `after: error.signatures`: it checks the chain first and reuses the COLA already bought. Never re-sign a `PENDING` step by hand.
- Server + browser: `createFeed({ mint, skipSend: true, payer })` on the server, `mimir.sign(step)` in the browser, then post `{ resume, signed }` back (docs/CREATE.md).
- Costs: ticker fee in COLA (base × a multiplier by ticker length, set on chain by the protocol admin in AdminConfig and read at each creation; `dryRun` returns the live `tariffCola`/`totalLamports`), bought with SOL in its own transaction and burned, always in full, locked rent (V1 feeds cannot be closed), network fees. No Mimir fee on the classic first price or refreshes.
- Index: `mimir.createIndex({ ticker, components: { MRVL: 1, INTC: 1 } })`, 2 to 5 existing feeds; the activation and price fees come from AdminConfig too (`dryRun` → `activationFeeLamports`).
- Metadata (display name, image, categories) is managed in the Mimir App: https://app.mimirfeeds.io

## Errors

Catch errors and call `MimirError.from(error)`. Act on `retry`:

- `"now"`: rebuild from fresh reads, resend.
- `"after-refresh"`: the refresh is missing before your instruction.
- `"later"`: retry in a few seconds.
- `"never"`: stop; show `hint`.

## Do not

- Do not call `getProgramAccounts` yourself; resolve tickers with `mimir.price`.
- Do not treat `"needs-refresh"` or `"degraded"` as fresh offchain; a `live: true` result is a simulation, not an onchain state.
- Do not hardcode byte offsets offchain (`decodePrice` in `/advanced`). Onchain, until the Rust crate ships, copy the cookbook program's `feed` offsets and its `fresh_at` rule (docs/ONCHAIN.md).

## Working on this repository

```bash
npm ci
npm run build
npm test
npm run typecheck
```

Docs: https://mimirfeeds.io/docs/ · App: https://app.mimirfeeds.io

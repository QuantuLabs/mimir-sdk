# Create feeds and indexes

The short version is in the [README](../README.md#create-a-feed). This page has the details: what happens, every option, wallets, resuming, and the server + browser split.

Creation needs `rpc`, `dryRun` included: `new Mimir({ wallet, rpc })`.

## What happens

```text
 createFeed({ mint })
   │
   ├─ find the token's symbol, refuse it if it already has a feed  (FEED_EXISTS)
   ├─ find its pools on your RPC, check each on chain, pick the set
   ├─ pick the first free ticker: WIF, WIF1 … WIF19
   │
   ├─ approval 1   buy-cola       buys the ticker's COLA with SOL
   └─ approval 2   create+price   creates the feed, records its first price
                                  └─ waits for "finalized" → { state: "ready", … }
```

- **Each step** is built just in time. The wallet sees its exact review: simulated debit, network fee, writes, compute, size.
- **The wallet must not change** anything but the network fee; otherwise `REVIEW_CHANGED`, and nothing is sent.
- **Pools:** with `pools`, exactly those (each must hold the mint). Without, the SDK finds the token's pools on your RPC, checks them on chain, and picks the set the Mimir App would, possibly several pools.
- **Recipes:** chosen per pool (native-bounded, else current-point, else default); `recipe` overrides. Interval recipes throw `NOT_SUPPORTED` for now.
- **The COLA purchase** uses Jupiter's keyless `GET /swap/v2/build` (public, rate-limited). Every build is checked and simulated before you sign.

## Costs

All fees are set on chain by the protocol admin and read at each creation, so these docs quote no amount: run `createFeed({ mint, dryRun: true })`. A shorter ticker costs more. Feed rent stays locked: feeds cannot be closed. Token feed refreshes carry no Mimir fee. See [Fees](https://mimirfeeds.io/docs/guides/fees.html).

| Dry-run field | Meaning |
|---|---|
| `ticker` | The ticker the creation would claim |
| `steps` | Each step's `kind` (`"buy-cola"`, `"create+price"`) and cost |
| `tariffCola` | The ticker fee, in COLA. The `buy-cola` step buys it with SOL. |
| `totalLamports` | The SOL for rent and network fees, **without** the ticker fee |
| `warnings` | Anything worth reading before you create |

## `createFeed` options

| Option | Meaning |
|---|---|
| `mint` | The token mint to price (required) |
| `ticker` | Your own ticker instead of the automatic one |
| `quote` | `"USDC"` or `"SOL"`: only use pools with that quote. With `pools`, the quote of those pools (default `"USDC"`). Without, USDC pools unless the SOL pools score at least 5 higher. |
| `pools` | Your own pool addresses; each must hold the mint (else `NOT_FOUND`). Default: the SDK's pick. |
| `recipe` | Override the pricing recipe, one for all pools or one per pool |
| `require` | `"market-grade"` or `{ minScore }`: refuse a weaker pool set (`NO_POOL`) |
| `variant` | `"new"`: create another feed even if the token has one |
| `onStep` | Awaited progress events. `prepared` means « approve step `index` of `of` in your wallet ». |
| `after` | Resume an interrupted creation ([below](#resume-after-an-interruption)) |
| `dryRun` | Return the plan and cost; send nothing. Needs no wallet. |
| `skipSend`, `payer`, `resume`, `signed` | [Server + browser split](#server--browser-build-on-the-server-sign-in-the-browser) |

The result is `{ state: "ready", ticker, feed, price, signatures, cost }`: `price` as in [Read a price](../README.md#read-a-price), `signatures` each step's `{ kind, signature, slot }`, `cost` what the wallet spent, `{ sol, lamports }` (`"0"` in the server + browser split, which does not track it).

Display name, image and categories are managed in the [Mimir App](https://app.mimirfeeds.io).

## Index components

`createIndex` takes 2 to 5 components. Each one names an existing classic (token) feed, by ticker, feed address or mint, and must resolve to a live classic feed with **exactly one pool**.

| You give | The SDK uses |
|---|---|
| A ticker | That feed if it has one pool; otherwise a one-pool feed of the same mint, if one exists |
| A feed address | That feed; it must have one pool |
| A mint | That mint's one-pool feed, USDC-quoted first, then SOL |

No match gives `COMPOSITE_CHILD_MULTI_ROW` (the feed has several pools) or `INVALID_INPUT` (not a live classic feed): [ERRORS.md](./ERRORS.md).

Every component must have a fresh price when the index is created; otherwise the creation stops with `UNPRICEABLE` before the index is written. The COLA already bought stays in the wallet: call again with `after: error.signatures` once each component prices.

| `createIndex` option | Meaning |
|---|---|
| `ticker` | The index ticker (required), 1–12 of `A-Z0-9` |
| `components` | `{ [tickerFeedOrMint]: quantity }`: each component and its quantity in the basket |
| `quote` | `"USDC"` (default) or `"SOL"`. Each component must be quoted in the index's quote or in SOL; a USDC index converts SOL-quoted components. |
| `dryRun` | Return the plan and cost, with `activationFeeLamports`; send nothing |
| `onStep`, `after` | As in `createFeed` |

An index refresh that records a new price pays a refresh fee in SOL.

## Which wallet can I pass?

Any signer that can sign Transaction v1: a 64-byte secret key (CLI key file as JSON, `Uint8Array` or base58), a web3.js `Keypair`, a WebCrypto Ed25519 `CryptoKeyPair`, a `@solana/kit` signer, a Wallet Standard wallet (wallet-adapter: `useWallet().wallet`). Others are refused with `WALLET_UNSUPPORTED`.

## Resume after an interruption

If a creation stops after the COLA purchase (declined approval, network drop), the error carries `signatures`. Pass them back as `after`: the COLA already bought is reused. A new creation without `after` always buys its own COLA.

```ts
import { Mimir, MimirError } from "@quantulabs/mimir-sdk";
declare const wallet: unknown;
const mimir = new Mimir({ wallet, rpc: process.env.SOLANA_RPC_URL }), mint = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
try {
  await mimir.createFeed({ mint });
} catch (e) {
  if (e instanceof MimirError && e.signatures?.length) await mimir.createFeed({ mint, after: e.signatures });
  else throw e;
}
```

## Server + browser: build on the server, sign in the browser

The server holds the RPC and no secret. It returns each step unsigned; the browser signs it and posts it back.

```text
 browser (wallet)                         your server (rpc)
   │ { mint, skipSend: true, payer }  ──▶   │
   │                                  ◀──   │ { state: "sign", step }
   │ mimir.sign(step)                       │
   │ { …, resume, signed }            ──▶   │
   │                                  ◀──   │ next step, or { state: "ready" }
```

```ts
import { Mimir, type ServerStep } from "@quantulabs/mimir-sdk";
declare const post: (body: object) => Promise<ServerStep>;
declare const wallet: unknown;
const server = new Mimir({ rpc: process.env.SOLANA_RPC_URL }); // no wallet, no secret
export const handle = (body: Parameters<typeof server.createFeed>[0] & { skipSend: true; payer: string }) => server.createFeed(body);
const mimir = new Mimir({ wallet }), mint = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
let r = await post({ mint, skipSend: true, payer: mimir.address });
while (r.state === "sign") r = await post({ mint, skipSend: true, payer: mimir.address, resume: r, signed: await mimir.sign(r.step) });
```

- Each step is JSON-safe: no secret, no RPC URL.
- The server re-checks the signed transaction against the step. Any change beyond the network fee is `REVIEW_CHANGED`, and nothing is sent.
- It relays only the creation programs (Mimir, compute budget, system, SPL Token, Token-2022, associated token, Jupiter, Memo).
- One call can wait up to 120 s for `finalized`. Give the endpoint a longer timeout and cap its concurrency per payer.

To resume a split creation, pass the error's `signatures` back as `resume.after`:

```ts
import { MimirError, type ServerStep } from "@quantulabs/mimir-sdk";
declare const post: (body: object) => Promise<ServerStep>;
declare const r: ServerStep, e: unknown, mint: string, payer: string;
if (e instanceof MimirError && e.signatures) await post({ mint, skipSend: true, payer, resume: { ...r, after: e.signatures } });
```

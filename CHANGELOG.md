# Changelog

## 0.9.2 - 2026-10-30

### Added

- `mimir.sendWithFreshPrice(feeds, instructions)`: one Transaction V1 with the compute budget, the refreshes and your instructions, simulated, signed by the wallet, sent and confirmed. Returns `{ signature, slot }`. Fits every feed, indexes with a SOL conversion included. Prices that move during the approval rebuild it once.
- `mimir.buildWithFreshPrice(feeds, instructions, { payer })`: the same transaction unsigned, for `mimir.sign(step)` where the wallet is.
- `Price.categories` (API mode).
- `npm run check:live`: simulates the fresh-price transaction of every live feed on mainnet.

### Fixed

- `createFeed` without `rpc`, dry run included, throws `INVALID_INPUT` « createFeed needs rpc » before any network call.
- `cluster: "devnet"` gives the devnet hint.
- `UNPRICEABLE` after a landed COLA purchase says the create step was not sent and the COLA is kept for `after: error.signatures`.
- A custom `{ address, sign }` that returns something other than a `Uint8Array` throws `WALLET_UNSUPPORTED`.
- `AccountNotFound` in a simulation maps to `INSUFFICIENT_SOL`; « Blockhash not found » to `EXPIRED`; a raw `InstructionError` object keeps its JSON message.
- A failing `buildSwap` maps to `SWAP_UNAVAILABLE`.
- Index component hints say `createFeed({ mint, pools: [onePool] })`.

## 0.9.1 - 2026-10-30

- Docs reworded in a calmer tone, without warning boxes. Same code as 0.9.0.

## 0.9.0 - 2026-10-30

- First public npm release; same code as 0.8.3.

## 0.8.3 - 2026-10-29

### Fixed

- Pre-send check of the signed transaction: a creation that went stale during approval is rebuilt instead of reverting (`PLAN_STALE`, nothing sent, one re-plan).

## 0.8.2 - 2026-10-29

### Fixed

- Index components accept a feed account address as well as a feed id. A multi-row account is refused with `COMPOSITE_CHILD_MULTI_ROW` and its address, before any write.
- V1 classic: a set mixing spot rows with a bounded minority that the deployed program refuses (`mixed_majority_ok`) is refused with `CLASSIC_BOUNDED_WEIGHT_INSUFFICIENT` while planning, before any COLA purchase.
- The recommender never mixes recipe classes in a set: native-bounded only when every pool takes it, Default otherwise.
- `MimirError.from` keeps `CLASSIC_NATIVE_NOT_READY` (retry later) and `CLASSIC_BOUNDED_WEIGHT_INSUFFICIENT` as typed codes instead of `UNKNOWN`.
- `createFeed` without `require` no longer says « meets undefined » when no pool set scores.

### Removed

- The internal `api.list` client and its fixtures: GET /v1/feeds no longer takes `cursor`.

## 0.8.1 - 2026-10-29

### Added

- `marketFit(definition, cohort, intent)`: can this feed back a lending market as created, under a named profile. Returns `status` ("ready", "not-as-is" or "unknown"), the first `reason`, every `failures` and `missing` code, the `profile` and the `limits`. A known broken rule is "not-as-is"; a fact not supplied is "unknown", never guessed.
- Profiles `MARKET_STANDARD_STABLE` (default: IM/MM 500/250, max confidence 100, 45 s, BAND+VAULT, activation 250 USDC) and `MARKET_STANDARD_VOLATILE` (max confidence 300). Reason codes in `MARKET_FIT_FAIL` and `MARKET_FIT_MISSING`.
- `composeConfBps` and `normalizeSolToUsdc6` helpers. `normalizeSolToUsdc6` returns undefined for an invalid input (not a u64/u128 BigInt, decimals not an integer 0..18).
- Market fit from a create plan: `MARKET_RULES` (the lending market's parameters as data, revision 87607828; `marketFit` takes it as a last argument), and in `/beta` `planFitReads(plan, accounts?)` (the extra accounts to read; for a SOL quote call it again once the converter feed is read, to add its DLMM source pool and oracle), `planFit(plan + accounts)` (definition, cohort and intents from the V1 create path's own functions; the result carries its `rules`) and `marketFitForPlan(fit)` (the verdict under the plan's own rules, for the feed's quote as collateral and for the other one). Reference market: band seed/trade 500/50 USDC, point 2/1 USDC. At 2 USDC the LP cap (seed × min(kappa 1000, max trader OI 2000)) is 0.2 USDC, so every point plan is "not-as-is" `TRADE_CAPACITY` under this reference.
- `scoreFeed` returns `fitVerdict` next to `marketFit`, and takes `quote` and `fit: { cohort, intent, variant, definition }` for the facts pools do not carry. `fit.definition` (authenticated rows with depth, floor, liquidity, condition and binding) is passed to `marketFit` unchanged; the score never depends on the fit.

### Changed

- The automatic recipe (`recommend()`, `mimir.createFeed({ mint })`) picks the time-weighted price (native-bounded) only on Raydium CLMM pools, the one kind whose time-weighted price keeps going when the pool is quiet. Meteora DLMM and Raydium CPMM pools now get Default, which prices from the pool's current state. Native-bounded stays available on them as an explicit choice. The SOL/USDC base row is unchanged. `autoChoice` and `scoreInput` are exported from `/advanced`, and `scoreInput` passes the pool's adapter type.
- `scoreFeed` returns `pausesWhenQuiet`: true when a native-bounded DLMM or CPMM row would pause while its pool is quiet. Such a feed gets « Stays priced » 0 and `pauseCost` 0. CLMM, DUAL and Default rows are unchanged, so a single JUP-like pool under Default keeps its score.
- `extractMeteoraDlmmNativeTwapSample` takes an optional `activeId` (the LbPair active bin). A 60–120 s old latest record is extended to now with it; without it the call throws `stale-oracle` as before.
- Time-weighted readiness now follows the deployed program: a DLMM oracle up to 120 s old still counts (a 60–120 s old record is extended to now), and a quiet CPMM pool is measured from now, so it stays ready for about 30 minutes after its last swap.
- Creating a feed with an explicit native-bounded row checks the pool's history first and throws `MimirClassicNativeNotReadyError` before any COLA purchase when fewer than `policy.minSources` rows (default: all) would be ready. `readiness.readyAtUnixTs` is set only when the history is expected to be ready soon if trading continues, never before the last update + 61 s; it is absent when the pool has gone quiet. `mimirClassicNativeRebuild` reports `history-rebuilding` with `aboutSecs` whenever it is set.
- `scoreFeed`: the market fit no longer lowers the score; read `fitVerdict` / `marketFit` for it. `marketFit.fit` is true, false or null for "ready", "not-as-is" or "unknown". A single pool with a known confidence above the ceiling now fails, even with its mode unknown.
- Point and sampled rows of one exchange are represented by the first row in source order, as the program does. Spot keeps the fee comparator.
- `decodeFeedInfo` / `getFeedInfo`: a ring older than 150 slots at the read slot has a null depth, so `scoreFeed({ pools: info.pools })` is null without passing `slot`.
- `scoreFeed` ignores invalid activity, fees and confidences (non-finite or negative count as unknown), and returns null for an invalid `capBps` or `marketMaxConfBps`.
- `marketFit` validates every number and BigInt it reads, by domain and width: publication, history, converter and capacity evidence that is not an unsigned integer in range (counts u8, bps ≤ 10000, confidence/dispersion u16, D50/floor/capacity u64, liquidity u128) counts as not supplied ("unknown"); a bad `variant` (u16) is `MISSING_OI`; a bad mode, temporal kind or adapter is `MISSING_RECIPE`; a malformed rules object, policy field or profile field is `POLICY_INVALID`. The exported functions do not throw on bad JavaScript inputs, `scoreFeed` included (a numeric `slot` is accepted, a NaN or negative one gives null).
- Sources: `liquidity` / `condition` null means known absent (fails), undefined means not read (`MISSING_SOURCE_DEPTH` / `MISSING_BINDING`). New row field `binding` (the pool account read and owned by the planned program): false fails `SOURCE_CONDITION`, undefined is `MISSING_BINDING`. `planFit` projects a publication only when every pool account was read and bound.
- SOL converter: `cohort.converter.fresh` is required for "ready". `planFit` sets it from a refresh projection of the converter's own DLMM sources (ready → fresh, its bound = max(bin step, lag envelope); not ready → `EXPIRED`; not read → `MISSING_CONVERTER`). Identity, ACTIVE lifecycle, no notice, recipes and USDC quote stay required (`CONVERTER_INVALID`).
- Capacity: point and DUAL use the live D50 (position 3·D50, market 10·D50); `positionUsdc6` / `marketUsdc6` are intersected, never a replacement; DUAL also needs `positionUsdc6` (its native arm cap) or is `MISSING_CAPACITY`. Sampled keeps F/10 and F/4. Activation is min(half the seed, the normalized cap) against the minimum. The position cap is the normalized cap ∩ the LP cap. `planFit` no longer uses F/10 for a point position.
- Profiles: integer margins, maintenance < initial, 0 < kappa ≤ 10000, 0 < max trader OI ≤ 10000, staleness > 0, 0 < max position ≤ 2^44 micro-USDC, minimum activation > 0, collateral "stable" / "volatile"; otherwise `POLICY_INVALID`. The margin pair must be the standard 500/250 or the high-leverage 200/100 within its confidence/staleness bounds (`MARKET_RULES.margins` / `highRisk`), else `RISK_PROFILE`. Checked before any "ready"; a FAIL wins over a MISSING.
- Single-source proof (one native-bounded row, or interval rows only): counts 1/1/1, coverage ≥ 9000, dispersion ≤ 50 and deviation 50 are each checked from the policy, with or without a publication. `planFit` applies the clamp to interval plans too.
- Composite: `cfcMaxConfBps` and `cfcMaxDispersionBps` are both required (`MISSING_POLICY` when absent, never zero).
- `planFit` compares the rules' snapshot and config image versions, not only lengths.
- A proven multi-pool confidence above the ceiling is "not-as-is".
- DUAL rows cap a position at 3·D50.
- A non-spot row without its temporal kind, or without its adapter when a recipe of its mode lists adapters (native, interval, point), is "unknown" (`MISSING_RECIPE`), never guessed; a known unsupported tuple fails `RECIPE_UNSUPPORTED`. `ScorePool` takes optional `adapterType` and `temporalKind`.
- A composite without `componentSkewSlots` is "unknown" (`MISSING_CLOCK`); above 2 slots it fails `COMPONENT_SKEW`.
- `recommend({ require: "market-grade" })` keeps its 0.8.0 meaning, without a ×1.25 margin.
- A fact that cannot be authenticated is "unknown", never "ready":
  - `planFit` authenticates every read pool, primary and converter source, with the SDK capture reader (owner, allocation, discriminator, status, oriented mints, the expected vaults). Another account fails (`SOURCE_CONDITION`, or `CONVERTER_INVALID` for a converter source); no Clock or no reader is `MISSING_BINDING`.
  - The SOL converter is refreshed in the trade transaction, so only its sources prove it: a stored price fresh at the read slot no longer does. A source known absent is `CONVERTER_INVALID`; not ready, `EXPIRED`; not read, `MISSING_CONVERTER`.
  - SOL quote, except live point: the converter's cap (F/10 of its publication floor) is intersected through `capacity.converterUsdc6`; absent is `MISSING_CAPACITY`. `planFit` does not project it.
  - The converter's dispersion is composed with the primary's (as the bounds) against the policy maximum; `converter.dispersionBps` absent is `MISSING_BOUNDS`.
  - Point usage (`usedMarketUsdc`) and sampled shared OI (`sharedUsdc`) unknown are `MISSING_CAPACITY`, except for a new feed (`cohort.existing === false`).
  - A supplied capacity that is not a u64 is `MISSING_CAPACITY`, never dropped. A zero trade (after rounding to micro-USDC) fails `TRADE_CAPACITY`.
  - `target.program` / `layout` / `lifecycle`: each false fails, anything else is `MISSING_TARGET` / `MISSING_LAYOUT_PROJECTION`.
  - Quorum, venues and coverage are checked one by one, so a known failure is not hidden by a missing sibling.
  - The rules object is validated in full (quotes, recipes and their adapters, converter recipes, the FeedOI enum, terms); an invalid policy stops every policy comparison (`POLICY_INVALID`, no throw).
  - The SOL converter also needs `converter.condition`, the condition its in-transaction refresh stamps from its sources' bin arrays and vaults (depth or liquidity below the sealed floor, vault shortfall, vault frozen): 0 passes, nonzero or null is `CONVERTER_INVALID`, absent is `MISSING_CONVERTER`. `planFit` does not read those accounts, so it leaves it absent.
  - FeedOI headroom: `capacity.feedOiHeadroomUsdc6` (always) and `capacity.conversionOiHeadroomUsdc6` (SOL quote; the conversion FeedOI is shared by every SOL-quoted market) are what an Open may still add. Absent or invalid is `MISSING_OI`; a trade above either fails `OI_CAPACITY`. `planFit` reads neither (a new feed's FeedOI does not exist yet).
  - Minimum position: a trade below the market minimum fails `TRADE_CAPACITY`. `MarketProfile.minPositionUsdc` sets it; otherwise BAND uses `MARKET_RULES.minPosition` (the mobile rule: min(20 % of the seed-usable position, 50 USDC), activation 5 × that minimum); point, sampled and DUAL without it are `MISSING_MARKET_TERMS`. `planFit` sets the point minimum to the reference trade (1 USDC).
  - A known primary confidence or dispersion above its maximum fails even when the converter's bound is absent (the composition only widens it).
  - A converter source read as null fails `CONVERTER_INVALID` even when its sibling is unread.
  - A non-string rules `revision` is reported as "", and a non-number `mode` gives `eligible: null`, without a throw.

## 0.8.0 - 2026-10-28

First public release.

### The surface

- One client: the root exports `Mimir` and `MimirError`.
- Creation by mint: `createFeed({ mint })` finds the symbol, the pools and the ticker, then creates the feed with its first price; `createIndex` creates an index.
- Discovery through the Mimir API (default) or your own RPC (`new Mimir({ rpc })`).
- The 0.6/0.7 functions live under `@quantulabs/mimir-sdk/advanced`.
- Creation is paid in SOL: the SDK buys the COLA it needs with SOL (`buy-cola`), then creates.
- No fixed prices for creation: fees are read on chain at each creation; `dryRun` shows the live amounts.

### Changed since 0.7.5

- API mode reads prices with `POST /v1/feeds` and feed details with `/v1/feed/{feed}`.
- A price is now the API's feed object: `ticker`, `kind`, `address`, `token`, `quote`, its pools (`sources`) or an index's `components` with weights, `price` in USDC, `confidenceBps`, `dispersionBps`, the `slot` it was computed at, `updatedAt`, and `reason` when there is no price. Sources carry `liquidityUsdc`, token feeds a `score`; the types mark every field the API can send as null.
- Gone from the price: `status`, `mode`, `live`, `source`, `ageSlots`, `native`, the exact X64 fields and `feed` (now `address`). Priced means `price` is not null. Exact onchain fields stay in `getPrice` under `/advanced`.
- API errors read `{ error: { code, hint, retryAfterMs } }`; pools drop `origin`.

### Fixed since 0.7.5

- A transaction that landed is no longer reported as expired. A slow or failing node during the wait counts as "unknown". The wait ends confirmed, failed, expired, or `PENDING` after 120 s with the signatures.
- An error thrown by your `onStep` callback no longer stops the wait; it is rethrown once the step is settled.
- Safe retry without paying twice: pass `after: error.signatures` (or `resume.after`) to `createFeed` / `createIndex`. A COLA purchase that already landed is reused. If its status cannot be read, the call ends `PENDING` and never buys again.
- Errors carry every signature sent, as plain JSON (`{ kind, signature, slot }`), ready to pass back as `after`.
- The purchase check works on any RPC and any transaction format.
- The server split (`skipSend`) returns its signatures on every error, so a retry reuses the COLA. A malformed `after` is a `MimirError`.
- The `PENDING`, `EXPIRED` and `WALLET_REJECTED` hints, and AGENTS.md, say to call again with `after: error.signatures`.

### RPC compatibility (checked on Alchemy, Flux and the public mainnet RPC)

- Creation works with an RPC whose clock is sometimes a slot apart from the accounts it returns. The SDK reads the whole set again after a short pause, up to four times, and never mixes two reads. If the RPC stays out of step, the error says so and can be retried.
- The network fee is quoted the same way on every RPC, including the ones that cannot quote a Transaction v1 directly. The quote includes the transaction's own priority fee. A wallet that raises the priority fee itself makes the network fee higher than the quote.
- A creation that landed is confirmed even when the RPC returns the transaction in the older format. The SDK checks it against the transaction you signed, signature by signature, and otherwise keeps waiting.
- Feed list items (`GET /v1/feeds`) carry no `score` or `reason`; the API sends them only with a price.

## 0.7.5 - 2026-10-28

### Fixed

- Server split (`skipSend`): only a purchase is re-planned. Retrying a landed `create+price` or `first-price` (after `PENDING` or a lost response) answers `ready` again, and a non-fused `create` step is sent, then `first-price`.
- `FEED_EXISTS` for the payer's own feed says "this is your feed".
- Existing feeds are read over variants 0–16, every variant creation can pick.
- `planFeed` with `rpc`: the unreachable-API hint says `discovery: 'rpc'`.

### Docs

- Calling `createFeed` again starts over and buys the ticker COLA again; the server split resumes from `after`.

## 0.7.4 - 2026-10-28

### Fixed

- Server split (`skipSend`): after a landed `buy-cola` (its finalized transaction signed by the payer and calling Jupiter), the next step is `create+price`; a second signed `buy-cola` is never sent, and an already-landed signed step is not re-sent. A step counts as a purchase from its wire's programs, not its label.
- Server split: `ready` also requires the feed to be the payer's feed for the requested mint (`createFeed`) or the ticker's claimed feed (`createIndex`).
- A composite CREATE without a fused first price gets its `first-price` step again.
- The base mint is checked before pool resolution, also with `pools`: an invalid string is `INVALID_INPUT`, a non-mint or a pool of another mint is `NOT_FOUND`.
- The relay refuses a step whose program index is out of range; a batch item's `retry` outside the four values becomes `never`.
- The unreachable-API hint says to pass `{ rpc }` for on-chain reads and pool discovery.

### Docs

- `exponent` describes `native.mantissa` on a converted price; API-mode conversion wording.
- Migrating from 0.6 (for 0.8.0): `import { getPrice } from '@quantulabs/mimir-sdk/advanced'`; the root exports `Mimir` and `MimirError`.

## 0.7.3 - 2026-10-27

### Fixed

- Sending works on Agave 4.3.2 and the mainnet RPCs: `getSignatureStatuses` always carries `searchTransactionHistory`.
- Server split (`skipSend`): `ready` comes from the feed on chain (Mimir-owned, created by the payer, priced), never from the receipts' labels; a signed `buy-cola` is re-planned before it is sent; only steps that call the creation programs are relayed.
- A payer that already holds WSOL can buy the ticker COLA.
- An existing index is `FEED_EXISTS` with its feed; a DLMM current point that cannot publish is `UNPRICEABLE` with a hint. Mimir program errors classify before the price code loads.
- `watch` keeps its 2 s floor for a NaN or huge interval; one failed batch item keeps the API's code and retry; an address answer is checked against the request.
- The SOL to USDC conversion runs only while Mimir's SOL feed is fresh or needs a refresh, and takes the worse status and older age of the two.
- A walletless dry run plans with a fresh random payer; resuming your own unpriced feed skips pool discovery.

### Changed

- A converted price no longer has SOL-unit exact fields at top level: `priceX64`, `lowerX64`, `upperX64` and `mantissa` are null there and live in `price.native`.
- The tariff and fees are read only from AdminConfig at each creation; the docs no longer list figures. `MIMIR_V1_DEFAULT_TICKER_TIER_TENTHS` is removed.
- `./advanced` exports `recommend` without its internal helpers.

## 0.7.2 - 2026-10-27

### Added

- `new Mimir(opts?)`: one client with `price`, `prices`, `watch`, `createFeed`, `createIndex`, `withFreshPrice` and `sign`. The root exports `Mimir` and `MimirError`; every 0.7 name moves to `./advanced` unchanged.
- Reads default to the free keyless Mimir API (`https://api.mimirfeeds.io`, option `api`); `rpc` switches everything to your RPC, with zero API calls. `watch` polls one batch request per tick (default 5 s, minimum 2 s).
- Prices in USDC: a SOL-quoted feed is converted through Mimir's own SOL/USDC feed and carries `native`; `Price.source`.
- `createFeed({ mint })`: the ticker comes from the token's verified symbol (first free of `SYMBOL` … `SYMBOL19`), pools from the API or a bounded scan of the venue programs on your RPC, checked on chain and picked by the app's recommender. `dryRun`, `skipSend` + `sign` (stateless server split), `require`, `variant: "new"`.
- Wallet inputs: secret-key bytes or base58, web3.js `Keypair`, `CryptoKeyPair`, `@solana/kit` signers, Wallet Standard, wallet-adapter, `{ address, sign }`; Transaction v1 only.
- Codes `NO_WALLET`, `WALLET_UNSUPPORTED`, `WALLET_REJECTED`, `TOKEN_AMBIGUOUS`, `FEED_EXISTS`, `NO_POOL`, `PENDING`, `INSUFFICIENT_COLA`, `RATE_LIMITED`, `CAPACITY`, `UPSTREAM_UNAVAILABLE`, one hint each.
- `./advanced`: `recommend`, `poolCandidates`, `resolveToken`, `searchTokens`, `autoTicker`, `existingFeeds`, `normaliseWallet`.

### Changed

- A SOL-quoted classic or composite draft carries the SOL/USDC conversion source; a USDC-quoted one does not.
- `createFeed` without `pools` takes the candidates from the Mimir API or the on-chain scan; a refused eligibility chunk splits down to single pools.
- `onStep` is awaited and its events carry `index` and `of`.

## 0.7.1 - 2026-10-27

### Changed

- Beta errors are `instanceof`-safe across entries.
- `./create` loads no beta code until a creation runs.
- Post-swap draft reuse and one-simulation purchase.
- Composite CREATE carries the media memo.

## 0.7.0 - 2026-10-27

### Added

- `@quantulabs/mimir-sdk/create`: `planFeed` (a plan: steps, estimated SOL, prompts, recipe trade-offs, warnings; signs nothing) and `createFeed(plan, { sign })` (each step built just in time with its exact review, sent and awaited at `finalized`). Default classic: 2 approvals, the COLA purchase then CREATE with the first price in one transaction.
- `planComposite` / `prepareCompositeStep` / `createComposite`: a composite (index) over 2 to 5 existing classic feeds (ticker or feed id, decimal quantity), on the same plan → review → sign → confirm contract as `createFeed`. The plan carries `activationFeeLamports`.
- Plans carry the ticker tariff (`tariffColaRaw`, `tariffCola`); `totalLamports` excludes it.
- `prepareFeed` and `prepareComposite` stay as deprecated aliases of `planFeed` and `prepareCompositeStep`.
- `Price.liveError`: set when a live read fell back to the stored price; `watchPrices` reports it through `onError` once per failure burst.
- Error hints per code (`TICKER_NOT_FOUND`, `INVALID_INPUT`, `TICKER_TAKEN`).
- `jupiterSwapBuild({ apiKey? })`: Jupiter's keyless `GET /swap/v2/build`, public and rate-limited; `buildSwap` is injectable. Every build is validated and simulated.
- `keyPairSigner(keyPair)` for Node bots.
- The first price can ride in the CREATE transaction; the review records it as `review.firstPrice`.
- `./beta` exports the creation modules.
- `MimirErrorCode`: `TICKER_TAKEN`, `UNPRICEABLE`, `INSUFFICIENT_SOL`, `SWAP_UNAVAILABLE`, `REVIEW_CHANGED`, `NOT_SUPPORTED`.

- `FeedReceipt.state: "pending"`: a step was sent and its outcome is unknown; resume with `planFeed`.

### Changed

- `createFeed` waits with the caller's RPC only (`rpc` in the plan args or in its options), polls at most once per second, and retries 429 and transport errors with backoff (Retry-After honoured).
- `FeedPlan.args` no longer carries the RPC URL.
- RPC failures in `/create` (HTTP 429 retried first) map to `RPC` with `retry: "later"`; an unfunded payer is `INSUFFICIENT_SOL`.
- Public type declarations no longer need `@types/node`.
- The COLA purchase asks Jupiter for `transactionVersion=1` and keeps the first-price network fee in reserve.

### Not yet

- Interval recipes.

## 0.6.1 - 2026-10-27

### Added

- `listFeeds({ rpc })`: every feed as `{ feed, ticker, kind }`. Needs an RPC that allows `getProgramAccounts`.
- `watchPrices(feeds, onPrice, { rpc, intervalMs = 5000 })`: polls `getPrices`; returns the unsubscribe function.
- `Price.generation`: the feed account generation to pin.
- `withFreshPrice({ simulate: true })` sets the compute-unit limit to the simulated units plus the planned refresh units, so a refresh that lands later and needs a full publish still fits. `withFreshPrice` also takes web3.js `TransactionInstruction`s and returns the same type.
- Root API: `getFeedInfo` (a feed's pools, venues, depth to move each pool 50 bps in USDC, components, sealed dispersion cap; SOL-quoted depth converted with Mimir's own SOL price), `decodeFeedInfo`, `scoreFeed` (feed score 0-100 and band, information only), `recommendPools` (Auto pool pick with per-candidate score deltas) and `venueLabel`.
- Feed score v2: `scoreFeed` returns `marketFit` (`{ fit, eligible, confFloorBps, reason }`, option `marketMaxConfBps`, default 100) and scales the score by 0.6 when the feed does not fit a market (e.g. a lending/perps market) as created; `null` when any depth is unknown, not a finite non-negative number, or older than 150 slots (pass the `FeedInfo` as is). `FeedPool` adds `feePpm`, `confBps`, `mode`, `depthSlot`; `FeedInfo` adds `slot`. `dlmmRouteableDepth` gives a routeable DLMM candidate the depth creation seals.

### Fixed

- A load-balanced RPC whose reads do not converge on one slot: the refresh planning is retried once, then throws `MimirError` `RPC` with `retry: "now"`.
- Error messages show the RPC host only, never the URL (keys).
- `getFeedInfo`: a ring older than 150 slots is replaced by a simulated refresh (the stored ring stands if it fails); SOL-quoted depth uses the live SOL price. `scoreFeed` uses fees only when every pool of an exchange has one.

## 0.6.0 - 2026-10-27

First public release.

### Added

- Root API: `getPrice`, `getPrices`, `decodePrice`, `refreshInstructions`, `withFreshPrice`, `simulatePrice`, `toWeb3Instruction`, `MimirError` (with `retry` and `hint`), `MIMIR_PROGRAM_IDS` and the `Price` type. `getPrice` and `getPrices` need no configuration: they read mainnet through Solana's public RPC unless `{ rpc }` is given. They are live by default: a feed whose stored price is not fresh gets its refresh simulated, never sent (`live: true`); `{ live: false }` reads storage only. `Price.status` is `fresh`, `needs-refresh`, `degraded` or `none`; `Price.mode` is `standard` or `current-point`. Read-only RPC calls retry HTTP 429/503 twice (`Retry-After`): retried twice, within 20 s in total.

### Changed

- The root entry is the easy API only, and bundles for a browser with no Node built-in (`node:crypto`, global `Buffer`). The previous root surface (V0 codecs, instruction builders, PDAs, source graph, routeable depth, mint oracle, consumer helpers) moved from the root to `@quantulabs/mimir-sdk/advanced`; see [ADVANCED.md](docs/ADVANCED.md).

### Fixed

- The default mainnet program id is now `hBYrGHXVCQsnduDERkVnViCXNYawpHCvN5y3GsMiMiR`. Earlier versions defaulted to `hMuPDstPQEb5uaYc6d5N18Rz4srL1Bewc5fYibMimiR`, a closed deployment; the root API refuses accounts it owns.

### Removed

- The `./internal/instructions` subpath.

### Deprecated

- `createMimirRefreshReadConsumerInstructions`, `createMimirAuditedDirectReadConsumerInstructions` and `createMimirCompositeRefreshReadConsumerInstructions`, now in `./advanced`. Use `withFreshPrice`.

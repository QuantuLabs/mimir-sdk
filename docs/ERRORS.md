# Errors

Every error the SDK throws is a `MimirError` with `code`, `message`, `hint` and `retry`. `MimirError.from(error)` turns any failed send or simulation into one, including Mimir program errors.

## `retry`

| `retry` | What to do |
|---|---|
| `"now"` | Rebuild from fresh reads and try again |
| `"later"` | The service is busy; wait (`Retry-After` gives the wait) and try again |
| `"after-refresh"` | Put the Mimir refresh before your instruction in the same transaction |
| `"never"` | Retrying will not help; fix the input |

## Codes

`retry` below is the usual value; always read it from the error.

| Code | Meaning | `retry` | What to do |
|---|---|---|---|
| `NO_WALLET` | A write without a wallet, or a browser wallet not connected | never | Pass `wallet`, or connect it first |
| `WALLET_UNSUPPORTED` | Unknown wallet shape, no Transaction v1 signing, or a custom `sign(step)` that returns something other than a `Uint8Array` | never | Use a [supported wallet](./CREATE.md#which-wallet-can-i-pass) |
| `WALLET_REJECTED` | The wallet declined; nothing was sent for this step | now | Ask again, with `after: error.signatures` |
| `REVIEW_CHANGED` | The wallet edited the transaction beyond the network fee; nothing was sent | never | Use a wallet that signs as is |
| `EXPIRED` | The approval was too slow, or the blockhash expired (« Blockhash not found ») | now | Call again with `after: error.signatures` |
| `PENDING` | A step was sent and its outcome is unknown | later | Call again with `after: error.signatures`; the COLA bought is reused. Never re-sign the step by hand. |
| `NOT_FOUND`, `TICKER_NOT_FOUND` | Unknown feed or ticker (`NOT_FOUND` through the API; `TICKER_NOT_FOUND`, or `WRONG_OWNER` for an address that is not a feed, through your RPC), a mint that is not a token, or a pool that does not hold the mint (« … is not a pool of … ») | never | Check the ticker, address, mint or pools |
| `TOKEN_AMBIGUOUS` | Several verified tokens share the symbol you gave | never | Pass the mint you mean |
| `FEED_EXISTS` | The token already has a feed (`error.feeds`) | never | Use that feed, or pass `variant: "new"` |
| `NO_POOL` | No eligible pool, or no pool set meets `require` | never | Pass other `pools`, or relax `require` |
| `UNPRICEABLE` | The first price would not be fresh: a pool, or an index component, cannot price right now. The create step was not sent; COLA already bought stays in the wallet. | never | Choose other pools or components, or call again with `after: error.signatures` once each one prices (`simulatePrice` shows `"fresh"`) |
| `TICKER_TAKEN` | The ticker, or all 20 automatic candidates, are claimed | never | Pass another `ticker` |
| `INSUFFICIENT_SOL` | The payer cannot fund this step and the next, or has no SOL on this network (« AccountNotFound » in a simulation) | later | Fund the wallet, then call again; a dry run gives the cost |
| `SWAP_UNAVAILABLE` | The COLA purchase route could not be built, `buildSwap` included | later | Try again later |
| `NOT_SUPPORTED` | A recipe the SDK cannot create yet (interval recipes), or `cluster: "devnet"` (no devnet deployment yet) | never | Use `default`, `native-bounded` or `current-point`; use mainnet |
| `CLASSIC_NATIVE_NOT_READY` | The pool's native price history is not ready yet | later | Retry after a fresh swap, or use recipe `default` |
| `CLASSIC_BOUNDED_WEIGHT_INSUFFICIENT` | The pools' recipes cannot give enough bounded evidence | never | Use the same recipe on every pool: all `default`, or `native-bounded` on every venue |
| `COMPOSITE_CHILD_MULTI_ROW` | An index component is a classic feed with several pools, and its mint has no single-pool feed | never | Create one with `createFeed({ mint, pools: [onePool] })`, then use it |
| `INVALID_INPUT` | A bad argument: an `rpc` that is not an http(s) URL, `createFeed` without `rpc`, an index component that is not a live classic feed, fewer than 2 or more than 5 components, refreshes above 1,400,000 compute units | never | Fix the argument; for an index, [create the missing component feed](./CREATE.md#index-components) first |
| `RATE_LIMITED`, `CAPACITY`, `UPSTREAM_UNAVAILABLE` | The Mimir API is busy | later | Wait for `Retry-After`, or pass your own `rpc` |
| `RPC` | The RPC failed, or the Mimir API is unreachable | later | Retry, or use another RPC |
| `PLAN_STALE` | A pool moved while the refresh was prepared | now | Rebuild and resend |
| `UNKNOWN` | Anything else | — | Read `message` and `hint` |

`INSUFFICIENT_COLA` is part of the `MimirErrorCode` type but is not raised.

### Raised when reading an account with `/advanced`

All `never`: the account is not the feed you asked for.

| Code | Meaning |
|---|---|
| `TICKER_MISMATCH` | The feed's ticker is not the one asked for |
| `NOT_A_FEED`, `WRONG_OWNER`, `EXECUTABLE`, `WRONG_ADDRESS`, `MALFORMED` | The account is not a valid Mimir feed |
| `GENERATION_MISMATCH` | The feed's generation is not the pinned one |
| `CLOSED_PROGRAM` | The account belongs to a closed Mimir program id |

## Program errors

Program errors keep their numeric code and name. Without program logs, `MimirError.from(error, { instructions })` attributes a custom error to Mimir only when Mimir is the instruction at the failing index.

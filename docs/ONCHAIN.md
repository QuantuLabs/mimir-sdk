# Use a price in a program

The client side, `withFreshPrice`, is in the [README](../README.md#use-a-price-in-a-program); lower-level variants are in [QUICKSTART step 5](./QUICKSTART.md#5-use-a-fresh-price-on-chain). This page is the program side.

## Read the price onchain

Your program must check the feed itself. The cookbook's Pinocchio program, [`programs/mimir-cookbook/src/lib.rs`](https://github.com/QuantuLabs/mimir-cookbook/blob/main/programs/mimir-cookbook/src/lib.rs), does exactly this for a token feed: start from it. An Anchor program applies the same checks.

```text
 your program's checks, in order
 ─────────────────────────────────────────────────────────────
 1. Owner      feed account owned by the Mimir program, not a signer
 2. Pin        same (feed, generation) as when you first bound it
 3. Refresh    the k instructions just before yours are Mimir refreshes
 4. Fresh      status OK and valid_from ≤ current slot ≤ valid_until
 5. Bound      use the bound that protects you (e.g. the lower bound for collateral)
```

1. **Owner and identity.** The feed account is owned by the Mimir program (`hBYrGHXVCQsnduDERkVnViCXNYawpHCvN5y3GsMiMiR`) and is not a signer. A token feed starts with `MIMIRSNP`. Its address is the PDA `["feed_snapshot", feed_id]` of the Mimir program, with `feed_id` the 32 bytes at offset 16.
2. **Pin.** When you first bind a feed, store `(feed, generation)`; both come from `getPrice` in `/advanced`. Refuse any other feed later.
3. **Refresh in this transaction.** Load the Instructions sysvar. With k feeds, the instructions at relative positions −k..−1 are Mimir refreshes, in the order given to `withFreshPrice`. For a token feed: program id = Mimir, first data byte = `89`, account 0 = the feed.
4. **Fresh now.** Read `Clock::get()?.slot`. Accept the price only if the revision is non-zero, the status byte is `0`, the quote status is `0`, the routeability byte is below `4`, `valid_from_slot ≤ slot ≤ valid_until_slot`, and the lower bound is non-zero. Otherwise refuse (the cookbook returns `NOT_FRESH`).
5. **Use the bound that protects you.** The cookbook lender values collateral at the lower bound (Q64.64).

An index refresh is `87`, with the index at account 1 (account 0 = the payer). Its account layout differs and is not documented yet; the cookbook has no index consumer yet.

## Token feed account offsets

As the cookbook reads them ([`lib.rs#L61-L80`](https://github.com/QuantuLabs/mimir-cookbook/blob/main/programs/mimir-cookbook/src/lib.rs#L61-L80)). Integers are little-endian.

| Field | Offset | Size | Type |
|---|--:|--:|---|
| magic `MIMIRSNP` | 0 | 8 | bytes |
| feed_id | 16 | 32 | address |
| revision | 96 | 8 | u64 |
| status | 104 | 1 | u8 |
| routeability | 105 | 1 | u8 |
| valid_from_slot | 116 | 8 | u64 |
| valid_until_slot | 124 | 8 | u64 |
| lower bound | 216 | 16 | u128 Q64.64 |
| upper bound | 232 | 16 | u128 Q64.64 |
| quote status | 257 | 1 | u8 |

The full layout lives in the SDK's `src/v1/layout/classic.ts`. Until a Rust consumer crate ships, copy the offsets from the cookbook program's `feed` module rather than writing your own.

import type { AccountInfo, PublicKey } from "@solana/web3.js";
import type { PoolCoreAccount } from "./rpcPoolDiscoveryCore.js";

export function legacyWeb3PoolAccountToCore(
  address: PublicKey,
  account: AccountInfo<Buffer>,
): PoolCoreAccount {
  return {
    address: address.toBase58(),
    owner: account.owner.toBase58(),
    data: Uint8Array.from(account.data),
  };
}

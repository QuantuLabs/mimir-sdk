import { Connection } from "@solana/web3.js";

export interface StaticAccount { readonly data: string; readonly owner: string; readonly executable: boolean; readonly lamports: number }

/** A web3 Connection answering getAccountInfo / getMultipleAccounts from a fixed account map at one slot (missing = null); `read` collects every key asked. */
export function staticConnection(slot: number, accounts: Readonly<Record<string, StaticAccount | null>>, read = new Set<string>()): Connection {
  const connection = new Connection("http://127.0.0.1:1", "confirmed");
  const value = (key: string) => {
    read.add(key);
    const a = accounts[key];
    return a ? { data: [a.data, "base64"], owner: a.owner, executable: a.executable, lamports: a.lamports, rentEpoch: 0, space: Buffer.from(a.data, "base64").length } : null;
  };
  (connection as unknown as { _rpcRequest: unknown })._rpcRequest = async (method: string, params: unknown[]) => {
    const context = { slot };
    if (method === "getAccountInfo") return { jsonrpc: "2.0", id: "1", result: { context, value: value(params[0] as string) } };
    if (method === "getMultipleAccounts") return { jsonrpc: "2.0", id: "1", result: { context, value: (params[0] as string[]).map(value) } };
    throw new Error(`staticConnection: unsupported ${method}`);
  };
  return connection;
}

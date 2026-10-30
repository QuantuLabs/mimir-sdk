// A local mock of the Mimir API JSON contract (api-mode-spec §2.2–2.4) and a recording fake JSON-RPC. Both on 127.0.0.1.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const SOL_MINT = 'So11111111111111111111111111111111111111112', USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const WIF_MINT = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';
// The feed object of API-RESPONSE-SPEC-20261028 (GET /v1/feed/{feed}; items of POST /v1/feeds).
const price = (ticker: string, feed: string, quote: string, p: number | null, reason?: string) => ({ ticker, kind: 'token', address: feed,
  token: { mint: ticker === 'SOL' ? SOL_MINT : WIF_MINT, symbol: ticker, name: ticker }, quote: { mint: quote === 'SOL' ? SOL_MINT : USDC_MINT, symbol: quote },
  sources: [{ pool: 'HTvjzsfX3yU6BUodCjZ5vZkUrAxMDTrBs3CJaq43ashR', venue: 'orca-whirlpool' }],
  price: p, confidenceBps: p === null ? null : 12, dispersionBps: p === null ? null : 8, slot: '462544186', updatedAt: 1793136000, ...(reason ? { reason } : {}) });
export const FEEDS: Record<string, ReturnType<typeof price> | Record<string, any>> = {
  SOL: price('SOL', '9vNf1NDAbcvmEDtFJB7sCLdPUTXc9GYRzyVgF8yXDL7Y', 'USDC', 182.41),
  WIF: price('WIF', '4Q6Wy1nQmyJH7LkMjQHgdXzZ1c1jZjvZrP8ktfF8nKz5', 'SOL', 0.7479),
  COLA: price('COLA', 'Ar1aHjgTLtTThgo2VVyuKUjKDGBRGHVcQZdDcbpULAMd', 'SOL', null, 'NOT_READY'),
};
export const TOKENS = [{ mint: WIF_MINT, symbol: '$WIF', name: 'dogwifhat', verified: true }, { mint: 'Bogus11111111111111111111111111111111111111', symbol: 'WIF', name: 'fake', verified: false }];
export const INDEX = { ticker: 'MEME', kind: 'index', address: 'Ccn1Cz6xFgZ5qSYmvCDyLhXEcU6ZyFsDpDNUykrRWWbE', token: null, quote: { mint: USDC_MINT, symbol: 'USDC' },
  components: [{ ticker: 'WIF', address: '4Q6Wy1nQmyJH7LkMjQHgdXzZ1c1jZjvZrP8ktfF8nKz5', weight: 0.6 }, { ticker: 'SOL', address: '9vNf1NDAbcvmEDtFJB7sCLdPUTXc9GYRzyVgF8yXDL7Y', weight: 0.4 }],
  price: 1.25, confidenceBps: 20, dispersionBps: 15, slot: '462544186', updatedAt: 1793136000 };
export const POOLS: Record<string, { pool: string; venue: string; programId: string; quoteReserveRaw: string }[]> = {
  [`${WIF_MINT}|USDC`]: [{ pool: 'ADEjbFryLPfYLmCrMCFo2BUaoZb86VmCkBZbjnHPM5S8', venue: 'meteora-dlmm', programId: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', quoteReserveRaw: '453520000' }],
  [`${WIF_MINT}|SOL`]: [],
};

const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', ...headers }); res.end(JSON.stringify(body));
};
const err = (code: string, _message: string) => ({ error: { code, hint: `mock ${code}`, retryAfterMs: null as number | null } });
const TICKER = /^[A-Za-z0-9]{1,12}$/, ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const lookup = (x: string) => TICKER.test(x) ? FEEDS[x.toUpperCase()] : Object.values(FEEDS).find((f) => f.address === x);

export type MockApi = { url: string; requests: string[]; limitOnce: (retryAfter: number) => void; close: () => Promise<void> };
export async function mockApi(): Promise<MockApi> {
  const requests: string[] = [];
  let limit: number | null = null;
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url!, 'http://x');
    let body = ''; for await (const c of req) body += c;
    requests.push(`${req.method} ${url.pathname}${url.search}${body ? ` ${body}` : ''}`);
    const post = req.method === 'POST' && url.pathname === '/v1/feeds';
    if (req.method !== 'GET' && !post) return send(res, 405, err('INVALID_INPUT', 'method'));
    if (limit !== null) { const s = limit; limit = null; return send(res, 429, { error: { code: 'RATE_LIMITED', hint: 'mock', retryAfterMs: s * 1000 } }, { 'retry-after': String(s) }); }
    const one = /^\/v1\/feed\/([^/]+)$/.exec(url.pathname);
    if (one) {
      const x = decodeURIComponent(one[1]!);
      if (!TICKER.test(x) && !ADDRESS.test(x)) return send(res, 400, err('INVALID_INPUT', 'bad feed'));
      const f = lookup(x);
      return f ? send(res, 200, { feed: f }) : send(res, 404, err('NOT_FOUND', `no feed ${x}`));
    }
    if (post) {
      if (req.headers['content-type'] !== 'application/json') return send(res, 415, err('INVALID_INPUT', 'json only'));
      const feeds = (() => { try { return JSON.parse(body).feeds; } catch { return null; } })();
      const list: string[] = Array.isArray(feeds) ? [...new Set(feeds as string[])] : [];
      if (!list.length || list.length > 30 || list.some((x) => !TICKER.test(x) && !ADDRESS.test(x))) return send(res, 400, err('INVALID_INPUT', 'feeds: 1-30 tickers or addresses'));
      return send(res, 200, { items: list.map((input) => { const f = lookup(input); return f ? { input, feed: f } : { input, error: err('NOT_FOUND', `no feed ${input}`).error }; }) });
    }
    const hist = /^\/v1\/feed\/([^/]+)\/history$/.exec(url.pathname);
    if (hist) { const f = lookup(decodeURIComponent(hist[1]!)); return f ? send(res, 200, { ticker: f.ticker, address: f.address, range: url.searchParams.get('range'), points: [[1793132400, 181.9], [1793136000, 182.41]] }) : send(res, 404, err('NOT_FOUND', 'no feed')); }
    if (url.pathname === '/v1/tokens/search') {
      const q = url.searchParams.get('q') ?? '';
      if (!/^[A-Za-z0-9 ._$-]{2,44}$/.test(q)) return send(res, 400, err('INVALID_INPUT', 'q: 2-44 of [A-Za-z0-9 ._$-]'));
      const k = q.replace(/^\$/, '').toUpperCase();
      return send(res, 200, { query: q, items: TOKENS.filter((t) => t.mint === q || t.symbol.replace(/^\$/, '').toUpperCase().startsWith(k)).slice(0, 8) });
    }
    if (url.pathname === '/v1/pools') {
      const mint = url.searchParams.get('mint') ?? '', quote = url.searchParams.get('quote') ?? '';
      if (!ADDRESS.test(mint) || (quote !== 'USDC' && quote !== 'SOL')) return send(res, 400, err('INVALID_INPUT', 'mint and quote=USDC|SOL'));
      return send(res, 200, { mint, quote, items: (POOLS[`${mint}|${quote}`] ?? []).slice(0, 8) });
    }
    send(res, 404, err('NOT_FOUND', 'no route'));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests, limitOnce: (s) => { limit = s; },
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

export type RpcCall = { method: string; params: unknown[] };
export type FakeRpc = { url: string; calls: RpcCall[]; close: () => Promise<void> };
/** A JSON-RPC that records every call and answers through `handle` (return a number for an HTTP status, `[status, headers]` for a 429 with headers). */
export async function fakeRpc(handle: (method: string, params: unknown[]) => unknown): Promise<FakeRpc> {
  const calls: RpcCall[] = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const { id, method, params } = JSON.parse(body);
    calls.push({ method, params });
    const out = await handle(method, params);
    if (Array.isArray(out) && out[0] === 'status') { res.writeHead(out[1] as number, out[2] as Record<string, string>); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id, result: out }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}
export const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

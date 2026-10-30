import { afterEach, describe, expect, it, vi } from './vitest.js';
import { confirmSignature, confirmedFailureSlot, type SignatureStatus } from '../../src/create/confirm-signature.js';

class FakeSocket {
  static last: FakeSocket;
  sent: { id: number; method: string; params: [string, { commitment: string }] }[] = [];
  closed = false;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  constructor(readonly url: string) { FakeSocket.last = this; }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.closed = true; }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  ack() { this.sent.forEach(({ id }) => this.message({ jsonrpc: '2.0', id, result: 100 + id })); }
  notify(id: number, err: unknown = null, slot = 1) {
    this.message({ jsonrpc: '2.0', method: 'signatureNotification', params: { subscription: 100 + id, result: { context: { slot }, value: { err } } } });
  }
}

const SIGNATURE = '5'.repeat(88);
const base = (getStatus: (signature: string) => Promise<SignatureStatus>) => ({
  wsUrl: 'wss://rpc.example', signature: SIGNATURE, getStatus, pollMs: 10, timeoutMs: 1_000,
  socketFactory: (url: string) => new FakeSocket(url)
});

afterEach(() => vi.useRealTimers());

it('reports a failure slot only once the failed status is confirmed', async () => {
  const statuses: SignatureStatus[] = [null, { err: { InstructionError: [0, { Custom: 1 }] }, confirmationStatus: 'processed', slot: 9 },
    { err: { InstructionError: [0, { Custom: 1 }] }, confirmationStatus: 'confirmed', slot: 10 }];
  await expect(confirmedFailureSlot(async () => statuses.shift() ?? null, 5, 0)).resolves.toBe(10n);
  await expect(confirmedFailureSlot(async () => ({ err: 'x', confirmationStatus: 'processed', slot: 9 }), 3, 0)).resolves.toBeUndefined();
  await expect(confirmedFailureSlot(async () => ({ err: 'x', confirmationStatus: 'confirmed', slot: null }), 3, 0)).resolves.toBeUndefined();
  await expect(confirmedFailureSlot(async () => ({ err: null, confirmationStatus: 'confirmed', slot: 10 }), 3, 0)).resolves.toBeUndefined();
});

describe('confirmSignature', () => {
  it('keeps a finalized wait open across a processed-only failure, then re-checks finalized', async () => {
    const statuses: SignatureStatus[] = [{ err: 'x', confirmationStatus: 'processed', slot: 9 }, null, { err: null, confirmationStatus: 'finalized', slot: 11 }];
    const outcome = confirmSignature({ ...base(async () => statuses.length > 1 ? statuses.shift()! : statuses[0]!), wsUrl: undefined, commitment: 'finalized' });
    await expect(outcome).resolves.toBe('confirmed');
    await expect(confirmSignature({ ...base(async () => ({ err: 'x', confirmationStatus: 'finalized', slot: 12 })), wsUrl: undefined, commitment: 'finalized' })).resolves.toBe('failed');
  });

  it('confirms over WebSocket, reporting processed before confirmed', async () => {
    const getStatus = vi.fn(async () => null);
    const onProcessed = vi.fn();
    const outcome = confirmSignature({ ...base(getStatus), onProcessed });
    const socket = FakeSocket.last;
    socket.onopen?.({});
    expect(socket.sent.map(({ method, params }) => [method, params[0], params[1].commitment])).toEqual([
      ['signatureSubscribe', SIGNATURE, 'processed'], ['signatureSubscribe', SIGNATURE, 'confirmed']]);
    socket.ack();
    socket.notify(1);
    expect(onProcessed).toHaveBeenCalledTimes(1);
    socket.notify(2);
    await expect(outcome).resolves.toBe('confirmed');
    expect(socket.closed).toBe(true);
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it('carries the WebSocket confirmed slot when HTTP status is still null', async () => {
    const onConfirmedSlot = vi.fn();
    const outcome = confirmSignature({ ...base(async () => null), onConfirmedSlot });
    FakeSocket.last.onopen?.({});
    FakeSocket.last.ack();
    FakeSocket.last.notify(1, null, 455331700);
    expect(onConfirmedSlot).not.toHaveBeenCalled();
    FakeSocket.last.notify(2, null, 455331732);
    await expect(outcome).resolves.toBe('confirmed');
    expect(onConfirmedSlot).toHaveBeenCalledExactlyOnceWith(455331732, 'confirmed');
  });

  it('carries the HTTP confirmed status slot', async () => {
    const onConfirmedSlot = vi.fn();
    await expect(confirmSignature({ ...base(async () => ({ err: null, confirmationStatus: 'finalized', slot: 42 })), wsUrl: undefined, onConfirmedSlot })).resolves.toBe('confirmed');
    expect(onConfirmedSlot).toHaveBeenCalledExactlyOnceWith(42, 'finalized');
  });

  it('reports an on-chain failure from the notification', async () => {
    const outcome = confirmSignature(base(async () => null));
    FakeSocket.last.onopen?.({});
    FakeSocket.last.ack();
    FakeSocket.last.notify(1, { InstructionError: [0, 'Custom'] });
    await expect(outcome).resolves.toBe('failed');
  });

  it('falls back to polling when the socket errors', async () => {
    let calls = 0;
    const getStatus = vi.fn(async (): Promise<SignatureStatus> => (++calls >= 3 ? { err: null, confirmationStatus: 'confirmed', slot: 42 } : null));
    const outcome = confirmSignature(base(getStatus));
    FakeSocket.last.onerror?.({});
    await expect(outcome).resolves.toBe('confirmed');
    expect(getStatus).toHaveBeenCalledTimes(3);
  });

  it('falls back to polling on a relay subscriptionError', async () => {
    let calls = 0;
    const getStatus = vi.fn(async (): Promise<SignatureStatus> => (++calls >= 3 ? { err: null, confirmationStatus: 'confirmed', slot: 42 } : null));
    const outcome = confirmSignature(base(getStatus));
    FakeSocket.last.onopen?.({});
    FakeSocket.last.ack();
    FakeSocket.last.message({ jsonrpc: '2.0', method: 'subscriptionError', params: { subscription: 101, error: { code: -32000, message: 'Subscription lifetime exceeded' } } });
    await expect(outcome).resolves.toBe('confirmed');
  });

  it('resolves expired from the block-height check while polling', async () => {
    const outcome = confirmSignature({ ...base(async () => null), expired: async () => true });
    FakeSocket.last.onclose?.({});
    await expect(outcome).resolves.toBe('expired');
  });

  it('times out when nothing settles', async () => {
    vi.useFakeTimers();
    const outcome = confirmSignature({ ...base(async () => null), timeoutMs: 500 });
    FakeSocket.last.onopen?.({});
    await vi.advanceTimersByTimeAsync(500);
    await expect(outcome).resolves.toBe('timeout');
    expect(FakeSocket.last.closed).toBe(true);
  });

  it('settles a signature already confirmed before the subscription', async () => {
    const onProcessed = vi.fn();
    const outcome = confirmSignature({ ...base(async () => ({ err: null, confirmationStatus: 'finalized', slot: 42 })), onProcessed });
    FakeSocket.last.onopen?.({});
    await expect(outcome).resolves.toBe('confirmed');
    expect(onProcessed).toHaveBeenCalledTimes(1);
  });
});


it.each([null, { InstructionError: [0, 'Custom'] }])('N1812 checks history before expiry and respects the historical result %j', async (err) => {
  const getStatus = vi.fn(async (_signature: string, history?: true): Promise<SignatureStatus> => history ? { err, confirmationStatus: 'confirmed', slot: 42 } : null);
  const onConfirmedSlot = vi.fn();
  await expect(confirmSignature({ ...base(getStatus), wsUrl: undefined, expired: async () => true, onConfirmedSlot })).resolves.toBe(err ? 'failed' : 'confirmed');
  expect(getStatus).toHaveBeenLastCalledWith(SIGNATURE, true);
  if (!err) expect(onConfirmedSlot).toHaveBeenCalledExactlyOnceWith(42, 'confirmed');
});

it('N1812 never expires a previously processed signature when later status reads are null', async () => {
  vi.useFakeTimers();
  const getStatus = vi.fn().mockResolvedValueOnce({ err: null, confirmationStatus: 'processed' }).mockResolvedValue(null);
  const outcome = confirmSignature({ ...base(getStatus), wsUrl: undefined, expired: async () => true, timeoutMs: 50 });
  await vi.advanceTimersByTimeAsync(50);
  await expect(outcome).resolves.toBe('timeout');
});


it('N1821 polls uncertain reads at a fixed 150 ms without history and performs a fresh history lookup after expiry', async () => {
  vi.useFakeTimers();
  const getStatus = vi.fn(async (..._args: unknown[]) => null);
  let expired = false;
  const result = confirmSignature({ wsUrl: undefined, signature: SIGNATURE, getStatus, expired: async () => expired, timeoutMs: 60_000 });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(getStatus.mock.calls.length).toBe(201);
  expect(getStatus.mock.calls.every((call) => call.length === 1)).toBe(true);
  expired = true;
  await vi.advanceTimersByTimeAsync(150);
  await expect(result).resolves.toBe('expired');
  expect(getStatus).toHaveBeenLastCalledWith(SIGNATURE, true);
});

it('Alpenglow rebroadcasts an unobserved send every second, 30 times, within one blockhash life', async () => {
  vi.useFakeTimers();
  const rebroadcast = vi.fn(async () => undefined);
  void confirmSignature({ wsUrl: undefined, signature: SIGNATURE, getStatus: async () => null, timeoutMs: 60_000, rebroadcast });
  await vi.advanceTimersByTimeAsync(1_000);
  expect(rebroadcast).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(40_000);
  expect(rebroadcast).toHaveBeenCalledTimes(30);
});


export type SignatureStatus = Readonly<{ err: unknown; confirmationStatus?: string | null; slot?: number | bigint | null }> | null;

export type SignatureOutcome = 'processed' | 'confirmed' | 'failed' | 'expired' | 'timeout';

type Socket = Pick<WebSocket, 'send' | 'close'> & {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
};

export interface ConfirmSignatureArgs {
  readonly wsUrl: string | undefined;
  readonly signature: string;
  /** `undefined` = unknown (transport error, a read behind the expiry fence): never taken as absent. */
  readonly getStatus: (signature: string, searchTransactionHistory?: true) => Promise<SignatureStatus | undefined>;
  readonly expired?: () => Promise<boolean>;
  readonly onProcessed?: () => void;
  readonly commitment?: 'processed' | 'confirmed' | 'finalized';
  readonly onProcessedSlot?: (slot: number) => void;
  readonly onConfirmed?: () => void;
  readonly onConfirmedSlot?: (slot: number, commitment?: string | null) => void;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
  readonly socketFactory?: (url: string) => Socket;
  readonly rebroadcast?: () => Promise<void>;
  readonly rebroadcastMs?: number;
  readonly release?: () => void;
}

const landed = (status: SignatureStatus) => Boolean(status?.confirmationStatus);
const observedSlot = (status: SignatureStatus) => typeof status?.slot === 'bigint' ? status.slot > 0n && status.slot <= BigInt(Number.MAX_SAFE_INTEGER)
  : Number.isSafeInteger(status?.slot) && status!.slot! > 0;
const confirmed = (status: SignatureStatus) => status?.err === null && observedSlot(status) &&
  (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized');

export async function confirmedFailureSlot(getStatus: () => Promise<SignatureStatus>, attempts = 50, pollMs = 300): Promise<bigint | undefined> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const status = await getStatus();
    if (status && status.err == null) return undefined;
    if (status && observedSlot(status) && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) return BigInt(status.slot!);
    await new Promise((wait) => setTimeout(wait, pollMs));
  }
  return undefined;
}

export function confirmSignature(args: ConfirmSignatureArgs): Promise<SignatureOutcome> {
  const pollMs = args.pollMs ?? 150;
  return new Promise<SignatureOutcome>((resolve, reject) => {
    let done = false;
    let processed = false;
    let disarmed = false;
    let confirmationNotified = false;
    let processedSlotNotified = false;
    let polling = false;
    let socket: Socket | undefined;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const disarm = () => { if (!disarmed) { disarmed = true; args.release?.(); } };
    const finish = (outcome: SignatureOutcome | { error: unknown }) => {
      if (done) return;
      done = true;
      disarm();
      timers.forEach(clearTimeout);
      if (socket) { socket.onclose = socket.onerror = socket.onmessage = null; try { socket.close(); } catch { /* already closed */ } }
      if (typeof outcome === 'object') reject(outcome.error); else resolve(outcome);
    };
    const land = () => { if (!processed) { processed = true; disarm(); args.onProcessed?.(); } };
    const apply = (status: SignatureStatus): boolean => {
      if (done) return true;
      if (landed(status)) land();
      if (status && status.err != null) {
        if (args.commitment === 'finalized' && status.confirmationStatus !== 'finalized') return false;
        finish('failed'); return true;
      }
      if (status?.err === null && observedSlot(status) && ['processed', 'confirmed', 'finalized'].includes(status.confirmationStatus ?? '')) {
        if (!processedSlotNotified) { processedSlotNotified = true; args.onProcessedSlot?.(Number(status.slot)); }
        if (args.commitment === 'processed') { finish('processed'); return true; }
      }
      if (confirmed(status)) {
        args.onConfirmedSlot?.(Number(status!.slot), status!.confirmationStatus);
        if (!confirmationNotified) { confirmationNotified = true; args.onConfirmed?.(); }
        if (args.commitment !== 'finalized' || status?.confirmationStatus === 'finalized') { finish('confirmed'); return true; }
      }
      return false;
    };
    const check = async (): Promise<void> => {
      try {
        if (apply(await args.getStatus(args.signature) ?? null) || done) return;
        if (args.expired && await args.expired()) {
          disarm();
          const history = await args.getStatus(args.signature, true);
          if (apply(history ?? null) || done) return;
          if (!processed && history === null) finish('expired');
        }
      } catch (error) { finish({ error }); }
    };
    const poll = async (): Promise<void> => {
      if (polling || done) return;
      polling = true;
      while (!done) {
        await check();
        if (!done) await new Promise((wait) => timers.push(setTimeout(wait, pollMs)));
      }
    };
    let resends = 0;
    const resend = () => {
      if (done || !args.rebroadcast) return;
      timers.push(setTimeout(() => {
        if (done || disarmed || ++resends > 30) return;
        void args.rebroadcast!().catch(() => undefined).then(resend);
      }, args.rebroadcastMs ?? 1_000));
    };
    timers.push(setTimeout(() => finish('timeout'), args.timeoutMs ?? 60_000));
    resend();
    if (!args.wsUrl) { void poll(); return; }
    try {
      socket = (args.socketFactory ?? ((url) => new WebSocket(url) as unknown as Socket))(args.wsUrl);
    } catch { void poll(); return; }
    if (args.commitment === 'finalized' && args.expired) void poll();
    const subscriptions = new Map<number, 'processed' | 'confirmed' | 'finalized'>();
    const fallback = () => { if (!done) void poll(); };
    socket.onerror = fallback;
    socket.onclose = fallback;
    socket.onopen = () => {
      for (const [id, commitment] of [[1, 'processed'], [2, 'confirmed'], ...(args.commitment === 'finalized' ? [[3, 'finalized'] as const] : [])] as const) {
        socket!.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'signatureSubscribe', params: [args.signature, { commitment }] }));
      }
      if (!(args.commitment === 'finalized' && args.expired)) void check();
    };
    socket.onmessage = ({ data }) => {
      let message: { id?: number; result?: unknown; error?: unknown; method?: string; params?: { subscription?: number; result?: { context?: { slot?: unknown }; value?: { err?: unknown } | string } } };
      try { message = JSON.parse(String(data)); } catch { return; }
      if (message.id !== undefined) {
        if (message.id !== 1 && message.id !== 2 && !(message.id === 3 && args.commitment === 'finalized')) return;
        if (message.error || typeof message.result !== 'number') fallback();
        else subscriptions.set(message.result, message.id === 1 ? 'processed' : message.id === 3 ? 'finalized' : 'confirmed');
        return;
      }
      if (message.method === 'subscriptionError') { fallback(); return; }
      if (message.method !== 'signatureNotification') return;
      const commitment = subscriptions.get(message.params?.subscription ?? -1);
      const value = message.params?.result?.value;
      const slot = message.params?.result?.context?.slot;
      if (!commitment || !value || typeof value !== 'object' || !('err' in value) || typeof slot !== 'number' || !Number.isSafeInteger(slot) || slot <= 0) return;
      apply({ err: value.err, confirmationStatus: commitment, slot });
    };
  });
}

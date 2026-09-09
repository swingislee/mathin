export interface PushCycleJob {
  kind: string;
  [key: string]: unknown;
}
export function jobWorkerScope(value?: string): "all" | "web_push";
export function runWebPushCycle(config: {
  admin: { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data?: PushCycleJob[] | null; error?: unknown }> };
  workerId: string;
  version: string;
  batchSize: number;
  leaseSeconds: number;
}, settle: (job: PushCycleJob) => Promise<unknown>): Promise<number>;

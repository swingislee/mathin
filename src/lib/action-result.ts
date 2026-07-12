export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? Record<never, never> : { data: T }))
  | { ok: false; code: string };

export function actionError(error: unknown, allowedCodes: readonly string[], fallback = "UNKNOWN"): ActionResult {
  const message = error instanceof Error ? error.message : "";
  const code = allowedCodes.find((item)=>message.includes(item));
  return {ok:false,code:code??fallback};
}

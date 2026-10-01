/** 延后一轮微任务再开始读取，让 Strict Mode 的预清理跳过已取消的请求。 */
export async function readClassSessionResource<T>(url: string, input: unknown, signal: AbortSignal): Promise<T> {
  await Promise.resolve();
  if (signal.aborted) throw new DOMException("Request cancelled", "AbortError");
  const response = await fetch(url, {
    method: "POST", credentials: "same-origin", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(response.status === 403 ? "forbidden" : "failed");
  return await response.json() as T;
}

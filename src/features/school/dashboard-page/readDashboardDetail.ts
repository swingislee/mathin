/** 详情读取使用独立请求，避免进入页面 Action 刷新链路；由调用方在切换或卸载时取消。 */
export async function readDashboardDetail<T>(url: string, input: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: "POST", credentials: "same-origin", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("Detail unavailable");
  return await response.json() as T;
}

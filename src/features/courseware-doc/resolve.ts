import { ASSET_BINDING_URL_PREFIX } from "./schema";

/**
 * bindingKey → URL 的解析结果。来源可注入(docs/plan/16 §3 D5):
 * - 中台/备课预览:staff 用自身 token 批签 cw-objects signed URL(服务端完成);
 * - 课堂:候课预载的 IndexedDB blob URL(P6-5 接入);
 * - H5:一律为垫片入口 URL(已拼回 launch query)。
 * DocStage 只消费这张表,不关心 URL 从哪来。
 */
export type ResolvedBindingUrls = Readonly<Record<string, string>>;

const BINDING_PLACEHOLDER = /asset:\/\/binding\/([0-9a-f]{64})/g;

/** richText html 里的 asset://binding/<key> 占位注入实际 URL;未解析的引用原样保留(渲染为破图,可见即可查)。 */
export function injectBindingUrls(html: string, urls: ResolvedBindingUrls): string {
  return html.replace(BINDING_PLACEHOLDER, (placeholder, bindingKey: string) => urls[bindingKey] ?? placeholder);
}

export interface H5LaunchQuery {
  query: Record<string, string[]>;
  coursewareIdParam: string | null;
}

/**
 * H5 iframe 入口 URL:垫片路径 + launch query 拼回。
 * 多页共享同一 H5 包、靠 query 区分关卡(doc 16 P6-1 发现②),漏拼会全部打开第一关。
 */
export function buildH5EntryUrl(
  packageHash: string,
  entryPath: string,
  launchQuery: H5LaunchQuery | null,
): string {
  const encodedEntry = entryPath.split("/").map(encodeURIComponent).join("/");
  const base = `/api/cw-h5/packages/${packageHash}/${encodedEntry}`;
  if (!launchQuery) return base;
  const params = new URLSearchParams();
  for (const [key, values] of Object.entries(launchQuery.query)) {
    for (const value of values) params.append(key, value);
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export { ASSET_BINDING_URL_PREFIX };

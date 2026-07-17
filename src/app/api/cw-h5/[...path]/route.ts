import { getSupabaseConfig } from "@/lib/supabase/config";
import {
  H5_IMMUTABLE_CACHE,
  h5ObjectPath,
  h5PublicUrl,
  isHtmlObjectPath,
} from "@/features/courseware-doc/h5-shim";

/**
 * H5 包垫片(docs/plan/16 §3 D3,proxy matcher 已排除 /api):
 * - .html/.htm:服务端取回后以 text/html 直出(storage-api 会把 HTML 降级
 *   text/plain,这是它存在的唯一原因);
 * - 其余扩展名:可缓存的 308 到 storage 公开 URL——内容寻址路径永不变,
 *   让浏览器把重定向本身缓存住,二次加载不再穿透 mathin。
 * iframe 侧必须 sandbox="allow-scripts"(不含 allow-same-origin),见 DocStage。
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const objectPath = h5ObjectPath(path);
  if (!objectPath) return new Response("Not found", { status: 404 });

  const publicUrl = h5PublicUrl(getSupabaseConfig().url, objectPath);
  if (!isHtmlObjectPath(objectPath)) {
    return new Response(null, {
      status: 308,
      headers: { Location: publicUrl, "Cache-Control": H5_IMMUTABLE_CACHE },
    });
  }

  const upstream = await fetch(publicUrl, { cache: "no-store" });
  if (!upstream.ok) return new Response("Not found", { status: 404 });
  return new Response(await upstream.text(), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": H5_IMMUTABLE_CACHE,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

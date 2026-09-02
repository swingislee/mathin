import { getSupabaseConfig } from "@/lib/supabase/config";
import {
  H5_IMMUTABLE_CACHE,
  h5HtmlSecurityHeaders,
  h5ObjectPath,
  h5PublicUrl,
  injectH5Runtime,
  isHtmlObjectPath,
} from "@/features/courseware-doc/h5-shim";
import { parseH5InputProfile, type H5InputProfile } from "@/features/courseware-doc/h5-input-profile";
import { injectSourceRuntimeEditorBridge } from "@/features/courseware-doc/source-runtime-editor-bridge";
import {
  SOURCE_RUNTIME_EDITOR_PARAM,
  SOURCE_RUNTIME_PROTOCOL,
} from "@/features/courseware-doc/source-runtime-schema";

/**
 * H5 包垫片(docs/plan/16 §3 D3,proxy matcher 已排除 /api):
 * - .html/.htm:服务端取回后以 text/html 直出(storage-api 会把 HTML 降级
 *   text/plain,这是它存在的唯一原因);
 * - `__h5_noop__/*`:打点/日志上报的离线改写目标,直接 204 空转;
 * - `__h5_backend__/get?courseware_id=X`:关卡配置接口的离线改写目标,
 *   改写为包内 `__h5_fixtures__/get/X.json` 并代理直出(该 XHR 老代码带
 *   withCredentials,凭据模式下不能吃 storage 的通配符 CORS,故不走 308);
 * - 其余扩展名:同源代理 storage 公开对象并永久缓存。爱学习离线引擎自带
 *   `script-src 'self'` 等 CSP，308 到 Storage 会在最终 URL 被浏览器拒绝；
 *   同源代理同时保留 Range 请求，视频跳播不退化。
 * 三个特殊路径的语义以镜像 `src/h5/offline-server.ts` 为准。
 * iframe 侧必须 sandbox="allow-scripts"(不含 allow-same-origin),见 DocStage。
 *
 * CORS:沙箱 iframe 的 origin 是 "null",@font-face/fetch/XHR 走 CORS 模式,
 * 且重定向链上每一跳都必须带 Access-Control-Allow-Origin(storage 侧 Kong
 * 已返回 *)。带 Origin 时反射并允许凭据——通配符 * 会被凭据模式请求拒收;
 * 内容为公开桶的内容寻址对象,该路由也不做 Cookie 鉴权,放开无害。
 */

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin) return { "Access-Control-Allow-Origin": "*" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

async function getActiveH5InputProfile(packageHash: string): Promise<H5InputProfile | null> {
  try {
    const { url, key } = getSupabaseConfig();
    const endpoint = new URL(`${url.replace(/\/$/, "")}/rest/v1/cw_h5_input_profiles`);
    endpoint.searchParams.set(
      "select",
      "profile_schema,provider_schema,provider_version,default_capability",
    );
    endpoint.searchParams.set("package_sha256", `eq.${packageHash}`);
    endpoint.searchParams.set("status", "eq.active");
    endpoint.searchParams.set("limit", "2");
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });
    if (!response.ok) return null;
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1) return null;
    return parseH5InputProfile(rows[0]);
  } catch {
    // Profile availability must never block native H5 playback. No profile
    // means the classroom bridge remains incompatible and Smart fails closed.
    return null;
  }
}

export function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(request),
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers":
        request.headers.get("access-control-request-headers") ?? "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const objectPath = h5ObjectPath(path);
  if (!objectPath) return new Response("Not found", { status: 404 });
  const cors = corsHeaders(request);
  const packagePath = path.slice(2).join("/");

  if (packagePath.startsWith("__h5_noop__/")) {
    return new Response(null, {
      status: 204,
      headers: { ...cors, "Cache-Control": "no-store" },
    });
  }

  if (packagePath === "__h5_backend__/get") {
    const coursewareId = new URL(request.url).searchParams.get("courseware_id") ?? "";
    if (!/^\d+$/.test(coursewareId)) {
      return new Response("Not found", { status: 404, headers: cors });
    }
    const fixtureUrl = h5PublicUrl(
      getSupabaseConfig().url,
      `packages/${path[1]}/__h5_fixtures__/get/${coursewareId}.json`,
    );
    const fixture = await fetch(fixtureUrl, { cache: "no-store" });
    if (!fixture.ok) return new Response("Not found", { status: 404, headers: cors });
    return new Response(await fixture.arrayBuffer(), {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": H5_IMMUTABLE_CACHE,
      },
    });
  }

  const publicUrl = h5PublicUrl(getSupabaseConfig().url, objectPath);
  if (!isHtmlObjectPath(objectPath)) {
    const range = request.headers.get("range");
    const upstream = await fetch(publicUrl, {
      cache: "no-store",
      headers: range ? { Range: range } : undefined,
    });
    if (!upstream.ok && upstream.status !== 206) {
      return new Response("Not found", { status: 404, headers: cors });
    }
    const headers = new Headers({
      ...cors,
      "Cache-Control": H5_IMMUTABLE_CACHE,
      "X-Content-Type-Options": "nosniff",
    });
    // Node fetch 会自动解压 gzip/br 响应，但保留上游压缩态 Content-Length；
    // 转发该长度会让浏览器把已解压脚本截断。由 Response 重新确定实体长度。
    for (const name of ["Content-Type", "Content-Range", "Accept-Ranges", "ETag"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...Object.fromEntries(headers.entries()),
      },
    });
  }

  const upstream = await fetch(publicUrl, { cache: "no-store" });
  if (!upstream.ok) return new Response("Not found", { status: 404, headers: cors });
  const profile = await getActiveH5InputProfile(path[1]);
  const requestUrl = new URL(request.url);
  const sourceEditor = requestUrl.searchParams.get(SOURCE_RUNTIME_EDITOR_PARAM) === SOURCE_RUNTIME_PROTOCOL;
  const runtimeHtml = injectH5Runtime(await upstream.text(), profile);
  return new Response(sourceEditor ? injectSourceRuntimeEditorBridge(runtimeHtml) : runtimeHtml, {
    status: 200,
    headers: {
      ...cors,
      ...h5HtmlSecurityHeaders(request.url),
      "Content-Type": "text/html; charset=utf-8",
      // The package bytes are immutable, but this response also contains the
      // app-owned runtime shim and must be revalidated after app deployments.
      "Cache-Control": "public, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

import {
  H5_SANDBOX_CSP,
  injectH5Runtime,
} from "@/features/courseware-doc/h5-shim";
import {
  H5_POINTER_RUNTIME_VERSION,
} from "@/features/courseware-doc/h5-pointer-protocol";

export const dynamic = "force-dynamic";

function fixtureHtml(compatible: boolean): string {
  const provider = compatible
    ? ' data-classroom-input-provider="mathin-classroom-input" data-classroom-renderer-version="1" data-classroom-input-default="ink"'
    : "";
  const state = compatible ? "provider v1 ready" : "provider missing · protected";
  return injectH5Runtime(`<!doctype html>
<html lang="zh"${provider}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
  <title>M3b H5 pointer fixture</title>
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; }
    body { display: grid; grid-template-rows: auto auto 1fr; gap: 14px; padding: 28px; color: #29251f; background: #fffdf8; font-family: system-ui, sans-serif; user-select: none; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    h1 { margin: 0; font-size: 25px; }
    small { color: #77695e; }
    nav { display: flex; flex-wrap: wrap; gap: 10px; }
    button { min-height: 46px; border: 1px solid #b99578; border-radius: 999px; padding: 8px 18px; color: inherit; background: #feedb9; font: inherit; }
    #paper { display: grid; place-items: center; min-height: 150px; border: 2px dashed #c8ab91; border-radius: 24px; color: #77695e; background: #fffaf0; }
    #count { font-variant-numeric: tabular-nums; }
  </style>
</head>
<body>
  <header data-classroom-input="ink">
    <h1>H5 Pointer Bridge</h1>
    <small>${state} · runtime ${H5_POINTER_RUNTIME_VERSION}</small>
  </header>
  <nav data-classroom-input="ink">
    <button id="counter" type="button" data-classroom-input="click">轻点计数 <span id="count">0</span></button>
    <button id="reload" type="button" data-classroom-input="click">重载 iframe</button>
  </nav>
  <div id="paper" data-classroom-input="ink">在此区域书写；也可从“轻点计数”按钮上起笔拖出</div>
  <script>
    document.getElementById("counter").addEventListener("click", () => {
      const count = document.getElementById("count");
      count.textContent = String(Number(count.textContent || 0) + 1);
    });
    document.getElementById("reload").addEventListener("click", () => location.reload());
  </script>
</body>
</html>`);
}

export function GET(request: Request): Response {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  const compatible = new URL(request.url).searchParams.get("compatible") !== "0";
  return new Response(fixtureHtml(compatible), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": H5_SANDBOX_CSP,
      "Content-Type": "text/html; charset=utf-8",
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
}

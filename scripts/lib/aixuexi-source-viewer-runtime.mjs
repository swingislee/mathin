import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
const PROTOCOL = "mathin-source-runtime-v1";
const FRAME_SOURCE = "mathin-source-runtime";
const HOST_SOURCE = "mathin-source-runtime-host";

/**
 * MathJax v2 stores TeX source in a deliberately inert script element.
 * Remove only its exact, attribute-free shape from executable-markup
 * inspection. The original markup is still packaged and stored verbatim.
 */
export function stripInertMathTexScriptsForInspection(markup) {
  return String(markup ?? "").replace(
    /<script\s+type\s*=\s*(["'])math\/tex\1\s*>([^<]*)<\/script\s*>/gi,
    "",
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function replaceOnce(value, search, replacement, label) {
  const first = value.indexOf(search);
  if (first < 0 || value.indexOf(search, first + search.length) >= 0) {
    throw new Error(`AIXUEXI_SOURCE_RUNTIME: ${label} source seam is missing or ambiguous`);
  }
  return `${value.slice(0, first)}${replacement}${value.slice(first + search.length)}`;
}

function extractTemplateExport(source, exportName, raw) {
  const marker = `export const ${exportName} = ${raw ? "String.raw" : ""}\``;
  const start = source.indexOf(marker);
  const end = source.lastIndexOf("`;\n");
  if (start < 0 || end <= start || source.indexOf(marker, start + marker.length) >= 0) {
    throw new Error(`AIXUEXI_SOURCE_RUNTIME: cannot read source export ${exportName}`);
  }
  return source.slice(start + marker.length, end);
}

/** Load the producer-owned, raw-template Viewer exports without compiling that repository. */
export async function loadAixuexiSourceViewerRuntime(sourceRoot) {
  const viewerRoot = path.join(path.resolve(sourceRoot), "src", "viewer");
  const [viewerAppSource, viewerStylesSource, trueOrFalseSource, topicClassificationSource] = await Promise.all([
    readFile(path.join(viewerRoot, "viewer-app.ts"), "utf8"),
    readFile(path.join(viewerRoot, "viewer-styles.ts"), "utf8"),
    readFile(path.join(viewerRoot, "aixuexi-true-or-false-viewer.ts"), "utf8"),
    readFile(path.join(viewerRoot, "aixuexi-topic-classification-viewer.ts"), "utf8"),
  ]);
  const trueOrFalseRuntime = extractTemplateExport(trueOrFalseSource, "aixuexiTrueOrFalseViewerRuntime", true);
  const topicClassificationRuntime = extractTemplateExport(topicClassificationSource, "aixuexiTopicClassificationViewerRuntime", true);
  const viewerScript = extractTemplateExport(viewerAppSource, "viewerScript", true)
    .replace("${aixuexiTrueOrFalseViewerRuntime}", trueOrFalseRuntime)
    .replace("${aixuexiTopicClassificationViewerRuntime}", topicClassificationRuntime);
  const value = {
    viewerScript,
    viewerStyles: extractTemplateExport(viewerStylesSource, "viewerStyles", false),
  };
  if (typeof value.viewerScript !== "string"
      || typeof value.viewerStyles !== "string"
      || !value.viewerScript.includes("function aixuexiPreviewHtml(page)")
      || !value.viewerScript.includes("aix-shared-interaction-entry")
      || !value.viewerStyles.includes(".aix-shared-interaction-entry")) {
    throw new Error("AIXUEXI_SOURCE_RUNTIME: source Viewer export is incomplete");
  }
  return value;
}

function portableBridgeScript() {
  return String.raw`
const mathinSend=(type,extra={})=>parent.postMessage({source:'${FRAME_SOURCE}',protocol:'${PROTOCOL}',type,...extra},'*');
let mathinMediaBound=false;
function mathinBindMedia(){
  if(mathinMediaBound)return;mathinMediaBound=true;
  document.addEventListener('play',event=>{if(event.target instanceof HTMLMediaElement)parent.postMessage({source:'mathin-h5-media',action:'play',time:event.target.currentTime},'*')},true);
  document.addEventListener('pause',event=>{if(event.target instanceof HTMLMediaElement)parent.postMessage({source:'mathin-h5-media',action:'pause',time:event.target.currentTime},'*')},true);
  document.addEventListener('seeked',event=>{if(event.target instanceof HTMLMediaElement)parent.postMessage({source:'mathin-h5-media',action:'seek',time:event.target.currentTime},'*')},true);
}
async function mathinRender(message){
  if(message.format!=='aixuexi-viewer-page-v1'||!message.data||typeof message.data!=='object')throw new Error('SOURCE_RUNTIME_PAYLOAD_UNSUPPORTED');
  MATHIN_PORTABLE={resources:message.resources||{},routes:message.routes||{}};
  const page=message.data;
  app.innerHTML=aixuexiPreviewHtml(page);
  const viewport=app.querySelector(':scope > .aix-layout-viewport');
  if(!viewport)throw new Error('SOURCE_RUNTIME_STAGE_MISSING');
  app.replaceChildren(viewport);
  fitAixuexiStages();
  await hydrateAixuexiPreviews(page);
  hydrateAixuexiPageBehaviors(page);
  hydrateAixuexiMathAndItv(page);
  scheduleAixuexiLayoutCorrections();
  mathinBindMedia();
  document.documentElement.dataset.mathinInteractive=String(message.interactive!==false);
  if(message.interactive===false)document.querySelectorAll('[data-aix-topic-launch],[data-aix-itv-entry]').forEach(button=>button.setAttribute('disabled',''));
  const stage=viewport.querySelector('[data-aix-stage]');
  if(stage&&message.interactive!==false&&message.advanceOnCanvasClick===true)stage.addEventListener('click',event=>{
    if(aixuexiConsumesPageClick(event))return;
    const selection=window.getSelection?.();
    if(selection&&!selection.isCollapsed)return;
    mathinSend('advance');
  });
  fitAixuexiStages();applyAixuexiLayoutCorrections();
  mathinSend('rendered');
}
window.addEventListener('resize',()=>{fitAixuexiStages();applyAixuexiLayoutCorrections()},{passive:true});
window.addEventListener('message',event=>{
  const message=event.data||{};
  if(event.source===parent&&message.source==='${HOST_SOURCE}'&&message.protocol==='${PROTOCOL}'&&message.type==='render'){
    mathinRender(message).catch(error=>mathinSend('error',{message:String(error?.message||error)}));return;
  }
  if(event.source===parent&&message.source==='mathin-classroom'&&message.type==='media_ctl'){
    document.querySelectorAll('video,audio').forEach(media=>{try{if(Number.isFinite(message.time)&&Math.abs(media.currentTime-message.time)>.5)media.currentTime=message.time;if(message.action==='play')media.play().catch(()=>{});if(message.action==='pause')media.pause()}catch{}});return;
  }
  if(message.source==='mathin-h5-media')parent.postMessage(message,'*');
});
mathinSend('ready');`;
}

/**
 * Convert the source review Viewer into a page-only, postMessage-driven runtime.
 * Every replacement is an explicit fail-closed adapter seam; presentation and
 * interaction functions remain byte-for-byte owned by the source project.
 */
export function buildPortableAixuexiViewerRuntime({ viewerScript, viewerStyles, staticRoutes }) {
  const sourceFingerprint = sha256(`${viewerScript}\0${viewerStyles}`);
  let script = viewerScript;
  script = replaceOnce(
    script,
    "const PUBLIC_BASE_PATH='';",
    `let MATHIN_PORTABLE=null;\nconst MATHIN_STATIC_ROUTES=${JSON.stringify(staticRoutes)};\nconst PUBLIC_BASE_PATH='';`,
    "bootstrap",
  );
  script = replaceOnce(
    script,
    "const publicPath=path=>PUBLIC_BASE_PATH&&String(path).startsWith('/')&&path!==PUBLIC_BASE_PATH&&!String(path).startsWith(PUBLIC_BASE_PATH+'/')?PUBLIC_BASE_PATH+path:path;",
    "const publicPath=path=>MATHIN_PORTABLE?.routes?.[path]??(MATHIN_STATIC_ROUTES[path]?new URL(MATHIN_STATIC_ROUTES[path],location.href).href:(String(path).startsWith('/api/')?'about:blank#unmapped-source-runtime-route':path));",
    "public path",
  );
  script = replaceOnce(
    script,
    "const assetUrl=(resource,page)=>publicPath('/api/assets/'+resource.resourceRefId+'/content?course='+encodeURIComponent(page.coursewareId)+'&page='+encodeURIComponent(page.pageDatabaseId));",
    "const assetUrl=resource=>MATHIN_PORTABLE?.resources?.[String(resource.resourceRefId)]||'';",
    "asset URL",
  );
  script = replaceOnce(
    script,
    "const assetPathPrefix=publicPath('/api/assets/');\nconst isAixuexiLocalAssetUrl=value=>String(value).startsWith(assetPathPrefix);",
    "const isAixuexiLocalAssetUrl=value=>Object.values(MATHIN_PORTABLE?.resources||{}).some(url=>String(value).startsWith(url));",
    "asset URL policy",
  );
  if (script.includes("assetPathPrefix")) {
    throw new Error("AIXUEXI_SOURCE_RUNTIME: source Viewer bypasses its asset URL policy");
  }
  const routeStart = script.lastIndexOf("route().catch(error=>");
  if (routeStart < 0 || script.slice(routeStart).trim().split("\n").length !== 1) {
    throw new Error("AIXUEXI_SOURCE_RUNTIME: route bootstrap seam is missing or ambiguous");
  }
  script = `${script.slice(0, routeStart)}${portableBridgeScript()}\n`;
  return { viewerScript: script, viewerStyles, sourceFingerprint };
}

export function portableAixuexiViewerHtml({ hasLottie }) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Source courseware runtime</title>
<link rel="stylesheet" href="./slide-runtime.css"><link rel="stylesheet" href="./itv-runtime.css"><link rel="stylesheet" href="./viewer-runtime.css"><link rel="stylesheet" href="./vendor/katex/katex.min.css">
<style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#fff}body{min-width:0}#app{width:100%;height:100%;max-width:none;margin:0;padding:0;overflow:hidden}.aix-layout-viewport{height:100%;border-radius:0;background:#fff}.aix-layout-frame{border-radius:0}</style>
</head><body><main id="app" aria-live="polite">加载中…</main><script src="./vendor/katex/katex.min.js"></script>${hasLottie ? '<script src="./lottie.min.js"></script>' : ""}<script src="./viewer-runtime.js"></script></body></html>`;
}

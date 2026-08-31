export const SOURCE_RUNTIME_DELIVERY_PARAM = "mathin_source_delivery";
export const SOURCE_RUNTIME_DELIVERY_VERSION = "3";

function appendQueryParam(url, name, value) {
  const fragmentAt = url.indexOf("#");
  const base = fragmentAt < 0 ? url : url.slice(0, fragmentAt);
  const fragment = fragmentAt < 0 ? "" : url.slice(fragmentAt);
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}${name}=${encodeURIComponent(value)}${fragment}`;
}

/** Give the app-owned delivery seam a cache identity without changing the immutable package. */
export function versionSourceRuntimeEntryUrl(url) {
  return appendQueryParam(url, SOURCE_RUNTIME_DELIVERY_PARAM, SOURCE_RUNTIME_DELIVERY_VERSION);
}

function sourceRuntimeDeliveryRequested(requestUrl) {
  return new URL(requestUrl).searchParams.get(SOURCE_RUNTIME_DELIVERY_PARAM)
    === SOURCE_RUNTIME_DELIVERY_VERSION;
}

/**
 * The package HTML is revalidated after each app deploy. Version only the
 * portable bridge asset so an already cached immutable package can receive a
 * host-lifecycle hotfix without changing source DOM/CSS or page data.
 */
export function versionSourceRuntimeHtmlAssets(html, requestUrl) {
  if (!sourceRuntimeDeliveryRequested(requestUrl)) return html;
  return html.replace(
    /(<script\b[^>]*\bsrc=(['"]))(\.\/viewer-runtime\.js)(\2[^>]*>)/i,
    (_match, prefix, quote, source, suffix) => (
      `${prefix}${appendQueryParam(source, SOURCE_RUNTIME_DELIVERY_PARAM, SOURCE_RUNTIME_DELIVERY_VERSION)}${suffix}`
    ),
  );
}

export function isVersionedSourceRuntimeViewerAsset(packagePath, requestUrl) {
  return packagePath.endsWith("viewer-runtime.js") && sourceRuntimeDeliveryRequested(requestUrl);
}

/**
 * Shared by newly built portable runtimes and the delivery upgrade for
 * already-published immutable packages. It changes only page lifecycle:
 * producer Viewer code still owns every rendered element and interaction.
 */
export function sourceRuntimeVisualLifecycleScript() {
  return String.raw`
const mathinVisualLifecycleVersion='${SOURCE_RUNTIME_DELIVERY_VERSION}';
const mathinDelay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const mathinNextPaint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
let mathinRuntimeFontsScheduled=false;
async function mathinRuntimeFontUrls(){
  const stylesheet=new URL('./slide-runtime.css',location.href);
  try{
    const response=await fetch(stylesheet,{cache:'force-cache'});if(!response.ok)return [];
    const css=await response.text(),urls=new Set();
    for(const match of css.matchAll(/url\((?:["']?)([^"')]+)(?:["']?)\)/g)){
      try{const url=new URL(match[1],stylesheet).href;if(/\/runtime-assets\/.*\.woff2?(?:$|\?)/i.test(url))urls.add(url)}catch{}
    }
    return [...urls]
  }catch{return []}
}
function mathinWarmRuntimeFonts(){
  if(mathinRuntimeFontsScheduled)return;mathinRuntimeFontsScheduled=true;
  const warm=async()=>{for(const url of await mathinRuntimeFontUrls()){try{await fetch(url,{cache:'force-cache'})}catch{}}};
  if(typeof requestIdleCallback==='function')requestIdleCallback(()=>void warm(),{timeout:1500});else setTimeout(()=>void warm(),750)
}
async function mathinWaitForVisualReady(){
  await mathinNextPaint();
  const images=[...app.querySelectorAll('img')];
  const decoded=Promise.allSettled(images.map(image=>image.decode?.()||Promise.resolve()));
  await Promise.race([decoded,mathinDelay(900)]);
  if(document.fonts?.ready)await Promise.race([document.fonts.ready,mathinDelay(350)]);
  await mathinNextPaint()
}
async function mathinRender(message){
  const update=async()=>{await mathinRenderBody(message);await mathinWaitForVisualReady()};
  if(typeof document.startViewTransition==='function'&&app.firstElementChild){
    let failure=null;
    const transition=document.startViewTransition(async()=>{try{await update()}catch(error){failure=error}});
    await transition.updateCallbackDone;
    if(failure)throw failure
  }else await update();
  mathinSend('rendered',{renderKey:message.renderKey});
  mathinWarmRuntimeFonts()
}`;
}

/** Upgrade the exact old portable bridge; unrelated package scripts pass through byte-for-byte. */
export function upgradeSourceRuntimeViewerScript(script) {
  if (script.includes("mathinVisualLifecycleVersion=")) return script;
  const renderStart = "async function mathinRender(message){";
  const renderEnd = /  mathinSend\('rendered'(?:,\{renderKey:message\.renderKey\})?\);\r?\n}\r?\n(?=async function mathinDrainRenderQueue\(\)\{|window\.addEventListener\('resize')/;
  if (!script.includes(renderStart) || !renderEnd.test(script)) return script;
  return script
    .replace(renderStart, "async function mathinRenderBody(message){")
    .replace(
      renderEnd,
      `}\n${sourceRuntimeVisualLifecycleScript()}\n`,
    );
}

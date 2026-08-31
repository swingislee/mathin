export const SOURCE_RUNTIME_DELIVERY_PARAM = "mathin_source_delivery";
export const SOURCE_RUNTIME_DELIVERY_VERSION = "4";

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
async function mathinRender(message){
  if(typeof document.startViewTransition==='function'&&app.firstElementChild){
    let updatePromise=null;
    const transition=document.startViewTransition(()=>{
      updatePromise=Promise.resolve().then(()=>mathinRenderBody(message));
      return updatePromise
    });
    void transition.ready.catch(()=>undefined);
    void transition.finished.catch(()=>undefined);
    try{await transition.updateCallbackDone}catch(error){if(updatePromise)await updatePromise;else throw error}
  }else await mathinRenderBody(message);
  mathinSend('rendered',{renderKey:message.renderKey})
}`;
}

/** Upgrade the exact old portable bridge; unrelated package scripts pass through byte-for-byte. */
export function upgradeSourceRuntimeViewerScript(script) {
  const currentLifecycle = `const mathinVisualLifecycleVersion='${SOURCE_RUNTIME_DELIVERY_VERSION}';`;
  if (script.includes(currentLifecycle)) return script;
  const lifecycleStart = script.indexOf("const mathinVisualLifecycleVersion='");
  if (lifecycleStart >= 0) {
    const queueStart = script.indexOf("async function mathinDrainRenderQueue(){", lifecycleStart);
    const resizeStart = script.indexOf("window.addEventListener('resize'", lifecycleStart);
    const lifecycleEnd = [queueStart, resizeStart]
      .filter((value) => value >= 0)
      .sort((left, right) => left - right)[0];
    if (lifecycleEnd === undefined
        || script.indexOf("const mathinVisualLifecycleVersion='", lifecycleStart + 1) >= 0) return script;
    return `${script.slice(0, lifecycleStart)}${sourceRuntimeVisualLifecycleScript()}\n${script.slice(lifecycleEnd)}`;
  }
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

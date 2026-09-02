export const SOURCE_RUNTIME_DELIVERY_PARAM = "mathin_source_delivery";
export const SOURCE_RUNTIME_DELIVERY_VERSION = "6";

const SOURCE_RUNTIME_LOTTIE_READINESS_MARKER = `/* mathin-source-lottie-readiness-v${SOURCE_RUNTIME_DELIVERY_VERSION} */`;

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
let mathinVisualObjectUrls=[];
function mathinPrepareVisualMessage(message){
  const objectUrls=[];
  const resources={};
  for(const [resourceId,value] of Object.entries(message.resources||{})){
    if(typeof Blob!=='undefined'&&value instanceof Blob){
      const url=URL.createObjectURL(value);
      objectUrls.push(url);
      resources[resourceId]=url
    }else resources[resourceId]=value
  }
  return {message:{...message,resources},objectUrls}
}
function mathinReleaseVisualObjectUrls(urls){
  for(const url of urls)URL.revokeObjectURL(url)
}
async function mathinRender(message){
  const prepared=mathinPrepareVisualMessage(message);
  try{
    if(typeof document.startViewTransition==='function'&&app.firstElementChild){
      let updatePromise=null;
      const transition=document.startViewTransition(()=>{
        updatePromise=Promise.resolve().then(()=>mathinRenderBody(prepared.message));
        return updatePromise
      });
      void transition.ready.catch(()=>undefined);
      void transition.finished.catch(()=>undefined);
      try{await transition.updateCallbackDone}catch(error){if(updatePromise)await updatePromise;else throw error}
    }else await mathinRenderBody(prepared.message);
    const previous=mathinVisualObjectUrls;
    mathinVisualObjectUrls=prepared.objectUrls;
    mathinReleaseVisualObjectUrls(previous);
    mathinSend('rendered',{renderKey:message.renderKey})
  }catch(error){
    mathinReleaseVisualObjectUrls(prepared.objectUrls);
    throw error
  }
}`;
}

/**
 * Published X+ packages still bundle lottie-web 5.6.6. That source player
 * renders before DOMLoaded but does not expose the newer drawnFrame event.
 * Upgrade only the producer Viewer's exact readiness bridge and keep the
 * source lottie-web renderer, DOM and interaction ownership unchanged.
 */
function upgradeSourceRuntimeLottieReadiness(script) {
  if (script.includes(SOURCE_RUNTIME_LOTTIE_READINESS_MARKER)) return script;
  const functionStart = script.indexOf("async function hydrateAixuexiLottie(){");
  if (functionStart < 0) return script;
  const functionEnd = script.indexOf("\nconst hydrateAixuexiPreviewsBase=hydrateAixuexiPreviews;", functionStart);
  if (functionEnd < 0) return script;

  const block = script.slice(functionStart, functionEnd);
  const sourcePath = "        path:source";
  const legacyReadiness = [
    "      animation.addEventListener('DOMLoaded',()=>{domReady=true;ready()});",
    "      animation.addEventListener('drawnFrame',()=>{frameReady=true;ready()});",
  ].join("\n");
  if (!block.includes(sourcePath) || !block.includes(legacyReadiness)) return script;

  const upgradedBlock = block
    .replace(sourcePath, "        animationData")
    .replace(
      legacyReadiness,
      "      animation.addEventListener('DOMLoaded',()=>{domReady=true;frameReady=true;ready()});",
    );
  if (upgradedBlock === block) return script;
  return `${script.slice(0, functionStart)}${SOURCE_RUNTIME_LOTTIE_READINESS_MARKER}\n${upgradedBlock}${script.slice(functionEnd)}`;
}

/** Upgrade the exact old portable bridge; unrelated package scripts pass through byte-for-byte. */
export function upgradeSourceRuntimeViewerScript(script) {
  script = upgradeSourceRuntimeLottieReadiness(script);
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

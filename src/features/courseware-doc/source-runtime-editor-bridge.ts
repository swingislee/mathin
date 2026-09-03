import { injectHeadSnippet } from "./h5-shim";
import { SOURCE_RUNTIME_PROTOCOL } from "./source-runtime-schema";

const SOURCE_RUNTIME_EDITOR_BRIDGE = String.raw`<script data-mathin-source-runtime-editor="${SOURCE_RUNTIME_PROTOCOL}">
(()=>{
  if(window.__mathinSourceRuntimeEditorBridge)return;
  window.__mathinSourceRuntimeEditorBridge=true;
  const FRAME_SOURCE='mathin-source-runtime';
  const HOST_SOURCE='mathin-source-runtime-host';
  const PROTOCOL='${SOURCE_RUNTIME_PROTOCOL}';
  let editor={enabled:false,selectedNodePath:null,snapToGrid:true,canvas:{width:1200,height:900},nodes:[]};
  let metadata=new Map();
  let previewBases=new Map();
  let syncQueued=false;
  let observer=null;
  let observedRoot=null;

  const send=(type,extra={})=>parent.postMessage({source:FRAME_SOURCE,protocol:PROTOCOL,type,...extra},'*');
  const number=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
  const nodePath=node=>node?.dataset?.aixSourcePath||'';
  const nodes=()=>[...document.querySelectorAll('.aix-layout-node[data-aix-source-path]')];
  const nodeFor=path=>nodes().find(node=>nodePath(node)===path)||null;
  const normalizeInlineText=value=>String(value??'')
    .replace(/\r\n?/g,'\n')
    .replace(/[ \t]+\n/g,'\n')
    .replace(/\n[ \t]+/g,'\n')
    .replace(/^\n+|\n+$/g,'');

  function installOverrideStyle(){
    if(document.querySelector('style[data-mathin-source-editor-overrides]'))return;
    const style=document.createElement('style');
    style.dataset.mathinSourceEditorOverrides='';
    style.textContent=[
      '[data-mathin-source-inline-root][data-mathin-override-font-size="true"] *{font-size:inherit!important}',
      '[data-mathin-source-inline-root][data-mathin-override-color="true"] *{color:inherit!important}',
      '[data-mathin-source-inline-root][data-mathin-override-text-align="true"] *{text-align:inherit!important}',
    ].join('');
    (document.head||document.documentElement).append(style);
  }

  function setOverride(node,name,value){
    const marker='mathinOverride'+name.split('-').map(part=>part[0].toUpperCase()+part.slice(1)).join('');
    if(value===null||value===undefined||value===''){
      if(node.dataset[marker]==='true')node.style.removeProperty(name);
      delete node.dataset[marker];
      return;
    }
    node.dataset[marker]='true';
    node.style.setProperty(name,String(value),'important');
  }

  function syncNode(node,meta){
    if(meta.visible===false){
      node.dataset.mathinHidden='true';
      node.style.setProperty('display','none','important');
    }else if(node.dataset.mathinHidden==='true'){
      node.style.removeProperty('display');
      delete node.dataset.mathinHidden;
    }
    setOverride(node,'opacity',clamp(number(meta.opacity,1),0,1));
    setOverride(node,'z-index',Number.isFinite(meta.layer)?meta.layer:null);
    const content=node.querySelector('[data-aix-html]');
    if(content){
      content.dataset.mathinSourceInlineRoot='true';
      setOverride(content,'font-size',Number.isFinite(meta.fontSize)?String(meta.fontSize)+'px':null);
      setOverride(content,'color',typeof meta.color==='string'?meta.color:null);
      setOverride(content,'text-align',['left','center','right','justify'].includes(meta.textAlign)?meta.textAlign:null);
      const editable=editor.enabled&&meta.editableText;
      if(editable){
        if(content.getAttribute('contenteditable')!=='true')content.setAttribute('contenteditable','true');
        content.setAttribute('spellcheck','true');
        content.dataset.mathinSourceInlineEditor='true';
      }else if(content.dataset.mathinSourceInlineEditor==='true'){
        content.removeAttribute('contenteditable');
        content.removeAttribute('spellcheck');
        delete content.dataset.mathinSourceInlineEditor;
      }
    }
    previewBases.set(meta.path,{
      left:Number.parseFloat(node.style.left||'0')||0,
      top:Number.parseFloat(node.style.top||'0')||0,
      width:Number.parseFloat(node.style.width||String(meta.width))||meta.width,
      height:Number.parseFloat(node.style.height||String(meta.height))||meta.height,
    });
  }

  function sendGeometry(){
    if(!editor.enabled)return;
    const stage=document.querySelector('[data-aix-stage]');
    if(!stage)return;
    const stageRect=stage.getBoundingClientRect();
    const measured=nodes().flatMap(node=>{
      const path=nodePath(node),meta=metadata.get(path);
      if(!meta)return[];
      const rect=node.getBoundingClientRect();
      return[{path,left:rect.left,top:rect.top,width:rect.width,height:rect.height}];
    });
    send('editor-geometry',{geometry:{
      viewport:{width:window.innerWidth,height:window.innerHeight},
      stage:{left:stageRect.left,top:stageRect.top,width:stageRect.width,height:stageRect.height},
      nodes:measured,
    }});
  }

  function sync(){
    syncQueued=false;
    observer?.disconnect();
    installOverrideStyle();
    document.documentElement.dataset.mathinSourceEditor=String(editor.enabled===true);
    previewBases=new Map();
    nodes().forEach(node=>{
      const meta=metadata.get(nodePath(node));
      if(meta)syncNode(node,meta);
    });
    if(observer&&observedRoot)observer.observe(observedRoot,{subtree:true,childList:true});
    requestAnimationFrame(sendGeometry);
  }

  function scheduleSync(){
    if(syncQueued)return;
    syncQueued=true;
    requestAnimationFrame(sync);
  }

  function applyEditorState(value){
    const next=value&&typeof value==='object'?value:{};
    editor={...editor,...next,canvas:{...editor.canvas,...(next.canvas||{})},nodes:Array.isArray(next.nodes)?next.nodes:[]};
    metadata=new Map(editor.nodes.filter(item=>item&&typeof item.path==='string').map(item=>[item.path,item]));
    scheduleSync();
  }

  function applyPreview(path,patch){
    const node=nodeFor(path),meta=metadata.get(path),base=previewBases.get(path);
    if(!node||!meta||!base||!patch)return;
    if(Number.isFinite(patch.x))node.style.left=String(base.left+patch.x-meta.x)+'px';
    if(Number.isFinite(patch.y))node.style.top=String(base.top+patch.y-meta.y)+'px';
    if(Number.isFinite(patch.width))node.style.width=String(Math.max(1,base.width+patch.width-meta.width))+'px';
    if(Number.isFinite(patch.height))node.style.height=String(Math.max(1,base.height+patch.height-meta.height))+'px';
  }

  window.addEventListener('message',event=>{
    const message=event.data||{};
    if(event.source!==parent||message.source!==HOST_SOURCE||message.protocol!==PROTOCOL)return;
    if(message.type==='render'&&message.editor)applyEditorState(message.editor);
    if(message.type==='editor-state')applyEditorState(message.editor);
    if(message.type==='editor-preview-transform')applyPreview(message.nodePath,message.patch);
  });

  document.addEventListener('pointerdown',event=>{
    if(!editor.enabled||event.button!==0)return;
    const node=event.target instanceof Element?event.target.closest('.aix-layout-node[data-aix-source-path]'):null;
    const path=nodePath(node);
    if(!node||!metadata.has(path))return;
    send('node-selected',{nodePath:path});
    if(event.target instanceof Element&&event.target.closest('[data-mathin-source-inline-editor]'))return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  },true);

  document.addEventListener('click',event=>{
    if(!editor.enabled||!(event.target instanceof Element))return;
    const node=event.target.closest('.aix-layout-node[data-aix-source-path]');
    if(!node||!metadata.has(nodePath(node)))return;
    if(!event.target.closest('[data-mathin-source-inline-editor]'))event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  },true);

  document.addEventListener('focusin',event=>{
    if(!editor.enabled||!(event.target instanceof Element))return;
    const content=event.target.closest('[data-mathin-source-inline-editor]');
    const path=nodePath(content?.closest('.aix-layout-node[data-aix-source-path]'));
    if(path){send('node-selected',{nodePath:path});send('node-focus-change',{nodePath:path,focused:true})}
  },true);

  document.addEventListener('focusout',event=>{
    if(!editor.enabled||!(event.target instanceof HTMLElement)||!event.target.matches('[data-mathin-source-inline-editor]'))return;
    const path=nodePath(event.target.closest('.aix-layout-node[data-aix-source-path]'));
    if(path){
      send('node-text-change',{nodePath:path,value:normalizeInlineText(event.target.innerText)});
      send('node-focus-change',{nodePath:path,focused:false});
    }
  },true);

  const observe=()=>{
    observedRoot=document.body||document.documentElement;
    observer=new MutationObserver(scheduleSync);
    observer.observe(observedRoot,{subtree:true,childList:true});
    scheduleSync();
  };
  window.addEventListener('resize',()=>requestAnimationFrame(sendGeometry),{passive:true});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observe,{once:true});else observe();
})();
</script>`;

/**
 * Add the minimal transport needed by the shared host editor. This script
 * never renders authoring chrome; handles, outlines, and grids live in React.
 */
export function injectSourceRuntimeEditorBridge(html: string): string {
  return injectHeadSnippet(html, SOURCE_RUNTIME_EDITOR_BRIDGE);
}

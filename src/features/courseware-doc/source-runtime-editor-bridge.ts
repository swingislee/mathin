import { injectHeadSnippet } from "./h5-shim";
import { SOURCE_RUNTIME_PROTOCOL } from "./source-runtime-schema";

const SOURCE_RUNTIME_EDITOR_BRIDGE = String.raw`<script data-mathin-source-runtime-editor="${SOURCE_RUNTIME_PROTOCOL}">
(()=>{
  if(window.__mathinSourceRuntimeEditorBridge)return;
  window.__mathinSourceRuntimeEditorBridge=true;
  const FRAME_SOURCE='mathin-source-runtime';
  const HOST_SOURCE='mathin-source-runtime-host';
  const PROTOCOL='${SOURCE_RUNTIME_PROTOCOL}';
  let editor={enabled:false,selectedNodePath:null,snapToGrid:true,canvas:{width:1200,height:900},nodes:[],moveLabel:'Move',resizeLabel:'Resize'};
  let metadata=new Map();
  let syncQueued=false;
  let gesture=null;
  let observer=null;
  let observedRoot=null;

  const send=(type,extra={})=>parent.postMessage({source:FRAME_SOURCE,protocol:PROTOCOL,type,...extra},'*');
  const number=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
  const snap=(value,step)=>editor.snapToGrid&&step>0?Math.round(value/step)*step:value;
  const nodePath=node=>node?.dataset?.aixSourcePath||'';
  const normalizeInlineText=value=>String(value??'')
    .replace(/\r\n?/g,'\n')
    .replace(/[ \t]+\n/g,'\n')
    .replace(/\n[ \t]+/g,'\n')
    .replace(/^\n+|\n+$/g,'');

  function installStyle(){
    if(document.querySelector('style[data-mathin-source-editor-style]'))return;
    const style=document.createElement('style');
    style.dataset.mathinSourceEditorStyle='';
    style.textContent=[
      '.aix-layout-node[data-mathin-source-selected="true"]{outline:2px solid #ef6b72!important;outline-offset:-2px}',
      '.aix-layout-node[data-mathin-source-selected="true"] [data-mathin-source-inline-editor]:focus{outline:1px dashed #ef6b72!important;outline-offset:-2px}',
      '.aix-layout-node[data-mathin-font-size] [data-aix-html],.aix-layout-node[data-mathin-font-size] [data-aix-html] *{font-size:var(--mathin-font-size)!important}',
      '.aix-layout-node[data-mathin-color] [data-aix-html],.aix-layout-node[data-mathin-color] [data-aix-html] *{color:var(--mathin-color)!important}',
      '.aix-layout-node[data-mathin-text-align] [data-aix-html],.aix-layout-node[data-mathin-text-align] [data-aix-html] *{text-align:var(--mathin-text-align)!important}',
      '.mathin-source-node-handle{position:absolute!important;z-index:2147483647!important;display:grid!important;place-items:center!important;width:24px!important;height:24px!important;margin:0!important;padding:0!important;border:0!important;border-radius:4px!important;background:#ef6b72!important;color:#fff!important;font:700 14px/1 sans-serif!important;box-shadow:0 1px 4px #0005!important;cursor:move!important;pointer-events:auto!important;user-select:none!important}',
      '.mathin-source-node-handle[data-kind="move"]{left:0!important;top:0!important;transform:translate(-2px,-2px)!important}',
      '.mathin-source-node-handle[data-kind="resize"]{right:0!important;bottom:0!important;transform:translate(2px,2px)!important;cursor:nwse-resize!important}',
    ].join('');
    (document.head||document.documentElement).append(style);
  }

  function clearEditorDecorations(node){
    node.querySelectorAll(':scope > .mathin-source-node-handle').forEach(handle=>handle.remove());
    delete node.dataset.mathinSourceSelected;
    delete node.dataset.mathinFontSize;
    delete node.dataset.mathinColor;
    delete node.dataset.mathinTextAlign;
    node.style.removeProperty('--mathin-font-size');
    node.style.removeProperty('--mathin-color');
    node.style.removeProperty('--mathin-text-align');
    if(node.dataset.mathinHidden==='true'){
      node.style.removeProperty('display');
      delete node.dataset.mathinHidden;
    }
    if(node.dataset.mathinOpacity==='true'){
      node.style.removeProperty('opacity');
      delete node.dataset.mathinOpacity;
    }
    node.querySelectorAll('[data-mathin-source-inline-editor]').forEach(target=>{
      target.removeAttribute('contenteditable');
      target.removeAttribute('spellcheck');
      delete target.dataset.mathinSourceInlineEditor;
    });
  }

  function startGesture(event,node,meta,kind){
    if(!editor.enabled||event.button!==0)return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const stage=node.closest('[data-aix-stage]');
    const stageWidth=Math.max(1,number(stage?.dataset?.width,editor.canvas.width));
    const scale=Math.max(.0001,(stage?.getBoundingClientRect().width||stageWidth)/stageWidth);
    gesture={
      pointerId:event.pointerId,path:meta.path,node,kind,scale,
      startX:event.clientX,startY:event.clientY,
      source:{x:meta.x,y:meta.y,width:meta.width,height:meta.height},
      dom:{
        x:Number.parseFloat(node.style.left||'0')||0,
        y:Number.parseFloat(node.style.top||'0')||0,
        width:Number.parseFloat(node.style.width||String(meta.width))||meta.width,
        height:Number.parseFloat(node.style.height||String(meta.height))||meta.height,
      },
    };
    try{event.currentTarget.setPointerCapture(event.pointerId)}catch{}
  }

  function addHandle(node,meta,kind){
    const handle=document.createElement('button');
    handle.type='button';
    handle.className='mathin-source-node-handle';
    handle.dataset.kind=kind;
    handle.textContent=kind==='move'?'⠿':'↘';
    handle.setAttribute('aria-label',kind==='move'?editor.moveLabel:editor.resizeLabel);
    handle.title=kind==='move'?editor.moveLabel:editor.resizeLabel;
    handle.addEventListener('pointerdown',event=>startGesture(event,node,meta,kind));
    handle.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();event.stopImmediatePropagation()});
    node.append(handle);
  }

  function sync(){
    syncQueued=false;
    observer?.disconnect();
    installStyle();
    document.documentElement.dataset.mathinSourceEditor=String(editor.enabled===true);
    document.querySelectorAll('.aix-layout-node[data-aix-source-path]').forEach(node=>{
      clearEditorDecorations(node);
      const meta=metadata.get(nodePath(node));
      if(!meta)return;
      if(meta.visible===false){
        node.dataset.mathinHidden='true';
        node.style.setProperty('display','none','important');
      }
      node.dataset.mathinOpacity='true';
      node.style.opacity=String(clamp(number(meta.opacity,1),0,1));
      if(Number.isFinite(meta.fontSize)){
        node.dataset.mathinFontSize='true';
        node.style.setProperty('--mathin-font-size',String(meta.fontSize)+'px');
      }
      if(typeof meta.color==='string'&&meta.color){
        node.dataset.mathinColor='true';
        node.style.setProperty('--mathin-color',meta.color);
      }
      if(['left','center','right','justify'].includes(meta.textAlign)){
        node.dataset.mathinTextAlign='true';
        node.style.setProperty('--mathin-text-align',meta.textAlign);
      }
      const content=node.querySelector('[data-aix-html]');
      if(content&&editor.enabled&&meta.editableText){
        content.contentEditable='true';
        content.spellcheck=true;
        content.dataset.mathinSourceInlineEditor='true';
      }
      if(editor.enabled&&editor.selectedNodePath===meta.path&&meta.visible!==false){
        node.dataset.mathinSourceSelected='true';
        addHandle(node,meta,'move');
        addHandle(node,meta,'resize');
      }
    });
    if(observer&&observedRoot)observer.observe(observedRoot,{subtree:true,childList:true});
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

  window.addEventListener('message',event=>{
    const message=event.data||{};
    if(event.source!==parent||message.source!==HOST_SOURCE||message.protocol!==PROTOCOL)return;
    if(message.type==='render'&&message.editor)applyEditorState(message.editor);
    if(message.type==='editor-state')applyEditorState(message.editor);
  });

  document.addEventListener('pointerdown',event=>{
    if(!editor.enabled||event.button!==0)return;
    if(event.target instanceof Element&&event.target.closest('.mathin-source-node-handle'))return;
    const node=event.target instanceof Element?event.target.closest('.aix-layout-node[data-aix-source-path]'):null;
    const path=nodePath(node);
    if(!node||!metadata.has(path))return;
    send('node-selected',{nodePath:path});
    event.stopPropagation();
    event.stopImmediatePropagation();
  },true);

  document.addEventListener('click',event=>{
    if(!editor.enabled||!(event.target instanceof Element)||event.target.closest('.mathin-source-node-handle'))return;
    const node=event.target.closest('.aix-layout-node[data-aix-source-path]');
    if(!node||!metadata.has(nodePath(node)))return;
    if(!event.target.closest('[data-mathin-source-inline-editor]'))event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  },true);

  document.addEventListener('focusin',event=>{
    if(!editor.enabled||!(event.target instanceof Element))return;
    const content=event.target.closest('[data-mathin-source-inline-editor]');
    const node=content?.closest('.aix-layout-node[data-aix-source-path]');
    const path=nodePath(node);
    if(path)send('node-selected',{nodePath:path});
  },true);

  document.addEventListener('focusout',event=>{
    if(!editor.enabled||!(event.target instanceof HTMLElement)||!event.target.matches('[data-mathin-source-inline-editor]'))return;
    const node=event.target.closest('.aix-layout-node[data-aix-source-path]');
    const path=nodePath(node);
    if(path)send('node-text-change',{nodePath:path,value:normalizeInlineText(event.target.innerText)});
  },true);

  window.addEventListener('pointermove',event=>{
    if(!gesture||event.pointerId!==gesture.pointerId)return;
    event.preventDefault();
    const dx=(event.clientX-gesture.startX)/gesture.scale;
    const dy=(event.clientY-gesture.startY)/gesture.scale;
    const stepX=Math.max(1,number(editor.canvas.width,1200)/12);
    const stepY=Math.max(1,number(editor.canvas.height,900)/9);
    if(gesture.kind==='move'){
      const x=snap(gesture.source.x+dx,stepX);
      const y=snap(gesture.source.y+dy,stepY);
      gesture.node.style.left=String(gesture.dom.x+x-gesture.source.x)+'px';
      gesture.node.style.top=String(gesture.dom.y+y-gesture.source.y)+'px';
      gesture.patch={x,y};
    }else{
      const width=Math.max(1,snap(gesture.source.width+dx,stepX));
      const height=Math.max(1,snap(gesture.source.height+dy,stepY));
      gesture.node.style.width=String(gesture.dom.width+width-gesture.source.width)+'px';
      gesture.node.style.height=String(gesture.dom.height+height-gesture.source.height)+'px';
      gesture.patch={width,height};
    }
  },true);

  window.addEventListener('pointerup',event=>{
    if(!gesture||event.pointerId!==gesture.pointerId)return;
    const completed=gesture;
    gesture=null;
    if(completed.patch)send('node-transform-change',{nodePath:completed.path,patch:completed.patch});
  },true);

  const observe=()=>{
    observedRoot=document.body||document.documentElement;
    observer=new MutationObserver(scheduleSync);
    observer.observe(observedRoot,{subtree:true,childList:true});
    scheduleSync();
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observe,{once:true});else observe();
})();
</script>`;

/** Add app-owned editing behavior without changing the immutable source package. */
export function injectSourceRuntimeEditorBridge(html: string): string {
  return injectHeadSnippet(html, SOURCE_RUNTIME_EDITOR_BRIDGE);
}

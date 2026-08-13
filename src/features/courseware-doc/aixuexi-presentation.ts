/**
 * 爱学习成品页里必须靠实测才能施加的呈现规则。
 *
 * 这些规则在源站是播放器运行时行为,页面 JSON 里没有对应字段,只能在挂载后量真实几何:
 * 形状文字按框收敛字号、富文本内联小图 2 倍放大、答案面板负边距回收、节点夹回母版、
 * 控件让位。前两条是还原源站;后三条是镜像项目阶段 61 定的自收敛矫正 ——
 * **溢出与遮挡即使源站也有,本地化产物也要消掉**,且只平移不缩放。
 *
 * 口径与镜像项目 `src/viewer/viewer-app.ts` 的同名函数保持一致;改这里之前先确认
 * 镜像项目 `page-inspect` 的基线没有跟着变。
 */

const MASTER_WIDTH = 1200;
const MASTER_HEIGHT = 900;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function stageScale(stage: HTMLElement) {
  return stage.getBoundingClientRect().width / Math.max(1, MASTER_WIDTH);
}

/** 节点的着墨范围:文字、媒体与自身涂色的并集,再与节点框求交。空占位不计入。 */
function nodeInk(node: HTMLElement): Box | null {
  const style = getComputedStyle(node);
  const painted = style.backgroundImage !== "none"
    || (style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent")
    || Number.parseFloat(style.borderTopWidth) > 0;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const add = (rect: DOMRect) => {
    if (rect.width === 0 || rect.height === 0) return;
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  };

  const range = document.createRange();
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    if (!(textNode.textContent ?? "").trim()) continue;
    // .widget-placeholder 是源站给别的部件让出的空白位,没有着墨。
    if (textNode.parentElement?.closest(".widget-placeholder")) continue;
    range.selectNode(textNode);
    add(range.getBoundingClientRect());
  }
  for (const media of node.querySelectorAll("img,video,svg,canvas")) {
    if (media.closest(".widget-placeholder")) continue;
    add(media.getBoundingClientRect());
  }
  if (painted) add(node.getBoundingClientRect());

  const clip = node.getBoundingClientRect();
  left = Math.max(left, clip.left);
  top = Math.max(top, clip.top);
  right = Math.min(right, clip.right);
  bottom = Math.min(bottom, clip.bottom);
  return left === Infinity || right <= left || bottom <= top ? null : { left, top, right, bottom };
}

/** 着墨范围并上控件外框——控件的背景与边框同样不该被裁掉。 */
function nodeVisualBox(node: HTMLElement): Box | null {
  let box = nodeInk(node);
  for (const control of node.querySelectorAll('.tk-answer-toggle,.tk-analysis-toggle,[role="button"],button')) {
    const rect = control.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    box = box
      ? {
        left: Math.min(box.left, rect.left),
        top: Math.min(box.top, rect.top),
        right: Math.max(box.right, rect.right),
        bottom: Math.max(box.bottom, rect.bottom),
      }
      : { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }
  return box;
}

/** 形状部件的文字是否溢出可视框(含内边距)。 */
function shapeTextOverflows(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return false;
  const scale = box.width / Math.max(1, element.offsetWidth);
  const style = getComputedStyle(element);
  const pad = (name: string) => (Number.parseFloat(style.getPropertyValue(name)) || 0) * scale;
  const range = document.createRange();
  range.selectNodeContents(element);
  const content = range.getBoundingClientRect();
  const tolerance = Math.max(1, scale);
  return content.height > box.height - pad("padding-top") - pad("padding-bottom") + tolerance
    || content.width > box.width - pad("padding-left") - pad("padding-right") + tolerance;
}

/** a44 形状部件:从源字号逐级降到装得下为止,下限取 behaviors.shapeTextFit.minFontSize。 */
export function fitShapeText(stage: HTMLElement, minFontSize: number) {
  for (const element of stage.querySelectorAll<HTMLElement>('[data-aix-source-type="a44"] .shape-editable-element')) {
    const initial = Math.max(minFontSize, Number.parseFloat(getComputedStyle(element).fontSize) || 36);
    element.style.fontSize = `${initial}px`;
    let size = initial;
    while (size > minFontSize && shapeTextOverflows(element)) {
      size -= 1;
      element.style.fontSize = `${size}px`;
    }
  }
}

/** 答案面板的负 margin 在本地字体下会把内容推出节点左边界,按亏空回收到刚好不越界。 */
function clampPanelOffsets(stage: HTMLElement) {
  const scale = stageScale(stage);
  if (!(scale > 0)) return;
  const stageRect = stage.getBoundingClientRect();
  for (const panel of stage.querySelectorAll<HTMLElement>(".aix-layout-node .tk-answer-analysis")) {
    const node = panel.closest<HTMLElement>(".aix-layout-node");
    if (!node) continue;
    const current = Number.parseFloat(panel.style.marginLeft || "0");
    if (!(current < 0)) continue;
    const limit = Math.max(node.getBoundingClientRect().left, stageRect.left);
    const deficit = (limit - panel.getBoundingClientRect().left) / scale;
    if (deficit <= 0.05) continue;
    panel.style.marginLeft = `${Math.min(0, current + deficit)}px`;
  }
}

/**
 * 节点夹回母版:逐轴取「装得下的那个量度」——控件框与着墨范围的并集装得下就按并集夹,
 * 装不下就退回着墨范围,两个都装不下就不动(例如折叠面板本来就比母版高)。只平移。
 */
function clampNodesToCanvas(stage: HTMLElement) {
  const stageRect = stage.getBoundingClientRect();
  const scale = stageScale(stage);
  if (!(scale > 0)) return;
  const axisShift = (low: number, high: number, limit: number) => {
    if (high - low > limit) return null;
    if (low < 0) return -low;
    if (high > limit) return limit - high;
    return 0;
  };
  for (const node of stage.querySelectorAll<HTMLElement>(".aix-layout-node")) {
    if (node.dataset.aixOverlapShift) continue;
    const union = nodeVisualBox(node);
    if (!union) continue;
    const ink = nodeInk(node);
    const toStageX = (value: number) => (value - stageRect.left) / scale;
    const toStageY = (value: number) => (value - stageRect.top) / scale;
    // 滚动区里的节点纵向本来就超出母版,纵轴不夹。
    const scrolled = Boolean(node.closest("[data-aix-question-scroll]"));

    let dx = axisShift(toStageX(union.left), toStageX(union.right), MASTER_WIDTH);
    if (dx === null && ink) dx = axisShift(toStageX(ink.left), toStageX(ink.right), MASTER_WIDTH);
    let dy = scrolled ? 0 : axisShift(toStageY(union.top), toStageY(union.bottom), MASTER_HEIGHT);
    if (dy === null && ink) dy = axisShift(toStageY(ink.top), toStageY(ink.bottom), MASTER_HEIGHT);
    dx = dx ?? 0;
    dy = dy ?? 0;
    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) continue;
    node.style.left = `${Number.parseFloat(node.style.left || "0") + dx}px`;
    node.style.top = `${Number.parseFloat(node.style.top || "0") + dy}px`;
  }
}

/**
 * 控件让位:源数据里答案/解析控件的框会压在题干正文上(源站同样压着,但本地化产物不接受
 * 正文被遮挡)。把控件所在节点整体下移到刚好让开被压正文为止。
 */
function clearControlOverlaps(stage: HTMLElement) {
  const scale = stageScale(stage);
  if (!(scale > 0)) return;
  const nodes = [...stage.querySelectorAll<HTMLElement>(".aix-layout-node")];
  const zOf = (node: HTMLElement) => Number(getComputedStyle(node).zIndex) || 0;
  const owners = new Map<HTMLElement, HTMLElement[]>();
  for (const control of stage.querySelectorAll<HTMLElement>(".tk-answer-toggle,.tk-analysis-toggle")) {
    const owner = control.closest<HTMLElement>(".aix-layout-node");
    if (!owner) continue;
    owners.set(owner, [...(owners.get(owner) ?? []), control]);
  }
  for (const [owner, controls] of owners) {
    const minOverlap = 4 * scale;
    let shift = 0;
    for (const control of controls) {
      const rect = control.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      for (const other of nodes) {
        if (other === owner || owner.contains(other) || other.contains(owner)) continue;
        if (zOf(owner) < zOf(other)) continue;
        if (!(other.textContent ?? "").trim()) continue;
        const ink = nodeInk(other);
        if (!ink) continue;
        const overlapWidth = Math.min(rect.right, ink.right) - Math.max(rect.left, ink.left);
        const overlapHeight = Math.min(rect.bottom, ink.bottom) - Math.max(rect.top, ink.top);
        if (overlapWidth <= minOverlap || overlapHeight <= minOverlap) continue;
        shift = Math.max(shift, ink.bottom - rect.top);
      }
    }
    if (shift <= 0) continue;
    const delta = Math.ceil(shift / scale);
    owner.style.top = `${Number.parseFloat(owner.style.top || "0") + delta}px`;
    owner.dataset.aixOverlapShift = String(Number(owner.dataset.aixOverlapShift ?? 0) + delta);
  }
}

export function applyLayoutCorrections(stage: HTMLElement) {
  clampPanelOffsets(stage);
  clampNodesToCanvas(stage);
  clearControlOverlaps(stage);
}

export interface PresentationOptions {
  shapeTextMinFontSize: number | null;
  stagedReveal: { underlineCount: number; summaryWidgetCount: number };
  disclosureLabels: { answer: string; analysis: string };
  onRevealSteps: (steps: HTMLElement[]) => void;
}

/**
 * 完整施加一遍宿主交互规则。题目图片尺寸由 projection v31 绑定的 captured player
 * module 执行，不再在这里手工放大。
 */
export function applyPresentation(stage: HTMLElement, options: PresentationOptions) {
  wireDisclosures(stage, options.disclosureLabels);
  if (options.shapeTextMinFontSize !== null) fitShapeText(stage, options.shapeTextMinFontSize);
  options.onRevealSteps(collectRevealSteps(stage, options.stagedReveal));
  applyLayoutCorrections(stage);
}

/** 超过这个次数就停手:呈现规则本身是自收敛的,还在抖说明有规则互相打架,不要无限重排。 */
const MAX_PRESENTATION_PASSES = 40;

/**
 * 挂载后按几个节拍复算,并监听舞台子树。
 *
 * 必须监听:注入的源站 HTML 是 React 托管的子树,React 在后续渲染里会重建它,
 * 把接过线的折叠开关、放大过的图和矫正过的坐标一起抹掉;字体与图片落位的时机也各不相同。
 * 重入标志 + 次数上限保证不会和 React 或规则自身来回打架。
 */
export function observePresentation(stage: HTMLElement, options: PresentationOptions) {
  let running = false;
  let passes = 0;
  let queued = false;

  const run = () => {
    if (running) return;
    running = true;
    try {
      applyPresentation(stage, options);
    } finally {
      running = false;
    }
  };

  run();
  void document.fonts?.ready?.then(run);
  const timers = [80, 200, 400].map((delay) => window.setTimeout(run, delay));

  const observer = new MutationObserver(() => {
    if (running || queued || passes > MAX_PRESENTATION_PASSES) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      passes += 1;
      run();
    });
  });
  observer.observe(stage, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["style", "src", "class"],
  });

  return () => {
    observer.disconnect();
    timers.forEach((timer) => window.clearTimeout(timer));
  };
}

/**
 * 答案/解析折叠接线。源站有两种结构:切换按钮与内容同为 `.tk-answer` 的直接子元素,
 * 或再深嵌一层(`.tk-answer-moden25`)。统一以折叠内容为锚点、在其父级里找兄弟按钮,
 * 两种结构都能接上;渲染后没有 `aria-expanded` 的折叠开关会被镜像巡检判为死按钮。
 */
export function wireDisclosures(stage: HTMLElement, labels: { answer: string; analysis: string }) {
  const disclosures = [
    { contentSelector: ".tk-answers-content", label: labels.answer, toggleClass: "tk-answer-toggle" },
    { contentSelector: ".tk-analysises-content", label: labels.analysis, toggleClass: "tk-analysis-toggle" },
  ];
  for (const { contentSelector, label, toggleClass } of disclosures) {
    for (const content of stage.querySelectorAll<HTMLElement>(contentSelector)) {
      const container = content.parentElement;
      if (!container) continue;
      const toggle = [...container.querySelectorAll<HTMLElement>(
        ':scope > .tk-answer-toggle,:scope > .tk-analysis-toggle,:scope > [role="button"]',
      )].find((candidate) => !candidate.dataset.aixDisclosure);
      if (!toggle) continue;
      toggle.dataset.aixDisclosure = toggleClass;
      toggle.classList.remove("tk-answer-toggle", "tk-analysis-toggle");
      toggle.classList.add(toggleClass);
      // 源站结构是 [role=button]>span,moden25 的 letter-spacing 依赖这个 span。
      toggle.textContent = "";
      const labelSpan = document.createElement("span");
      labelSpan.textContent = label;
      toggle.append(labelSpan);
      toggle.setAttribute("role", "button");
      toggle.setAttribute("tabindex", "0");
      toggle.setAttribute("aria-expanded", "false");
      content.style.display = "none";

      const activate = (event: Event) => {
        event.preventDefault();
        // 折叠开关不参与舞台的分步揭示/翻页,否则点开答案会顺带翻页。
        event.stopPropagation();
        const opening = getComputedStyle(content).display === "none";
        content.style.display = opening ? "block" : "none";
        toggle.setAttribute("aria-expanded", String(opening));
      };
      toggle.addEventListener("click", activate);
      toggle.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") activate(event);
      });
    }
  }
}

/** 返回按顺序揭示的步骤;调用方每次点击推进一格。 */
export function collectRevealSteps(
  stage: HTMLElement,
  reveal: { underlineCount: number; summaryWidgetCount: number },
) {
  const summaries = [...stage.querySelectorAll<HTMLElement>('[data-aix-source-type="tk-summary"]')]
    .slice(0, reveal.summaryWidgetCount);
  const underlines = [...stage.querySelectorAll<HTMLElement>("u")]
    .filter((item) => !item.closest('[data-aix-source-type="tk-summary"]'))
    .slice(0, reveal.underlineCount);
  for (const item of summaries) item.hidden = true;
  for (const item of underlines) item.classList.add("aix-staged-underline");
  return [...summaries, ...underlines];
}

export function revealStep(item: HTMLElement) {
  if (item.matches('[data-aix-source-type="tk-summary"]')) item.hidden = false;
  else item.classList.add("aix-revealed");
}

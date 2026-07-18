import type { DocInteraction } from "./schema";

/**
 * WAAPI 交互调度器——镜像 viewer-app.ts 的行为基准逐条移植(docs/plan/16 §3 D5):
 * - 步骤流:auto 从首个 auto 步连播,遇 click 步停;click 按步循环推进;
 *   same 与上一步并行,follow 等上一步完成;
 * - enter/emphasize/path 执行前先显示节点(enter 目标初始 visible=false,
 *   doc 已带——提前显示=答案泄露,教学事故级,见 schema 注释);
 * - exit 动画结束后隐藏;path 动画结束后节点落位到 points[0,1];
 * - 交互音频经 bindingKey 解析播放,失败静默(浏览器自动播放策略)。
 * 纯 DOM/WAAPI,无 React 依赖,便于单测与课堂复用。
 *
 * fill:"both" 的动画效果与 style 直改都会在元素上长期残留,离开当前页时
 * 必须 dispose():取消全部动画、停掉音频,否则残留终帧 transform 会盖住
 * 后续复用元素的行内样式(整页节点集体位移的事故根源)。
 */

export interface InteractionRuntime {
  runAuto: () => Promise<void>;
  /** 舞台 click 委托:节点触发器优先,无则走页级 click 流。 */
  handleStageClick: (target: EventTarget | null) => Promise<void>;
  /** 取消在跑动画/音频并冻结调度器;卸载或换页时必须调用。 */
  dispose: () => void;
}

interface RuntimeOptions {
  root: ParentNode;
  interactions: readonly DocInteraction[];
  resolveAudioUrl: (bindingKey: string) => string | null;
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

function frames(item: DocInteraction, node: HTMLElement): Keyframe[] {
  const base = node.style.transform;
  const shift = (x: string, y: string) => `${base} translate(${x},${y})`;
  const fade: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
  const animation = item.animation || "";
  if (item.action === "path") {
    const points = item.path?.points ?? [];
    const end =
      points.length >= 2
        ? base.replace(/translate\([^)]*\)/, `translate(${points[0]}px,${points[1]}px)`)
        : base;
    return [{ transform: base }, { transform: end }];
  }
  if (item.action === "exit") {
    if (animation.includes("fadeOut") || animation === "animate__exit") return [{ opacity: 1 }, { opacity: 0 }];
    if (animation.includes("slideOutRight")) return [{ transform: base }, { transform: shift("100%", "0") }];
    return [{ opacity: 1 }, { opacity: 0 }];
  }
  if (item.action === "emphasize") {
    if (animation.includes("pulse")) return [{ transform: base }, { transform: `${base} scale(1.1)` }, { transform: base }];
    if (animation.includes("rubberBand")) {
      return [
        { transform: base },
        { transform: `${base} scale(1.25,.75)` },
        { transform: `${base} scale(.85,1.15)` },
        { transform: base },
      ];
    }
    if (animation.includes("heartBeat")) return [{ transform: base }, { transform: `${base} scale(1.3)` }, { transform: base }];
    return [{ transform: base }, { transform: shift("0", "-16px") }, { transform: base }];
  }
  if (animation.includes("slideInLeft")) return [{ transform: shift("-100%", "0"), opacity: 0 }, { transform: base, opacity: 1 }];
  if (animation.includes("slideInRight")) return [{ transform: shift("100%", "0"), opacity: 0 }, { transform: base, opacity: 1 }];
  if (animation.includes("slideInUp")) return [{ transform: shift("0", "100%"), opacity: 0 }, { transform: base, opacity: 1 }];
  if (animation.includes("scaleUp") || animation.includes("buffer")) {
    return [{ transform: `${base} scale(.3)`, opacity: 0 }, { transform: base, opacity: 1 }];
  }
  if (animation.includes("eraseInRight")) return [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }];
  if (animation.includes("eraseInDown")) return [{ clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0 0)" }];
  return fade;
}

export function createInteractionRuntime({ root, interactions, resolveAudioUrl }: RuntimeOptions): InteractionRuntime {
  const interactionSteps = new Map<string, number>();
  const liveAnimations = new Set<Animation>();
  const liveAudios = new Set<HTMLAudioElement>();
  let disposed = false;

  const targets = (id: string): HTMLElement[] =>
    [...root.querySelectorAll<HTMLElement>("[data-source-resource-id]")].filter(
      (node) => node.dataset.sourceResourceId === id,
    );

  const playAudio = (item: DocInteraction) => {
    if (!item.audioBindingKey) return;
    const url = resolveAudioUrl(item.audioBindingKey);
    if (!url) return;
    const audio = new Audio(url);
    liveAudios.add(audio);
    audio.addEventListener("ended", () => liveAudios.delete(audio));
    audio.play().catch(() => {});
  };

  const execute = (item: DocInteraction) => {
    if (disposed) return Promise.resolve([]);
    const ms = (item.duration || 0) * 1000;
    const delay = (item.delay || 0) * 1000;
    const repeat = Math.max(1, item.loop || 1);
    const nodes = targets(item.targetResourceId);
    playAudio(item);
    return Promise.all(
      nodes.map(async (node) => {
        if (item.action === "enter" || item.action === "emphasize" || item.action === "path") node.style.display = "block";
        if (delay) await wait(delay);
        if (disposed) return;
        const animation = node.animate?.(frames(item, node), {
          duration: ms,
          iterations: repeat,
          easing: "ease-out",
          fill: "both",
        });
        if (animation) liveAnimations.add(animation);
        if (ms) await (animation?.finished?.catch(() => {}) ?? wait(ms * repeat));
        if (disposed) return;
        if (item.action === "exit") node.style.display = "none";
        if (item.action === "path" && (item.path?.points.length ?? 0) >= 2) {
          const points = item.path?.points ?? [];
          node.style.transform = node.style.transform.replace(
            /translate\([^)]*\)/,
            `translate(${points[0]}px,${points[1]}px)`,
          );
        }
      }),
    );
  };

  const stream = (scope: DocInteraction["triggerScope"], id: string | null) =>
    interactions
      .filter((item) => item.triggerScope === scope && item.triggerResourceId === id)
      .sort((a, b) => a.step - b.step);

  const runAuto = async () => {
    const all = stream("auto", null);
    const first = all.find((item) => item.trigger === "auto");
    if (!first) return;
    let step = first.step;
    let previous: Promise<unknown> = Promise.resolve();
    for (;;) {
      const items = all.filter((item) => item.step === step);
      if (!items.length || disposed) break;
      const trigger = items[0].trigger;
      if (step !== first.step && trigger === "click") break;
      if (trigger === "follow") await previous;
      const current = Promise.all(items.map(execute));
      previous = trigger === "same" ? Promise.all([previous, current]) : current;
      step += 1;
    }
    await previous;
  };

  const runClick = async (scope: DocInteraction["triggerScope"], id: string | null) => {
    const all = stream(scope, id);
    const clickSteps = [...new Set(all.filter((item) => item.trigger === "click").map((item) => item.step))];
    if (!clickSteps.length) return false;
    const key = `${scope}:${id ?? "page"}`;
    const step = clickSteps[interactionSteps.get(key) ?? 0];
    interactionSteps.set(key, ((interactionSteps.get(key) ?? 0) + 1) % clickSteps.length);
    let previous: Promise<unknown> = Promise.resolve();
    for (let cursor = step; ; cursor++) {
      const items = all.filter((item) => item.step === cursor);
      if (!items.length || disposed) break;
      if (cursor !== step && items[0].trigger === "click") break;
      if (items[0].trigger === "follow") await previous;
      const current = Promise.all(items.map(execute));
      previous = items[0].trigger === "same" ? Promise.all([previous, current]) : current;
    }
    await previous;
    return true;
  };

  const handleStageClick = async (target: EventTarget | null) => {
    const element =
      typeof Element !== "undefined" && target instanceof Element
        ? target.closest<HTMLElement>("[data-click-trigger]")
        : null;
    const trigger = element?.dataset.clickTrigger;
    if (trigger && stream("node", trigger).some((item) => item.trigger === "click")) {
      await runClick("node", trigger);
      return;
    }
    await runClick("page", null);
  };

  const dispose = () => {
    disposed = true;
    for (const animation of liveAnimations) animation.cancel?.();
    liveAnimations.clear();
    for (const audio of liveAudios) audio.pause();
    liveAudios.clear();
  };

  return { runAuto, handleStageClick, dispose };
}

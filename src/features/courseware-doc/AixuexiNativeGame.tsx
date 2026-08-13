"use client";

import { useEffect, useRef } from "react";
import { renderAixuexiMathHtml } from "./aixuexi-math";
import type { AixuexiPageDoc } from "./aixuexi-schema";
import { injectBindingUrls, type ResolvedBindingUrls } from "./resolve";

type AixuexiNode = AixuexiPageDoc["nodes"][number];

export interface AixuexiNativeGameProps {
  node: AixuexiNode;
  bindingUrls: ResolvedBindingUrls;
  interactive: boolean;
}

function normalizeRelativeAssetPath(stylesheetPath: string, reference: string): string {
  const parts = [...stylesheetPath.split("/").slice(0, -1), ...reference.split("/")];
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  return normalized.join("/");
}

function localizeStylesheet(
  css: string,
  stylesheetPath: string,
  assets: Record<string, string>,
  bindingUrls: ResolvedBindingUrls,
): string {
  const keys = Object.keys(assets);
  return css.replace(/url\(\s*(["']?)([^)'"\s]+)\1\s*\)/gi, (_match, _quote: string, reference: string) => {
    if (/^(?:data:|blob:|#)/i.test(reference)) return `url("${reference}")`;
    let candidate = "";
    if (/^https?:/i.test(reference)) {
      try {
        const pathname = decodeURIComponent(new URL(reference).pathname);
        const basename = pathname.split("/").pop()?.split(":").pop() ?? "";
        candidate = keys.find((key) => key === pathname.replace(/^\/+/, ""))
          ?? keys.find((key) => key.endsWith(`/${basename}`))
          ?? "";
      } catch {
        candidate = "";
      }
    } else {
      const normalized = normalizeRelativeAssetPath(stylesheetPath, reference.split(/[?#]/, 1)[0]);
      const basename = normalized.split("/").pop() ?? "";
      candidate = keys.includes(normalized) ? normalized
        : keys.find((key) => key.endsWith(`/${basename}`)) ?? "";
    }
    const resolved = candidate ? bindingUrls[assets[candidate]] : "";
    // 未列入来源模型账本的 URL 不允许继续向源站发请求。
    return `url("${(resolved ?? "").replaceAll('"', "%22")}")`;
  });
}

function installLocalizedStyles(
  target: ShadowRoot,
  stylesheetPaths: string[],
  assets: Record<string, string>,
  bindingUrls: ResolvedBindingUrls,
) {
  const controller = new AbortController();
  const styles: HTMLStyleElement[] = [];
  for (const stylesheetPath of stylesheetPaths) {
    const href = bindingUrls[assets[stylesheetPath]];
    if (!href) continue;
    void fetch(href, { cache: "force-cache", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Aixuexi game stylesheet unavailable: ${stylesheetPath}`);
        return response.text();
      })
      .then((css) => {
        if (controller.signal.aborted) return;
        const style = document.createElement("style");
        style.dataset.aixSourceStylesheet = stylesheetPath;
        style.textContent = localizeStylesheet(css, stylesheetPath, assets, bindingUrls);
        target.prepend(style);
        styles.push(style);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          (target.host as HTMLElement).dataset.aixSourceStyleError = String(error);
        }
      });
  }
  return () => {
    controller.abort();
    styles.forEach((style) => style.remove());
  };
}

function installTrueOrFalse(
  host: HTMLElement,
  model: NonNullable<AixuexiNode["trueOrFalse"]>,
  bindingUrls: ResolvedBindingUrls,
  interactive: boolean,
) {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  shadow.replaceChildren();
  const asset = (key: string) => bindingUrls[model.assets[key]] ?? "";
  const stopStyles = installLocalizedStyles(shadow, [
    "styles/audio.css", "styles/bubble.css", "styles/button.css", "styles/game-board.css",
    "styles/radial-progress.css", "styles/ranking.css", "styles/style.css",
  ], model.assets, bindingUrls);
  const style = document.createElement("style");
  style.textContent = `
    :host{display:block;width:100%;height:100%;overflow:hidden;background:#078bd0}
    *,*:before,*:after{box-sizing:border-box}.game{position:relative;width:1920px;height:1080px;overflow:hidden}
    .aix-tf-bg{position:absolute;inset:0;width:1920px;height:1080px}.aix-tf-levels{display:flex;gap:16px;justify-content:center}
    .aix-tf-levels button,.aix-tf-actions button{min-width:180px;min-height:68px;border:0;background:transparent center/100% 100% no-repeat;color:#501d00;font-size:30px;font-weight:700}
    .aix-tf-options{position:absolute;left:0;right:0;top:390px;height:390px;overflow:hidden}.aix-tf-option{position:absolute;right:-560px;display:flex;min-width:330px;max-width:620px;min-height:126px;align-items:center;justify-content:center;border:0;border-radius:63px;padding:18px 52px;background:#d9f6ff;color:#174994;font-size:38px;font-weight:700;box-shadow:0 8px 24px #003c6e55}
    .aix-tf-option[data-lane="1"]{top:20px}.aix-tf-option[data-lane="2"]{top:205px}.aix-tf-option[data-result="right"]{background:#bdf6c7}.aix-tf-option[data-result="wrong"]{background:#ffd1d1}
    .aix-tf-result{position:absolute;inset:110px 269px;display:flex;flex-direction:column;align-items:center;justify-content:center;border:8px solid #fff;border-radius:44px;background:#ffffffdc;color:#174994;font-size:52px}.aix-tf-actions{display:flex;gap:24px;margin-top:56px}
  `;
  shadow.append(style);
  const game = document.createElement("div");
  game.className = "game";
  shadow.append(game);
  let timers: number[] = [];
  let animations: Animation[] = [];
  let difficulty = "normal";
  let score = 0;
  const clean = () => {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers = [];
    animations.forEach((animation) => animation.cancel());
    animations = [];
  };
  const html = (value: string) => renderAixuexiMathHtml(injectBindingUrls(value, bindingUrls));
  const background = () => `<img class="aix-tf-bg" src="${asset("images/big-bg-top.jpg")}" alt="">`;
  const buttonBackground = asset("images/button-component-large.svg");

  const renderResult = () => {
    clean();
    game.innerHTML = `${background()}<div class="aix-tf-result"><strong>本轮得分 ${score}</strong><div class="aix-tf-actions"><button data-again style="background-image:url('${buttonBackground}')">再来一次</button></div></div>`;
    game.querySelector<HTMLButtonElement>("[data-again]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      renderInitial();
    });
  };

  const renderPlay = () => {
    clean();
    score = 0;
    const setting = model.difficulties[difficulty] ?? Object.values(model.difficulties)[0];
    game.innerHTML = `${background()}<div class="p1-root switch"><div class="content show"><div class="page-two"><div class="p2">${html(model.contentHtml)}</div><div class="aix-tf-options"></div></div></div></div>`;
    const root = game.querySelector<HTMLElement>(".aix-tf-options");
    if (!root) return;
    model.options.forEach((option, index) => {
      const button = document.createElement("button");
      button.className = "aix-tf-option";
      button.dataset.lane = String(index % 2 + 1);
      button.innerHTML = html(option.html);
      button.disabled = !interactive;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (button.dataset.result) return;
        button.dataset.result = option.answer ? "right" : "wrong";
        score += option.answer ? 3 : -2;
        button.getAnimations().forEach((animation) => animation.pause());
      });
      root.append(button);
      const delay = (setting.readyTime + setting.intervalTime * index) * 1000;
      const timer = window.setTimeout(() => {
        animations.push(button.animate(
          [{ transform: "translateX(0)" }, { transform: "translateX(-2580px)" }],
          { duration: setting.existTime * 1000, easing: "linear", fill: "forwards" },
        ));
      }, delay);
      timers.push(timer);
    });
    timers.push(window.setTimeout(
      renderResult,
      (setting.readyTime + setting.intervalTime * Math.max(0, model.options.length - 1) + setting.existTime) * 1000 + 300,
    ));
  };

  function renderInitial() {
    clean();
    const levels = Object.entries(model.difficulties).map(([key, value]) =>
      `<button data-level="${key}" aria-pressed="${key === difficulty}" style="background-image:url('${asset("images/LevelButton-btn.svg")}')">${value.label}</button>`,
    ).join("");
    game.innerHTML = `${background()}<div class="p1-root"><div class="content show flex"><div class="page-one"><div class="t1">${html(model.contentHtml)}</div><div class="select aix-tf-levels">${levels}</div><div class="aix-tf-actions" style="justify-content:center"><button data-start style="background-image:url('${buttonBackground}')">开始答题</button></div></div></div></div>`;
    game.querySelectorAll<HTMLButtonElement>("[data-level]").forEach((button) => button.addEventListener("click", (event) => {
      event.stopPropagation();
      difficulty = button.dataset.level ?? difficulty;
      renderInitial();
    }));
    game.querySelector<HTMLButtonElement>("[data-start]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      renderPlay();
    });
  }

  renderInitial();
  return () => {
    clean();
    stopStyles();
  };
}

function installTopicClassification(
  host: HTMLElement,
  model: NonNullable<AixuexiNode["topicClassification"]>,
  bindingUrls: ResolvedBindingUrls,
  interactive: boolean,
) {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  shadow.replaceChildren();
  const stopStyles = installLocalizedStyles(
    shadow,
    Object.keys(model.assets).filter((key) => key.endsWith(".css")),
    model.assets,
    bindingUrls,
  );
  const baseStyle = document.createElement("style");
  baseStyle.textContent = ":host{display:block;width:100%;height:100%;overflow:hidden}";
  shadow.append(baseStyle);
  const root = document.createElement("div");
  root.className = model.slideClass.split(/\s+/).filter((token) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(token)).join(" ");
  root.style.cssText = "position:absolute;inset:0;width:1920px;height:1080px;overflow:hidden";
  if (model.backgroundBindingKey) root.style.backgroundImage = `url(${bindingUrls[model.backgroundBindingKey]})`;
  root.style.backgroundSize = "100% 100%";
  root.innerHTML = renderAixuexiMathHtml(injectBindingUrls(model.stageHtml, bindingUrls));
  shadow.append(root);
  const elements = new Map<string, HTMLElement>();
  root.querySelectorAll<HTMLElement>(":scope > .a0[data-type=container][data-interactive-item]").forEach((element) => {
    try {
      const item = JSON.parse(element.dataset.interactiveItem ?? "{}") as { key?: string };
      if (item.key) elements.set(item.key, element);
    } catch {
      // 来源模型校验会在元素缺失时呈现明确错误。
    }
  });
  if (model.items.some((item) => !elements.has(item.key))) {
    host.textContent = "TopicClassification 源 DOM 键不完整";
    return stopStyles;
  }
  const optionTopic = new Map(model.topics.flatMap((topic) => topic.optionKeys.map((key) => [key, topic.key] as const)));
  const completed = new Set<string>();
  for (const item of model.items.filter((entry) => entry.type === "option")) {
    const element = elements.get(item.key)!;
    element.style.cursor = interactive ? "grab" : "default";
    element.style.touchAction = "none";
    let drag: { id: number; x: number; y: number } | null = null;
    element.addEventListener("pointerdown", (event) => {
      if (!interactive || completed.has(item.key)) return;
      event.preventDefault();
      event.stopPropagation();
      element.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    });
    element.addEventListener("pointermove", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const scale = Math.max(0.001, host.getBoundingClientRect().width / 1920);
      element.style.transform = `translate(${(event.clientX - drag.x) / scale}px, ${(event.clientY - drag.y) / scale}px)`;
    });
    element.addEventListener("pointerup", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = element.getBoundingClientRect();
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const target = model.items.filter((entry) => entry.type === "topic").find((entry) => {
        const bounds = elements.get(entry.key)!.getBoundingClientRect();
        return bounds.left < center.x && center.x < bounds.right && bounds.top < center.y && center.y < bounds.bottom;
      });
      if (target && target.key === optionTopic.get(item.key)) {
        completed.add(item.key);
        element.style.opacity = "0";
        element.style.pointerEvents = "none";
        elements.get(target.key)?.classList.add("heartBeat");
      } else {
        element.style.transform = "";
        if (target) elements.get(target.key)?.classList.add("shake");
      }
      window.setTimeout(() => model.topics.forEach((topic) => elements.get(topic.key)?.classList.remove("heartBeat", "shake")), 450);
      element.releasePointerCapture(event.pointerId);
      drag = null;
    });
  }
  return () => {
    root.remove();
    stopStyles();
  };
}

export function AixuexiNativeGame({ node, bindingUrls, interactive }: AixuexiNativeGameProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.replaceChildren();
    delete host.dataset.aixSourceStyleError;
    if (node.trueOrFalse) return installTrueOrFalse(host, node.trueOrFalse, bindingUrls, interactive);
    if (node.topicClassification) return installTopicClassification(host, node.topicClassification, bindingUrls, interactive);
  }, [node, bindingUrls, interactive]);
  return <div ref={ref} data-aix-native-game data-aix-page-click-boundary="game" className="size-full" />;
}

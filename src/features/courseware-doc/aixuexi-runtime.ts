import type { AixuexiPageDoc } from "./aixuexi-schema";
import type { ResolvedBindingUrls } from "./resolve";

type CapturedPlayerRuntime = {
  sourceModuleSha256: string;
  sourceModuleId: number;
  sourceExportName: string;
  questionImageSizing: (
    input: AixuexiPageDoc["sourceRuntime"]["questionImageSizingInput"],
    host: unknown,
    done: () => void,
    completeTk: boolean,
  ) => void;
};

type LottieAnimation = { destroy: () => void };
type LottieRuntime = {
  loadAnimation: (options: Record<string, unknown>) => LottieAnimation;
};

declare global {
  interface Window {
    jQuery?: (target: Element) => unknown;
    __AIXUEXI_CAPTURED_PLAYER_RUNTIME__?: CapturedPlayerRuntime;
    lottie?: LottieRuntime;
  }
}

const loadedScripts = new Map<string, Promise<void>>();

function integrityForSha256(hash: string): string {
  const bytes = new Uint8Array(hash.match(/../g)?.map((pair) => Number.parseInt(pair, 16)) ?? []);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `sha256-${btoa(binary)}`;
}

export function aixuexiRuntimeFileUrl(entryUrl: string, packagePath: string): string {
  const entry = new URL(entryUrl, window.location.origin);
  const segments = entry.pathname.split("/");
  segments.pop();
  entry.pathname = `${segments.join("/")}/${packagePath.split("/").map(encodeURIComponent).join("/")}`;
  entry.search = "";
  return `${entry.pathname}${entry.hash}`;
}

function loadVerifiedScript(url: string, sha256: string, force = false): Promise<void> {
  const cached = force ? undefined : loadedScripts.get(sha256);
  if (cached) return cached;
  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.integrity = integrityForSha256(sha256);
    script.dataset.aixuexiRuntimeSha256 = sha256;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error(`Aixuexi runtime failed integrity check: ${sha256}`)), { once: true });
    document.head.append(script);
  });
  if (!force) loadedScripts.set(sha256, promise);
  return promise;
}

export async function hydrateAixuexiSourceRuntime(
  stage: HTMLElement,
  doc: AixuexiPageDoc,
  bindingUrls: ResolvedBindingUrls,
): Promise<() => void> {
  const entryUrl = bindingUrls[doc.sourceRuntime.runtimeBindingKey];
  if (!entryUrl) throw new Error("Aixuexi source runtime binding is unresolved");
  const animations: LottieAnimation[] = [];

  const lottiePath = doc.sourceRuntime.lottieRuntimePath;
  if (lottiePath && stage.querySelector("[data-lottie-src]")) {
    const lottieUrl = aixuexiRuntimeFileUrl(entryUrl, lottiePath);
    const response = await fetch(lottieUrl, { cache: "force-cache" });
    if (!response.ok) throw new Error("Aixuexi lottie runtime is unavailable");
    const bytes = await response.arrayBuffer();
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (digest !== doc.sourceRuntime.lottieRuntimeSha256) {
      throw new Error("Aixuexi lottie runtime does not match the package ledger");
    }
    await loadVerifiedScript(lottieUrl, digest);
    for (const host of stage.querySelectorAll<HTMLElement>("[data-lottie-src]")) {
      if (!window.lottie || host.dataset.aixLottieHydrated === "true") continue;
      host.dataset.aixLottieHydrated = "true";
      animations.push(window.lottie.loadAnimation({
        container: host,
        renderer: "svg",
        loop: host.dataset.lottieLoop !== "0",
        autoplay: host.dataset.lottieAutoplay !== "0",
        path: host.dataset.lottieSrc,
      }));
    }
  }

  const rule = doc.sourceRuntime.questionImageSizing;
  const questionHosts = [...stage.querySelectorAll<HTMLElement>('[data-aix-source-type="question-tk"]')];
  if (rule && questionHosts.length > 0) {
    await loadVerifiedScript(aixuexiRuntimeFileUrl(entryUrl, rule.jqueryRuntimePath), rule.jquerySha256);
    const executionUrl = aixuexiRuntimeFileUrl(entryUrl, rule.executionRuntimePath);
    await loadVerifiedScript(executionUrl, rule.executionRuntimeSha256);
    let runtime = window.__AIXUEXI_CAPTURED_PLAYER_RUNTIME__;
    if (runtime?.sourceModuleSha256 !== rule.sourceModuleSha256
        || runtime?.sourceModuleId !== rule.sourceModuleId
        || runtime?.sourceExportName !== rule.sourceExportName) {
      // 不同讲次可能捕获了不同的源站模块。脚本对象本身按 hash 缓存，但切回旧讲次时
      // 需要重新执行对应模块，恢复它在源站播放器上使用的全局导出。
      await loadVerifiedScript(executionUrl, rule.executionRuntimeSha256, true);
      runtime = window.__AIXUEXI_CAPTURED_PLAYER_RUNTIME__;
    }
    if (!runtime || !window.jQuery
        || runtime.sourceModuleSha256 !== rule.sourceModuleSha256
        || runtime.sourceModuleId !== rule.sourceModuleId
        || runtime.sourceExportName !== rule.sourceExportName) {
      throw new Error("Aixuexi captured player runtime does not match the page ledger");
    }
    for (const host of questionHosts) {
      runtime.questionImageSizing(
        doc.sourceRuntime.questionImageSizingInput,
        window.jQuery(host),
        () => undefined,
        false,
      );
      host.dataset.aixSourcePlayerModule = rule.sourceModuleSha256;
    }
  }

  return () => animations.forEach((animation) => animation.destroy());
}

export type WidgetRevealController = { runNext: () => boolean; reset: () => void };

export function installAixuexiWidgetReveal(stage: HTMLElement): WidgetRevealController {
  const nodes = [...stage.querySelectorAll<HTMLElement>(".aix-layout-node")];
  const animations = new Map<HTMLElement, AixuexiPageDoc["nodes"][number]["animations"]>();
  const steps = new Set<number>();
  for (const node of nodes) {
    const source = node.dataset.aixAnimations;
    if (source) {
      const parsed = JSON.parse(source) as AixuexiPageDoc["nodes"][number]["animations"];
      animations.set(node, parsed);
      for (const animation of parsed) if (animation.step > 0) steps.add(animation.step);
    }
    const revealStep = Number(node.dataset.aixRevealStep ?? 0);
    if (revealStep > 0) steps.add(revealStep);
  }
  const orderedSteps = [...steps].sort((left, right) => left - right);
  let cursor = 0;

  const play = (node: HTMLElement, animation: AixuexiPageDoc["nodes"][number]["animations"][number]) => {
    if (animation.phase === "enter") {
      node.style.removeProperty("display");
      node.dataset.aixRevealHidden = "false";
    }
    node.classList.remove(animation.effect);
    void node.offsetWidth;
    node.style.animationDuration = `${animation.duration}s`;
    node.style.animationDelay = `${animation.delay}s`;
    node.style.animationFillMode = "both";
    node.classList.add(animation.effect);
    const finish = () => {
      node.classList.remove(animation.effect);
      node.style.removeProperty("animation-duration");
      node.style.removeProperty("animation-delay");
      node.style.removeProperty("animation-fill-mode");
      if (animation.phase === "exit") {
        node.style.display = "none";
        node.dataset.aixRevealHidden = "true";
      }
    };
    node.addEventListener("animationend", finish, { once: true });
    window.setTimeout(finish, (animation.duration + animation.delay) * 1000 + 80);
  };

  const runStep = (step: number) => {
    for (const node of nodes) {
      const matching = (animations.get(node) ?? []).filter((animation) => animation.step === step);
      if (matching.length > 0) matching.forEach((animation) => play(node, animation));
      else if (step > 0 && Number(node.dataset.aixRevealStep ?? 0) === step) {
        node.style.removeProperty("display");
        node.dataset.aixRevealHidden = "false";
      }
    }
  };

  for (const node of nodes) {
    const items = animations.get(node) ?? [];
    const hidden = items.some((animation) => animation.phase === "enter" && animation.step > 0)
      || items.length === 0 && Number(node.dataset.aixRevealStep ?? 0) > 0;
    if (hidden) {
      node.style.display = "none";
      node.dataset.aixRevealHidden = "true";
    }
  }
  runStep(0);
  const update = () => {
    stage.dataset.aixWidgetRevealRemaining = String(orderedSteps.length - cursor);
    stage.classList.toggle("aix-has-next-state", cursor < orderedSteps.length);
  };
  update();

  return {
    runNext: () => {
      if (cursor >= orderedSteps.length) return false;
      runStep(orderedSteps[cursor]);
      cursor += 1;
      update();
      return true;
    },
    reset: () => {
      cursor = 0;
      update();
    },
  };
}

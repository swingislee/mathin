import type { LayoutStorage } from "react-resizable-panels";

/**
 * `useDefaultLayout` 的存储实现（docs/plan/27 §3 D3）。
 *
 * 库的默认实现在渲染期直接读 `localStorage`。客户端组件同样要在服务端渲染一次，
 * 那一次没有 `localStorage`，React 会把整棵子树标记为"服务端渲染出错、改用客户端渲染"，
 * 备课工作区因此丢掉全部 SSR 产出。所以这里在两端都做兜底：
 * 服务端和禁用存储的浏览器（Safari 无痕）落到进程内 Map，只是不跨会话保留。
 */
const fallback = new Map<string, string>();

export const panelLayoutStorage: LayoutStorage = {
  getItem(key) {
    if (typeof window === "undefined") return fallback.get(key) ?? null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return fallback.get(key) ?? null;
    }
  },
  setItem(key, value) {
    if (typeof window === "undefined") {
      fallback.set(key, value);
      return;
    }
    try {
      window.localStorage.setItem(key, value);
    } catch {
      fallback.set(key, value);
    }
  },
};

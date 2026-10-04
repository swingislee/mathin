# 无障碍基线清单

对应 `docs/plan/14-navigation-and-experience.md` §5.2 的验收标准。新页面/新组件上线前，或代码评审时，对照这份清单自查。

## 1. Skip link

- 每个受 `[locale]` 布局覆盖的页面，键盘 Tab 第一下应能跳到 `#main-content`（已在 `src/app/[locale]/layout.tsx` 全局提供，新增布局不要重复实现或遮盖它）。

## 2. 弹层必须走 Radix

- 任何模态/抽屉/浮出面板（对话框、确认框、侧边抽屉、下拉菜单、popover）必须基于 `@radix-ui/react-*`（通常经 `src/components/ui/{dialog,alert-dialog,sheet,popover,dropdown-menu}.tsx`），以获得焦点陷阱、Esc 关闭、点击外部关闭、滚动锁。
- 不允许用原生 `<details>/<summary>` 或手搓 `fixed`/`absolute` + `useState` 模拟浮层。

## 3. `aria-*` 文案必须走 next-intl

- 所有 `aria-label`/`aria-describedby` 等提供给读屏软件的文案必须来自 `useTranslations`/`getTranslations`，不能是硬编码字面量（中文或英文）。
- 例外：纯技术性、非用户可见语言概念的 landmark 标签（如 shadcn 组件默认值）可保留字面量兜底，但业务代码应通过组件暴露的 prop 传入翻译后的文案覆盖默认值。

## 4. 图标按钮必须有可访问名称

- 任何仅靠图标（无可见文字）表达含义的按钮，必须有 `aria-label`（`title` 可以作为补充但不能替代，因为不是所有读屏/触屏场景都会读取 `title`）。

## 5. 可见 focus 环

- 任何可键盘聚焦的自定义交互元素（`tabIndex={0}` 容器、原生 `<textarea>/<select>/<input>` 且未使用共享 `ui/input.tsx` 等组件）都必须有可见的 focus-visible 样式，不能只写 `outline-none` 却不补样式。
- 约定用法：`outline-none focus-visible:ring-2 focus-visible:ring-crater focus-visible:ring-offset-2 focus-visible:ring-offset-paper`（与 `src/components/ui/button.tsx` 一致）；若组件处在非全局主题的独立配色体系里（如笔记工作区的可切换 tone），改用该体系自己的强调色变量（例如 `focus-visible:ring-[var(--ws-panel-ink)]`），不要硬套 `crater`/`paper`。

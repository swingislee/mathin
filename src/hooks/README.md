# 共用客户端 Hooks

## 长按识别 `useLongPress`

需要区分点击与长按的 React 控件从 `@/hooks/use-long-press` 导入。将返回的事件处理器展开到实际操作元素；识别逻辑与业务动作、样式和拖拽区域分开。

```tsx
import { Button } from "@/components/ui/button";
import { useLongPress } from "@/hooks/use-long-press";

const press = useLongPress<HTMLButtonElement>({
  onClick: () => setEditing(true),
  onLongPress: () => resetValue(),
  disabled: locked,
  delayMs: 500,
  movementThresholdPx: 3,
});

<Button {...press} type="button" disabled={locked} className="touch-none select-none">
  {value}
</Button>
```

以上代码放在已有客户端组件内；业务组件提供实际的编辑、复位和锁定状态。

| 参数 | 行为 |
| --- | --- |
| `onLongPress` | 必填；持续按住达到时长后执行一次，接收起按元素、指针 ID、类型及视口坐标 |
| `onClick` | 可选；短按与原生键盘激活时执行。由 `PopoverTrigger` 等组件接管点击时可省略 |
| `disabled` | 默认 `false`；为 `true` 时取消当前计时并停止识别。元素的 `disabled`／只读语义由调用方设置 |
| `delayMs` | 默认 500 ms，按下时确定本次触发时长 |
| `movementThresholdPx` | 默认 3 px，按下时确定本次允许的二维移动距离；超出后即使返回起点也取消 |
| `preventContextMenu` | 默认 `true`，在可用的长按元素上阻止浏览器上下文菜单；设为 `false` 可保留原生菜单 |

鼠标主键、触摸和笔共用 Pointer Events。释放、匹配指针的取消、窗口失焦、禁用及卸载均清理计时和监听；其他指针不接管本次按压。窗口捕获阶段只观察事件，即使子元素停止冒泡也会结束计时。各控件独立保存手势状态，长按回调使用组件最新的业务函数。

长按、移动或取消后的指针点击会同时阻止默认动作和冒泡，避免又执行短按或上层点击；键盘的 Enter／Space 保持原生点击行为。调用方需要提供清晰的操作提示；关键功能继续保留可发现的普通按钮或菜单入口。

Hook 不设置 `touch-action`、不捕获指针、不启动拖动，也不修改颜色或透明度。固定操作按钮可使用 `touch-none select-none`；可滚动列表应保留适合该区域的滚动行为，由浏览器的 `pointercancel` 结束长按。运动或演示中的教学对象可保留原色，交互锁定单独表达。

首个接入示例：`src/features/tools/motion-lab/RunwayLane.tsx`、`NumField.tsx`。回归位于 `tests/use-long-press.test.ts`；Motion Lab 自身手柄与菜单边界继续由其交互测试覆盖。

import type { ComponentProps } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 与微课编辑工具栏一致：只显示图标，文字用于悬浮提示和无障碍名称。 */
export function ToolToolbarButton({ label, icon: Icon, className, ...props }: Omit<ComponentProps<typeof Button>, "children" | "size" | "variant"> & {
  label: string; icon: LucideIcon;
}) {
  return <Button type="button" variant="ghost" size="sm" aria-label={label} title={label} {...props}
    className={cn("size-9 shrink-0 p-0", className)} data-tool-toolbar-action>
    <Icon size={16} className="shrink-0" aria-hidden />
  </Button>;
}

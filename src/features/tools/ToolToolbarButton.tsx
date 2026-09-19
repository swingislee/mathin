import type { ComponentProps } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 复用嵌入按钮的紧凑描边样式；按工具栏可用宽度显示文字。 */
export function ToolToolbarButton({ label, icon: Icon, className, ...props }: Omit<ComponentProps<typeof Button>, "children" | "size" | "variant"> & {
  label: string; icon: LucideIcon;
}) {
  return <Button type="button" variant="secondary" size="sm" aria-label={label} title={label} {...props}
    className={cn("h-8 w-8 shrink-0 gap-1.5 whitespace-nowrap px-0 py-1.5 text-xs font-normal @5xl/tool-toolbar:w-auto @5xl/tool-toolbar:px-3", className)} data-tool-toolbar-action>
    <Icon size={13} className="shrink-0" aria-hidden />
    <span className="hidden @5xl/tool-toolbar:inline">{label}</span>
  </Button>;
}

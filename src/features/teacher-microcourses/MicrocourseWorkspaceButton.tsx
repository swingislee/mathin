import { Sparkles } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** One entry affordance for microcourse authoring in every teaching context. */
export function MicrocourseWorkspaceButton({
  href,
  label,
  compact = false,
  className,
}: {
  href: string;
  label: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        buttonVariants({ size: "sm", variant: "secondary" }),
        "gap-2",
        compact && "h-7 px-2 text-xs",
        className,
      )}
      data-microcourse-workspace-button
    >
      <Sparkles size={compact ? 13 : 15} />
      {label}
    </Link>
  );
}

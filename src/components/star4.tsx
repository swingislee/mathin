import { cn } from "@/lib/utils";

/** 四角星装饰（同 Main.png 中的星星）。默认星光金填充，每屏最多 3–5 颗。 */
export function Star4({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn("text-star", className)}
    >
      <path
        fill="currentColor"
        d="M12 0C13.2 7.4 16.6 10.8 24 12 16.6 13.2 13.2 16.6 12 24 10.8 16.6 7.4 13.2 0 12 7.4 10.8 10.8 7.4 12 0Z"
      />
    </svg>
  );
}

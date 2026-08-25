import {
  CircleCheckBig,
  CircleDashed,
  CircleX,
  MessageCircleMore,
  type LucideIcon,
} from "lucide-react";
import type { LearningCheckStatus } from "./session-learning-contract";

const BUILT_IN_STATUS_ICONS: Record<Exclude<LearningCheckStatus, "prompted" | "imitated">, LucideIcon> = {
  explained: MessageCircleMore,
  independent: CircleCheckBig,
  incomplete: CircleX,
  unchecked: CircleDashed,
};

function BulbCheckIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M9 18h6M10 21h4" />
      <path d="M8.5 15c-1.6-1.2-2.5-3.2-2.5-5.3a6 6 0 1 1 12 0c0 2.1-.9 4.1-2.5 5.3-.6.5-.8 1.2-.8 2H9.3c0-.8-.2-1.5-.8-2Z" />
      <path d="m9.5 10.5 1.7 1.7 3.7-4" />
    </svg>
  );
}

function TracePenIcon({ size, className }: { size: number; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 7c4-4 8 4 14 0" strokeDasharray="2 2" />
      <path d="M3 15c4-4 8 4 14 0" />
      <path d="m16 17 4-4 2 2-4 4-3 1Z" />
    </svg>
  );
}

export function LearningCheckStatusIcon({
  status,
  className,
  size = 16,
}: {
  status: LearningCheckStatus;
  className?: string;
  size?: number;
}) {
  if (status === "prompted") return <BulbCheckIcon size={size} className={className} />;
  if (status === "imitated") return <TracePenIcon size={size} className={className} />;

  const Icon = BUILT_IN_STATUS_ICONS[status];
  return <Icon aria-hidden size={size} className={className} />;
}

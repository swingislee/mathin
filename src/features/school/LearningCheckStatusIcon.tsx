import {
  CircleCheckBig,
  CircleDashed,
  CircleX,
  CopyCheck,
  HandHelping,
  MessageCircleMore,
  type LucideIcon,
} from "lucide-react";
import type { LearningCheckStatus } from "./session-learning-contract";

const STATUS_ICONS: Record<LearningCheckStatus, LucideIcon> = {
  explained: MessageCircleMore,
  independent: CircleCheckBig,
  prompted: HandHelping,
  imitated: CopyCheck,
  incomplete: CircleX,
  unchecked: CircleDashed,
};

export function LearningCheckStatusIcon({
  status,
  className,
  size = 16,
}: {
  status: LearningCheckStatus;
  className?: string;
  size?: number;
}) {
  const Icon = STATUS_ICONS[status];
  return <Icon aria-hidden size={size} className={className} />;
}

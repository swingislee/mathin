import { Star4 } from "./star4";

/** 空状态：一颗星 + 一句话（docs/plan/01-6）。 */
export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <Star4 size={28} />
      <p className="text-muted">{message}</p>
    </div>
  );
}

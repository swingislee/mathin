export default function Loading() {
  return (
    <div className="space-y-8 pt-5" aria-hidden>
      <div className="h-28 animate-pulse border-y border-line bg-card/35" />
      <div className="h-64 animate-pulse border-y border-line bg-card/35" />
      <div className="h-40 animate-pulse border-y border-line bg-card/35" />
    </div>
  );
}

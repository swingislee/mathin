export default function LiveClassLoading() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden px-3 pb-[4.25rem] pt-2" aria-busy="true">
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_clamp(22rem,31vw,36rem)] gap-3">
        <main className="grid min-h-0 place-items-center [container-type:size]">
          <div
            className="aspect-[4/3] animate-pulse rounded-2xl border border-line bg-moon/20 motion-reduce:animate-none"
            style={{
              width: "min(100cqw, calc(100cqh * 4 / 3))",
              height: "min(100cqh, calc(100cqw * 3 / 4))",
            }}
          />
        </main>
        <aside className="grid min-h-0 grid-rows-[3rem_minmax(8rem,1fr)_17.5rem] gap-2">
          <div className="animate-pulse rounded-2xl border border-line bg-moon/20 motion-reduce:animate-none" />
          <div className="animate-pulse rounded-2xl border border-line bg-moon/20 motion-reduce:animate-none" />
          <div className="grid grid-cols-4 gap-1 rounded-2xl border border-line p-2">
            {Array.from({ length: 20 }, (_, index) => (
              <span key={index} className="min-h-11 animate-pulse rounded-lg bg-moon/20 motion-reduce:animate-none" />
            ))}
          </div>
        </aside>
      </div>
      <div className="fixed inset-x-3 bottom-2 h-14 animate-pulse rounded-2xl border border-line bg-moon/20 motion-reduce:animate-none" />
    </div>
  );
}

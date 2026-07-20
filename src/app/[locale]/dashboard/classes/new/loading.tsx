export default function NewClassLoading() {
  return <div className="mx-auto w-full max-w-4xl animate-pulse space-y-6" aria-busy="true">
    <div className="space-y-3"><div className="h-8 w-44 rounded bg-moon/50" /><div className="h-4 w-full max-w-2xl rounded bg-moon/35" /></div>
    <div className="h-12 rounded-full bg-moon/35" />
    <div className="h-80 rounded-2xl border border-line bg-card" />
  </div>;
}

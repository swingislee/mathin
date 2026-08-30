export default function TeacherMicrocourseSettingsLoading() {
  return <div className="w-full min-w-0 space-y-5" aria-busy="true">
    <div className="h-28 animate-pulse rounded-2xl border border-line bg-card" />
    <div className="h-12 w-80 animate-pulse rounded-xl bg-moon/30" />
    <div className="h-[32rem] animate-pulse rounded-2xl border border-line bg-card" />
  </div>;
}

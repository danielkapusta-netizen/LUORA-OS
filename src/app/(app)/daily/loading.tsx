// Shown at once while the day is read: the page's shape in soft placeholders, so nothing jumps when it arrives.
export default function DailyLoading() {
  const block = 'animate-pulse motion-reduce:animate-none';
  return (
    <div aria-busy="true" className="space-y-4 md:space-y-5">
      <div className="mb-6 space-y-3 md:mb-8">
        <div className={`h-4 w-48 rounded-full bg-black/[0.06] ${block}`} />
        <div className={`h-11 w-72 rounded-2xl bg-black/[0.06] ${block}`} />
        <div className={`h-11 w-full max-w-xl rounded-full bg-black/[0.04] ${block}`} />
      </div>
      <div className="grid grid-cols-1 gap-4 md:gap-5 lg:grid-cols-3">
        <div className={`h-[440px] rounded-[28px] bg-[#f6d3c6] ${block}`} />
        <div className={`h-[440px] rounded-[28px] bg-[#d9c3d6] ${block}`} />
        <div className={`h-[440px] rounded-[28px] bg-[#d6ccf6] ${block}`} />
      </div>
      <div className="grid grid-cols-1 gap-4 md:gap-5 lg:grid-cols-2">
        <div className={`h-72 rounded-[28px] bg-white/80 ${block}`} />
        <div className={`h-72 rounded-[28px] bg-white/80 ${block}`} />
      </div>
    </div>
  );
}

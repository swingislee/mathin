import Image from "next/image";

export function SiteFooter() {
  return (
    <footer
      lang="zh-CN"
      className="flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center text-xs leading-6 text-muted"
    >
      <a
        href="https://beian.mps.gov.cn/#/query/webSearch?code=11010502053253"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-crater"
      >
        <Image
          src="/assets/FilingIcon.png"
          alt=""
          width={16}
          height={17}
          unoptimized
          className="shrink-0"
        />
        京公网安备 11010502053253号
      </a>
      <a
        href="https://beian.miit.gov.cn/"
        target="_blank"
        rel="noopener noreferrer"
        className="whitespace-nowrap rounded-sm underline-offset-4 hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-crater"
      >
        京ICP备2020034692号-2
      </a>
    </footer>
  );
}

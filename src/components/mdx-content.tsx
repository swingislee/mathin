import { MDXRemote } from "next-mdx-remote-client/rsc";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

/** MDX 正文渲染：KaTeX 公式 + 设计系统排印（docs/plan/03-§5 选型已批准） */
const components = {
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h2 className="mt-8 font-display text-xl text-ink" {...props} />,
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className="mt-6 font-medium text-ink" {...props} />,
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => <p className="mt-4 leading-7 text-ink/90" {...props} />,
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => <ul className="mt-4 list-disc space-y-1.5 pl-6 leading-7 marker:text-crater" {...props} />,
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => <ol className="mt-4 list-decimal space-y-1.5 pl-6 leading-7 marker:text-crater" {...props} />,
  blockquote: (props: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote className="mt-4 border-l-2 border-[var(--section-accent,var(--crater))] pl-4 text-muted" {...props} />
  ),
  strong: (props: React.HTMLAttributes<HTMLElement>) => <strong className="font-semibold text-ink" {...props} />,
  code: (props: React.HTMLAttributes<HTMLElement>) => <code className="rounded bg-moon/40 px-1 py-0.5 font-mono text-[0.9em]" {...props} />,
  hr: () => <hr className="my-8 border-line" />,
  table: (props: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  th: (props: React.HTMLAttributes<HTMLTableCellElement>) => <th className="border-b border-crater/60 px-2 py-1.5 text-left font-medium" {...props} />,
  td: (props: React.HTMLAttributes<HTMLTableCellElement>) => <td className="border-b border-line px-2 py-1.5 tabular-nums" {...props} />,
};

export function MdxContent({ source }: { source: string }) {
  return (
    <MDXRemote
      source={source}
      components={components}
      options={{ mdxOptions: { remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeKatex] } }}
    />
  );
}

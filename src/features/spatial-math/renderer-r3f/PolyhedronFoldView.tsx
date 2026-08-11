"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { PolyhedronFoldCanvasProps } from "./PolyhedronFoldCanvas";
import { POLYHEDRON_FOLD_RENDERER_PROFILE } from "./polyhedron-fold-render-model";

const DynamicPolyhedronFoldCanvas = dynamic(
  () => import("./PolyhedronFoldCanvas").then((module) => module.PolyhedronFoldCanvas),
  {
    ssr: false,
    loading: () => <Skeleton className="absolute inset-0 rounded-2xl" />,
  },
);

export interface PolyhedronFoldViewProps extends PolyhedronFoldCanvasProps {
  readonly className?: string;
}

export function PolyhedronFoldView({ className, ...props }: PolyhedronFoldViewProps) {
  const title = props.locale === "en" ? props.scene.title.en ?? props.scene.title.zh : props.scene.title.zh;
  return (
    <section
      className={cn(
        "relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-line bg-paper shadow-sm",
        className,
      )}
      data-layout-profile={POLYHEDRON_FOLD_RENDERER_PROFILE}
      aria-label={title}
    >
      <DynamicPolyhedronFoldCanvas {...props} />
    </section>
  );
}

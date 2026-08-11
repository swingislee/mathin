"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { VoxelCanvasProps } from "./VoxelCanvas";
import { VOXEL_RENDERER_PROFILE } from "./voxel-render-model";

const DynamicVoxelCanvas = dynamic(() => import("./VoxelCanvas").then((module) => module.VoxelCanvas), {
  ssr: false,
  loading: () => <Skeleton className="absolute inset-0 rounded-2xl" />,
});

export interface VoxelViewProps extends VoxelCanvasProps {
  readonly className?: string;
}

export function VoxelView({ className, ...props }: VoxelViewProps) {
  return (
    <section
      className={cn("relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-line bg-paper shadow-sm", className)}
      data-layout-profile={VOXEL_RENDERER_PROFILE}
      aria-label={props.locale === "en" ? props.page.scene.title.en ?? props.page.scene.title.zh : props.page.scene.title.zh}
    >
      <DynamicVoxelCanvas {...props} />
    </section>
  );
}

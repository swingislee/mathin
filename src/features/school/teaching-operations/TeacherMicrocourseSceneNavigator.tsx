"use client";

import { Folder, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TeacherMicrocourseDirectoryNode } from "./teacher-microcourse-browser";

export function TeacherMicrocourseSceneNavigator({ nodes, selectedNode, allLabel, onSelect }: {
  nodes: TeacherMicrocourseDirectoryNode[];
  selectedNode?: string;
  allLabel: string;
  onSelect: (node?: string) => void;
}) {
  return <nav aria-label={allLabel} className="space-y-0.5">
    <Button variant={selectedNode ? "ghost" : "secondary"} size="sm" className="h-8 w-full justify-between rounded-md px-2" onClick={() => onSelect(undefined)}>
      <span className="flex items-center gap-2"><FolderOpen className="h-4 w-4" />{allLabel}</span>
    </Button>
    {nodes.map((node) => <Button
      key={node.id}
      variant={selectedNode === node.id ? "secondary" : "ghost"}
      size="sm"
      className={cn("h-8 w-full justify-between rounded-md pr-2", node.depth === 1 && "pl-7", node.depth === 2 && "pl-10")}
      onClick={() => onSelect(node.id)}
    >
      <span className="flex min-w-0 items-center gap-2"><Folder className="h-4 w-4 shrink-0" /><span className="truncate">{node.label}</span></span>
      <span className="text-xs tabular-nums text-muted">{node.count}</span>
    </Button>)}
  </nav>;
}

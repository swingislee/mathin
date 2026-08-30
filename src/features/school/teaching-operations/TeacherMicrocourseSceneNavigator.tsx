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
  return <nav aria-label={allLabel} className="space-y-1">
    <Button variant={selectedNode ? "ghost" : "secondary"} size="sm" className="w-full justify-between rounded-lg" onClick={() => onSelect(undefined)}>
      <span className="flex items-center gap-2"><FolderOpen className="h-4 w-4" />{allLabel}</span>
    </Button>
    {nodes.map((node) => <Button
      key={node.id}
      variant={selectedNode === node.id ? "secondary" : "ghost"}
      size="sm"
      className={cn("w-full justify-between rounded-lg pr-2", node.depth === 1 && "pl-8", node.depth === 2 && "pl-12")}
      onClick={() => onSelect(node.id)}
    >
      <span className="flex min-w-0 items-center gap-2"><Folder className="h-4 w-4 shrink-0" /><span className="truncate">{node.label}</span></span>
      <span className="rounded-full bg-moon/30 px-2 py-0.5 text-xs text-muted">{node.count}</span>
    </Button>)}
  </nav>;
}

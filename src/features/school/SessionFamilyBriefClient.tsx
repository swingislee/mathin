"use client";

import dynamic from "next/dynamic";

export const SessionFamilyBriefForm = dynamic(
  () => import("./SessionFamilyBriefForm").then((module) => module.SessionFamilyBriefForm),
  { ssr: false },
);

export const KnowledgeSummaryDocumentView = dynamic(
  () => import("./SessionFamilyBriefForm").then((module) => module.KnowledgeSummaryDocumentView),
  { ssr: false },
);

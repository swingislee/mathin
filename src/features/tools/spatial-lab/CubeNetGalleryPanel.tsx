"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Shapes, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CUBE_NET_ANALYSIS_REASONS,
  CUBE_NET_GALLERY_VERSION,
  cubeNetGalleryJudgmentDeck,
  createCubeNetGalleryCatalog,
  evaluateCubeNetGalleryPrediction,
  type CubeNetGalleryEntry,
  type CubeNetGalleryEvaluation,
  type CubeNetGalleryClassification,
} from "@/features/spatial-math/domain";
import { cn } from "@/lib/utils";

function NetDiagram({
  entry,
  label,
  compact = false,
}: {
  readonly entry: CubeNetGalleryEntry;
  readonly label: string;
  readonly compact?: boolean;
}) {
  const xs = entry.net.cells.map((cell) => cell.x);
  const ys = entry.net.cells.map((cell) => cell.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const padding = 0.18;
  return (
    <svg
      viewBox={`${-padding} ${-padding} ${width + padding * 2} ${height + padding * 2}`}
      className={cn("mx-auto block w-full", compact ? "h-20" : "h-52 sm:h-60")}
      role={compact ? undefined : "img"}
      aria-hidden={compact ? true : undefined}
      aria-label={compact ? undefined : label}
      preserveAspectRatio="xMidYMid meet"
    >
      {entry.net.cells.map((cell) => (
        <rect
          key={`${cell.x},${cell.y}`}
          x={cell.x - minX}
          y={maxY - cell.y}
          width="1"
          height="1"
          rx="0.04"
          fill="var(--leaf)"
          stroke="var(--ink)"
          strokeWidth="0.07"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

function resultReasonKey(result: CubeNetGalleryEvaluation): "validReason" | "orientationConflictReason" | "faceOverlapReason" {
  if (result.reason === CUBE_NET_ANALYSIS_REASONS.valid) return "validReason";
  if (result.reason === CUBE_NET_ANALYSIS_REASONS.orientationConflict) return "orientationConflictReason";
  return "faceOverlapReason";
}

export function CubeNetGalleryPanel() {
  const t = useTranslations("tools.spatialLab.cubeNet.gallery");
  const catalog = useMemo(() => createCubeNetGalleryCatalog(), []);
  const legalEntries = useMemo(
    () => catalog.entries.filter((entry) => entry.classification === "legal"),
    [catalog],
  );
  const judgmentDeck = useMemo(() => cubeNetGalleryJudgmentDeck(catalog), [catalog]);
  const [selectedLegalId, setSelectedLegalId] = useState(legalEntries[0].id);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [evaluation, setEvaluation] = useState<CubeNetGalleryEvaluation | null>(null);
  const selectedLegal = legalEntries.find((entry) => entry.id === selectedLegalId) ?? legalEntries[0];
  const question = judgmentDeck[questionIndex];

  const selectQuestion = (nextIndex: number) => {
    setQuestionIndex(Math.min(judgmentDeck.length - 1, Math.max(0, nextIndex)));
    setEvaluation(null);
  };
  const evaluate = (prediction: CubeNetGalleryClassification) => {
    setEvaluation(evaluateCubeNetGalleryPrediction(catalog, {
      galleryVersion: CUBE_NET_GALLERY_VERSION,
      entryId: question.id,
      prediction,
    }));
  };

  return (
    <Card
      data-cube-net-gallery={CUBE_NET_GALLERY_VERSION}
      data-gallery-question={question.id}
      data-gallery-result={evaluation ? (evaluation.correct ? "correct" : "incorrect") : "pending"}
    >
      <CardHeader className="p-4 pb-2 sm:p-5 sm:pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Shapes aria-hidden="true" className="size-4 text-leaf-deep" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-2 sm:p-5 sm:pt-2">
        <Tabs defaultValue="library">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="library">{t("libraryTab")}</TabsTrigger>
            <TabsTrigger value="judge">{t("judgeTab")}</TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="mt-4 space-y-4">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6" role="list" aria-label={t("libraryLabel")}>
              {legalEntries.map((entry) => {
                const label = t("candidateLabel", { ordinal: entry.classificationOrdinal });
                const selected = entry.id === selectedLegal.id;
                return (
                  <div key={entry.id} role="listitem">
                    <Button
                      type="button"
                      variant={selected ? "secondary" : "ghost"}
                      className="h-auto min-h-28 w-full flex-col gap-1 border border-line p-2"
                      aria-label={label}
                      aria-pressed={selected}
                      onClick={() => setSelectedLegalId(entry.id)}
                    >
                      <NetDiagram entry={entry} label={label} compact />
                      <span className="text-xs">{label}</span>
                    </Button>
                  </div>
                );
              })}
            </div>
            <div className="grid gap-4 rounded-2xl border border-line bg-moon/10 p-4 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center">
              <div className="order-2 sm:order-1">
                <p className="font-medium text-ink">
                  {t("selectedSummary", { ordinal: selectedLegal.classificationOrdinal })}
                </p>
                <p className="mt-1 text-sm leading-6 text-muted">{t("pendingReview")}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant="secondary">{t("sixSquares")}</Badge>
                  <Badge variant="outline">{t("sharedEdges", { count: selectedLegal.adjacencyEdgeCount })}</Badge>
                </div>
              </div>
              <div className="order-1 rounded-xl bg-paper/70 p-2 sm:order-2">
                <NetDiagram
                  entry={selectedLegal}
                  label={t("candidateLabel", { ordinal: selectedLegal.classificationOrdinal })}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="judge" className="mt-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-center">
              <div className="rounded-2xl border border-line bg-paper p-3 sm:p-4">
                <NetDiagram entry={question} label={t("questionAlt", { current: questionIndex + 1 })} />
              </div>
              <div className="space-y-4">
                <div>
                  <Badge variant="outline">
                    {t("questionPosition", { current: questionIndex + 1, total: judgmentDeck.length })}
                  </Badge>
                  <h3 className="mt-3 text-base font-medium text-ink">{t("questionPrompt")}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted">{t("localPractice")}</p>
                </div>
                <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("answerGroup")}>
                  <Button type="button" className="h-11" onClick={() => evaluate("legal")}>{t("legalChoice")}</Button>
                  <Button type="button" variant="secondary" className="h-11" onClick={() => evaluate("invalid")}>{t("invalidChoice")}</Button>
                </div>
                <div className="min-h-24 rounded-xl border border-line bg-moon/10 p-3" role="status" aria-live="polite" aria-atomic="true">
                  {evaluation ? (
                    <div>
                      <p className="flex items-center gap-2 font-medium text-ink">
                        {evaluation.correct
                          ? <CheckCircle2 aria-hidden="true" className="size-4 text-leaf-deep" />
                          : <XCircle aria-hidden="true" className="size-4 text-rose-deep" />}
                        {evaluation.correct ? t("correct") : t("incorrect")}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-muted">
                        {evaluation.actual === "legal" ? t("actualLegal") : t("actualInvalid")} {t(resultReasonKey(evaluation))}
                      </p>
                    </div>
                  ) : <p className="text-sm leading-6 text-muted">{t("pendingResult")}</p>}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-11"
                    disabled={questionIndex === 0}
                    onClick={() => selectQuestion(questionIndex - 1)}
                  >
                    <ArrowLeft aria-hidden="true" className="size-4" />
                    {t("previousQuestion")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-11"
                    disabled={questionIndex === judgmentDeck.length - 1}
                    onClick={() => selectQuestion(questionIndex + 1)}
                  >
                    {t("nextQuestion")}
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

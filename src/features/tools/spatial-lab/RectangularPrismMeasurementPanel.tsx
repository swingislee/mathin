"use client";

import { useEffect, useRef } from "react";
import { Minus, Plus, RotateCcw, Ruler } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  RECTANGULAR_PRISM_MEASUREMENT_LIMITS,
  type RectangularPrismDimensions,
  type RectangularPrismMeasurement,
} from "@/features/spatial-math/domain";

type DimensionKey = keyof RectangularPrismDimensions;

export interface RectangularPrismMeasurementMessages {
  readonly title: string;
  readonly description: string;
  readonly dimensionsLabel: string;
  readonly dimension: Readonly<Record<DimensionKey, string>>;
  readonly decreaseDimension: (dimension: string) => string;
  readonly increaseDimension: (dimension: string) => string;
  readonly restorePrism: string;
  readonly invalidShapeTitle: string;
  readonly invalidShapeDescription: string;
  readonly boundary: string;
  readonly volume: string;
  readonly surfaceArea: string;
  readonly volumeValue: (value: number) => string;
  readonly surfaceValue: (value: number) => string;
  readonly liveSummary: (measurement: RectangularPrismMeasurement) => string;
  readonly volumeFormula: (measurement: RectangularPrismMeasurement) => string;
  readonly surfaceFormula: (measurement: RectangularPrismMeasurement) => string;
  readonly facePairs: string;
  readonly facePairLabel: Readonly<Record<RectangularPrismMeasurement["oppositeFacePairs"][number]["pair"], string>>;
  readonly facePairFormula: (
    label: string,
    first: number,
    second: number,
    value: number,
  ) => string;
}

const DIMENSION_KEYS = ["length", "width", "height"] as const;

export function RectangularPrismMeasurementPanel({
  measurement,
  messages,
  onDimensionsChange,
  onRestore,
}: {
  readonly measurement: RectangularPrismMeasurement | null;
  readonly messages: RectangularPrismMeasurementMessages;
  readonly onDimensionsChange: (dimensions: RectangularPrismDimensions) => void;
  readonly onRestore: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const focusAfterRestore = useRef(false);
  useEffect(() => {
    if (!measurement || !focusAfterRestore.current) return;
    focusAfterRestore.current = false;
    panelRef.current?.focus();
  }, [measurement]);

  if (!measurement) {
    return (
      <Card
        data-measurement-controls="rectangular-prism-measurement-v1"
        data-measurement-valid="false"
        ref={panelRef}
        tabIndex={-1}
      >
        <CardHeader className="p-4 pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Ruler aria-hidden="true" className="size-4 text-rose" />
            {messages.invalidShapeTitle}
          </CardTitle>
          <CardDescription>{messages.invalidShapeDescription}</CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-2">
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {messages.invalidShapeTitle}. {messages.invalidShapeDescription}
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              focusAfterRestore.current = true;
              onRestore();
            }}
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            {messages.restorePrism}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { dimensions } = measurement;
  const facePairDimensions = {
    "length-width": [dimensions.length, dimensions.width],
    "length-height": [dimensions.length, dimensions.height],
    "width-height": [dimensions.width, dimensions.height],
  } as const;

  return (
    <Card
      data-measurement-controls="rectangular-prism-measurement-v1"
      data-measurement-valid="true"
      data-measurement-dimensions={`${dimensions.length}x${dimensions.width}x${dimensions.height}`}
      data-measurement-volume={measurement.volume.value}
      data-measurement-surface-area={measurement.surfaceArea.value}
      ref={panelRef}
      tabIndex={-1}
    >
      <CardHeader className="gap-2 p-4 pb-2 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Ruler aria-hidden="true" className="size-4 text-rose" />
            {messages.title}
          </CardTitle>
          <CardDescription>{messages.description}</CardDescription>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Badge variant="secondary">{messages.volumeValue(measurement.volume.value)}</Badge>
          <Badge variant="outline">{messages.surfaceValue(measurement.surfaceArea.value)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 p-4 pt-2 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <p className="text-xs font-medium text-ink">{messages.dimensionsLabel}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-1" role="group" aria-label={messages.dimensionsLabel}>
            {DIMENSION_KEYS.map((key) => {
              const value = dimensions[key];
              const label = messages.dimension[key];
              return (
                <div key={key} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-moon/10 px-2 py-1.5" role="group" aria-label={`${label} ${value}`}>
                  <span className="min-w-12 text-sm font-medium text-ink">{label}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="size-8 p-0"
                      disabled={value <= RECTANGULAR_PRISM_MEASUREMENT_LIMITS.minDimension}
                      aria-label={messages.decreaseDimension(label)}
                      onClick={() => onDimensionsChange({ ...dimensions, [key]: value - 1 })}
                    >
                      <Minus aria-hidden="true" className="size-4" />
                    </Button>
                    <span className="w-8 text-center text-lg font-medium tabular-nums">
                      {value}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="size-8 p-0"
                      disabled={value >= RECTANGULAR_PRISM_MEASUREMENT_LIMITS.maxDimension}
                      aria-label={messages.increaseDimension(label)}
                      onClick={() => onDimensionsChange({ ...dimensions, [key]: value + 1 })}
                    >
                      <Plus aria-hidden="true" className="size-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs leading-5 text-muted">{messages.boundary}</p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mt-2"
            onClick={() => {
              focusAfterRestore.current = true;
              onRestore();
            }}
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            {messages.restorePrism}
          </Button>
        </div>

        <div className="space-y-3">
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {messages.liveSummary(measurement)}
          </p>
          <div className="rounded-xl border border-line bg-card px-3 py-2">
            <p className="text-xs text-muted">{messages.volume}</p>
            <p className="mt-1 break-words font-mono text-sm leading-6 text-ink">
              {messages.volumeFormula(measurement)}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-card px-3 py-2">
            <p className="text-xs text-muted">{messages.surfaceArea}</p>
            <p className="mt-1 break-words font-mono text-sm leading-6 text-ink">
              {messages.surfaceFormula(measurement)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-ink">{messages.facePairs}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {measurement.oppositeFacePairs.map((pair) => {
                const [first, second] = facePairDimensions[pair.pair];
                const label = messages.facePairLabel[pair.pair];
                return (
                  <div key={pair.pair} className="rounded-xl border border-line bg-leaf/10 px-3 py-2 text-xs leading-5 text-ink">
                    {messages.facePairFormula(label, first, second, pair.oppositePairArea)}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

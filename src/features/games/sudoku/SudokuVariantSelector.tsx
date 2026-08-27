"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  sudokuVariantsForSurface,
  type SudokuVariantId,
  type SudokuVariantSurface,
} from "./variant";

/** 注册表驱动的数独题型入口；新增题型不应再创建平行选择器。 */
export function SudokuVariantSelector({
  value,
  onValueChange,
  surface = "public",
  disabled = false,
  className,
}: {
  value: SudokuVariantId;
  onValueChange: (variantId: SudokuVariantId) => void;
  surface?: SudokuVariantSurface;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations("games");
  const variants = sudokuVariantsForSurface(surface);

  return (
    <div
      aria-label={t("sudokuVariantLabel")}
      className={cn("flex items-center gap-1 rounded-full border border-line/80 bg-card/70 p-1", className)}
      role="radiogroup"
    >
      {variants.map((variant) => (
        <Button
          key={variant.id}
          type="button"
          role="radio"
          aria-checked={value === variant.id}
          data-sudoku-size-option={variant.size}
          data-sudoku-variant-option={variant.id}
          disabled={disabled}
          variant="ghost"
          size="sm"
          className={cn(
            "min-h-8 px-3 py-1 text-xs",
            value === variant.id ? "bg-moon/70 text-ink shadow-sm hover:bg-moon/70" : "hover:bg-moon/30",
          )}
          onClick={() => onValueChange(variant.id)}
        >
          {t(variant.messageKey)}
        </Button>
      ))}
    </div>
  );
}

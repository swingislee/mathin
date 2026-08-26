"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SUDOKU_SIZES, type SudokuSize } from "./variant";

export function SudokuSizeSelector({
  value,
  onValueChange,
  disabled = false,
  className,
}: {
  value: SudokuSize;
  onValueChange: (size: SudokuSize) => void;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations("games");

  return (
    <div
      aria-label={t("sudokuSizeLabel")}
      className={cn("flex items-center gap-1 rounded-full border border-line/80 bg-card/70 p-1", className)}
      role="radiogroup"
    >
      {SUDOKU_SIZES.map((size) => (
        <Button
          key={size}
          type="button"
          role="radio"
          aria-checked={value === size}
          data-sudoku-size-option={size}
          disabled={disabled}
          variant="ghost"
          size="sm"
          className={cn(
            "min-h-8 px-3 py-1 text-xs",
            value === size ? "bg-moon/70 text-ink shadow-sm hover:bg-moon/70" : "hover:bg-moon/30",
          )}
          onClick={() => onValueChange(size)}
        >
          {t(`sudokuSize.${size}`)}
        </Button>
      ))}
    </div>
  );
}

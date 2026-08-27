"use client";

import { SudokuVariantSelector } from "./SudokuVariantSelector";
import {
  getSudokuVariant,
  sudokuVariantForSize,
  type SudokuSize,
} from "./variant";

/**
 * @deprecated 仅保留给旧尺寸调用方。新增界面必须使用 SudokuVariantSelector，
 * 否则同为 9×9 的变形题型无法区分。
 */
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
  return (
    <SudokuVariantSelector
      value={sudokuVariantForSize(value).id}
      disabled={disabled}
      className={className}
      onValueChange={(variantId) => {
        const size = getSudokuVariant(variantId)?.size;
        if (size) onValueChange(size);
      }}
    />
  );
}

"use client"

import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & { thumbClassName?: string }
>(({
  className,
  orientation = "horizontal",
  thumbClassName,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-valuetext": ariaValueText,
  ...props
}, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    orientation={orientation}
    className={cn(
      "relative flex touch-none select-none items-center",
      orientation === "vertical" ? "h-full flex-col" : "w-full",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className={cn("relative grow overflow-hidden rounded-full bg-line", orientation === "vertical" ? "h-full w-1.5" : "h-1.5 w-full")}>
      <SliderPrimitive.Range className={cn("absolute bg-rose", orientation === "vertical" ? "w-full" : "h-full")} />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-valuetext={ariaValueText}
      className={cn("block h-4 w-4 rounded-full border-[1.5px] border-crater bg-card shadow-sm transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-crater disabled:pointer-events-none disabled:opacity-50", thumbClassName)}
    />
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }

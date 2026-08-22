"use client";

import { DayPicker, type DayPickerProps } from "react-day-picker";
import { useLocale } from "next-intl";
import { enUS, zhCN } from "react-day-picker/locale";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Site-themed shadcn calendar primitive. Keeping the styling here means every
 * date field uses Mathin's paper/moon/crater palette instead of the browser's
 * unthemeable blue-and-white native picker.
 */
export function Calendar({ className, classNames, showOutsideDays = true, ...props }: DayPickerProps) {
  const locale = useLocale();
  return (
    <DayPicker
      locale={locale === "zh" ? zhCN : enUS}
      showOutsideDays={showOutsideDays}
      fixedWeeks
      className={cn("w-fit select-none", className)}
      classNames={{
        root: "w-fit",
        months: "relative flex flex-col",
        month: "space-y-3",
        month_caption: "flex h-9 items-center justify-center px-10",
        caption_label: "text-sm font-medium text-ink",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous: cn(buttonVariants({ variant: "ghost", size: "sm" }), "size-9 rounded-full p-0 text-muted hover:-translate-y-0.5 hover:bg-moon/40 hover:text-ink"),
        button_next: cn(buttonVariants({ variant: "ghost", size: "sm" }), "size-9 rounded-full p-0 text-muted hover:-translate-y-0.5 hover:bg-moon/40 hover:text-ink"),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-9 py-1 text-center text-[11px] font-normal text-muted",
        weeks: "block",
        week: "mt-1 flex w-full",
        day: "relative size-9 p-0 text-center text-sm",
        day_button: "size-9 rounded-lg text-ink outline-none transition-[color,background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-moon/40 focus-visible:ring-2 focus-visible:ring-crater/40",
        selected: "[&>button]:bg-rose [&>button]:text-white [&>button]:hover:bg-rose-deep",
        today: "[&>button]:ring-1 [&>button]:ring-crater/70",
        outside: "text-muted opacity-35",
        disabled: "pointer-events-none text-muted opacity-25",
        hidden: "invisible",
        ...classNames,
      }}
      {...props}
    />
  );
}

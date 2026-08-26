import { AnimatePresence, motion } from "framer-motion";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../utils/cn";
import {
  formatAriaDate,
  getCalendarWeekdays,
  type CalendarDayCell
} from "../../features/calendar/calendar-utils";
import type { AbsenceTypeSetting } from "../../types/absence";

type DayMeta = {
  entriesCount: number;
  marker: { label: string; color: string } | null;
  noActivityInTrackedRange: boolean;
  activityLabel?: string | null;
  earningsLabel?: string | null;
  intensity?: number;
};

type Props = {
  monthLabel: string;
  monthKey: string;
  slideDirection: number;
  days: CalendarDayCell[];
  selectedDate: Date | null;
  today: Date;
  absenceTypes: AbsenceTypeSetting[];
  getDayMeta: (isoDate: string) => DayMeta;
  onSelect: (date: Date) => void;
  onSwipeChange: (direction: -1 | 1) => void;
  onResolveSwipe: (info: {
    offset: { x: number; y: number };
    velocity: { x: number; y: number };
  }) => number;
};

export function CalendarMonthGrid({
  monthLabel,
  monthKey,
  slideDirection,
  days,
  selectedDate,
  today,
  absenceTypes,
  getDayMeta,
  onSelect,
  onSwipeChange,
  onResolveSwipe
}: Props) {
  const { t, i18n } = useTranslation("calendar");
  const weekdays = getCalendarWeekdays(i18n.resolvedLanguage);
  const rowCount = days.length / 7;
  const gridClassName =
    rowCount === 6
      ? "grid grid-cols-7 gap-x-1.5 gap-y-1.5 sm:gap-x-2 sm:gap-y-2"
      : "grid grid-cols-7 gap-x-1.5 gap-y-2 sm:gap-x-2 sm:gap-y-2.5";
  const cellClassName =
    rowCount === 6
      ? "calendar-month-grid__cell relative flex min-h-[58px] flex-col items-center justify-between rounded-[14px] px-0.5 py-1 text-center transition duration-200 focus:outline-none focus:ring-2 focus:ring-[#10b981]/30 sm:min-h-[64px]"
      : "calendar-month-grid__cell relative flex min-h-[64px] flex-col items-center justify-between rounded-[15px] px-0.5 py-1.5 text-center transition duration-200 focus:outline-none focus:ring-2 focus:ring-[#10b981]/30 sm:min-h-[70px]";

  return (
    <section
      className="calendar-month-grid mx-auto w-full overflow-hidden px-1 pb-1"
      aria-label={t("calendarGrid.label")}
    >
      <div className="flex min-h-14 items-center justify-center">
        <div className="text-center">
          <p className="text-[1.4rem] font-semibold tracking-[-0.045em] text-[#f5f5f5]">
            {monthLabel}
          </p>
          <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.24em] text-[#10b981]/58">
            {t("calendarGrid.monthlyActivity")}
          </p>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1 border-t border-white/[0.065] pt-3" role="row">
        {weekdays.map((weekday) => (
          <div
            key={weekday}
            className="text-center text-[10px] font-semibold tracking-[0.15em] text-white/38"
          >
            {weekday.slice(0, 3)}
          </div>
        ))}
      </div>

      <div className="relative mt-2 overflow-hidden touch-pan-y">
        <div className={`${gridClassName} invisible pointer-events-none`} aria-hidden="true">
          {days.map((day) => (
            <div key={`placeholder-${day.key}`} className={cellClassName}>
              <div className="h-8 w-8 shrink-0" />
              <div className="min-h-[21px]" />
            </div>
          ))}
        </div>
        <AnimatePresence custom={slideDirection} initial={false}>
          <motion.div
            key={monthKey}
            custom={slideDirection}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.08}
            dragDirectionLock
            onDragEnd={(_, info) => {
              const direction = onResolveSwipe(info);
              if (direction === -1) onSwipeChange(-1);
              if (direction === 1) onSwipeChange(1);
            }}
            variants={{
              enter: (direction: number) => ({
                x: direction === 0 ? 0 : direction > 0 ? "100%" : "-100%"
              }),
              center: { x: 0 },
              exit: (direction: number) => ({
                x: direction > 0 ? "-100%" : "100%"
              })
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
            className={`absolute inset-x-0 top-0 ${gridClassName}`}
            role="grid"
          >
            {days.map((day) => {
              const selected =
                selectedDate !== null &&
                day.date.getFullYear() === selectedDate.getFullYear() &&
                day.date.getMonth() === selectedDate.getMonth() &&
                day.date.getDate() === selectedDate.getDate();
              const current =
                !selected &&
                day.date.getFullYear() === today.getFullYear() &&
                day.date.getMonth() === today.getMonth() &&
                day.date.getDate() === today.getDate();
              const meta = getDayMeta(day.key);
              const ariaSegments = [formatAriaDate(day.date)];
              if (selected) ariaSegments.push("selected");
              if (current) ariaSegments.push("today");
              if (meta.entriesCount > 0) ariaSegments.push(`${meta.entriesCount} work records`);
              if (meta.marker) ariaSegments.push(meta.marker.label);

              return (
                <button
                  key={day.key}
                  type="button"
                  role="gridcell"
                  aria-selected={selected}
                  aria-label={ariaSegments.join(", ")}
                  data-state={selected ? "selected" : current ? "today" : "default"}
                  onClick={() => onSelect(day.date)}
                  className={cn(
                    cellClassName,
                    !selected && day.inActiveMonth && meta.entriesCount > 0 && "calendar-day-activity",
                    !selected && day.inActiveMonth && meta.entriesCount > 0 && "bg-[#10b981]/[0.035]",
                    !selected && day.inActiveMonth && "calendar-day-hoverable",
                    !day.inActiveMonth && "opacity-30"
                  )}
                  style={resolveDaySurfaceStyle(meta, selected)}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full text-[15px] font-semibold",
                      selected
                        ? "calendar-day-selected border border-[#34d399]/55 bg-[#059669] text-white"
                        : current
                          ? "calendar-day-today border border-[#10b981]/35 bg-transparent text-[#34d399]"
                          : "text-white/74"
                    )}
                  >
                    {day.dayNumber}
                  </span>
                  <div className={cn(
                    "flex min-h-[21px] max-w-full flex-col items-center leading-none",
                    !meta.activityLabel && meta.earningsLabel
                      ? "flex-1 justify-center"
                      : "justify-end"
                  )}>
                    {meta.activityLabel || meta.earningsLabel ? (
                      <>
                        {meta.activityLabel ? (
                          <span
                          className={cn(
                              "calendar-day-activity-label max-w-full truncate font-metric text-[10px] font-semibold tabular-nums",
                              selected ? "text-white/82" : "text-[#34d399]/82"
                            )}
                          >
                            {meta.activityLabel}
                          </span>
                        ) : null}
                        {meta.earningsLabel ? (
                          <span className={cn(
                            "calendar-day-earnings-label max-w-full truncate font-metric text-[9px] font-semibold tabular-nums",
                            meta.activityLabel && "mt-0.5",
                            selected ? "text-white/76" : "text-white/48"
                          )}>
                            {meta.earningsLabel}
                          </span>
                        ) : null}
                      </>
                    ) : meta.marker ? (
                      <span className="flex max-w-full items-center justify-center">
                        <span
                          className={cn(
                            "calendar-day-marker max-w-[48px] truncate text-[8px] font-semibold leading-tight",
                            selected && "text-white/72"
                          )}
                          style={!selected
                            ? {
                                color: meta.marker.color,
                                "--calendar-marker-color": meta.marker.color
                              } as CSSProperties
                            : undefined}
                        >
                          {meta.marker.label}
                        </span>
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>

      {absenceTypes.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-white/[0.06] pt-3 text-[9px] font-medium tracking-[0.12em] text-white/36">
          {absenceTypes.map((absenceType) => (
            <LegendDot key={absenceType.id} color={absenceType.color} label={absenceType.name} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function resolveDaySurfaceStyle(meta: DayMeta, selected: boolean) {
  if (selected) return undefined;

  if (meta.entriesCount > 0) {
    return {
      boxShadow: "inset 0 -2px 0 rgba(16,185,129,0.62)",
      background: "linear-gradient(155deg, color-mix(in srgb, #10b981 10%, transparent), color-mix(in srgb, #10b981 4%, transparent))"
    };
  }

  if (meta.marker) {
    return {
      boxShadow: `inset 0 -2px 0 color-mix(in srgb, ${meta.marker.color} 68%, transparent)`,
      backgroundColor: `color-mix(in srgb, ${meta.marker.color} 7%, transparent)`
    };
  }

  return undefined;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </span>
  );
}

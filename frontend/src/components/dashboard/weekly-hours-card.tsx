import { useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { WeeklyRhythmDay } from "../../types/dashboard";
import { cn } from "../../utils/cn";
import { formatCurrency, formatMinutesAsDuration } from "../../utils/format";
import { Card } from "../ui/card";

type Props = {
  variant?: "rhythm" | "flow";
  days?: WeeklyRhythmDay[];
  previousWeekAverageMinutes?: number;
  previousWeekAverageGross?: number;
  flowCurrency?: string;
  onDaySelect?: (date: string) => void;
};

export function WeeklyHoursCard({
  variant = "rhythm",
  days = [],
  previousWeekAverageMinutes,
  previousWeekAverageGross,
  flowCurrency = "EUR",
  onDaySelect,
}: Props) {
  const { t, i18n } = useTranslation("dashboard");
  const sectionRef = useRef<HTMLElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const firstTrackRef = useRef<HTMLDivElement>(null);
  const lastTrackRef = useRef<HTMLDivElement>(null);
  const preservedViewportTop = useRef<number | null>(null);
  const [averageGuide, setAverageGuide] = useState<{ left: number; top: number; width: number } | null>(null);
  const weekKey = days[0]?.key ?? "empty";
  const selectedDayKey = days.find((day) => day.selected)?.key ?? "none";
  const metricValues = days.map((day) => variant === "flow" ? day.amount : day.minutes);
  const hasWeeklyActivity = metricValues.some((value) => value > 0) ||
    days.some((day) => Boolean(day.absence));
  const currentWeekValue = metricValues.reduce((total, value) => total + value, 0);
  const weeklyWorkedMinutes = days.reduce((total, day) => total + day.minutes, 0);
  const weeklyExtraMinutes = days.reduce((total, day) => total + (day.extraMinutes ?? 0), 0);
  const weeklyBaseAmount = days.reduce(
    (total, day) => total + (day.baseAmount ?? day.amount - (day.extraAmount ?? 0)),
    0
  );
  const weeklyExtraAmount = days.reduce((total, day) => total + (day.extraAmount ?? 0), 0);
  const weeklySummary = variant === "flow"
    ? [
        {
          label: t("weeklyHours.workEarnings"),
          value: formatCurrency(String(weeklyBaseAmount + weeklyExtraAmount), flowCurrency)
        },
        {
          label: t("weeklyHours.extraMoney"),
          value: formatCurrency(String(weeklyExtraAmount), flowCurrency)
        }
      ]
    : [
        {
          label: t("weeklyHours.workedHours"),
          value: formatMinutesAsDuration(weeklyWorkedMinutes)
        },
        {
          label: t("weeklyHours.extraHours"),
          value: formatMinutesAsDuration(weeklyExtraMinutes)
        }
      ];
  const workedDays = days.filter((day, index) => metricValues[index] > 0 && day.status !== "absence").length;
  const dailyAverage = workedDays > 0 ? currentWeekValue / workedDays : 0;
  const maximumDailyValue = Math.max(...metricValues, 0);
  const averagePercentage = maximumDailyValue > 0
    ? Math.min((dailyAverage / maximumDailyValue) * 100, 100)
    : 0;
  const previousDailyAverage = variant === "flow"
    ? previousWeekAverageGross
    : previousWeekAverageMinutes;
  const weekChange = previousDailyAverage === undefined
    ? null
    : previousDailyAverage === 0
      ? currentWeekValue > 0 ? 100 : 0
      : ((dailyAverage - previousDailyAverage) / previousDailyAverage) * 100;
  const numberFormatter = new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 2 });
  const currencySymbol = new Intl.NumberFormat(i18n.resolvedLanguage, {
    style: "currency",
    currency: flowCurrency,
    currencyDisplay: "narrowSymbol"
  }).formatToParts(0).find((part) => part.type === "currency")?.value ?? flowCurrency;

  useLayoutEffect(() => {
    if (preservedViewportTop.current === null || !sectionRef.current) return;

    const root = document.documentElement;
    const previousScrollBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    root.dataset.preserveScrollPosition = "true";

    let frame = 0;
    let animationFrame = 0;
    const stabilizePosition = () => {
      if (!sectionRef.current || preservedViewportTop.current === null) return;

      const offset = sectionRef.current.getBoundingClientRect().top - preservedViewportTop.current;
      if (Math.abs(offset) > 0.5) {
        window.scrollTo({ top: window.scrollY + offset, left: 0, behavior: "auto" });
      }

      frame += 1;
      if (frame < 8) {
        animationFrame = window.requestAnimationFrame(stabilizePosition);
      } else {
        preservedViewportTop.current = null;
        root.style.scrollBehavior = previousScrollBehavior;
        delete root.dataset.preserveScrollPosition;
      }
    };

    stabilizePosition();
    return () => {
      window.cancelAnimationFrame(animationFrame);
      root.style.scrollBehavior = previousScrollBehavior;
      delete root.dataset.preserveScrollPosition;
    };
  }, [selectedDayKey]);

  useLayoutEffect(() => {
    const chart = chartRef.current;
    const firstTrack = firstTrackRef.current;
    const lastTrack = lastTrackRef.current;
    if (!chart || !firstTrack || !lastTrack || maximumDailyValue <= 0) {
      setAverageGuide(null);
      return;
    }

    const updateGuide = () => {
      const left = firstTrack.offsetLeft;
      const width = lastTrack.offsetLeft + lastTrack.offsetWidth - left;
      const top = firstTrack.offsetTop + firstTrack.offsetHeight * (1 - averagePercentage / 100);
      setAverageGuide({ left, top, width });
    };

    updateGuide();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateGuide);
      return () => window.removeEventListener("resize", updateGuide);
    }
    const observer = new ResizeObserver(updateGuide);
    observer.observe(chart);
    return () => observer.disconnect();
  }, [averagePercentage, maximumDailyValue, weekKey]);

  return (
    <section ref={sectionRef}>
      {hasWeeklyActivity ? (
        <Card className="dashboard-primary-card overflow-hidden">
          <div className="flex min-h-14 items-center justify-between gap-4 border-b border-black/10 px-5 py-2.5 dark:border-white/10">
            <div>
              <p className="text-[0.6rem] font-medium uppercase tracking-[0.12em] text-[#f5f5f5]/34">
                {t(variant === "flow"
                  ? "weeklyHours.dailyEarningsAverage"
                  : "weeklyHours.dailyAverage")}
              </p>
              <p className="mt-1 flex items-baseline gap-1 font-metric text-lg font-medium tabular-nums text-[#f5f5f5]">
                {variant === "flow" ? (
                  <span className="text-sm text-[#f5f5f5]/44">{currencySymbol}</span>
                ) : null}
                <span>{numberFormatter.format(variant === "flow" ? dailyAverage : dailyAverage / 60)}</span>
                {variant === "rhythm" ? (
                  <span className="text-xs text-[#f5f5f5]/44">h</span>
                ) : null}
              </p>
            </div>
            {weekChange !== null ? (
              <div className={cn(
                  "flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold tabular-nums",
                  weekChange >= 0
                  ? "border-[#10b981]/15 bg-[#10b981]/[0.07] text-[#10b981]"
                  : "border-red-400/15 bg-red-400/[0.06] text-red-300"
              )}>
                {weekChange >= 0 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                <span>{new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 1 }).format(Math.abs(weekChange))}%</span>
              </div>
            ) : null}
          </div>
          <div className="weekly-chart-area px-4 py-4">
          <div className="relative h-52 touch-pan-y overflow-hidden">
            <div className="grid h-52 grid-cols-7 items-end gap-1.5 opacity-0" aria-hidden="true">
              {days.map((day) => (
                <div key={`placeholder-${day.key}`} />
              ))}
            </div>
            <div ref={chartRef} key={weekKey} className="absolute inset-0 grid h-52 grid-cols-7 items-stretch gap-1.5">
	              {averageGuide ? (
                    <span
                      data-testid="weekly-average-guide"
                      data-average-percentage={averagePercentage}
                      className="pointer-events-none absolute z-20 h-px border-t border-dashed border-[#10b981]/55"
                      style={{ left: averageGuide.left, top: averageGuide.top, width: averageGuide.width }}
                      aria-hidden="true"
                    />
                  ) : null}
	                {days.map((day, index) => {
	                  const isAbsenceOnly = day.status === "absence";
	                  const metricValue = metricValues[index] ?? 0;
                  const flowExtraAmount = Math.max(day.extraAmount ?? 0, 0);
                  const flowBaseAmount = Math.max(day.baseAmount ?? metricValue - flowExtraAmount, 0);
                  const flowTotalAmount = flowBaseAmount + flowExtraAmount;
                  const flowExtraPercentage = flowTotalAmount > 0
                    ? Math.min((flowExtraAmount / flowTotalAmount) * 100, 100)
                    : 0;
	                  const uniqueExtraPayPercentages = [...new Set(day.extraPayPercentages)];
	                  const extraPayPercentage = uniqueExtraPayPercentages.length === 1
                        ? uniqueExtraPayPercentages[0] ?? null
                        : null;
	                  const extraPayLabel = extraPayPercentage === null
                        ? ""
                        : `+${new Intl.NumberFormat(i18n.resolvedLanguage, {
                            maximumFractionDigits: 1
                          }).format(extraPayPercentage)}%`;
	                  const barHeight = Math.max(
                        maximumDailyValue > 0 ? Math.min((metricValue / maximumDailyValue) * 100, 100) : 0,
                        6
                      );
	                  const absenceLabel = day.absence?.label ?? "";

                  return (
                    <button
                      type="button"
                      key={day.key}
                      onClick={() => {
                        preservedViewportTop.current = sectionRef.current?.getBoundingClientRect().top ?? null;
                        onDaySelect?.(day.key);
                      }}
                      className={cn(
                        "flex h-full min-w-0 flex-col items-center gap-2 rounded-2xl px-1 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10b981]",
                        day.selected
                          ? "bg-[#10b981]/[0.075] shadow-[inset_0_0_0_1px_rgba(16,185,129,0.1)]"
                          : "bg-transparent"
                      )}
                      aria-label={isAbsenceOnly
                        ? `${day.label}, ${absenceLabel}`
                        : `${day.label}, ${variant === "flow" ? metricValue : day.value}`}
                    >
                      <p className={`truncate text-[0.64rem] font-semibold uppercase tracking-[0.1em] ${
                        day.selected ? "text-[#34d399]" : "text-[#f5f5f5]/38"
                      }`}>
                        {day.label}
                      </p>
                      <div
                        ref={index === 0 ? firstTrackRef : index === days.length - 1 ? lastTrackRef : undefined}
                        className="relative h-28 w-full"
                      >
                        <span
                          className="weekly-chart-track absolute bottom-0 left-1/2 h-28 w-full max-w-6 -translate-x-1/2 rounded-full bg-white/[0.065]"
                          aria-hidden="true"
                        />
                        {metricValue > 0 && (!day.absence || variant === "flow") ? (
                          <>
                            {extraPayLabel ? (
                              <span
                                className={cn(
                                  "absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap text-[0.55rem] font-bold tabular-nums",
                                  variant === "flow"
                                    ? "text-[#10b981]"
                                    : day.selected
                                      ? "text-[#34d399]"
                                      : "text-[#10b981]"
                                )}
                                style={{
                                  bottom: `clamp(0.8rem, calc(${barHeight}% + 0.15rem), calc(100% - 0.9rem))`
                                }}
                              >
                                {extraPayLabel}
                              </span>
                            ) : null}
                            {variant === "flow" ? (
                              <motion.div
                                initial={{ height: `${Math.max(barHeight - 10, 6)}%`, opacity: 0.62 }}
                                animate={{ height: `${barHeight}%`, opacity: 1 }}
                                transition={{ duration: 0.22, delay: index * 0.018, ease: [0.22, 1, 0.36, 1] }}
                                className="absolute bottom-0 left-1/2 flex w-full max-w-6 -translate-x-1/2 flex-col overflow-hidden rounded-full"
                                data-testid={`flow-segmented-bar-${day.key}`}
                              >
                                {flowExtraPercentage > 0 ? (
                                  <span
                                    data-segment="extra"
                                    className="w-full bg-[#10b981]"
                                    style={{ height: `${flowExtraPercentage}%` }}
                                    aria-hidden="true"
                                  />
                                ) : null}
                                <span
                                  data-segment="worked"
                                  className={cn("weekly-chart-bar w-full flex-1", day.selected && "is-selected")}
                                  style={{ backgroundColor: day.selected ? "#34d399" : "rgba(255, 255, 255, 0.42)" }}
                                  aria-hidden="true"
                                />
                              </motion.div>
                            ) : (
                              <motion.div
                                data-testid={`rhythm-bar-${day.key}`}
                                initial={{ height: `${Math.max(barHeight - 10, 6)}%`, opacity: 0.62 }}
                                animate={{ height: `${barHeight}%`, opacity: 1 }}
                                transition={{ duration: 0.22, delay: index * 0.018, ease: [0.22, 1, 0.36, 1] }}
                                className={cn(
                                  "weekly-chart-bar absolute bottom-0 left-1/2 w-full max-w-6 -translate-x-1/2 overflow-hidden rounded-full transition-colors",
                                  day.selected
                                    ? "is-selected shadow-[0_0_18px_rgba(16,185,129,0.18)]"
                                    : ""
                                )}
                                style={{ backgroundColor: day.selected ? "#34d399" : "rgba(255, 255, 255, 0.42)" }}
                              />
                            )}
                          </>
                        ) : null}
                      </div>
                      <div className="mt-auto min-w-0 text-center">
                        {day.absence ? (
                          <span className="flex h-4 items-center justify-center">
                            <span
                              className="block h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: day.absence.color }}
                              aria-label={day.absence.label}
                            />
                          </span>
                        ) : variant === "flow" ? (
                          <p className={cn(
                            "whitespace-nowrap text-[0.66rem] font-semibold tabular-nums",
                            day.selected ? "text-[#34d399]" : "text-[#f5f5f5]/42"
                          )}>
                            {currencySymbol}{numberFormatter.format(day.amount)}
                          </p>
                        ) : (
                          <p className={cn(
                            "text-xs font-semibold tabular-nums",
                            day.selected ? "text-[#34d399]" : "text-[#f5f5f5]/38"
                          )}>
                            {new Intl.NumberFormat(i18n.resolvedLanguage, {
                              maximumFractionDigits: 2
                            }).format(day.minutes / 60)}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
          </div>
          <div
            className={cn(
              "grid gap-3 border-t border-black/10 px-5 py-4 dark:border-white/10",
              "grid-cols-2"
            )}
          >
            {weeklySummary.map((item, index) => (
              <div key={item.label} className={cn("min-w-0", index === 1 && "text-right")}>
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-[#f5f5f5]/36">
                  {item.label}
                </p>
                <p className="mt-1.5 break-words font-metric text-base font-medium tabular-nums text-[#f5f5f5]">
                  {item.value}
                </p>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Card className="dashboard-primary-card dashboard-empty-week flex min-h-24 items-center px-5 py-4">
          <p className="max-w-[18rem] text-sm font-medium leading-5 text-[#f5f5f5]/48">
            {t("weeklyHours.emptyDescription")}
          </p>
        </Card>
      )}
    </section>
  );
}

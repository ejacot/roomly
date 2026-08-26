import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatisticsTrendGraph } from "../../features/statistics/charts/statistics-line-chart";
import { cn } from "../../utils/cn";
import { Card } from "../ui/card";

export type CalendarMonthlyMetricDay = {
  key: string;
  dayNumber: number;
  minutes: number;
  amount: number;
  absenceColor: string | null;
  selected: boolean;
};

type Props = {
  variant: "flow" | "rhythm";
  days: CalendarMonthlyMetricDay[];
  previousMonthTotal: number;
  currency?: string;
};

export function CalendarMonthlyMetricCard({
  variant,
  days,
  previousMonthTotal,
  currency = "EUR"
}: Props) {
  const { t, i18n } = useTranslation("calendar");
  const values = days.map((day) => variant === "flow" ? day.amount : day.minutes);
  const total = values.reduce((sum, value) => sum + value, 0);
  const activeDays = days.filter(
    (day, index) => values[index] > 0 && (variant === "flow" || !day.absenceColor)
  ).length;
  const average = activeDays > 0 ? total / activeDays : 0;
  const change = previousMonthTotal === 0
    ? total > 0 ? 100 : 0
    : ((total - previousMonthTotal) / previousMonthTotal) * 100;
  const numberFormatter = new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 2 });
  const currencySymbol = new Intl.NumberFormat(i18n.resolvedLanguage, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol"
  }).formatToParts(0).find((part) => part.type === "currency")?.value ?? currency;
  const selectedMetricDay = days.find((day) => day.selected) ?? null;
  const selectedMetricValue = selectedMetricDay
    ? (variant === "flow" ? selectedMetricDay.amount : selectedMetricDay.minutes)
    : 0;

  return (
    <section
      aria-label={t(variant === "flow" ? "monthlyCharts.flow" : "monthlyCharts.rhythm")}
    >
      <Card className="personal-calendar-monthly-metric overflow-hidden">
        <div className="flex min-h-16 items-center justify-between gap-4 border-b border-white/[0.07] px-5 py-3">
          <div className="min-w-0">
            <p className="text-[0.6rem] font-medium uppercase tracking-[0.12em] text-[#f5f5f5]/34">
              {t(variant === "flow" ? "monthlyCharts.dailyEarningsAverage" : "monthlyCharts.dailyHoursAverage")}
            </p>
            <p className="mt-1 flex items-baseline gap-1.5 font-metric text-lg font-medium tabular-nums text-[#f5f5f5]">
              <span className="text-sm text-[#f5f5f5]/44">
                {variant === "flow" ? currencySymbol : "h"}
              </span>
              <span>{numberFormatter.format(variant === "flow" ? average : average / 60)}</span>
              <span className="text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-[#f5f5f5]/34">
                {t("monthlyCharts.averageShort")}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {selectedMetricDay && selectedMetricValue > 0 ? (
              <div className="text-right">
                <p className="text-[0.55rem] font-medium uppercase tracking-[0.12em] text-[#f5f5f5]/30">
                  {t("monthlyCharts.day", { day: selectedMetricDay.dayNumber })}
                </p>
                <p className="mt-0.5 font-metric text-xs font-medium tabular-nums text-[#34d399]">
                  {variant === "flow"
                    ? `${currencySymbol}${numberFormatter.format(selectedMetricValue)}`
                    : `${numberFormatter.format(selectedMetricValue / 60)} h`}
                </p>
              </div>
            ) : null}
            <div className={cn(
              "flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold tabular-nums",
              change >= 0
                ? "border-[#10b981]/15 bg-[#10b981]/[0.07] text-[#10b981]"
                : "border-red-400/15 bg-red-400/[0.06] text-red-300"
            )}>
              {change >= 0 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
              <span>{new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 1 }).format(Math.abs(change))}%</span>
            </div>
          </div>
        </div>

        <div className="px-2 pb-1 pt-3 sm:px-4">
          <StatisticsTrendGraph
            metric={variant === "flow" ? "GROSS" : "WORKED_MINUTES"}
            currency={variant === "flow" ? currency : null}
            points={days.map((day, index) => ({
              date: day.key,
              label: String(day.dayNumber),
              value: values[index] ?? 0,
              currency: variant === "flow" ? currency : null
            }))}
          />
        </div>
      </Card>
    </section>
  );
}

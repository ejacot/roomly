import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createPortal } from "react-dom";
import { listEmployments, listWorkTypes } from "../../../api/endpoints";
import { queryKeys } from "../../../api/query-keys";
import { SectionHeading } from "../../../components/ui/section-heading";
import { Download, FileText } from "lucide-react";
import { StatisticsLineChart } from "../charts/statistics-line-chart";
import { StatisticsDrilldownPanel } from "../components/statistics-drilldown-panel";
import { StatisticsFilterBar } from "../components/statistics-filter-bar";
import { StatisticsSummaryCards } from "../components/statistics-summary";
import {
  StatisticsForecastSection,
  StatisticsHighlightsSection,
  StatisticsInsightsSection,
  StatisticsProductivitySection
} from "../components/statistics-v2b-sections";
import {
  StatisticsEmptyState,
  StatisticsErrorState,
  StatisticsSkeleton
} from "../components/statistics-states";
import { WorkTypeBreakdown } from "../components/work-type-breakdown";
import {
  createDefaultStatisticsFilters
} from "../filters/statistics-filter-state";
import { useStatistics } from "../hooks/use-statistics";
import type {
  ProductivityGrouping,
  ProductivityMetric,
  StatisticsFilters,
  StatisticsMetric,
  StatisticsPeriod,
  StatisticsTimeSeriesPoint
} from "../types/statistics";

function parseFilters(searchParams: URLSearchParams): StatisticsFilters {
  const defaults = createDefaultStatisticsFilters();
  const period = searchParams.get("period") as StatisticsPeriod | null;
  const metric = searchParams.get("metric") as StatisticsMetric | null;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const parsed: StatisticsFilters = {
    ...defaults,
    period:
      period && ["today", "week", "month", "year", "custom"].includes(period)
        ? period
        : defaults.period,
    metric:
      metric &&
      ["GROSS", "WORKED_MINUTES", "WORKED_HOURS", "WORKED_DAYS", "ENTRIES"].includes(metric)
        ? metric
        : defaults.metric,
    workTypeIds: searchParams.getAll("workTypeIds").filter(Boolean).sort(),
    calculationMethods: searchParams
      .getAll("calculationMethods")
      .filter(
        (value): value is "TIME_BASED" | "UNIT_BASED" =>
          value === "TIME_BASED" || value === "UNIT_BASED"
      )
      .sort()
  };

  if (from && to && to >= from) {
    return { ...parsed, from, to };
  }

  return parsed;
}

function parseProductivityMetric(searchParams: URLSearchParams): ProductivityMetric {
  const value = searchParams.get("productivityMetric");
  return value &&
    ["TOTAL_UNITS", "CONFIGURED_UNITS_PER_HOUR", "EQUIVALENT_MINUTES"].includes(value)
    ? (value as ProductivityMetric)
    : "TOTAL_UNITS";
}

function parseProductivityGrouping(searchParams: URLSearchParams): ProductivityGrouping {
  const value = searchParams.get("productivityGrouping");
  return value && ["TOTAL", "DAILY", "WEEKLY", "MONTHLY"].includes(value)
    ? (value as ProductivityGrouping)
    : "TOTAL";
}

function writeFilters(
  filters: StatisticsFilters,
  productivityMetric: ProductivityMetric,
  productivityGrouping: ProductivityGrouping,
  currentParams: URLSearchParams
) {
  const params = new URLSearchParams(currentParams);
  params.set("period", filters.period);
  params.set("from", filters.from);
  params.set("to", filters.to);
  params.set("metric", filters.metric);
  params.set("productivityMetric", productivityMetric);
  params.set("productivityGrouping", productivityGrouping);
  params.delete("heatmapMetric");
  params.delete("heatmapCurrency");
  params.delete("workTypeIds");
  params.delete("calculationMethods");

  for (const workTypeId of filters.workTypeIds) {
    params.append("workTypeIds", workTypeId);
  }

  for (const method of filters.calculationMethods) {
    params.append("calculationMethods", method);
  }

  return params;
}

function latestSearchParams(fallback: URLSearchParams) {
  return typeof window === "undefined" ? fallback : new URLSearchParams(window.location.search);
}

export function StatisticsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation("common");
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFiltersState] = useState(() => parseFilters(searchParams));
  const [productivityMetric, setProductivityMetricState] = useState(() =>
    parseProductivityMetric(searchParams)
  );
  const [productivityGrouping, setProductivityGroupingState] = useState(() =>
    parseProductivityGrouping(searchParams)
  );
  const [selectedChartPoint, setSelectedChartPoint] =
    useState<StatisticsTimeSeriesPoint | null>(null);
  const [comparisonPeriodB, setComparisonPeriodB] =
    useState<{ from: string; to: string } | null>(null);
  const [employmentIds, setEmploymentIds] = useState<string[]>([]);
  const workTypes = useQuery({
    queryKey: queryKeys.workTypes.all(),
    queryFn: listWorkTypes
  });
  const employments = useQuery({
    queryKey: queryKeys.employments.all(),
    queryFn: listEmployments
  });
  const effectiveFilters = useMemo(() => {
    if (employmentIds.length === 0) return filters;
    const allowed = (workTypes.data ?? [])
      .filter((workType) => workType.employmentId && employmentIds.includes(workType.employmentId))
      .map((workType) => workType.id);
    return {
      ...filters,
      workTypeIds: filters.workTypeIds.length > 0
        ? filters.workTypeIds.filter((id) => allowed.includes(id))
        : allowed
    };
  }, [employmentIds, filters, workTypes.data]);
  const statistics = useStatistics(
    effectiveFilters,
    productivityMetric,
    productivityGrouping,
    comparisonPeriodB
  );

  useEffect(() => {
    setFiltersState(parseFilters(searchParams));
    setProductivityMetricState(parseProductivityMetric(searchParams));
    setProductivityGroupingState(parseProductivityGrouping(searchParams));
  }, [searchParams]);

  function setFilters(next: StatisticsFilters) {
    setFiltersState(next);
    setSearchParams(
      writeFilters(
        next,
        productivityMetric,
        productivityGrouping,
        latestSearchParams(searchParams)
      ),
      { replace: false }
    );
    setSelectedChartPoint(null);
    setComparisonPeriodB(null);
  }

  function setProductivityOptions(
    metric: ProductivityMetric,
    grouping: ProductivityGrouping
  ) {
    setProductivityMetricState(metric);
    setProductivityGroupingState(grouping);
    setSearchParams(
      writeFilters(
        filters,
        metric,
        grouping,
        latestSearchParams(searchParams)
      ),
      { replace: false }
    );
  }

  if (statistics.isLoading) {
    return <StatisticsSkeleton />;
  }

  const overview = statistics.overview.data;
  const timeSeries = statistics.timeSeries.data;
  const breakdown = statistics.workTypes.data ?? [];
  const hasEntries = Boolean(overview && overview.entries > 0);
  const showForecast = statistics.forecast.isLoading
    || statistics.forecast.isError
    || Boolean(statistics.forecast.data?.forecasts.some((item) => item.available));
  const showProductivity = statistics.productivity.isLoading
    || statistics.productivity.isError
    || Boolean(statistics.productivity.data?.available);
  const headerActionsTarget = typeof document === "undefined"
    ? null
    : document.getElementById("personal-workspace-header-actions");
  const exportActions = (
    <>
      <button type="button" disabled={!overview} onClick={() => overview && exportStatisticsCsv(overview, timeSeries?.points ?? [], breakdown)} className="personal-workspace__header-action disabled:opacity-35" aria-label={t("statistics.export.csv")}>
        <Download aria-hidden="true" />
      </button>
      <button type="button" disabled={!overview} onClick={() => overview && navigate(`/settings/export-pdf?from=${filters.from}&to=${filters.to}&returnTo=/statistics`)} className="personal-workspace__header-action disabled:opacity-35" aria-label={t("statistics.export.pdf")}>
        <FileText aria-hidden="true" />
      </button>
    </>
  );

  return (
    <>
      {headerActionsTarget ? createPortal(exportActions, headerActionsTarget) : null}
      <div className="personal-statistics-page statistics-workspace space-y-6 pb-8">
      <div className="sticky-header-blur -mx-1 flex items-end justify-between gap-3 px-1 pb-3 pt-1">
        <SectionHeading eyebrow={t("statistics.eyebrow")} title={t("statistics.title")} />
        {!headerActionsTarget ? <div className="mb-1 flex gap-2">{exportActions}</div> : null}
      </div>
      <StatisticsFilterBar
        filters={filters}
        workTypes={workTypes.data ?? []}
        employments={(employments.data ?? []).filter((employment) => employment.active)}
        employmentIds={employmentIds}
        onEmploymentsChange={setEmploymentIds}
        onChange={setFilters}
      />
      {statistics.isError || !overview ? (
        <StatisticsErrorState onRetry={statistics.refetch} />
      ) : !hasEntries ? (
        <StatisticsEmptyState />
      ) : (
        <>
          <StatisticsLineChart
            points={timeSeries?.points ?? []}
            comparison={statistics.comparison?.data}
            metric={timeSeries?.metric ?? filters.metric}
            granularity={timeSeries?.granularity ?? "DAILY"}
            onPointSelect={setSelectedChartPoint}
            comparisonPeriod={filters.period}
            comparisonPeriodB={comparisonPeriodB}
            onComparisonPeriodBChange={setComparisonPeriodB}
          />
          <StatisticsDrilldownPanel
            filters={filters}
            point={selectedChartPoint}
            onClose={() => setSelectedChartPoint(null)}
          />

          <StatisticsSummaryCards overview={overview} />

          <div className={`grid items-start gap-4 ${showForecast ? "lg:grid-cols-2" : ""}`}>
            <StatisticsInsightsSection
              data={statistics.insights.data}
              isLoading={statistics.insights.isLoading}
              isError={statistics.insights.isError}
              onRetry={() => void statistics.insights.refetch()}
            />
            {showForecast ? (
              <StatisticsForecastSection
                data={statistics.forecast.data}
                isLoading={statistics.forecast.isLoading}
                isError={statistics.forecast.isError}
                onRetry={() => void statistics.forecast.refetch()}
              />
            ) : null}
          </div>

          <div className={`grid items-start gap-4 ${showProductivity ? "lg:grid-cols-2" : ""}`}>
            <WorkTypeBreakdown items={breakdown} />
            {showProductivity ? (
              <StatisticsProductivitySection
                data={statistics.productivity.data}
                isLoading={statistics.productivity.isLoading}
                isError={statistics.productivity.isError}
                onRetry={() => void statistics.productivity.refetch()}
                metric={productivityMetric}
                grouping={productivityGrouping}
                onOptionsChange={setProductivityOptions}
              />
            ) : null}
          </div>

          <StatisticsHighlightsSection
            data={statistics.highlights.data}
            isLoading={statistics.highlights.isLoading}
            isError={statistics.highlights.isError}
            onRetry={() => void statistics.highlights.refetch()}
          />
        </>
      )}
      </div>
    </>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportStatisticsCsv(
  overview: NonNullable<ReturnType<typeof useStatistics>["overview"]["data"]>,
  points: StatisticsTimeSeriesPoint[],
  breakdown: ReturnType<typeof useStatistics>["workTypes"]["data"]
) {
  const rows = [
    ["section", "label", "value", "currency"],
    ...overview.grossByCurrency.map((item) => ["summary", "gross", item.amount, item.currency]),
    ["summary", "worked_minutes", overview.workedMinutes, ""],
    ["summary", "worked_days", String(overview.workedDays), ""],
    ...points.map((point) => ["trend", `${point.bucketStart}/${point.bucketEnd}`, point.value, point.currency ?? ""]),
    ...(breakdown ?? []).flatMap((item) => item.grossByCurrency.length
      ? item.grossByCurrency.map((gross) => ["work_type", item.name, gross.amount, gross.currency])
      : [["work_type", item.name, item.minutes, "minutes"]])
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "alveryn-statistics.csv");
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate, useOutletContext } from "react-router-dom";
import { createPortal } from "react-dom";
import { ChevronDown, FileCheck2, FileText, Pencil, ShieldCheck, Upload } from "lucide-react";
import {
  getCalendarActivityRange,
  getPayrollReconciliation,
  getPayrollReconciliationDocument,
  getPreferences,
  getScheduledShifts,
  getWeeklySchedule,
  listAbsenceTypes,
  listAbsencesInRange,
  listEmployments,
  listHourlyRates,
  listRestDays,
  listWorkRecordsInRange,
  markRestDay,
  removeRestDay,
  reconcileMonthlyPayroll,
  savePayrollReconciliation,
  uploadPayrollReconciliationDocument,
  type PayrollReconciliation
} from "../api/endpoints";
import { getApiError } from "../api/api-errors";
import { queryKeys } from "../api/query-keys";
import { CalendarErrorState } from "../components/calendar/calendar-error-state";
import { CalendarMonthGrid } from "../components/calendar/calendar-month-grid";
import { CalendarMonthSummary } from "../components/calendar/calendar-month-summary";
import {
  CalendarMonthlyMetricCard,
  type CalendarMonthlyMetricDay
} from "../components/calendar/calendar-monthly-metric-card";
import { CalendarSelectedDayPanel } from "../components/calendar/calendar-selected-day-panel";
import { CalendarSkeleton } from "../components/calendar/calendar-skeleton";
import {
  addDays,
  absenceOverlapsDate,
  buildMonthGrid,
  formatMonthLabel,
  formatSelectedDate,
  getNextMonthDate,
  getPreviousMonthDate,
  isSameMonth,
  resolveMonthSwipeDirection,
  startOfMonth,
  toIsoDate
} from "../features/calendar/calendar-utils";
import type { Absence, AbsenceTypeSetting } from "../types/absence";
import type { WorkRecord } from "../types/work-record";
import type { EmploymentRestDay } from "../types/rest-day";
import { parseLocalIsoDate } from "../utils/date";
import { formatCurrency, formatMinutesAsDuration } from "../utils/format";
import { calculatePaidAbsenceDays, type PaidAbsenceDay } from "../utils/paid-absence";
import { useEmploymentScope } from "../features/employment/employment-scope";

const EMPTY_ABSENCES: Absence[] = [];
const EMPTY_WORK_RECORDS: WorkRecord[] = [];
const EMPTY_ABSENCE_TYPES: AbsenceTypeSetting[] = [];
const GENERIC_EXTRA_PAY_KEY = "__extra_pay__";

type OutletContext = {
  setSelectedDate?: (date: Date) => void;
};

export function CalendarPage() {
  const navigate = useNavigate();
  const outletContext = useOutletContext<OutletContext>();
  const { t } = useTranslation(["calendar", "settings"]);
  const localizedAbsenceName = useCallback((code: AbsenceTypeSetting["code"], fallback: string) => {
    if (code === "SICK_LEAVE") return t("legend.sick");
    if (code === "VACATION") return t("legend.vacation");
    if (code === "DAY_OFF") return t("legend.dayOff");
    return fallback;
  }, [t]);
  const queryClient = useQueryClient();
  const selectedEmploymentId = useEmploymentScope();
  const today = useMemo(() => new Date(), []);
  const [activeMonth, setActiveMonth] = useState(() => startOfMonth(today));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [slideDirection, setSlideDirection] = useState(0);
  const [compactTitleVisible, setCompactTitleVisible] = useState(false);
  const largeTitleRef = useRef<HTMLHeadingElement>(null);
  const payrollInputRef = useRef<HTMLInputElement>(null);
  const [payrollReview, setPayrollReview] = useState<PayrollReconciliation | null>(null);
  const [payrollPending, setPayrollPending] = useState(false);
  const [payrollError, setPayrollError] = useState<string | null>(null);
  const [payrollSaving, setPayrollSaving] = useState(false);
  const [payrollSaved, setPayrollSaved] = useState(false);
  const [payrollExpanded, setPayrollExpanded] = useState(false);
  const [payrollEditing, setPayrollEditing] = useState(false);
  const [payrollDocument, setPayrollDocument] = useState<File | null>(null);
  const [payrollReconciliationId, setPayrollReconciliationId] = useState<string | null>(null);
  const [payrollDocumentAvailable, setPayrollDocumentAvailable] = useState(false);
  const [payrollDocumentOpening, setPayrollDocumentOpening] = useState(false);
  const [monthlyView, setMonthlyView] = useState<"flow" | "rhythm">("flow");

  const year = activeMonth.getFullYear();
  const month = activeMonth.getMonth() + 1;
  const updatePayrollNumber = (field: keyof PayrollReconciliation, raw: string) => {
    const value = raw.trim() === "" ? null : Number(raw.replace(",", "."));
    if (value != null && !Number.isFinite(value)) return;
    setPayrollReview((current) => current ? { ...current, [field]: value } : current);
    setPayrollSaved(false);
  };

  const monthStartKey = toIsoDate(startOfMonth(activeMonth));
  const monthEndKey = toIsoDate(addDays(getNextMonthDate(activeMonth), -1));
  const employmentsQuery = useQuery({
    queryKey: queryKeys.employments.all(),
    queryFn: listEmployments
  });
  const activeEmployments = (employmentsQuery.data ?? []).filter((employment) => employment.active);
  const effectiveEmploymentId =
    selectedEmploymentId ?? (activeEmployments.length === 1 ? activeEmployments[0].id : null);

  useEffect(() => {
    setPayrollReview(null);
    setPayrollError(null);
    setPayrollSaved(false);
    setPayrollExpanded(false);
    setPayrollDocument(null);
    setPayrollReconciliationId(null);
    setPayrollDocumentAvailable(false);
  }, [effectiveEmploymentId, year, month]);

  const savedPayrollQuery = useQuery({
    queryKey: ["payroll-reconciliation", effectiveEmploymentId ?? "none", year, month],
    queryFn: () => getPayrollReconciliation(effectiveEmploymentId!, year, month),
    enabled: Boolean(effectiveEmploymentId)
  });

  useEffect(() => {
    const saved = savedPayrollQuery.data;
    if (!saved || payrollReview) return;
    setPayrollReview({
      filename: saved.filename ?? undefined,
      year: saved.year,
      month: saved.month,
      normalHours: saved.payrollWorkedHours,
      absenceHours: saved.payrollAbsenceHours,
      extraHours: saved.payrollExtraHours,
      grossAmount: saved.payrollGross,
      payrollLines: saved.payrollLines,
      status: saved.status
    });
    setPayrollSaved(true);
    setPayrollReconciliationId(saved.id);
    setPayrollDocumentAvailable(saved.documentAvailable);
    setPayrollExpanded(false);
  }, [payrollReview, savedPayrollQuery.data]);

  const workRecordsQuery = useQuery({
    queryKey: queryKeys.workRecords.range({ from: monthStartKey, to: monthEndKey }),
    queryFn: () => listWorkRecordsInRange({ from: monthStartKey, to: monthEndKey })
  });
  const previousMonth = getPreviousMonthDate(activeMonth);
  const previousMonthStartKey = toIsoDate(startOfMonth(previousMonth));
  const previousMonthEndKey = toIsoDate(addDays(getNextMonthDate(previousMonth), -1));
  const previousWorkRecordsQuery = useQuery({
    queryKey: queryKeys.workRecords.range({ from: previousMonthStartKey, to: previousMonthEndKey }),
    queryFn: () => listWorkRecordsInRange({ from: previousMonthStartKey, to: previousMonthEndKey }),
    enabled: workRecordsQuery.isSuccess
  });

  const absencesQuery = useQuery({
    queryKey: queryKeys.absences.range({ year, month }),
    queryFn: () => listAbsencesInRange({ year, month })
  });
  const absenceTypesQuery = useQuery({
    queryKey: queryKeys.absenceTypes.list(false),
    queryFn: () => listAbsenceTypes(false)
  });
  const previousAbsencesQuery = useQuery({
    queryKey: queryKeys.absences.range({
      year: previousMonth.getFullYear(),
      month: previousMonth.getMonth() + 1
    }),
    queryFn: () => listAbsencesInRange({
      year: previousMonth.getFullYear(),
      month: previousMonth.getMonth() + 1
    }),
    enabled: workRecordsQuery.isSuccess && absencesQuery.isSuccess
  });

  const activityRangeQuery = useQuery({
    queryKey: queryKeys.calendar.activityRange(),
    queryFn: getCalendarActivityRange
  });
  const preferencesQuery = useQuery({
    queryKey: queryKeys.preferences(),
    queryFn: getPreferences
  });
  const hourlyRatesQuery = useQuery({
    queryKey: queryKeys.hourlyRates.all(),
    queryFn: listHourlyRates
  });
  const restDaysQuery = useQuery({
    queryKey: queryKeys.restDays.range(effectiveEmploymentId ?? "none", monthStartKey, monthEndKey),
    queryFn: () => listRestDays(effectiveEmploymentId!, monthStartKey, monthEndKey),
    enabled: Boolean(effectiveEmploymentId)
  });
  const scheduleQuery = useQuery({
    queryKey: queryKeys.schedules.employment(effectiveEmploymentId ?? "none"),
    queryFn: () => getWeeklySchedule(effectiveEmploymentId!),
    enabled: Boolean(effectiveEmploymentId)
  });
  const scheduledShiftsQuery = useQuery({
    queryKey: queryKeys.schedules.shifts(
      effectiveEmploymentId ?? "none",
      monthStartKey,
      monthEndKey
    ),
    queryFn: () => getScheduledShifts(effectiveEmploymentId!, monthStartKey, monthEndKey),
    enabled: Boolean(effectiveEmploymentId && scheduleQuery.data)
  });
  const markRestDayMutation = useMutation({
    mutationFn: (date: string) => markRestDay(effectiveEmploymentId!, date),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.restDays.range(
          effectiveEmploymentId ?? "none",
          monthStartKey,
          monthEndKey
        )
      });
    }
  });
  const removeRestDayMutation = useMutation({
    mutationFn: (date: string) => removeRestDay(effectiveEmploymentId!, date),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.restDays.range(
          effectiveEmploymentId ?? "none",
          monthStartKey,
          monthEndKey
        )
      });
    }
  });
  useEffect(() => {
    if (!workRecordsQuery.isSuccess || !absencesQuery.isSuccess) return;
    const nextMonth = getNextMonthDate(activeMonth);
    const nextMonthStartKey = toIsoDate(startOfMonth(nextMonth));
    const nextMonthEndKey = toIsoDate(addDays(getNextMonthDate(nextMonth), -1));
    const timer = window.setTimeout(() => {
      void queryClient.prefetchQuery({
        queryKey: queryKeys.workRecords.range({ from: nextMonthStartKey, to: nextMonthEndKey }),
        queryFn: () => listWorkRecordsInRange({ from: nextMonthStartKey, to: nextMonthEndKey })
      });
      void queryClient.prefetchQuery({
        queryKey: queryKeys.absences.range({
          year: nextMonth.getFullYear(),
          month: nextMonth.getMonth() + 1
        }),
        queryFn: () => listAbsencesInRange({ year: nextMonth.getFullYear(), month: nextMonth.getMonth() + 1 })
      });
    }, 750);
    return () => window.clearTimeout(timer);
  }, [absencesQuery.isSuccess, activeMonth, queryClient, workRecordsQuery.isSuccess]);

  useEffect(() => {
    let frameId = 0;

    const updateCompactTitle = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const titleRect = largeTitleRef.current?.getBoundingClientRect();
        setCompactTitleVisible(Boolean(titleRect && titleRect.top <= 60));
      });
    };

    updateCompactTitle();
    window.addEventListener("scroll", updateCompactTitle, { passive: true });
    window.addEventListener("resize", updateCompactTitle);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", updateCompactTitle);
      window.removeEventListener("resize", updateCompactTitle);
    };
  }, []);

  const isLoading =
    employmentsQuery.isLoading ||
    workRecordsQuery.isLoading ||
    absencesQuery.isLoading ||
    absenceTypesQuery.isLoading ||
    preferencesQuery.isLoading ||
    hourlyRatesQuery.isLoading;
  const classificationLoading = Boolean(effectiveEmploymentId) && (
    restDaysQuery.isLoading ||
    scheduleQuery.isLoading ||
    (Boolean(scheduleQuery.data) && scheduledShiftsQuery.isLoading)
  );
  const error =
    employmentsQuery.error ??
    workRecordsQuery.error ??
    absencesQuery.error ??
    absenceTypesQuery.error ??
    preferencesQuery.error ??
    hourlyRatesQuery.error;
  const classificationError =
    restDaysQuery.error ?? scheduleQuery.error ?? scheduledShiftsQuery.error;
  const records = useMemo(
    () => (workRecordsQuery.data ?? EMPTY_WORK_RECORDS).filter((record) => matchesEmployment(record.employmentId, effectiveEmploymentId)),
    [effectiveEmploymentId, workRecordsQuery.data]
  );
  const absences = useMemo(
    () => (absencesQuery.data ?? EMPTY_ABSENCES).filter((absence) => matchesEmployment(absence.employmentId, effectiveEmploymentId)),
    [absencesQuery.data, effectiveEmploymentId]
  );
  const absenceTypes = absenceTypesQuery.data ?? EMPTY_ABSENCE_TYPES;
  const absenceTypeById = useMemo(
    () => new Map(absenceTypes.map((type) => [type.id, type])),
    [absenceTypes]
  );
  const previousRecords = useMemo(
    () => (previousWorkRecordsQuery.data ?? EMPTY_WORK_RECORDS).filter((record) => matchesEmployment(record.employmentId, effectiveEmploymentId)),
    [effectiveEmploymentId, previousWorkRecordsQuery.data]
  );
  const previousAbsences = useMemo(
    () => (previousAbsencesQuery.data ?? EMPTY_ABSENCES).filter((absence) => matchesEmployment(absence.employmentId, effectiveEmploymentId)),
    [effectiveEmploymentId, previousAbsencesQuery.data]
  );
  const preferences = preferencesQuery.data ?? null;
  const hourlyRates = useMemo(
    () => (hourlyRatesQuery.data ?? []).filter((rate) => matchesEmployment(rate.employmentId, effectiveEmploymentId)),
    [effectiveEmploymentId, hourlyRatesQuery.data]
  );
  const firstActivityDate = activityRangeQuery.data?.firstActivityDate ?? null;
  const todayIso = toIsoDate(today);
  const paidAbsenceDays = useMemo(
    () => calculatePaidAbsenceDays({
      absences,
      activityDates: records.map((record) => record.workDate),
      hourlyRates,
      preferences,
      from: monthStartKey,
      to: monthEndKey
    }),
    [absences, hourlyRates, monthEndKey, monthStartKey, preferences, records]
  );
  const previousPaidAbsenceDays = useMemo(
    () => calculatePaidAbsenceDays({
      absences: previousAbsences,
      activityDates: previousRecords.map((record) => record.workDate),
      hourlyRates,
      preferences,
      from: previousMonthStartKey,
      to: previousMonthEndKey
    }),
    [
      hourlyRates,
      preferences,
      previousAbsences,
      previousMonthEndKey,
      previousMonthStartKey,
      previousRecords
    ]
  );

  const monthlyMetricDays = useMemo(
    () => buildMonthlyMetricDays(activeMonth, records, absences, absenceTypeById, selectedDate, today),
    [absenceTypeById, absences, activeMonth, records, selectedDate, today]
  );
  const monthlyMetricDayByDate = useMemo(
    () => new Map(monthlyMetricDays.map((day) => [day.key, day])),
    [monthlyMetricDays]
  );
  const previousMonthlyMetricDays = useMemo(
    () => buildMonthlyMetricDays(previousMonth, previousRecords, previousAbsences, absenceTypeById, null, today),
    [absenceTypeById, previousAbsences, previousMonth, previousRecords, today]
  );
  const monthlyChartDays = useMemo(
    () => mergePaidAbsenceMetrics(monthlyMetricDays, paidAbsenceDays),
    [monthlyMetricDays, paidAbsenceDays]
  );
  const previousMonthlyChartDays = useMemo(
    () => mergePaidAbsenceMetrics(previousMonthlyMetricDays, previousPaidAbsenceDays),
    [previousMonthlyMetricDays, previousPaidAbsenceDays]
  );
  const monthlyCurrencies = useMemo(
    () => new Set([
      ...records.map((record) => record.currency).filter(Boolean),
      ...paidAbsenceDays.map((day) => day.currency)
    ]),
    [paidAbsenceDays, records]
  );
  const monthlyFlowAvailable = monthlyCurrencies.size <= 1;
  const headerActionsTarget = typeof document === "undefined"
    ? null
    : document.getElementById("personal-workspace-header-actions");
  const headerActions = (
    <>
      <button type="button" onClick={() => navigate("/settings/import-data?returnTo=/calendar")} className="personal-workspace__header-action" aria-label={t("settings:dataImport.menuLabel")}>
        <Upload aria-hidden="true" />
      </button>
      <button type="button" onClick={() => navigate(`/settings/export-pdf?from=${monthStartKey}&to=${monthEndKey}&returnTo=/calendar`)} className="personal-workspace__header-action" aria-label={t("settings:pdfExport.menuLabel")}>
        <FileText aria-hidden="true" />
      </button>
    </>
  );

  useEffect(() => {
    if (!monthlyFlowAvailable) setMonthlyView("rhythm");
  }, [monthlyFlowAvailable]);

  const monthGrid = useMemo(() => buildMonthGrid(activeMonth), [activeMonth]);

  const recordsByDate = useMemo(() => {
    const grouped = new Map<string, WorkRecord[]>();
    records.forEach((record) => {
      const bucket = grouped.get(record.workDate) ?? [];
      bucket.push(record);
      grouped.set(record.workDate, bucket);
    });
    return grouped;
  }, [records]);

  const absenceByDate = useMemo(() => {
    const grouped = new Map<string, Absence>();
    monthGrid.forEach((day) => {
      const found = absences.find((absence) => absenceOverlapsDate(absence, day.date));
      if (found) {
        grouped.set(day.key, found);
      }
    });
    return grouped;
  }, [absences, monthGrid]);

  const manualRestDayByDate = useMemo(
    () => new Map((restDaysQuery.data ?? []).map((restDay) => [restDay.date, restDay])),
    [restDaysQuery.data]
  );
  const scheduledDates = useMemo(
    () => new Set((scheduledShiftsQuery.data ?? []).map((shift) => shift.startsAt.slice(0, 10))),
    [scheduledShiftsQuery.data]
  );
  const automaticRestDates = useMemo(() => {
    const schedule = scheduleQuery.data;
    if (!schedule) return new Set<string>();

    return new Set(
      monthGrid
        .filter((day) => {
          if (!day.inActiveMonth || day.key > todayIso) return false;
          if (day.key < schedule.validFrom || (schedule.validTo && day.key > schedule.validTo)) {
            return false;
          }
          return (
            !scheduledDates.has(day.key) &&
            !recordsByDate.has(day.key) &&
            !absenceByDate.has(day.key)
          );
        })
        .map((day) => day.key)
    );
  }, [absenceByDate, monthGrid, recordsByDate, scheduleQuery.data, scheduledDates, todayIso]);
  const restDates = useMemo(
    () => new Set([...manualRestDayByDate.keys(), ...automaticRestDates]),
    [automaticRestDates, manualRestDayByDate]
  );
  const missingDates = useMemo(() => {
    if (!scheduleQuery.data) return new Set<string>();
    return new Set(
      [...scheduledDates].filter(
        (date) =>
          date <= todayIso &&
          date >= monthStartKey &&
          date <= monthEndKey &&
          !recordsByDate.has(date) &&
          !absenceByDate.has(date) &&
          !restDates.has(date)
      )
    );
  }, [
    absenceByDate,
    monthEndKey,
    monthStartKey,
    recordsByDate,
    restDates,
    scheduleQuery.data,
    scheduledDates,
    todayIso
  ]);

  useEffect(() => {
    if (selectedDate !== null && !isSameMonth(selectedDate, activeMonth)) {
      setSelectedDate(null);
    }
  }, [activeMonth, selectedDate]);

  const selectedRecords = selectedDate ? recordsByDate.get(toIsoDate(selectedDate)) ?? EMPTY_WORK_RECORDS : EMPTY_WORK_RECORDS;

  const selectedAbsence = useMemo(
    () => (selectedDate ? absenceByDate.get(toIsoDate(selectedDate)) ?? null : null),
    [absenceByDate, selectedDate]
  );
  const selectedDateKey = selectedDate ? toIsoDate(selectedDate) : null;
  const selectedManualRestDay: EmploymentRestDay | null = selectedDateKey
    ? manualRestDayByDate.get(selectedDateKey) ?? null
    : null;
  const selectedAutomaticRestDay = Boolean(
    selectedDateKey && automaticRestDates.has(selectedDateKey)
  );

  const selectedPaidAbsenceMinutes = useMemo(() => {
    if (!selectedDate || !selectedAbsence) {
      return 0;
    }

    const selectedDateKey = toIsoDate(selectedDate);
    return calculatePaidAbsenceDays({
      absences: [selectedAbsence],
      activityDates: selectedRecords.map((record) => record.workDate),
      hourlyRates,
      preferences,
      from: selectedDateKey,
      to: selectedDateKey
    }).reduce((total, absence) => total + absence.minutes, 0);
  }, [hourlyRates, preferences, selectedAbsence, selectedDate, selectedRecords]);

  const summary = useMemo(() => {
    const paidAbsences = paidAbsenceDays;
    const workedMinutes = monthlyMetricDays.reduce((total, day) => total + day.minutes, 0);
    const workGrossAmount = monthlyMetricDays.reduce((total, day) => total + day.amount, 0);
    const paidAbsenceMinutes = paidAbsences.reduce((total, absence) => total + absence.minutes, 0);
    const paidAbsenceGrossAmount = paidAbsences.reduce((total, absence) => total + absence.grossAmount, 0);
    const extraPaid = calculateExtraPaidInRange(records, absences, monthStartKey, monthEndKey);
    const workedDateKeys = new Set(
      monthlyMetricDays
        .filter((day) => day.minutes > 0 || day.amount > 0)
        .map((day) => day.key)
    );
    const absenceDateKeys = new Set(
      monthGrid
        .filter((day) =>
          day.inActiveMonth &&
          absenceByDate.has(day.key) &&
          !workedDateKeys.has(day.key)
        )
        .map((day) => day.key)
    );
    const absenceDays = absenceDateKeys.size;
    const workedDays = workedDateKeys.size;
    const classifiableDates = monthGrid
      .filter((day) => day.inActiveMonth && day.key <= todayIso)
      .map((day) => day.key);
    const classifiedDates = new Set(
      classifiableDates.filter(
        (date) =>
          recordsByDate.has(date) ||
          absenceByDate.has(date) ||
          restDates.has(date)
      )
    );
    const currencies = new Set([
      ...records.map((record) => record.currency).filter(Boolean)
    ]);
    const currency = records[0]?.currency ?? paidAbsences[0]?.currency ?? "EUR";
    const paidAbsenceCurrencies = new Set(
      paidAbsences.map((absence) => absence.currency)
    );
    const totalCurrencies = new Set([...currencies, ...paidAbsenceCurrencies]);
    const absenceGroups = new Map<string, {
      label: string;
      minutes: number;
      grossAmount: number;
      currencies: Set<string>;
    }>();
    paidAbsences.forEach((absence) => {
      const key = absence.absenceTypeId ?? absence.absenceType;
      const current = absenceGroups.get(key) ?? {
        label: localizedAbsenceName(absence.absenceType, absence.absenceTypeName),
        minutes: 0,
        grossAmount: 0,
        currencies: new Set<string>()
      };
      current.minutes += absence.minutes;
      current.grossAmount += absence.grossAmount;
      current.currencies.add(absence.currency);
      absenceGroups.set(key, current);
    });
    const absenceBreakdown = Array.from(absenceGroups.entries())
      .filter(([, item]) => item.minutes > 0 || item.grossAmount > 0)
      .sort(([, left], [, right]) => right.minutes - left.minutes)
      .map(([id, item]) => ({
        id,
        label: item.label,
        hours: formatMinutesAsDuration(item.minutes),
        amount: item.currencies.size > 1
          ? t("monthlySummary.mixedCurrencies")
          : formatCurrency(String(item.grossAmount), [...item.currencies][0] ?? currency)
      }));
    const extraPayBreakdown = extraPaid.items
      .filter((item) => item.minutes > 0 || item.grossAmount > 0)
      .sort((left, right) => right.minutes - left.minutes)
      .map((item) => ({
        id: item.name,
        label: item.name === GENERIC_EXTRA_PAY_KEY ? t("monthlySummary.extraPay") : item.name,
        hours: formatMinutesAsDuration(item.minutes),
        amount: currencies.size > 1
          ? t("monthlySummary.mixedCurrencies")
          : formatCurrency(String(item.grossAmount), currency)
      }));
    return {
      workedHours: formatMinutesAsDuration(workedMinutes),
      paidAbsenceHours: formatMinutesAsDuration(paidAbsenceMinutes),
      extraPaidHours: formatMinutesAsDuration(extraPaid.minutes),
      workGrossAmount: totalCurrencies.size > 1
        ? t("monthlySummary.mixedCurrencies")
        : formatCurrency(String(workGrossAmount + paidAbsenceGrossAmount), currency),
      paidAbsenceGrossAmount: paidAbsenceCurrencies.size > 1
        ? t("monthlySummary.mixedCurrencies")
        : formatCurrency(String(paidAbsenceGrossAmount), paidAbsences[0]?.currency ?? currency),
      extraPaidGrossAmount: currencies.size > 1
        ? t("monthlySummary.mixedCurrencies")
        : formatCurrency(String(extraPaid.grossAmount), currency),
      paidAbsenceGrossAmountValue: paidAbsenceGrossAmount,
      extraPaidGrossAmountValue: extraPaid.grossAmount,
      workedHoursValue: workedMinutes / 60,
      paidAbsenceHoursValue: paidAbsenceMinutes / 60,
      extraPaidHoursValue: extraPaid.minutes / 60,
      grossAmountValue: workGrossAmount + paidAbsenceGrossAmount,
      absenceBreakdown,
      extraPayBreakdown,
      workedDays,
      absenceDays,
      restDays: classifiableDates.filter((date) => restDates.has(date)).length,
      missingDays: classifiableDates.filter((date) => missingDates.has(date)).length,
      classifiedDays: classifiedDates.size,
      totalDays: classifiableDates.length
    };
  }, [
    absenceByDate,
    absences,
    missingDates,
    monthEndKey,
    monthGrid,
    monthlyMetricDays,
    monthStartKey,
    paidAbsenceDays,
    localizedAbsenceName,
    records,
    recordsByDate,
    restDates,
    t,
    todayIso
  ]);
  const payrollComparison = useMemo(
    () => payrollReview
      ? buildPayrollComparison(payrollReview, {
          workedHours: summary.workedHoursValue,
          absenceHours: summary.paidAbsenceHoursValue,
          absenceAmount: summary.paidAbsenceGrossAmountValue,
          extraHours: summary.extraPaidHoursValue,
          extraAmount: summary.extraPaidGrossAmountValue,
          gross: summary.grossAmountValue
        })
      : null,
    [payrollReview, summary]
  );

  function changeMonth(direction: -1 | 1) {
    const nextMonth = direction === -1 ? getPreviousMonthDate(activeMonth) : getNextMonthDate(activeMonth);
    setSlideDirection(direction);
    setActiveMonth(nextMonth);
    setSelectedDate(null);
  }

  if (isLoading || classificationLoading) {
    return <CalendarSkeleton />;
  }

  if (error || classificationError) {
    return (
      <CalendarErrorState
        message={getApiError(error ?? classificationError).message}
        onRetry={() => {
          void workRecordsQuery.refetch();
          void employmentsQuery.refetch();
          void previousWorkRecordsQuery.refetch();
          void absencesQuery.refetch();
          void previousAbsencesQuery.refetch();
          void preferencesQuery.refetch();
          void hourlyRatesQuery.refetch();
          void restDaysQuery.refetch();
          void scheduleQuery.refetch();
          void scheduledShiftsQuery.refetch();
        }}
      />
    );
  }

  return (
    <>
      {headerActionsTarget ? createPortal(headerActions, headerActionsTarget) : null}
      <div className="personal-calendar-page mx-auto flex w-full max-w-[560px] flex-col gap-6 pb-28 pt-8">
      <header className={`settings-sticky-header dashboard-sticky-header calendar-sticky-header pointer-events-none fixed inset-x-0 top-0 z-40 mx-auto w-full max-w-[560px] transition-opacity duration-200 ${
        compactTitleVisible ? "opacity-100" : "opacity-0"
      }`}>
        <div
          className={`settings-sticky-header-title absolute left-1/2 flex h-9 -translate-x-1/2 items-center text-[1rem] font-bold leading-none tracking-[-0.035em] text-white transition duration-300 ${
            compactTitleVisible ? "translate-y-0 opacity-100 delay-100" : "translate-y-1 opacity-0"
          }`}
          aria-hidden="true"
        >
          {t("title")}
        </div>
      </header>

      <h1
        ref={largeTitleRef}
        className={`personal-calendar-page__heading order-0 text-3xl font-semibold leading-none tracking-[-0.07em] text-[#f5f5f5] transition duration-200 ${
          compactTitleVisible ? "-translate-y-1 opacity-0" : "translate-y-0 opacity-100 delay-75"
        }`}
      >
        {t("title")}
      </h1>

      <div className="order-3">
        <CalendarMonthSummary {...summary} />
      </div>

      <section className="order-1">
        <CalendarMonthGrid
          monthLabel={formatMonthLabel(activeMonth)}
          monthKey={`${year}-${month}`}
          slideDirection={slideDirection}
          days={monthGrid}
          selectedDate={selectedDate}
          today={today}
          absenceTypes={absenceTypes.filter((type) => type.active).map((type) => ({
            ...type,
            name: localizedAbsenceName(type.code, type.name)
          }))}
          getDayMeta={(isoDate) => {
            const dayRecords = recordsByDate.get(isoDate) ?? [];
            const recordsCount = dayRecords.length;
            const metricDay = monthlyMetricDayByDate.get(isoDate);
            const inTrackedRange = isInTrackedRange(isoDate, firstActivityDate, todayIso);
            const absence = absenceByDate.get(isoDate) ?? null;
            const configuredType = absence?.absenceTypeId
              ? absenceTypeById.get(absence.absenceTypeId)
              : null;
            const marker = absence
              ? {
                  label: localizedAbsenceName(
                    configuredType?.code ?? absence.absenceType,
                    configuredType?.name || absence.absenceTypeName
                  ),
                  color: configuredType?.color || defaultAbsenceColor(absence.absenceType)
                }
              : restDates.has(isoDate)
                ? { label: t("restDay.title"), color: "#737373" }
                : null;
            return {
              entriesCount: recordsCount,
              marker,
              activityLabel: recordsCount > 0
                ? formatCalendarActivity(dayRecords, metricDay?.minutes ?? 0)
                : null,
              earningsLabel: recordsCount > 0 && (metricDay?.amount ?? 0) > 0
                ? formatCompactCalendarAmount(
                    metricDay?.amount ?? 0,
                    records[0]?.currency ?? preferences?.currency ?? "EUR"
                  )
                : null,
              intensity: Math.min((metricDay?.minutes ?? 0) / 600, 1),
              noActivityInTrackedRange:
                missingDates.has(isoDate) ||
                (inTrackedRange && recordsCount === 0 && !marker && !scheduleQuery.data)
            };
          }}
          onSelect={(date) => {
            setSelectedDate(date);
            outletContext?.setSelectedDate?.(date);
            if (!isSameMonth(date, activeMonth)) {
              setActiveMonth(startOfMonth(date));
            }
          }}
          onSwipeChange={changeMonth}
          onResolveSwipe={resolveMonthSwipeDirection}
        />
      </section>

      {selectedDate ? (
        <div className="order-2 pt-1">
          <CalendarSelectedDayPanel
            title={formatSelectedDate(selectedDate)}
            records={selectedRecords}
            absence={selectedAbsence}
            absenceColor={selectedAbsence?.absenceTypeId
              ? absenceTypeById.get(selectedAbsence.absenceTypeId)?.color
              : undefined}
            paidAbsenceMinutes={selectedPaidAbsenceMinutes}
            restDay={Boolean(
              selectedDateKey &&
              (selectedManualRestDay || selectedAutomaticRestDay)
            )}
            automaticRestDay={selectedAutomaticRestDay && !selectedManualRestDay}
            restDayPending={
              markRestDayMutation.isPending || removeRestDayMutation.isPending
            }
            onMarkRestDay={
              effectiveEmploymentId && !selectedRecords.length && !selectedAbsence && selectedDateKey
                ? () => markRestDayMutation.mutate(selectedDateKey)
                : undefined
            }
            onRemoveRestDay={
              selectedManualRestDay && selectedDateKey
                ? () => removeRestDayMutation.mutate(selectedDateKey)
                : undefined
            }
            onEntrySelect={(entryId) =>
              navigate(`/records/${entryId.slice("record:".length)}`, {
                state: { returnTo: "/calendar" }
              })
            }
          />
        </div>
      ) : null}

      <section className="calendar-payroll-panel order-3 relative -mt-6 overflow-hidden rounded-b-[30px] border border-t border-[#10b981]/[0.14] bg-[linear-gradient(150deg,#101010_0%,#090a09_72%)] shadow-[0_28px_80px_rgba(0,0,0,0.34)]">
        <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-[#10b981]/[0.07] blur-3xl" />
        <input ref={payrollInputRef} type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          className="hidden"
          onChange={(event) => {
            const fileInput = event.currentTarget;
            const file = fileInput.files?.[0];
            if (!file) return;
            setPayrollPending(true);
            setPayrollError(null);
            setPayrollReview(null);
            setPayrollEditing(false);
            setPayrollSaved(false);
            setPayrollDocument(file);
            setPayrollDocumentAvailable(false);
            setPayrollExpanded(true);
            void reconcileMonthlyPayroll(file, year, month)
              .then((review) => {
                const hasValues = [
                  review.normalHours,
                  review.normalAmount,
                  review.absenceHours,
                  review.absenceAmount,
                  review.extraHours,
                  review.extraAmount,
                  review.grossAmount
                ].some((value) => value != null);
                if (!hasValues) {
                  throw new Error(t("payroll.errors.noValues"));
                }
                setPayrollReview(review);
              })
              .catch((error) => setPayrollError(
                axios.isAxiosError(error)
                  ? getApiError(error).message
                  : error instanceof Error && error.message
                    ? error.message
                    : getApiError(error).message
              ))
              .finally(() => {
                setPayrollPending(false);
                fileInput.value = "";
              });
          }} />
        <div className="relative p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-[9px] font-semibold uppercase tracking-[0.25em] text-[#10b981]/62">
              {t("payroll.eyebrow", { month: formatMonthLabel(activeMonth) })}
            </p>
            {payrollComparison ? (
              <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] ${
                payrollComparison.differenceCount === 0
                  ? "border-emerald-300/15 bg-emerald-300/[0.08] text-emerald-200/80"
                  : "border-[#10b981]/20 bg-[#10b981]/[0.09] text-[#34d399]"
              }`}>
                <ShieldCheck className="h-3 w-3" />
                {payrollComparison.differenceCount === 0
                  ? payrollSaved ? t("payroll.status.confirmed") : t("payroll.status.matches")
                  : t("payroll.status.differences", { count: payrollComparison.differenceCount })}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
          <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-[18px] border ${
            payrollSaved
              ? "border-emerald-300/15 bg-emerald-300/[0.09] text-emerald-200"
              : "border-[#10b981]/15 bg-[#10b981]/[0.07] text-[#34d399]"
          }`}>
            {payrollSaved ? <FileCheck2 className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[1.05rem] font-semibold tracking-[-0.035em] text-[#f5f5f5]">
              {payrollComparison
                ? payrollComparison.differenceCount === 0
                  ? t("payroll.title.matches")
                  : t("payroll.title.review")
                : t("payroll.title.scan")}
            </p>
            <p className="mt-1 truncate text-xs text-white/42">
              {payrollComparison
                ? payrollComparison.differenceCount === 0
                  ? t("payroll.description.matches")
                  : t("payroll.description.grossDifference", {
                      difference: formatSignedCurrency(payrollComparison.grossDifference)
                    })
                : t("payroll.description.scan")}
            </p>
          </div>
          {payrollReview ? (
            <button type="button" onClick={() => setPayrollExpanded((value) => !value)}
              aria-label={t(payrollExpanded ? "payroll.actions.collapse" : "payroll.actions.open")}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/[0.08] bg-white/[0.06] text-white">
              <ChevronDown className={`h-5 w-5 transition-transform ${
                payrollExpanded ? "rotate-180" : ""
              }`} />
            </button>
          ) : (
            <button type="button" disabled={payrollPending}
              onClick={() => payrollInputRef.current?.click()}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#10b981]/16 bg-[#10b981]/[0.08] text-[#34d399] transition active:scale-95 disabled:opacity-50"
              aria-label={t("payroll.actions.scanAria")}>
              <Upload className="h-[18px] w-[18px]" />
            </button>
          )}
          </div>
        </div>
        {payrollError ? <p className="px-5 pb-4 text-sm text-red-300">{payrollError}</p> : null}
        {payrollReview && payrollExpanded ? (
          <div className="space-y-4 border-t border-white/[0.08] px-5 pb-5 pt-5 text-sm">
            {(payrollReview.requiresReview || payrollReview.documentCompleteness === "FRAGMENT") ? (
              <div role="status" className="rounded-[18px] border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-xs leading-5 text-amber-100/85">
                <div className="flex items-start justify-between gap-3">
                  <p>{t("payroll.verification.review")}</p>
                  <button type="button" onClick={() => setPayrollEditing((value) => !value)}
                    className="flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border border-amber-200/20 bg-amber-100/[0.08] px-3 font-semibold text-amber-50">
                    <Pencil className="h-3 w-3" />
                    {t(payrollEditing ? "payroll.actions.doneEditing" : "payroll.actions.editValues")}
                  </button>
                </div>
                <p className="mt-1 text-amber-100/55">
                  {payrollReview.documentCompleteness === "FRAGMENT"
                    ? `${t("payroll.verification.fragment")} · ` : ""}
                  {t("payroll.verification.confidence", {
                    value: Math.round((payrollReview.confidence ?? 0) * 100)
                  })}
                </p>
              </div>
            ) : null}
            {payrollEditing ? (
              <fieldset className="grid grid-cols-2 gap-3 rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
                <legend className="px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45">
                  {t("payroll.verification.editTitle")}
                </legend>
                {([
                  ["normalHours", "payroll.categories.workedHours"],
                  ["normalAmount", "payroll.categories.workedPay"],
                  ["extraHours", "payroll.categories.extraHours"],
                  ["extraAmount", "payroll.categories.extraPay"],
                  ["absenceHours", "payroll.categories.paidAbsence"],
                  ["grossAmount", "payroll.categories.gross"]
                ] as const).map(([field, label]) => (
                  <label key={field} className="space-y-1.5 text-[10px] uppercase tracking-[0.12em] text-white/45">
                    <span>{t(label)}</span>
                    <input type="number" inputMode="decimal" step="0.01"
                      value={payrollReview[field] ?? ""}
                      onChange={(event) => updatePayrollNumber(field, event.currentTarget.value)}
                      className="min-h-11 w-full rounded-[14px] border border-white/10 bg-black/25 px-3 text-base font-medium normal-case tracking-normal text-white outline-none focus:border-emerald-300/50" />
                  </label>
                ))}
              </fieldset>
            ) : null}
            {payrollComparison ? (
              <div className={`rounded-[22px] border px-4 py-4 ${
                payrollComparison.differenceCount === 0
                  ? "border-emerald-300/15 bg-emerald-300/[0.055]"
                  : "border-[#10b981]/15 bg-[#10b981]/[0.055]"
              }`}>
                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-white/36">
                  {t("payroll.result.label")}
                </p>
                <div className="mt-2 flex items-end justify-between gap-4">
                  <div>
                    <p className="text-lg font-semibold tracking-[-0.04em] text-[#f5f5f5]">
                      {payrollComparison.differenceCount === 0
                        ? t("payroll.result.everythingMatches")
                        : t("payroll.result.found", { count: payrollComparison.differenceCount })}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-white/42">
                      {payrollComparison.differenceCount === 0
                        ? t("payroll.result.agree")
                        : t("payroll.result.review")}
                    </p>
                  </div>
                  <p className={`shrink-0 font-metric text-lg font-medium tabular-nums ${
                    payrollComparison.grossDifference === 0
                      ? "text-emerald-200"
                      : "text-[#34d399]"
                  }`}>
                    {payrollComparison.grossDifference === 0
                      ? "✓"
                      : formatSignedCurrency(payrollComparison.grossDifference)}
                  </p>
                </div>
              </div>
            ) : null}
            <div className="mb-4 flex gap-2">
              {(payrollDocumentAvailable || payrollDocument) ? (
                <button type="button" disabled={payrollDocumentOpening}
                  onClick={() => {
                    const viewer = window.open("", "_blank");
                    setPayrollDocumentOpening(true);
                    const source = payrollDocument
                      ? Promise.resolve(payrollDocument as Blob)
                      : payrollReconciliationId
                        ? getPayrollReconciliationDocument(payrollReconciliationId)
                        : Promise.reject(new Error(t("payroll.errors.documentUnavailable")));
                    void source.then((blob) => {
                      const url = URL.createObjectURL(blob);
                      if (viewer) viewer.location.href = url;
                      else {
                        const link = document.createElement("a");
                        link.href = url;
                        link.target = "_blank";
                        link.click();
                      }
                      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
                    }).catch((error) => {
                      viewer?.close();
                      setPayrollError(getApiError(error).message);
                    }).finally(() => setPayrollDocumentOpening(false));
                  }}
                  className="min-h-10 rounded-full border border-white/12 bg-white/[0.07] px-4 text-xs font-semibold text-white disabled:opacity-50">
                  {payrollDocumentOpening ? t("payroll.actions.opening") : t("payroll.actions.openDocument")}
                </button>
              ) : null}
              <button type="button" disabled={payrollPending}
                onClick={() => payrollInputRef.current?.click()}
                className="min-h-10 rounded-full border border-white/12 bg-white/[0.07] px-4 text-xs font-semibold text-white disabled:opacity-50">
                {payrollPending ? t("payroll.actions.reading") : t("payroll.actions.replaceDocument")}
              </button>
            </div>
            <div className="space-y-2">
            <PayrollComparisonRow label={t("payroll.categories.workedHours")}
              app={summary.workedHours}
              payroll={payrollReview.normalHours == null ? "—" : `${payrollReview.normalHours} h`}
              difference={payrollComparison?.rows.workedHours ?? null} />
            {payrollComparison?.showPaidAbsence ? (
              <PayrollComparisonRow label={t("payroll.categories.paidAbsence")}
                app={`${summary.paidAbsenceHours} · ${summary.paidAbsenceGrossAmount}`}
                payroll={payrollReview.absenceHours == null && payrollReview.absenceAmount == null
                  ? "—"
                  : `${payrollReview.absenceHours ?? "—"} h · ${formatPayrollCurrency(payrollReview.absenceAmount, payrollReview.currency)}`}
                difference={payrollComparison.rows.paidAbsence} />
            ) : null}
            <PayrollComparisonRow label={t("payroll.categories.extraPay")}
              app={`${summary.extraPaidHours} · ${summary.extraPaidGrossAmount}`}
              payroll={payrollReview.extraHours == null ? "—"
                : `${payrollReview.extraHours} h · ${formatPayrollCurrency(payrollReview.extraAmount, payrollReview.currency)}`}
              difference={payrollComparison?.rows.extraPay ?? null} />
            <PayrollComparisonRow label={t("payroll.categories.gross")}
              app={summary.workGrossAmount}
              payroll={payrollReview.grossAmount == null ? "—"
                : formatPayrollCurrency(payrollReview.grossAmount, payrollReview.currency)}
              difference={payrollComparison?.rows.gross ?? null}
              currency />
            </div>
            {payrollReview.payrollLines?.length ? (
              <div className="mt-4 border-t border-white/10 pt-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-white/45">
                  {t("payroll.details.title")}
                </p>
                <div className="space-y-3">
                  {payrollReview.payrollLines.map((line, index) => (
                    <div key={`${line.code ?? "line"}-${index}`}
                      className="grid grid-cols-[1fr_auto] gap-x-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">
                          {line.code ? `${line.code} · ` : ""}{line.label ?? t("payroll.details.line")}
                        </p>
                        <p className="mt-0.5 text-xs text-white/45">
                          {[
                            line.quantity == null ? null : `${line.quantity} h`,
                            line.factor == null ? null : `× ${line.factor} €`,
                            line.percentage == null ? null : `${line.percentage}%`
                          ].filter(Boolean).join(" · ") || t("payroll.details.noQuantity")}
                        </p>
                      </div>
                      <p className="text-sm font-semibold tabular-nums text-white">
                        {formatPayrollCurrency(line.amount, payrollReview.currency)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <button type="button"
              disabled={payrollSaving || !effectiveEmploymentId}
              onClick={() => {
                if (!effectiveEmploymentId) return;
                setPayrollSaving(true);
                setPayrollError(null);
                void savePayrollReconciliation({
                  employmentId: effectiveEmploymentId,
                  year,
                  month,
                  filename: payrollReview.filename,
                  appWorkedHours: summary.workedHoursValue,
                  appAbsenceHours: summary.paidAbsenceHoursValue,
                  appExtraHours: summary.extraPaidHoursValue,
                  appGross: summary.grossAmountValue,
                  payrollWorkedHours: payrollReview.normalHours,
                  payrollAbsenceHours: payrollReview.absenceHours,
                  payrollExtraHours: payrollReview.extraHours,
                  payrollGross: payrollReview.grossAmount,
                  payrollLines: payrollReview.payrollLines ?? []
                }).then(async (saved) => {
                  setPayrollReconciliationId(saved.id);
                  if (payrollDocument) {
                    await uploadPayrollReconciliationDocument(saved.id, payrollDocument);
                    setPayrollDocumentAvailable(true);
                  }
                  setPayrollSaved(true);
                  setPayrollExpanded(false);
                  void savedPayrollQuery.refetch();
                })
                  .catch((error) => setPayrollError(getApiError(error).message))
                  .finally(() => setPayrollSaving(false));
              }}
              className="mt-4 min-h-12 w-full rounded-full bg-white font-semibold text-black disabled:opacity-40">
              {payrollSaving
                ? t("payroll.actions.saving")
                : payrollSaved
                  ? t("payroll.actions.saved")
                  : t("payroll.actions.save")}
            </button>
          </div>
        ) : null}
      </section>

      <section className="order-4" aria-label={t("monthlyCharts.sectionLabel")}>
        <div className="mb-3 flex items-center justify-between gap-4 px-1">
          <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-[#10b981]/56">
            {t("monthlyCharts.title")}
          </p>
          <div
            className="relative grid grid-cols-2 rounded-full border border-white/[0.07] bg-white/[0.025] p-[3px]"
            role="group"
            aria-label={t("monthlyCharts.viewLabel")}
          >
            {(["flow", "rhythm"] as const).map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => setMonthlyView(view)}
                disabled={view === "flow" && !monthlyFlowAvailable}
                aria-pressed={monthlyView === view}
                title={view === "flow" && !monthlyFlowAvailable
                  ? t("monthlyCharts.flowUnavailable")
                  : undefined}
                className={`relative isolate flex h-8 min-w-[4.35rem] items-center justify-center rounded-full px-3 text-[0.7rem] font-medium transition-colors duration-150 active:scale-[0.97] ${
                  monthlyView === view
                    ? "text-[#34d399]"
                    : "text-[#f5f5f5]/36 hover:text-[#f5f5f5]/58"
                } disabled:cursor-not-allowed disabled:opacity-30`}
              >
                {monthlyView === view ? (
                  <motion.span
                    layoutId="calendar-monthly-view"
                    className="absolute inset-0 -z-10 rounded-full border border-[#10b981]/18 bg-[#10b981]/[0.09]"
                    transition={{ type: "spring", stiffness: 620, damping: 40, mass: 0.58 }}
                  />
                ) : null}
                <span>{t(`monthlyCharts.${view}`)}</span>
              </button>
            ))}
          </div>
        </div>
        {!monthlyFlowAvailable ? (
          <p className="-mt-1 mb-3 px-1 text-xs leading-5 text-[#f5f5f5]/34">
            {t("monthlyCharts.flowUnavailable")}
          </p>
        ) : null}
        <CalendarMonthlyMetricCard
          variant={monthlyView}
          days={monthlyChartDays}
          previousMonthTotal={previousMonthlyChartDays.reduce(
            (total, day) => total + (monthlyView === "flow" ? day.amount : day.minutes),
            0
          )}
          currency={records[0]?.currency ?? preferences?.currency ?? "EUR"}
        />
      </section>

      {!headerActionsTarget ? <section className="order-5 flex gap-2" aria-label={t("settings:pdfExport.title")}>{headerActions}</section> : null}
      </div>
    </>
  );
}

function PayrollComparisonRow({
  label,
  app,
  payroll,
  difference,
  currency = false
}: {
  label: string;
  app: string;
  payroll: string;
  difference: string | null;
  currency?: boolean;
}) {
  const matches = difference === "✓";
  return (
    <article className={`rounded-[20px] border px-4 py-3.5 ${
      difference && !matches
        ? "border-[#10b981]/18 bg-[#10b981]/[0.05]"
        : "border-white/[0.07] bg-white/[0.025]"
    }`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold tracking-[-0.02em] text-[#f5f5f5]">{label}</p>
        <span className={`font-metric text-xs font-semibold tabular-nums ${
          matches ? "text-emerald-200/80" : difference ? "text-[#34d399]" : "text-white/28"
        }`}>
          {difference ?? "—"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-4 border-t border-white/[0.06] pt-3">
        <div>
          <p className="text-[8px] font-semibold uppercase tracking-[0.16em] text-white/28">
            Alveryn
          </p>
          <p className="mt-1 truncate font-metric text-sm font-medium tabular-nums text-white/66">
            {app}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[8px] font-semibold uppercase tracking-[0.16em] text-white/28">
            Lohn
          </p>
          <p className={`mt-1 truncate font-metric text-sm font-medium tabular-nums ${
            currency && difference && !matches ? "text-[#34d399]" : "text-[#f5f5f5]"
          }`}>
            {payroll}
          </p>
        </div>
      </div>
    </article>
  );
}

function buildPayrollComparison(
  payroll: PayrollReconciliation,
  app: {
    workedHours: number;
    absenceHours: number;
    absenceAmount: number;
    extraHours: number;
    extraAmount: number;
    gross: number;
  }
) {
  const workedHours = comparisonDifference(payroll.normalHours, app.workedHours, "h");
  const showPaidAbsence = [
    app.absenceHours,
    app.absenceAmount,
    payroll.absenceHours ?? 0,
    payroll.absenceAmount ?? 0
  ].some((value) => Math.abs(value) >= 0.01);
  const paidAbsence = combinedComparisonDifference(
    comparisonDifference(payroll.absenceHours, app.absenceHours, "h"),
    comparisonDifference(payroll.absenceAmount, app.absenceAmount, "€")
  );
  const extraPay = combinedComparisonDifference(
    comparisonDifference(payroll.extraHours, app.extraHours, "h"),
    comparisonDifference(payroll.extraAmount, app.extraAmount, "€")
  );
  const gross = comparisonDifference(payroll.grossAmount, app.gross, "€");
  const rows = {
    workedHours,
    ...(showPaidAbsence ? { paidAbsence } : {}),
    extraPay,
    gross
  };

  return {
    rows: { workedHours, paidAbsence, extraPay, gross },
    showPaidAbsence,
    differenceCount: Object.values(rows).filter((value) => value !== null && value !== "✓").length,
    grossDifference: payroll.grossAmount == null ? 0 : normalizeDifference(payroll.grossAmount - app.gross)
  };
}

function formatPayrollCurrency(
  amount: number | null | undefined,
  currency: string | null | undefined
) {
  if (amount == null) return "—";
  const safeCurrency = currency && /^[A-Z]{3}$/.test(currency) ? currency : "EUR";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: safeCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${safeCurrency}`;
  }
}

function comparisonDifference(
  payroll: number | null | undefined,
  app: number,
  unit: "h" | "€"
) {
  if (payroll == null) return null;
  const difference = normalizeDifference(payroll - app);
  if (difference === 0) return "✓";
  if (unit === "€") return formatSignedCurrency(difference);
  return `${difference > 0 ? "+" : ""}${difference.toFixed(2)} h`;
}

function combinedComparisonDifference(
  first: string | null,
  second: string | null
) {
  const differences = [first, second].filter(
    (value): value is string => Boolean(value && value !== "✓")
  );
  if (differences.length > 0) return differences.join(" · ");
  if (first === "✓" || second === "✓") return "✓";
  return null;
}

function normalizeDifference(value: number) {
  return Math.abs(value) < 0.01 ? 0 : Number(value.toFixed(2));
}

function formatSignedCurrency(value: number) {
  const normalized = normalizeDifference(value);
  if (normalized === 0) return "€0.00";
  return `${normalized > 0 ? "+" : "−"}€${Math.abs(normalized).toFixed(2)}`;
}

function formatCompactCalendarDuration(minutes: number) {
  if (minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h${remainder.toString().padStart(2, "0")}`;
}

function formatCalendarActivity(records: WorkRecord[], minutes: number) {
  const duration = formatCompactCalendarDuration(minutes);
  if (duration) return duration;

  const lines = records.flatMap((record) => record.workLines ?? []);
  const unitLine = lines.find(
    (line) => line.calculationMode === "UNITS_PER_UNIT" && Number(line.quantity) > 0
  );
  if (unitLine) {
    const quantity = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 1
    }).format(Number(unitLine.quantity));
    return `${quantity}${unitLine.unitSymbol ? ` ${unitLine.unitSymbol}` : ""}`;
  }

  const fixedLine = lines.find((line) => line.calculationMode === "FIXED_AMOUNT");
  if (fixedLine) return null;

  return records[0]?.workLines?.[0]?.workTypeName ?? null;
}

function formatCompactCalendarAmount(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
    currencyDisplay: "narrowSymbol"
  }).format(amount);
}

function isInTrackedRange(isoDate: string, firstActivityDate: string | null, todayIso: string) {
  return Boolean(firstActivityDate && isoDate >= firstActivityDate && isoDate <= todayIso);
}

function buildMonthlyMetricDays(
  month: Date,
  records: WorkRecord[],
  absences: Absence[],
  absenceTypeById: Map<string, AbsenceTypeSetting>,
  selectedDate: Date | null,
  today: Date
): CalendarMonthlyMetricDay[] {
  const dayCount = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();

  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(month.getFullYear(), month.getMonth(), index + 1, 12);
    const key = toIsoDate(date);
    const absence = absences.find((item) => absenceOverlapsDate(item, date)) ?? null;
    let minutes = 0;
    let amount = 0;

    if (!absence) {
      records.filter((record) => record.workDate <= key && (record.workEndDate ?? record.workDate) >= key)
        .forEach((record) => {
          const eligibleDays = recordEligibleDates(record, absences);
          if (!eligibleDays.includes(key) || eligibleDays.length === 0) return;
          minutes += recordTimeMinutes(record) / eligibleDays.length;
          amount += Number(record.totalGrossAmount ?? record.grossAmount) / eligibleDays.length;
        });
    }

    return {
      key,
      dayNumber: index + 1,
      minutes,
      amount,
      absenceColor: absence
        ? (absence.absenceTypeId ? absenceTypeById.get(absence.absenceTypeId)?.color : null)
          || defaultAbsenceColor(absence.absenceType)
        : null,
      selected: selectedDate
        ? toIsoDate(selectedDate) === key
        : toIsoDate(today) === key
    };
  });
}

function mergePaidAbsenceMetrics(
  days: CalendarMonthlyMetricDay[],
  paidAbsences: PaidAbsenceDay[]
) {
  const paidByDate = new Map(paidAbsences.map((absence) => [absence.date, absence]));

  return days.map((day) => {
    const paidAbsence = paidByDate.get(day.key);
    if (!paidAbsence) return day;
    return {
      ...day,
      minutes: day.minutes + paidAbsence.minutes,
      amount: day.amount + paidAbsence.grossAmount
    };
  });
}

function recordEligibleDates(record: WorkRecord, absences: Absence[]) {
  const result: string[] = [];
  const end = record.workEndDate ?? record.workDate;
  for (let key = record.workDate; key <= end; key = toIsoDate(addDays(parseLocalIsoDate(key), 1))) {
    const date = parseLocalIsoDate(key);
    if (!absences.some((absence) => absenceOverlapsDate(absence, date))) result.push(key);
  }
  return result;
}

function calculateExtraPaidInRange(
  records: WorkRecord[],
  absences: Absence[],
  from: string,
  to: string
) {
  const grouped = new Map<string, { minutes: number; grossAmount: number }>();
  const total = records.reduce((result, record) => {
    const eligibleDays = recordEligibleDates(record, absences);
    if (eligibleDays.length === 0) return result;
    const overlapDays = eligibleDays.filter((date) => date >= from && date <= to).length;
    const allocation = overlapDays / eligibleDays.length;

    record.workLines?.forEach((line) => {
      const percentage = line.extraPayPercentage ?? 0;
      if (percentage <= 0) return;
      const grossAmount = Number(
        line.extraGrossAmount ?? Number(line.grossAmount) * (percentage / (100 + percentage))
      ) * allocation;

      const matchingRule = (line.extraPayDetails ?? [])
        .map((detail) => ({
          name: detail.name,
          eligibleMinutes: Number(detail.eligibleMinutes),
          weight: Number(detail.eligibleMinutes) * detail.percentage / 100
        }))
        .filter((detail) => detail.weight > 0)
        .sort((left, right) => right.weight - left.weight)[0];
      // Extra hours describe the time to which the surcharge applies. The
      // percentage affects only the extra amount, not the displayed duration.
      const minutes = (matchingRule?.eligibleMinutes ?? Number(line.calculatedMinutes)) * allocation;
      result.minutes += minutes;
      result.grossAmount += grossAmount;

      const name = matchingRule?.name || GENERIC_EXTRA_PAY_KEY;
      const current = grouped.get(name) ?? { minutes: 0, grossAmount: 0 };
      current.minutes += minutes;
      current.grossAmount += grossAmount;
      grouped.set(name, current);
    });
    return result;
  }, { minutes: 0, grossAmount: 0 });

  return {
    ...total,
    items: Array.from(grouped.entries()).map(([name, values]) => ({ name, ...values }))
  };
}

function recordTimeMinutes(record: WorkRecord) {
  const lineMinutes = (record.workLines ?? [])
    .filter((line) => (
      line.calculationMode === "TIME_HOURLY" ||
      line.calculationMode === "TIME_ONLY" ||
      line.calculationMode === "UNITS_PER_HOUR" ||
      line.calculationMode === "UNITS_PER_UNIT"
    ) && Number(line.calculatedMinutes) > 0)
    .reduce((total, line) => total + Number(line.calculatedMinutes), 0);

  if (lineMinutes > 0) return lineMinutes;

  return Number(record.workedMinutes ?? record.calculatedMinutes ?? 0);
}

function defaultAbsenceColor(type: Absence["absenceType"]) {
  if (type === "SICK_LEAVE") return "#ef4444";
  if (type === "VACATION") return "#22c55e";
  return "#737373";
}

function matchesEmployment(value: string | null | undefined, selectedEmploymentId: string | null) {
  return !selectedEmploymentId || value === selectedEmploymentId;
}

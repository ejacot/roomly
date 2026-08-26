import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  createAbsence,
  createWorkSession,
  deleteAbsence,
  getAbsences,
  getPreferences,
  listAbsenceTypes,
  listEmployments,
  listHourlyRates,
  listWorkTypes,
  listRestDays,
  markRestDay,
  removeRestDay,
  listWorkRecordsInRange,
  getPersonalBusinessSchedule,
  saveMyStaffingResult,
} from "../api/endpoints";
import { getApiError } from "../api/api-errors";
import { queryKeys } from "../api/query-keys";
import { i18n } from "../i18n";
import { DashboardErrorState } from "../components/dashboard/dashboard-error-state";
import { DashboardOverview } from "../components/dashboard/dashboard-overview";
import { DashboardSkeleton } from "../components/dashboard/dashboard-skeleton";
import { InstallAppTip } from "../components/dashboard/install-app-tip";
import { TimeTrackingCard } from "../components/dashboard/time-tracking-card";
import { WorkSuggestionModal } from "../components/dashboard/work-suggestion-modal";
import type { SelectedDayActivity, WeeklyRhythmDay } from "../types/dashboard";
import type { Absence, AbsenceTypeSetting } from "../types/absence";
import type {
  WorkRecord,
  WorkRecordLine,
  WorkRecordRequest,
} from "../types/work-record";
import type { PersonalBusinessSchedule } from "../types/business";
import {
  addDays,
  formatLocalIsoDate,
  isSameDay,
  parseLocalIsoDate,
  safeLocalIsoDate,
  startOfWeek,
} from "../utils/date";
import { formatCurrency, formatMinutesAsDuration } from "../utils/format";
import { calculatePaidAbsenceDays } from "../utils/paid-absence";
import {
  setEmploymentScope,
  useEmploymentScope,
} from "../features/employment/employment-scope";
import { LockedModalViewport } from "../components/ui/locked-modal-viewport";
import { ModalPanel } from "../components/ui/modal-panel";
import { Input } from "../components/ui/input";
import { recommendWorkEntry } from "../features/work-records/work-type-recommendation";

type OutletContext = {
  selectedDate?: Date;
  setSelectedDate?: (date: Date) => void;
};

type DashboardPageProps = {
  selectedDate?: Date;
};

export function DashboardPage({
  selectedDate: selectedDateProp,
}: DashboardPageProps = {}) {
  const { t } = useTranslation(["dashboard", "common"]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const selectedEmploymentId = useEmploymentScope();
  const [absenceScopeError, setAbsenceScopeError] = useState<string | null>(
    null,
  );
  const [selectedPlannedAssignmentId, setSelectedPlannedAssignmentId] =
    useState<string | null>(null);
  const [workSuggestionOpen, setWorkSuggestionOpen] = useState(false);
  const outletContext = useOutletContext<OutletContext>();
  const selectedDate = useMemo(
    () => selectedDateProp ?? outletContext?.selectedDate ?? new Date(),
    [outletContext?.selectedDate, selectedDateProp],
  );
  const selectedDateKey = safeLocalIsoDate(selectedDate);

  const weekStart = useMemo(() => startOfWeek(selectedDate), [selectedDate]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    [weekStart],
  );
  const weekStartKey = formatLocalIsoDate(weekDays[0]);
  const weekEndKey = formatLocalIsoDate(weekDays[6]);
  const previousWeekStartKey = shiftIsoDate(weekStartKey, -7);
  const previousWeekEndKey = shiftIsoDate(weekEndKey, -7);
  const previousWeekDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) =>
        shiftIsoDate(previousWeekStartKey, index),
      ),
    [previousWeekStartKey],
  );

  const rhythmRecordsQuery = useQuery({
    queryKey: queryKeys.workRecords.range({
      from: previousWeekStartKey,
      to: weekEndKey,
    }),
    queryFn: () =>
      listWorkRecordsInRange({ from: previousWeekStartKey, to: weekEndKey }),
  });
  const preferencesQuery = useQuery({
    queryKey: queryKeys.preferences(),
    queryFn: getPreferences,
  });
  const employmentsQuery = useQuery({
    queryKey: queryKeys.employments.all(),
    queryFn: listEmployments,
  });
  const hourlyRatesQuery = useQuery({
    queryKey: queryKeys.hourlyRates.all(),
    queryFn: listHourlyRates,
  });
  const workTypesQuery = useQuery({
    queryKey: queryKeys.workTypes.all(),
    queryFn: listWorkTypes
  });
  const historyFromKey = formatLocalIsoDate(addDays(selectedDate, -90));
  const historyToKey = formatLocalIsoDate(addDays(selectedDate, -1));
  const workHistoryQuery = useQuery({
    queryKey: queryKeys.workRecords.range({ from: historyFromKey, to: historyToKey }),
    queryFn: () => listWorkRecordsInRange({ from: historyFromKey, to: historyToKey })
  });
  const absenceTypesQuery = useQuery({
    queryKey: queryKeys.absenceTypes.list(true),
    queryFn: () => listAbsenceTypes(true),
  });
  const weeklyAbsencesQuery = useQuery({
    queryKey: queryKeys.absences.list({
      from: previousWeekStartKey,
      to: weekEndKey,
    }),
    queryFn: () => getAbsences({ from: previousWeekStartKey, to: weekEndKey }),
  });
  const businessScheduleQuery = useQuery({
    queryKey: ["personal-business-schedule", weekStartKey, weekEndKey],
    queryFn: () => getPersonalBusinessSchedule(weekStartKey, weekEndKey),
  });
  const selectedPlannedAssignment = useMemo(
    () =>
      (businessScheduleQuery.data ?? [])
        .flatMap((schedule) => schedule.assignments)
        .map((assignment) => ({ assignment }))
        .find((value) => value.assignment.id === selectedPlannedAssignmentId) ??
      null,
    [businessScheduleQuery.data, selectedPlannedAssignmentId],
  );
  const staffingResultMutation = useMutation({
    mutationFn: ({
      assignmentId,
      submit,
      form,
    }: {
      assignmentId: string;
      submit: boolean;
      form: HTMLFormElement;
    }) => {
      const data = new FormData(form);
      return saveMyStaffingResult(assignmentId, {
        actualStartTime: String(data.get("actualStartTime") || "") || null,
        actualEndTime: String(data.get("actualEndTime") || "") || null,
        breakMinutes: Number(data.get("breakMinutes") || 0),
        completedQuantity: String(data.get("completedQuantity") || "")
          ? Number(data.get("completedQuantity"))
          : null,
        notes: String(data.get("notes") || "") || null,
        submit,
      });
    },
    onSuccess: async () => {
      setSelectedPlannedAssignmentId(null);
      await queryClient.invalidateQueries({
        queryKey: ["personal-business-schedule"],
      });
    },
  });
  const activeEmployments = (employmentsQuery.data ?? []).filter(
    (employment) => employment.active,
  );
  const selectedEmploymentExists = (employmentsQuery.data ?? []).some(
    (employment) => employment.id === selectedEmploymentId,
  );
  const effectiveEmploymentId = employmentsQuery.isSuccess
    ? selectedEmploymentId && selectedEmploymentExists
      ? selectedEmploymentId
      : activeEmployments.length === 1
        ? activeEmployments[0].id
        : null
    : null;
  useEffect(() => {
    if (
      employmentsQuery.isSuccess &&
      selectedEmploymentId &&
      !selectedEmploymentExists
    ) {
      setEmploymentScope(null);
    }
  }, [
    employmentsQuery.isSuccess,
    selectedEmploymentExists,
    selectedEmploymentId,
  ]);
  const restDaysQuery = useQuery({
    queryKey: queryKeys.restDays.range(
      effectiveEmploymentId ?? "none",
      selectedDateKey,
      selectedDateKey,
    ),
    queryFn: () =>
      listRestDays(effectiveEmploymentId!, selectedDateKey, selectedDateKey),
    enabled: Boolean(effectiveEmploymentId),
  });
  const absenceMutation = useMutation({
    mutationFn: ({
      absenceTypeId,
      date,
      employmentId,
    }: {
      absenceTypeId: string;
      date: string;
      employmentId: string;
    }) =>
      createAbsence({
        employmentId,
        absenceTypeId,
        startDate: date,
        endDate: date,
        notes: null,
      }),
    onSuccess: async (_, variables) => {
      setAbsenceScopeError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.absences.all() }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.calendar.activityRange(),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.statistics.all() }),
      ]);
      outletContext?.setSelectedDate?.(parseLocalIsoDate(variables.date));
    },
  });
  const deleteAbsenceMutation = useMutation({
    mutationFn: ({ id }: { id: string; date: string }) => deleteAbsence(id),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.absences.all() }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.calendar.activityRange(),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.statistics.all() }),
      ]);
      outletContext?.setSelectedDate?.(parseLocalIsoDate(variables.date));
    },
  });
  const markRestDayMutation = useMutation({
    mutationFn: ({
      employmentId,
      date,
    }: {
      employmentId: string;
      date: string;
    }) => markRestDay(employmentId, date),
    onSuccess: async (_, variables) => {
      setAbsenceScopeError(null);
      await queryClient.invalidateQueries({
        queryKey: ["rest-days", variables.employmentId],
      });
    },
  });
  const removeRestDayMutation = useMutation({
    mutationFn: ({
      employmentId,
      date,
    }: {
      employmentId: string;
      date: string;
    }) => removeRestDay(employmentId, date),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ["rest-days", variables.employmentId],
      });
    },
  });
  const suggestedWorkMutation = useMutation({
    mutationFn: (payload: WorkRecordRequest) => createWorkSession(payload),
    onSuccess: async () => {
      setWorkSuggestionOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workRecords.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.calendar.activityRange() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.statistics.all() })
      ]);
    }
  });

  const isLoading =
    rhythmRecordsQuery.isLoading ||
    preferencesQuery.isLoading ||
    employmentsQuery.isLoading ||
    hourlyRatesQuery.isLoading ||
    workTypesQuery.isLoading ||
    workHistoryQuery.isLoading ||
    absenceTypesQuery.isLoading ||
    weeklyAbsencesQuery.isLoading ||
    businessScheduleQuery.isLoading ||
    (Boolean(effectiveEmploymentId) && restDaysQuery.isLoading);
  const errorQuery =
    (rhythmRecordsQuery.error ? rhythmRecordsQuery : null) ??
    (preferencesQuery.error ? preferencesQuery : null) ??
    (employmentsQuery.error ? employmentsQuery : null) ??
    (hourlyRatesQuery.error ? hourlyRatesQuery : null) ??
    (workTypesQuery.error ? workTypesQuery : null) ??
    (workHistoryQuery.error ? workHistoryQuery : null) ??
    (absenceTypesQuery.error ? absenceTypesQuery : null) ??
    (weeklyAbsencesQuery.error ? weeklyAbsencesQuery : null) ??
    (businessScheduleQuery.error ? businessScheduleQuery : null) ??
    (restDaysQuery.error ? restDaysQuery : null);

  const rhythmRecords = useMemo(
    () =>
      (rhythmRecordsQuery.data ?? []).filter((record) =>
        matchesEmployment(record.employmentId, selectedEmploymentId),
      ),
    [rhythmRecordsQuery.data, selectedEmploymentId],
  );
  const weeklyRecords = useMemo(
    () =>
      rhythmRecords.filter((record) =>
        recordOverlapsRange(record, weekStartKey, weekEndKey),
      ),
    [rhythmRecords, weekEndKey, weekStartKey],
  );
  const previousWeeklyRecords = useMemo(
    () =>
      rhythmRecords.filter((record) =>
        recordOverlapsRange(record, previousWeekStartKey, previousWeekEndKey),
      ),
    [previousWeekEndKey, previousWeekStartKey, rhythmRecords],
  );
  const weeklyDailyRecords = useMemo(
    () => weeklyRecords.filter((record) => !isProjectTotalRecord(record)),
    [weeklyRecords],
  );
  const previousWeeklyDailyRecords = useMemo(
    () =>
      previousWeeklyRecords.filter((record) => !isProjectTotalRecord(record)),
    [previousWeeklyRecords],
  );
  const selectedDayRecords = useMemo(
    () =>
      weeklyRecords.filter((record) =>
        recordCoversDate(record, selectedDateKey),
      ),
    [selectedDateKey, weeklyRecords],
  );
  const selectedDaySummaryRecords = useMemo(
    () => selectedDayRecords.filter((record) => !isProjectTotalRecord(record)),
    [selectedDayRecords],
  );
  const preferences = preferencesQuery.data ?? null;
  const absenceEmploymentId =
    selectedEmploymentId ??
    (activeEmployments.length === 1 ? activeEmployments[0].id : null);
  const selectedRestDay =
    (restDaysQuery.data ?? []).find(
      (restDay) => restDay.date === selectedDateKey,
    ) ?? null;
  const hourlyRates = useMemo(
    () =>
      (hourlyRatesQuery.data ?? []).filter((rate) =>
        matchesEmployment(rate.employmentId, selectedEmploymentId),
      ),
    [hourlyRatesQuery.data, selectedEmploymentId],
  );
  const workSuggestion = useMemo(
    () => recommendWorkEntry(
      (workHistoryQuery.data ?? []).filter((record) => matchesEmployment(record.employmentId, selectedEmploymentId)),
      (workTypesQuery.data ?? []).filter((workType) =>
        workType.active && matchesEmployment(workType.employmentId, selectedEmploymentId)
      ),
      selectedDateKey
    ),
    [selectedDateKey, selectedEmploymentId, workHistoryQuery.data, workTypesQuery.data]
  );
  const rhythmAbsences = useMemo(
    () =>
      (weeklyAbsencesQuery.data?.content ?? []).filter((absence) =>
        matchesEmployment(absence.employmentId, selectedEmploymentId),
      ),
    [selectedEmploymentId, weeklyAbsencesQuery.data],
  );
  const weeklyAbsences = useMemo(
    () =>
      rhythmAbsences.filter((absence) =>
        absenceOverlapsRange(absence, weekStartKey, weekEndKey),
      ),
    [rhythmAbsences, weekEndKey, weekStartKey],
  );
  const previousWeeklyAbsences = useMemo(
    () =>
      rhythmAbsences.filter((absence) =>
        absenceOverlapsRange(absence, previousWeekStartKey, previousWeekEndKey),
      ),
    [previousWeekEndKey, previousWeekStartKey, rhythmAbsences],
  );
  const selectedAbsence = useMemo(
    () =>
      weeklyAbsences.find((absence) =>
        absenceCoversDate(absence, selectedDate),
      ) ?? null,
    [selectedDate, weeklyAbsences],
  );
  const selectedDayPlannedActivities = useMemo(
    () =>
      buildPlannedBusinessActivities(
        businessScheduleQuery.data ?? [],
        selectedDateKey,
        t,
      ),
    [businessScheduleQuery.data, selectedDateKey, t],
  );
  const selectedDayApprovedBusinessMinutes = useMemo(
    () =>
      selectedDayPlannedActivities.reduce(
        (total, activity) => total + (activity.approvedMinutes ?? 0),
        0,
      ),
    [selectedDayPlannedActivities],
  );

  const selectedDayLabel = useMemo(
    () =>
      formatSelectedDayLabel(selectedDate, t("dashboard:selectedDay.today")),
    [selectedDate, t],
  );
  const emptyDayPrompt = useMemo(() => {
    const dateLabel = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
      day: "numeric",
      month: "long"
    }).format(selectedDate);
    const today = isSameDay(selectedDate, new Date());
    return {
      eyebrow: t(
        today ? "dashboard:emptyDay.dateToday" : "dashboard:emptyDay.dateSelected",
        { date: dateLabel }
      ),
      question: t(today ? "dashboard:emptyDay.questionToday" : "dashboard:emptyDay.questionDate")
    };
  }, [selectedDate, t]);
  const selectedDayPaidAbsences = useMemo(
    () =>
      calculatePaidAbsenceDays({
        absences: selectedAbsence ? [selectedAbsence] : [],
        activityDates: selectedDaySummaryRecords.map(
          (record) => record.workDate,
        ),
        hourlyRates,
        preferences,
        from: selectedDateKey,
        to: selectedDateKey,
      }),
    [
      hourlyRates,
      preferences,
      selectedAbsence,
      selectedDateKey,
      selectedDaySummaryRecords,
    ],
  );
  const weeklyPaidAbsences = useMemo(
    () =>
      calculatePaidAbsenceDays({
        absences: weeklyAbsences,
        activityDates: weeklyDailyRecords.map((record) => record.workDate),
        hourlyRates,
        preferences,
        from: weekStartKey,
        to: weekEndKey,
      }),
    [
      hourlyRates,
      preferences,
      weekEndKey,
      weekStartKey,
      weeklyAbsences,
      weeklyDailyRecords,
    ],
  );
  const weeklyCurrencies = useMemo(
    () =>
      new Set([
        ...weeklyDailyRecords
          .filter((record) => Number(record.grossAmount) !== 0)
          .map((record) => record.currency)
          .filter(Boolean),
        ...weeklyPaidAbsences
          .filter((absence) => absence.grossAmount !== 0)
          .map((absence) => absence.currency),
      ]),
    [weeklyDailyRecords, weeklyPaidAbsences],
  );
  const weeklyDays = useMemo(
    () =>
      buildWeeklyRhythmDays(
        weekDays,
        weeklyDailyRecords,
        weeklyAbsences,
        weeklyPaidAbsences,
        absenceTypesQuery.data ?? [],
        selectedDate,
        t,
      ),
    [
      absenceTypesQuery.data,
      selectedDate,
      t,
      weekDays,
      weeklyAbsences,
      weeklyDailyRecords,
      weeklyPaidAbsences,
    ],
  );
  const selectedDayOverview = useMemo(
    () => ({
      label: selectedDayLabel,
      entriesCount:
        selectedDayRecords.length +
        selectedDayPlannedActivities.length +
        (selectedAbsence ? 1 : 0),
      totalDuration:
        selectedDaySummaryRecords.length ||
        selectedDayPaidAbsences.length ||
        selectedDayApprovedBusinessMinutes
          ? formatMinutesAsDuration(
              sumAllocatedRecordMinutes(
                selectedDaySummaryRecords,
                selectedDateKey,
                weeklyAbsences,
              ) +
                sumPaidAbsenceMinutes(selectedDayPaidAbsences) +
                selectedDayApprovedBusinessMinutes,
            )
          : "",
      durationLabel: selectedAbsence
        ? t("dashboard:selectedDay.paidHours")
        : t("dashboard:selectedDay.hours"),
      totalGross:
        selectedDaySummaryRecords.length || selectedDayPaidAbsences.length
          ? formatCombinedGross(
              selectedDaySummaryRecords,
              sumAllocatedRecordGross(
                selectedDaySummaryRecords,
                selectedDateKey,
                weeklyAbsences,
              ) + sumPaidAbsenceGross(selectedDayPaidAbsences),
              t("dashboard:summary.mixedCurrencies"),
              selectedDayPaidAbsences,
            )
          : "",
      activities: [
        ...selectedDayPlannedActivities,
        ...buildSelectedDayActivities(selectedDayRecords, t),
        ...(selectedAbsence
          ? [
              toAbsenceActivity(
                selectedAbsence,
                selectedDayPaidAbsences[0]?.minutes ?? 0,
                selectedDayPaidAbsences[0]
                  ? formatCurrency(
                      String(selectedDayPaidAbsences[0].grossAmount),
                      selectedDayPaidAbsences[0].currency,
                    )
                  : "",
                t,
              ),
            ]
          : []),
      ],
    }),
    [
      selectedAbsence,
      selectedDateKey,
      selectedDayLabel,
      selectedDayPaidAbsences,
      selectedDayPlannedActivities,
      selectedDayApprovedBusinessMinutes,
      selectedDayRecords,
      selectedDaySummaryRecords,
      t,
      weeklyAbsences,
    ],
  );
  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (errorQuery) {
    return (
      <DashboardErrorState
        message={getApiError(errorQuery.error).message}
        onRetry={() => {
          void rhythmRecordsQuery.refetch();
          void preferencesQuery.refetch();
          void employmentsQuery.refetch();
          void hourlyRatesQuery.refetch();
          void workTypesQuery.refetch();
          void workHistoryQuery.refetch();
          void absenceTypesQuery.refetch();
          void weeklyAbsencesQuery.refetch();
          void businessScheduleQuery.refetch();
          void restDaysQuery.refetch();
        }}
      />
    );
  }

  return (
    <div className="dashboard-glass-preview mx-auto w-full pb-10">
      {selectedDayOverview.entriesCount || selectedRestDay ? <InstallAppTip /> : null}
      <DashboardOverview
        selectedDay={selectedDayOverview}
        emptyDayEyebrow={emptyDayPrompt.eyebrow}
        emptyDayQuestion={emptyDayPrompt.question}
        weeklyDays={weeklyDays}
        previousWeekAverageMinutes={averagePositiveValues(
          previousWeekDays.map((date) =>
            sumAllocatedRecordMinutes(
              previousWeeklyDailyRecords,
              date,
              previousWeeklyAbsences,
            ),
          ),
        )}
        previousWeekAverageGross={averagePositiveValues(
          previousWeekDays.map((date) =>
            sumAllocatedRecordGross(
              previousWeeklyDailyRecords,
              date,
              previousWeeklyAbsences,
            ),
          ),
        )}
        flowCurrency={
          weeklyDailyRecords[0]?.currency ?? preferences?.currency ?? "EUR"
        }
        flowAvailable={weeklyCurrencies.size <= 1}
        absenceTypes={absenceTypesQuery.data ?? []}
        restDay={Boolean(selectedRestDay)}
        onMarkRestDay={() => {
          if (!effectiveEmploymentId) {
            setAbsenceScopeError(t("dashboard:restDay.selectEmployment"));
            return;
          }
          setAbsenceScopeError(null);
          markRestDayMutation.mutate({
            employmentId: effectiveEmploymentId,
            date: selectedDateKey,
          });
        }}
        onRemoveRestDay={() => {
          if (effectiveEmploymentId) {
            removeRestDayMutation.mutate({
              employmentId: effectiveEmploymentId,
              date: selectedDateKey,
            });
          }
        }}
        restDayPending={
          markRestDayMutation.isPending || removeRestDayMutation.isPending
        }
        onQuickAdd={() => {
          if (workSuggestion) setWorkSuggestionOpen(true);
          else navigate(`/records/new?date=${selectedDateKey}`);
        }}
        onDaySwipe={(direction) =>
          outletContext?.setSelectedDate?.(addDays(selectedDate, direction))
        }
        onRhythmDaySelect={(date) =>
          outletContext?.setSelectedDate?.(parseLocalIsoDate(date))
        }
        onCreateAbsence={(absenceTypeId) => {
          if (!absenceEmploymentId) {
            setAbsenceScopeError(t("dashboard:absence.selectEmployment"));
            return;
          }
          setAbsenceScopeError(null);
          absenceMutation.mutate({
            absenceTypeId,
            date: selectedDateKey,
            employmentId: absenceEmploymentId,
          });
        }}
        onConfigureAbsences={() => navigate("/settings/absences")}
        onDeleteAbsence={(activityId) =>
          deleteAbsenceMutation.mutate({
            id: activityId.slice("absence-".length),
            date: selectedDateKey,
          })
        }
        absencePending={
          absenceMutation.isPending ||
          deleteAbsenceMutation.isPending ||
          Boolean(selectedAbsence)
        }
        absenceError={
          absenceScopeError ??
          (absenceMutation.error
            ? getApiError(absenceMutation.error).message
            : deleteAbsenceMutation.error
              ? getApiError(deleteAbsenceMutation.error).message
              : markRestDayMutation.error
                ? getApiError(markRestDayMutation.error).message
                : removeRestDayMutation.error
                  ? getApiError(removeRestDayMutation.error).message
                  : null)
        }
        onEntrySelect={(entryId) =>
          entryId.startsWith("planned-")
            ? setSelectedPlannedAssignmentId(entryId.slice("planned-".length))
            : navigate(
                `/records/${entryId.slice("record:".length)}?returnDate=${selectedDateKey}`,
              )
        }
        timeTracker={<TimeTrackingCard />}
      />
      {selectedPlannedAssignment ? (
        <LockedModalViewport
          className="z-50 bg-black/70 px-4 py-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedPlannedAssignmentId(null)}
        >
          <ModalPanel
            className="max-w-md"
            onClick={(event) => event.stopPropagation()}
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-sky-300/70">
                {t("dashboard:selectedDay.planned")}
              </p>
              <h2 className="mt-1 text-lg font-semibold text-white">
                {selectedPlannedAssignment.assignment.workTypeName}
              </h2>
              <p className="text-sm text-white/45">
                {selectedPlannedAssignment.assignment.unitName}
              </p>
            </div>
            {selectedPlannedAssignment.assignment.result?.approvalStatus !==
              "DRAFT" && selectedPlannedAssignment.assignment.result ? (
              <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="font-semibold text-white">
                  {t(
                    `dashboard:businessResult.${selectedPlannedAssignment.assignment.result.approvalStatus.toLowerCase()}`,
                  )}
                </p>
                <p className="mt-1 text-sm text-white/45">
                  {selectedPlannedAssignment.assignment.result.actualStartTime?.slice(
                    0,
                    5,
                  ) ?? "—"}
                  –
                  {selectedPlannedAssignment.assignment.result.actualEndTime?.slice(
                    0,
                    5,
                  ) ?? "—"}
                  {selectedPlannedAssignment.assignment.result
                    .completedQuantity != null
                    ? ` · ${selectedPlannedAssignment.assignment.result.completedQuantity}`
                    : ""}
                </p>
              </div>
            ) : (
              <form
                className="mt-5 space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  staffingResultMutation.mutate({
                    assignmentId: selectedPlannedAssignment.assignment.id,
                    submit: true,
                    form: event.currentTarget,
                  });
                }}
              >
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    name="actualStartTime"
                    label={t("dashboard:businessResult.actualStart")}
                    type="time"
                    defaultValue={
                      selectedPlannedAssignment.assignment.result?.actualStartTime?.slice(
                        0,
                        5,
                      ) ??
                      selectedPlannedAssignment.assignment.startTime?.slice(
                        0,
                        5,
                      ) ??
                      ""
                    }
                  />
                  <Input
                    name="actualEndTime"
                    label={t("dashboard:businessResult.actualEnd")}
                    type="time"
                    defaultValue={
                      selectedPlannedAssignment.assignment.result?.actualEndTime?.slice(
                        0,
                        5,
                      ) ?? ""
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    name="breakMinutes"
                    label={t("dashboard:businessResult.breakMinutes")}
                    type="number"
                    min="0"
                    defaultValue={
                      selectedPlannedAssignment.assignment.result
                        ?.breakMinutes ?? 30
                    }
                  />
                  <Input
                    name="completedQuantity"
                    label={t("dashboard:businessResult.quantity")}
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={
                      selectedPlannedAssignment.assignment.result
                        ?.completedQuantity ?? ""
                    }
                  />
                </div>
                <label className="block text-sm text-white/70">
                  {t("dashboard:businessResult.notes")}
                  <textarea
                    name="notes"
                    defaultValue={
                      selectedPlannedAssignment.assignment.result?.notes ?? ""
                    }
                    className="mt-1 min-h-20 w-full rounded-2xl border border-white/10 bg-white/[0.05] p-3 text-white outline-none"
                  />
                </label>
                {staffingResultMutation.error ? (
                  <p className="text-sm text-red-300">
                    {getApiError(staffingResultMutation.error).message}
                  </p>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={staffingResultMutation.isPending}
                    onClick={(event) => {
                      const form = event.currentTarget.form!;
                      staffingResultMutation.mutate({
                        assignmentId: selectedPlannedAssignment.assignment.id,
                        submit: false,
                        form,
                      });
                    }}
                    className="rounded-2xl bg-white/10 py-3 font-semibold text-white"
                  >
                    {t("dashboard:businessResult.saveDraft")}
                  </button>
                  <button
                    disabled={staffingResultMutation.isPending}
                    className="rounded-2xl bg-emerald-400 py-3 font-bold text-emerald-950"
                  >
                    {t("dashboard:businessResult.submit")}
                  </button>
                </div>
              </form>
            )}
            <button
              onClick={() => setSelectedPlannedAssignmentId(null)}
              className="mt-3 w-full py-2 text-sm text-white/45"
            >
              {t("common:actions.cancel")}
            </button>
          </ModalPanel>
        </LockedModalViewport>
      ) : null}
      {workSuggestionOpen && workSuggestion ? (
        <WorkSuggestionModal
          workType={workSuggestion.workType}
          line={workSuggestion.line}
          saving={suggestedWorkMutation.isPending}
          error={suggestedWorkMutation.error ? getApiError(suggestedWorkMutation.error).message : null}
          onClose={() => setWorkSuggestionOpen(false)}
          onEdit={() => navigate(`/records/new?date=${selectedDateKey}&manual=1`)}
          onAccept={() => suggestedWorkMutation.mutate(
            suggestionToPayload(workSuggestion.line, workSuggestion.record, selectedDateKey)
          )}
        />
      ) : null}
    </div>
  );
}

function recordTimeMinutes(record: WorkRecord) {
  return (record.workLines ?? [])
    .filter(isTimeContributingLine)
    .reduce((total, line) => total + Number(line.calculatedMinutes), 0);
}

function isTimeContributingLine(line: WorkRecordLine) {
  return (
    (line.calculationMode === "TIME_HOURLY" ||
      line.calculationMode === "TIME_ONLY" ||
      line.calculationMode === "UNITS_PER_HOUR" ||
      line.calculationMode === "UNITS_PER_UNIT") &&
    Number(line.calculatedMinutes) > 0
  );
}

function shiftIsoDate(value: string, days: number) {
  return formatLocalIsoDate(addDays(parseLocalIsoDate(value), days));
}

function recordDurationDays(record: WorkRecord) {
  const start = parseLocalIsoDate(record.workDate);
  const end = parseLocalIsoDate(record.workEndDate ?? record.workDate);
  return Math.max(
    Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1,
    1,
  );
}

function sumAllocatedRecordMinutes(
  records: WorkRecord[],
  date: string,
  absences: Absence[],
) {
  if (hasAbsenceOnDate(absences, date)) return 0;
  return records.reduce((total, record) => {
    const eligibleDays = recordEligibleDays(record, absences);
    return (
      total +
      (eligibleDays.includes(date)
        ? recordTimeMinutes(record) / eligibleDays.length
        : 0)
    );
  }, 0);
}

function sumAllocatedRecordGross(
  records: WorkRecord[],
  date: string,
  absences: Absence[],
) {
  if (hasAbsenceOnDate(absences, date)) return 0;
  return records.reduce((total, record) => {
    const eligibleDays = recordEligibleDays(record, absences);
    return (
      total +
      (eligibleDays.includes(date)
        ? Number(record.grossAmount) / eligibleDays.length
        : 0)
    );
  }, 0);
}

function recordEligibleDays(record: WorkRecord, absences: Absence[]) {
  const endDate = record.workEndDate ?? record.workDate;
  const days: string[] = [];
  for (
    let date = record.workDate;
    date <= endDate;
    date = shiftIsoDate(date, 1)
  ) {
    if (!hasAbsenceOnDate(absences, date)) days.push(date);
  }
  return days;
}

function hasAbsenceOnDate(absences: Absence[], date: string) {
  return absences.some(
    (absence) => absence.startDate <= date && absence.endDate >= date,
  );
}

function recordCoversDate(record: WorkRecord, date: string) {
  return (
    record.workDate <= date && (record.workEndDate ?? record.workDate) >= date
  );
}

function isProjectTotalRecord(record: WorkRecord) {
  return record.entryKind === "WORK_RECORD" && Boolean(record.workEndDate);
}

function recordOverlapsRange(
  record: WorkRecord,
  fromDate: string,
  toDate: string,
) {
  return (
    record.workDate <= toDate &&
    (record.workEndDate ?? record.workDate) >= fromDate
  );
}

function absenceOverlapsRange(
  absence: Absence,
  fromDate: string,
  toDate: string,
) {
  return absence.startDate <= toDate && absence.endDate >= fromDate;
}

function formatCombinedGross(
  records: WorkRecord[],
  total: number,
  mixedCurrencyLabel: string,
  paidAbsences: Array<{ currency: string }> = [],
) {
  const currencies = new Set([
    ...records.map((record) => record.currency).filter(Boolean),
    ...paidAbsences.map((absence) => absence.currency),
  ]);

  if (currencies.size > 1) {
    return mixedCurrencyLabel;
  }

  return formatCurrency(
    String(total),
    records[0]?.currency ?? paidAbsences[0]?.currency ?? "EUR",
  );
}

function sumPaidAbsenceMinutes(absences: Array<{ minutes: number }>) {
  return absences.reduce((total, absence) => total + absence.minutes, 0);
}

function sumPaidAbsenceGross(absences: Array<{ grossAmount: number }>) {
  return absences.reduce((total, absence) => total + absence.grossAmount, 0);
}

function averagePositiveValues(values: number[]) {
  const positiveValues = values.filter((value) => value > 0);
  return positiveValues.length > 0
    ? positiveValues.reduce((total, value) => total + value, 0) /
        positiveValues.length
    : 0;
}

function calculateExtraPaidInRange(
  records: WorkRecord[],
  fromDate: string,
  toDate: string,
  absences: Absence[],
) {
  return records.reduce(
    (total, record) => {
      const eligibleDays = recordEligibleDays(record, absences);
      if (eligibleDays.length === 0) return total;
      const overlapDays = eligibleDays.filter(
        (date) => date >= fromDate && date <= toDate,
      ).length;
      const allocation = overlapDays / eligibleDays.length;

      record.workLines?.forEach((line) => {
        const percentage = line.extraPayPercentage ?? 0;
        if (percentage <= 0) return;
        const extraMinutes = Number(line.calculatedMinutes);
        const extraGross =
          line.extraGrossAmount === undefined
            ? Number(line.grossAmount) * (percentage / (100 + percentage))
            : Number(line.extraGrossAmount);
        total.minutes += extraMinutes * allocation;
        total.grossAmount += extraGross * allocation;
      });
      return total;
    },
    { minutes: 0, grossAmount: 0 },
  );
}

function buildSelectedDayActivities(
  records: WorkRecord[],
  t: ReturnType<typeof useTranslation<["dashboard", "common"]>>["t"],
): SelectedDayActivity[] {
  return records
    .filter((record) => record.workLines?.length)
    .map((record) => toPhaseTwoWorkRecordActivity(record, t));
}

function buildPlannedBusinessActivities(
  schedules: PersonalBusinessSchedule[],
  date: string,
  t: ReturnType<typeof useTranslation<["dashboard", "common"]>>["t"],
): SelectedDayActivity[] {
  return schedules.flatMap((schedule) =>
    schedule.assignments
      .filter((assignment) => assignment.date === date)
      .map((assignment) => {
            const startTime = assignment.startTime;
            const endTime = assignment.endTime;
            const interval =
              startTime && endTime
                ? `${startTime.slice(0, 5)}–${endTime.slice(0, 5)}`
                : startTime
                  ? t("dashboard:selectedDay.startsAt", {
                      time: startTime.slice(0, 5),
                    })
                  : t("dashboard:selectedDay.timeNotSet");

            const approvedMinutes =
              assignment.result?.approvalStatus === "APPROVED"
                ? (assignment.result.calculatedMinutes ??
                  approvedResultMinutes(
                    assignment.result.actualStartTime,
                    assignment.result.actualEndTime,
                    assignment.result.breakMinutes,
                  ))
                : 0;
            return {
              id: `planned-${assignment.id}`,
              kind: "PLANNED_BUSINESS" as const,
              title: assignment.workTypeName,
              subtitle: assignment.unitName,
              projectTitle: schedule.organizationName,
              periodLabel: interval,
              duration: approvedMinutes
                ? formatMinutesAsDuration(approvedMinutes)
                : "",
              amount: "",
              businessResultStatus: assignment.result?.approvalStatus ?? null,
              approvedMinutes,
              unitBreakdown: [
                {
                  id: assignment.id,
                  label: assignment.workTypeName,
                  enteredValue: assignment.workTypeCode,
                  displayOrder: 0,
                },
              ],
            };
          }),
  );
}

function approvedResultMinutes(
  start: string | null,
  end: string | null,
  breakMinutes: number,
) {
  if (!start || !end) return 0;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  let minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (minutes < 0) minutes += 24 * 60;
  return Math.max(0, minutes - breakMinutes);
}

function toPhaseTwoWorkRecordActivity(
  record: WorkRecord,
  t: ReturnType<typeof useTranslation<["dashboard", "common"]>>["t"],
) {
  const workLines = record.workLines ?? [];
  const timeLines = workLines.filter(isTimeContributingLine);
  const minutes = timeLines.reduce(
    (total, line) => total + Number(line.calculatedMinutes),
    0,
  );
  const mixedCurrencyLabel = t("dashboard:summary.mixedCurrencies");
  const currencies = new Set(
    workLines
      .filter(
        (line) => Number(line.totalGrossAmount ?? line.grossAmount ?? 0) !== 0,
      )
      .map((line) => line.currencySnapshot)
      .filter((currency): currency is string => Boolean(currency)),
  );
  const displayCurrency =
    currencies.values().next().value ?? record.currency ?? "EUR";
  const extraMinutes = workLines.reduce((total, line) => {
    if (line.extraPayDetails?.length) {
      return (
        total +
        line.extraPayDetails.reduce(
          (detailTotal, detail) => detailTotal + Number(detail.eligibleMinutes),
          0,
        )
      );
    }
    const percentage = line.extraPayPercentage ?? 0;
    if (percentage <= 0) return total;
    return total + Number(line.calculatedMinutes);
  }, 0);
  const extraGross = workLines.reduce((total, line) => {
    const percentage = line.extraPayPercentage ?? 0;
    if (percentage <= 0) return total;
    return (
      total +
      (line.extraGrossAmount === undefined
        ? Number(line.grossAmount) * (percentage / (100 + percentage))
        : Number(line.extraGrossAmount))
    );
  }, 0);
  const durationDays = recordDurationDays(record);
  const spansMultipleDays = durationDays > 1;

  return {
    id: `record:${record.id}`,
    title: "",
    kind: "UNIT_BASED" as const,
    subtitle: spansMultipleDays
      ? t("dashboard:selectedDay.jobDays", { count: durationDays })
      : "",
    projectTitle: record.projectTitle ?? null,
    projectNotes: record.projectNotes ?? null,
    teamSize: record.teamSize ?? null,
    address: record.address?.formatted ?? null,
    notes: record.notes,
    periodLabel: spansMultipleDays ? formatRecordPeriod(record) : null,
    duration: timeLines.length ? formatMinutesAsDuration(minutes) : "",
    durationLabel: spansMultipleDays
      ? t("dashboard:selectedDay.projectHours")
      : null,
    amount:
      currencies.size <= 1
        ? formatCurrency(record.grossAmount, displayCurrency)
        : mixedCurrencyLabel,
    amountLabel: spansMultipleDays
      ? t("dashboard:selectedDay.projectTotal")
      : null,
    extraDuration:
      extraMinutes > 0 ? formatMinutesAsDuration(extraMinutes) : null,
    extraAmount:
      extraGross > 0
        ? currencies.size <= 1
          ? formatCurrency(String(extraGross), displayCurrency)
          : mixedCurrencyLabel
        : null,
    extraPayLabel: null,
    unitBreakdown: workLines.flatMap((line) =>
      toPhaseTwoLineBreakdown(line, record.currency ?? "EUR"),
    ),
  };
}

function toPhaseTwoLineBreakdown(
  line: WorkRecordLine,
  fallbackCurrency = "EUR",
): SelectedDayActivity["unitBreakdown"] {
  const interval =
    line.startTime && line.endTime
      ? `${line.startTime.slice(0, 5)}–${line.endTime.slice(0, 5)}`
      : null;
  const calculatedMinutes = Number(
    line.workedMinutes ?? line.calculatedMinutes ?? 0,
  );
  const hours =
    calculatedMinutes > 0
      ? formatMinutesAsDuration(calculatedMinutes)
      : line.durationMinutes != null
        ? formatMinutesAsDuration(line.durationMinutes)
        : null;
  const price = formatCurrency(
    line.totalGrossAmount ??
      line.grossAmount ??
      line.fixedAmountSnapshot ??
      "0",
    line.currencySnapshot || fallbackCurrency,
  );
  const base: SelectedDayActivity["unitBreakdown"][number] = {
    id: line.id,
    label: line.workTypeName,
    enteredValue:
      line.calculationMode === "FIXED_AMOUNT"
        ? price
        : line.calculationMode === "UNITS_PER_HOUR" ||
            line.calculationMode === "UNITS_PER_UNIT"
          ? (() => {
              const unit = line.unitSymbol ?? line.unitLabel ?? "";
              return unit
                ? `${line.quantity ?? "0"} ${unit}`
                : (line.quantity ?? "0");
            })()
          : line.durationMinutes != null
            ? formatMinutesAsDuration(line.durationMinutes)
            : (interval ?? hours),
    interval,
    hours:
      line.calculationMode === "FIXED_AMOUNT" ||
      line.calculationMode === "UNITS_PER_UNIT"
        ? null
        : hours,
    price,
    extraPayPercentage: line.extraPayPercentage,
    extraPayDetails: line.extraPayDetails?.map((detail) => ({
      name: detail.name,
      eligibleMinutes: Number(detail.eligibleMinutes),
      percentage: detail.percentage,
    })),
    displayOrder: line.displayOrder,
  };

  if (
    line.calculationMode === "TIME_HOURLY" ||
    line.calculationMode === "TIME_ONLY" ||
    line.calculationMode === "FIXED_AMOUNT"
  ) {
    return [{ ...base, quantity: null }];
  }

  const unit = line.unitSymbol ?? line.unitLabel ?? "";
  const quantity = unit
    ? `${formatQuantity(line.quantity ?? "0")} ${unit}`
    : formatQuantity(line.quantity ?? "0");
  return [
    {
      ...base,
      quantity,
    },
  ];
}

function toAbsenceActivity(
  absence: Absence,
  paidMinutes: number,
  paidAmount: string,
  t: ReturnType<typeof useTranslation<["dashboard", "common"]>>["t"],
) {
  const marker = absenceMarker(absence.absenceType);
  return {
    id: `absence-${absence.id}`,
    title: absence.absenceTypeName || t(`dashboard:absence.${marker}`),
    kind: "ABSENCE" as const,
    subtitle: t("dashboard:absence.dayOff"),
    duration:
      paidMinutes > 0
        ? t("dashboard:selectedDay.equivalentTime", {
            duration: formatMinutesAsDuration(paidMinutes),
          })
        : t("dashboard:absence.noWork"),
    amount: paidAmount,
    unitBreakdown: [],
    marker,
  };
}

function absenceMarker(absenceType: Absence["absenceType"]) {
  if (absenceType === "SICK_LEAVE") {
    return "sick" as const;
  }
  if (absenceType === "VACATION") {
    return "vacation" as const;
  }
  return "free" as const;
}

const DAILY_TARGET_MINUTES = 8 * 60;

function buildWeeklyRhythmDays(
  days: Date[],
  records: WorkRecord[],
  absences: Absence[],
  paidAbsences: Array<{ date: string; grossAmount: number }>,
  absenceTypes: AbsenceTypeSetting[],
  selectedDate: Date,
  t: ReturnType<typeof useTranslation<["dashboard", "common"]>>["t"],
): WeeklyRhythmDay[] {
  const minutesPerDay = days.map((day) => {
    const date = formatLocalIsoDate(day);
    if (hasAbsenceOnDate(absences, date)) return 0;
    const coveringRecords = records.filter((record) =>
      recordCoversDate(record, formatLocalIsoDate(day)),
    );
    return coveringRecords.reduce((total, record) => {
      const eligibleDays = recordEligibleDays(record, absences);
      return (
        total +
        (eligibleDays.length > 0
          ? recordTimeMinutes(record) / eligibleDays.length
          : 0)
      );
    }, 0);
  });
  const grossPerDay = days.map((day) => {
    const date = formatLocalIsoDate(day);
    const workGross = hasAbsenceOnDate(absences, date)
      ? 0
      : records
          .filter((record) => recordCoversDate(record, date))
          .reduce((total, record) => {
            const eligibleDays = recordEligibleDays(record, absences);
            return (
              total +
              (eligibleDays.length > 0
                ? Number(record.grossAmount) / eligibleDays.length
                : 0)
            );
          }, 0);
    const paidAbsenceGross = paidAbsences
      .filter((absence) => absence.date === date)
      .reduce((total, absence) => total + absence.grossAmount, 0);
    return workGross + paidAbsenceGross;
  });
  const extraPaidPerDay = days.map((day) => {
    const date = formatLocalIsoDate(day);
    return calculateExtraPaidInRange(records, date, date, absences);
  });
  const extraPayPercentagesPerDay = days.map((day) => {
    const date = formatLocalIsoDate(day);
    if (hasAbsenceOnDate(absences, date)) return [];
    return records
      .filter((record) => recordCoversDate(record, date))
      .flatMap((record) => record.workLines ?? [])
      .map((line) => line.extraPayPercentage ?? 0)
      .filter((percentage) => percentage > 0)
      .sort((left, right) => left - right);
  });
  const maximumDailyMinutes = Math.max(...minutesPerDay, 0);
  return days.map((day, index) => {
    const absence = absences.find((item) => absenceCoversDate(item, day));
    const absenceType = absence ? absenceMarker(absence.absenceType) : null;
    const absenceColor = absence
      ? (absenceTypes.find((type) => type.id === absence.absenceTypeId)
          ?.color ?? "#737373")
      : "#737373";
    const minutes = minutesPerDay[index] ?? 0;
    const amount = grossPerDay[index] ?? 0;
    const extraMinutes = extraPaidPerDay[index]?.minutes ?? 0;
    const extraAmount = extraPaidPerDay[index]?.grossAmount ?? 0;
    const hasEntries = minutes > 0;
    const difference = minutes - DAILY_TARGET_MINUTES;
    const status = absence
      ? "absence"
      : !hasEntries
        ? "idle"
        : difference < 0
          ? "under"
          : difference > 0
            ? "over"
            : "met";

    return {
      key: formatLocalIsoDate(day),
      label: new Intl.DateTimeFormat(i18n.resolvedLanguage, {
        weekday: "short",
      }).format(day),
      value: formatMinutesAsDuration(minutes),
      minutes,
      amount,
      extraMinutes,
      baseAmount: Math.max(amount - extraAmount, 0),
      extraAmount,
      extraPayPercentages: extraPayPercentagesPerDay[index] ?? [],
      markerLabel:
        hasEntries && difference !== 0
          ? formatTargetDifferenceMarker(difference)
          : null,
      status,
      absence: absenceType
        ? {
            type: absenceType,
            label:
              absence?.absenceTypeName ?? t(`dashboard:absence.${absenceType}`),
            color: absenceColor,
          }
        : null,
      percentage:
        maximumDailyMinutes > 0
          ? Math.round((minutes / maximumDailyMinutes) * 100)
          : 0,
      selected: isSameDay(day, selectedDate),
    };
  });
}

function formatRecordPeriod(record: WorkRecord) {
  const formatter = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    day: "numeric",
    month: "short",
  });
  return `${formatter.format(parseLocalIsoDate(record.workDate))}–${formatter.format(parseLocalIsoDate(record.workEndDate ?? record.workDate))}`;
}

function absenceCoversDate(absence: Absence, date: Date) {
  const key = formatLocalIsoDate(date);
  return absence.startDate <= key && absence.endDate >= key;
}

function formatTargetDifferenceMarker(minutes: number) {
  const hours = Math.abs(minutes) / 60;
  const prefix = minutes > 0 ? "+" : "-";
  return new Intl.NumberFormat(i18n.resolvedLanguage, {
    maximumFractionDigits: 1,
  })
    .format(hours)
    .replace(/^/, prefix);
}

function suggestionToPayload(line: WorkRecordLine, record: WorkRecord, workDate: string): WorkRecordRequest {
  const baseLine = {
    workTypeId: line.workTypeId,
    notes: null,
    extraPayPercentage: line.extraPayPercentage ?? 0
  };
  const suggestedLine = line.calculationMode === "FIXED_AMOUNT"
    ? {
        ...baseLine,
        fixedAmount: Number(line.fixedAmountSnapshot ?? 0),
        currency: line.currencySnapshot
      }
    : line.calculationMode === "UNITS_PER_HOUR" || line.calculationMode === "UNITS_PER_UNIT"
      ? { ...baseLine, quantity: Number(line.quantity ?? 0) }
      : line.durationMinutes
        ? { ...baseLine, durationMinutes: line.durationMinutes }
        : {
            ...baseLine,
            startTime: line.startTime?.slice(0, 5) ?? null,
            endTime: line.endTime?.slice(0, 5) ?? null,
            unpaidBreakMinutes: line.breakMinutes ?? 0
          };

  return {
    workDate,
    addressId: null,
    teamSize: record.teamSize ?? null,
    notes: null,
    lines: [suggestedLine]
  };
}

function formatSelectedDayLabel(date: Date, todayLabel: string) {
  if (isSameDay(date, new Date())) {
    return todayLabel;
  }

  return new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

function formatQuantity(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Intl.NumberFormat(i18n.resolvedLanguage, {
    maximumFractionDigits: 2,
  }).format(parsed);
}

function matchesEmployment(
  value: string | null | undefined,
  selectedEmploymentId: string | null,
) {
  return !selectedEmploymentId || value === selectedEmploymentId;
}

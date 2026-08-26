import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Briefcase, CalendarX, ChevronRight, Coffee, Plus, X } from "lucide-react";
import { WeeklyHoursCard } from "./weekly-hours-card";
import { SelectedDayActivityCard } from "./selected-day-activity-card";
import type { AbsenceTypeSetting } from "../../types/absence";
import type {
  SelectedDayOverview,
  WeeklyRhythmDay
} from "../../types/dashboard";
import { resolveDaySwipeDirection } from "./day-swipe.utils";
import { Card } from "../ui/card";
import { DashboardDailySummaryCard } from "./dashboard-daily-summary-card";
import { LockedModalViewport } from "../ui/locked-modal-viewport";
import { ModalPanel } from "../ui/modal-panel";
import type { ReactNode } from "react";

type Props = {
  selectedDay: SelectedDayOverview;
  emptyDayEyebrow?: string;
  emptyDayQuestion?: string;
  weeklyDays?: WeeklyRhythmDay[];
  previousWeekAverageMinutes?: number;
  previousWeekAverageGross?: number;
  flowCurrency?: string;
  flowAvailable?: boolean;
  absenceTypes?: AbsenceTypeSetting[];
  restDay?: boolean;
  onMarkRestDay?: () => void;
  onRemoveRestDay?: () => void;
  restDayPending?: boolean;
  onQuickAdd: () => void;
  onDaySwipe?: (direction: -1 | 1) => void;
  onRhythmDaySelect?: (date: string) => void;
  onCreateAbsence: (absenceTypeId: string) => void;
  onConfigureAbsences?: () => void;
  onDeleteAbsence?: (activityId: string) => void;
  absencePending?: boolean;
  absenceError?: string | null;
  onEntrySelect?: (entryId: string) => void;
  timeTracker?: ReactNode;
  preview?: boolean;
};

export function DashboardOverview({
  selectedDay,
  emptyDayEyebrow,
  emptyDayQuestion,
  weeklyDays,
  previousWeekAverageMinutes,
  previousWeekAverageGross,
  flowCurrency,
  flowAvailable = true,
  absenceTypes = [],
  restDay = false,
  onMarkRestDay,
  onRemoveRestDay,
  restDayPending = false,
  onQuickAdd,
  onDaySwipe,
  onRhythmDaySelect,
  onCreateAbsence,
  onConfigureAbsences,
  onDeleteAbsence,
  absencePending = false,
  absenceError = null,
  onEntrySelect,
  timeTracker,
  preview = false
}: Props) {
  const { t } = useTranslation("dashboard");
  const [weeklyView, setWeeklyView] = useState<"flow" | "rhythm">(
    flowAvailable ? "flow" : "rhythm"
  );

  useEffect(() => {
    if (!flowAvailable) setWeeklyView("rhythm");
  }, [flowAvailable]);

  const hasWorkActivity = selectedDay.activities.some((activity) => activity.kind !== "ABSENCE");

  if (!selectedDay.entriesCount && !restDay && !preview) {
    return (
      <EmptyDayPrompt
        eyebrow={emptyDayEyebrow ?? t("emptyDay.eyebrow")}
        question={emptyDayQuestion ?? t("emptyDay.questionFallback")}
        absenceTypes={absenceTypes}
        restDayPending={restDayPending}
        absencePending={absencePending}
        absenceError={absenceError}
        onWorked={onQuickAdd}
        onRest={onMarkRestDay}
        onCreateAbsence={onCreateAbsence}
        onConfigureAbsences={onConfigureAbsences}
      />
    );
  }

  return (
    <div className="space-y-5 pb-6">
      {preview ? (
        <div className="space-y-2">
          <p className="hairline-text">{t("heading.previewEyebrow")}</p>
          <h1 className="text-3xl font-semibold tracking-[-0.07em] text-white">
            {selectedDay.label}
          </h1>
          <p className="text-sm leading-6 text-white/46">{t("heading.previewDescription")}</p>
        </div>
      ) : null}
      {hasWorkActivity ? (
        <DashboardDailySummaryCard selectedDay={selectedDay} onQuickAdd={onQuickAdd} />
      ) : null}
      <SelectedDayPanel
        selectedDay={selectedDay}
        absenceTypes={absenceTypes}
        restDay={restDay}
        onMarkRestDay={onMarkRestDay}
        onRemoveRestDay={onRemoveRestDay}
        restDayPending={restDayPending}
        onEntrySelect={onEntrySelect}
        onDaySwipe={onDaySwipe}
        onCreateAbsence={onCreateAbsence}
        onConfigureAbsences={onConfigureAbsences}
        onDeleteAbsence={onDeleteAbsence}
        absencePending={absencePending}
        absenceError={absenceError}
      />
      {timeTracker}
      <section aria-label={t("sections.thisWeek")}>
        <div className="mb-2.5 flex items-center justify-between gap-4 px-1">
          <p className="text-[0.68rem] font-medium uppercase tracking-[0.18em] text-[#10b981]/56">
            {t("sections.thisWeek")}
          </p>
          <div
            className="relative grid grid-cols-2 rounded-full border border-white/[0.07] bg-white/[0.025] p-[3px]"
            role="group"
            aria-label={t("weeklyHours.view")}
          >
            {(["flow", "rhythm"] as const).map((view) => (
              <button
                key={view}
                type="button"
                onClick={() => setWeeklyView(view)}
                disabled={view === "flow" && !flowAvailable}
                aria-pressed={weeklyView === view}
                title={view === "flow" && !flowAvailable
                  ? t("weeklyHours.mixedCurrencies")
                  : undefined}
                className={`relative isolate flex h-8 min-w-[4.35rem] items-center justify-center rounded-full px-3 text-[0.7rem] font-medium transition-colors duration-150 active:scale-[0.97] ${
                  weeklyView === view
                    ? "text-[#34d399]"
                    : "text-[#f5f5f5]/36 hover:text-[#f5f5f5]/58"
                } disabled:cursor-not-allowed disabled:opacity-30`}
              >
                {weeklyView === view ? (
                  <motion.span
                    layoutId="dashboard-weekly-view"
                    className="absolute inset-0 -z-10 rounded-full border border-[#10b981]/18 bg-[#10b981]/[0.09]"
                    transition={{ type: "spring", stiffness: 620, damping: 40, mass: 0.58 }}
                  />
                ) : null}
                <span>
                  {t(view === "flow" ? "weeklyHours.flowEyebrow" : "weeklyHours.eyebrow")}
                </span>
              </button>
            ))}
          </div>
        </div>
        {!flowAvailable ? (
          <p className="-mt-1 mb-3 px-1 text-xs leading-5 text-[#f5f5f5]/34">
            {t("weeklyHours.mixedCurrencies")}
          </p>
        ) : null}
        <WeeklyHoursCard
          variant={weeklyView}
          days={weeklyDays}
          previousWeekAverageMinutes={previousWeekAverageMinutes}
          previousWeekAverageGross={previousWeekAverageGross}
          flowCurrency={flowCurrency}
          onDaySelect={onRhythmDaySelect}
        />
      </section>
    </div>
  );
}

function EmptyDayPrompt({
  eyebrow,
  question,
  absenceTypes,
  restDayPending,
  absencePending,
  absenceError,
  onWorked,
  onRest,
  onCreateAbsence,
  onConfigureAbsences
}: {
  eyebrow: string;
  question: string;
  absenceTypes: AbsenceTypeSetting[];
  restDayPending: boolean;
  absencePending: boolean;
  absenceError: string | null;
  onWorked: () => void;
  onRest?: () => void;
  onCreateAbsence: (absenceTypeId: string) => void;
  onConfigureAbsences?: () => void;
}) {
  const { t } = useTranslation("dashboard");
  const [absenceOpen, setAbsenceOpen] = useState(false);

  return (
    <section className="dashboard-empty-prompt pb-8 pt-9" aria-labelledby="empty-day-question">
      <p className="hairline-text text-center">{eyebrow}</p>
      <h1
        id="empty-day-question"
        className="mx-auto mt-3 max-w-[20rem] text-center text-[2.15rem] font-semibold leading-[1.08] tracking-[-0.06em] text-white"
      >
        {question}
      </h1>
      <div className="dashboard-empty-choice-card mt-10 overflow-hidden rounded-[28px] border">
        <button
          type="button"
          onClick={onWorked}
          className="dashboard-day-choice dashboard-day-choice--primary group flex min-h-[76px] w-full items-center gap-4 px-5 text-left transition-colors focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#10b981]"
        >
          <span className="dashboard-day-choice-icon grid h-11 w-11 shrink-0 place-items-center rounded-full">
            <Briefcase className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span className="text-base font-semibold tracking-[-0.025em]">{t("emptyDay.worked")}</span>
          <ChevronRight className="ml-auto h-4 w-4 opacity-35" strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onRest}
          disabled={!onRest || restDayPending}
          className="dashboard-day-choice flex min-h-[76px] w-full items-center gap-4 border-t px-5 text-left transition-colors focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#10b981] disabled:opacity-45"
        >
          <span className="dashboard-day-choice-icon grid h-11 w-11 shrink-0 place-items-center rounded-full">
            <Coffee className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span className="text-base font-semibold tracking-[-0.025em]">{t("emptyDay.rested")}</span>
          <ChevronRight className="ml-auto h-4 w-4 opacity-35" strokeWidth={2} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setAbsenceOpen(true)}
          className="dashboard-day-choice flex min-h-[76px] w-full items-center gap-4 border-t px-5 text-left transition-colors focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#10b981]"
        >
          <span className="dashboard-day-choice-icon grid h-11 w-11 shrink-0 place-items-center rounded-full">
            <CalendarX className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span className="text-base font-semibold tracking-[-0.025em]">{t("emptyDay.absent")}</span>
          <ChevronRight className="ml-auto h-4 w-4 opacity-35" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      {absenceError ? <p className="mt-4 px-2 text-sm text-red-200/90">{absenceError}</p> : null}
      <AbsenceChooser
        open={absenceOpen}
        pending={absencePending}
        onClose={() => setAbsenceOpen(false)}
        onSelect={(absenceTypeId) => {
          onCreateAbsence(absenceTypeId);
          setAbsenceOpen(false);
        }}
        onConfigure={onConfigureAbsences
          ? () => {
              setAbsenceOpen(false);
              onConfigureAbsences();
            }
          : undefined}
        absenceTypes={absenceTypes}
      />
    </section>
  );
}

function SelectedDayPanel({
  selectedDay,
  absenceTypes,
  restDay,
  onMarkRestDay,
  onRemoveRestDay,
  restDayPending,
  onEntrySelect,
  onDaySwipe,
  onCreateAbsence,
  onConfigureAbsences,
  onDeleteAbsence,
  absencePending,
  absenceError
}: {
  selectedDay: SelectedDayOverview;
  absenceTypes: AbsenceTypeSetting[];
  restDay: boolean;
  onMarkRestDay?: () => void;
  onRemoveRestDay?: () => void;
  restDayPending: boolean;
  onEntrySelect?: (entryId: string) => void;
  onDaySwipe?: (direction: -1 | 1) => void;
  onCreateAbsence: (absenceTypeId: string) => void;
  onConfigureAbsences?: () => void;
  onDeleteAbsence?: (activityId: string) => void;
  absencePending: boolean;
  absenceError: string | null;
}) {
  const { t } = useTranslation("dashboard");
  const [absenceOpen, setAbsenceOpen] = useState(false);

  function handleAbsence(absenceTypeId: string) {
    onCreateAbsence(absenceTypeId);
    setAbsenceOpen(false);
  }

  const swipeProps = {
    drag: onDaySwipe ? "x" as const : false,
    dragConstraints: { left: 0, right: 0 },
    dragElastic: 0.08,
    dragDirectionLock: true,
    onDragEnd: (_: unknown, info: Parameters<typeof resolveDaySwipeDirection>[0]) => {
      const direction = resolveDaySwipeDirection(info);
      if (direction !== 0) {
        onDaySwipe?.(direction);
      }
    }
  };

  if (restDay) {
    return (
      <motion.section {...swipeProps} className="touch-pan-y">
        <Card variant="ambient" className="dashboard-primary-card flex min-h-[72px] items-center gap-3 px-4 py-3">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full bg-white/35"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="font-semibold tracking-[-0.03em] text-white">
              {t("restDay.title")}
            </p>
            <p className="mt-0.5 truncate text-sm text-white/42">
              {t("restDay.description")}
            </p>
          </div>
          {onRemoveRestDay ? (
            <button
              type="button"
              disabled={restDayPending}
              onClick={onRemoveRestDay}
              aria-label={t("restDay.remove")}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/38 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </Card>
        {absenceError ? <p className="mt-3 px-2 text-sm text-red-200/90">{absenceError}</p> : null}
      </motion.section>
    );
  }

  if (!selectedDay.entriesCount) {
    return (
      <motion.section {...swipeProps} className="space-y-3 touch-pan-y">
        <Card className="dashboard-empty-day overflow-hidden p-0 text-left">
          <div className="flex min-h-[54px] items-center gap-3 px-5 py-3">
            <span className="h-1.5 w-1.5 rounded-full bg-[#10b981]/55" aria-hidden="true" />
            <p className="text-sm font-medium text-[#f5f5f5]/52">{t("quickAdd.emptyDescription")}</p>
          </div>
          <div className="grid grid-cols-2 border-t border-[#10b981]/10">
            <button
              type="button"
              onClick={() => setAbsenceOpen(true)}
              className="min-h-11 border-r border-[#10b981]/10 px-4 text-sm font-medium text-[#f5f5f5]/58 transition hover:bg-[#10b981]/[0.04] hover:text-[#f5f5f5]"
            >
              {t("absence.cta")}
            </button>
            {onMarkRestDay ? (
              <button
                type="button"
                onClick={onMarkRestDay}
                disabled={restDayPending}
                className="min-h-11 px-4 text-sm font-medium text-[#f5f5f5]/58 transition hover:bg-[#10b981]/[0.04] hover:text-[#f5f5f5] disabled:opacity-50"
              >
                {t("restDay.cta")}
              </button>
            ) : null}
          </div>
        </Card>
        {absenceError ? <p className="px-2 text-sm text-red-200/90">{absenceError}</p> : null}
        <AbsenceChooser
          open={absenceOpen}
          pending={absencePending}
          onClose={() => setAbsenceOpen(false)}
          onSelect={handleAbsence}
          onConfigure={onConfigureAbsences
            ? () => {
                setAbsenceOpen(false);
                onConfigureAbsences();
              }
            : undefined}
          absenceTypes={absenceTypes}
        />
      </motion.section>
    );
  }

  const multiple = selectedDay.entriesCount > 1;

  return (
    <motion.section {...swipeProps} className="touch-pan-y">
      <p className="mb-3 px-1 text-[0.68rem] font-medium uppercase tracking-[0.18em] text-[#10b981]/56">
        {multiple
          ? t("selectedDay.activities", { count: selectedDay.entriesCount })
          : t("selectedDay.activity")}
      </p>
      <div className="space-y-3">
        {selectedDay.activities.map((activity) => (
          <SelectedDayActivityCard
            key={activity.id}
            activity={activity}
            onSelect={onEntrySelect}
            onDeleteAbsence={onDeleteAbsence}
          />
        ))}
        {selectedDay.activities.length > 1 ? (
          <div className="flex items-end justify-between gap-6 px-1 pt-2">
            <div>
              <p className="hairline-text mb-1">{t("selectedDay.dayTotal")}</p>
              <p className="text-base font-semibold tabular-nums text-white">
                {selectedDay.totalDuration}
              </p>
            </div>
            <p className="text-right text-base font-semibold tabular-nums text-white">
              {selectedDay.totalGross}
            </p>
          </div>
        ) : null}
      </div>
    </motion.section>
  );
}

function AbsenceChooser({
  open,
  pending,
  onClose,
  onSelect,
  onConfigure,
  absenceTypes
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSelect: (absenceTypeId: string) => void;
  onConfigure?: () => void;
  absenceTypes: AbsenceTypeSetting[];
}) {
  const { t } = useTranslation("dashboard");

  if (!open) {
    return null;
  }

  return (
    <LockedModalViewport
      className="z-50 bg-black/50 px-4 py-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="absence-title"
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={t("absence.cancel")}
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
      />
      <ModalPanel className="max-w-sm">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 id="absence-title" className="text-xl font-semibold tracking-[-0.06em] text-white">
            {t("absence.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-2 text-sm font-semibold text-white/48 transition hover:text-white"
          >
            {t("absence.cancel")}
          </button>
        </div>

        {absenceTypes.length ? (
          <div className="space-y-2">
            {absenceTypes.map((option) => (
            <Card
              as="button"
              key={option.id}
              type="button"
              disabled={pending}
              onClick={() => onSelect(option.id)}
              className="flex w-full items-center justify-between px-5 py-4 text-left transition hover:bg-white/[0.06] disabled:opacity-55"
            >
              <span className="font-name font-semibold tracking-[-0.03em] text-white">{option.name}</span>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: option.color }} aria-hidden="true" />
            </Card>
            ))}
          </div>
        ) : (
          <div className="rounded-[1.5rem] border border-dashed border-white/[0.14] bg-white/[0.025] px-5 py-6 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.08] text-white">
              <Plus className="h-5 w-5" aria-hidden="true" />
            </div>
            <p className="mt-4 font-semibold text-white">{t("absence.emptyTitle")}</p>
            <p className="mt-2 text-sm leading-6 text-white/52">{t("absence.emptyDescription")}</p>
            {onConfigure ? (
              <button
                type="button"
                onClick={onConfigure}
                className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-black transition active:scale-[0.985]"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t("absence.configure")}
              </button>
            ) : null}
          </div>
        )}
      </ModalPanel>
    </LockedModalViewport>
  );
}

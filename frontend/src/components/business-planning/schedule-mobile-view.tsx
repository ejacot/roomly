import { AlertTriangle, ChevronLeft, ChevronRight, UserRoundPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { i18n } from "../../i18n";
import { normalizeLanguage } from "../../i18n/language";
import type {
  StaffingSchedule,
  StaffingScheduleAssignment,
  StaffingScheduleRequirement,
} from "../../types/business-planning";
import { formatInterval, formatLongDate } from "./schedule-grid";

type Props = {
  schedule: StaffingSchedule;
  selectedDate: string;
  selectedRequirementId: string | null;
  canManage: boolean;
  onDateChange: (date: string) => void;
  onOpenRequirement: (requirement: StaffingScheduleRequirement, trigger: HTMLElement) => void;
  onEditAssignment: (assignment: StaffingScheduleAssignment, trigger: HTMLElement) => void;
};

export function ScheduleMobileView({
  schedule,
  selectedDate,
  selectedRequirementId,
  canManage,
  onDateChange,
  onOpenRequirement,
  onEditAssignment,
}: Props) {
  const { t } = useTranslation("business");
  const locale = normalizeLanguage(i18n.resolvedLanguage);
  const dayIndex = Math.max(0, schedule.days.findIndex((day) => day.date === selectedDate));
  const day = schedule.days[dayIndex] ?? schedule.days[0];
  if (!day) return null;
  const open = day.requirements.filter((requirement) => requirement.coverage.openPositions > 0);
  const assignments = day.requirements.flatMap((requirement) => requirement.assignments
    .filter((assignment) => assignment.status === "ASSIGNED")
    .map((assignment) => ({ assignment, requirement })));
  const statuses = schedule.members.flatMap((member) => member.dayStatuses
    .filter((entry) => entry.date === day.date)
    .map((entry) => ({ entry, member })));

  return (
    <section className="schedule-mobile" aria-label={t("planning.schedule.mobileTitle")}>
      <div className="schedule-mobile__days" role="tablist" aria-label={t("planning.schedule.chooseDay")}>
        {schedule.days.map((item) => (
          <button
            key={item.date}
            type="button"
            role="tab"
            aria-selected={item.date === day.date}
            onClick={() => onDateChange(item.date)}
          >
            <span>{new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(new Date(`${item.date}T12:00:00`))}</span>
            <strong>{new Date(`${item.date}T12:00:00`).getDate()}</strong>
            <i data-open={item.coverage.openPositions > 0 || undefined} />
          </button>
        ))}
      </div>

      <header className="schedule-mobile__day-header">
        <button
          type="button"
          disabled={dayIndex === 0}
          aria-label={t("planning.week.previousDay")}
          onClick={() => onDateChange(schedule.days[dayIndex - 1]?.date ?? day.date)}
        ><ChevronLeft aria-hidden="true" /></button>
        <div>
          <span>{t("planning.schedule.selectedDay")}</span>
          <h2>{formatLongDate(day.date, locale)}</h2>
        </div>
        <button
          type="button"
          disabled={dayIndex === schedule.days.length - 1}
          aria-label={t("planning.week.nextDay")}
          onClick={() => onDateChange(schedule.days[dayIndex + 1]?.date ?? day.date)}
        ><ChevronRight aria-hidden="true" /></button>
      </header>

      <div className="schedule-mobile__coverage">
        <span>{t("planning.schedule.dayCoverage")}</span>
        <strong>{day.coverage.effectiveAssigned}/{day.coverage.required}</strong>
        <b>{Number(day.coverage.percentage).toFixed(0)}%</b>
        <i><em style={{ width: `${Math.min(100, Number(day.coverage.percentage))}%` }} /></i>
      </div>

      <section className="schedule-mobile__section">
        <header>
          <h3>{t("planning.schedule.openPositions")}</h3>
          <span>{day.coverage.openPositions}</span>
        </header>
        {open.length === 0 ? <p>{t("planning.schedule.dayFullyCovered")}</p> : (
          <div className="schedule-mobile__open-list">
            {open.map((requirement) => (
              <button
                type="button"
                key={requirement.requirementId}
                className={selectedRequirementId === requirement.requirementId ? "is-selected" : ""}
                disabled={!canManage}
                onClick={(event) => onOpenRequirement(requirement, event.currentTarget)}
              >
                <UserRoundPlus aria-hidden="true" />
                <span>
                  <strong>{requirement.workTypeName}</strong>
                  <small>{formatInterval(requirement.startTime, requirement.endTime)}</small>
                </span>
                <b>{requirement.coverage.effectiveAssigned}/{requirement.requiredWorkers}</b>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="schedule-mobile__section">
        <header>
          <h3>{t("planning.schedule.peopleToday")}</h3>
          <span>{assignments.length}</span>
        </header>
        {assignments.length === 0 ? <p>{t("planning.schedule.noAssignments")}</p> : (
          <div className="schedule-mobile__people">
            {assignments.map(({ assignment, requirement }) => (
              <button
                type="button"
                key={assignment.assignmentId}
                disabled={!canManage}
                data-conflict={assignment.issueKeys.length > 0 || undefined}
                aria-label={t("planning.schedule.editAssignmentLabel", {
                  member: assignment.memberDisplayName,
                  code: requirement.workTypeName,
                  date: formatLongDate(day.date, locale),
                })}
                onClick={(event) => onEditAssignment(assignment, event.currentTarget)}
              >
                <span>
                  <strong>{assignment.memberDisplayName}</strong>
                  <small>{requirement.workTypeName} · {formatInterval(assignment.startTime, assignment.endTime)}</small>
                </span>
                {assignment.issueKeys.length > 0 ? <AlertTriangle aria-label={t("planning.schedule.conflict")} /> : null}
              </button>
            ))}
          </div>
        )}
      </section>

      {statuses.length > 0 ? (
        <section className="schedule-mobile__section">
          <header><h3>{t("planning.schedule.timeAway")}</h3><span>{statuses.length}</span></header>
          <div className="schedule-mobile__statuses">
            {statuses.map(({ entry, member }) => (
              <div key={`${member.membershipId}:${entry.date}:${entry.status}`} data-status={entry.pending ? "PENDING" : entry.status}>
                <strong>{member.displayName}</strong>
                <span>{t(`planning.schedule.status.${entry.pending ? "PENDING" : entry.status}`, { defaultValue: entry.status })}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}

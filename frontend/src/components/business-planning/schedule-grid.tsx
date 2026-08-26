import { AlertTriangle, Clock3, UserRoundPlus } from "lucide-react";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "../../i18n";
import { normalizeLanguage } from "../../i18n/language";
import type {
  StaffingSchedule,
  StaffingScheduleAssignment,
  StaffingScheduleMember,
  StaffingScheduleRequirement,
} from "../../types/business-planning";

type Props = {
  schedule: StaffingSchedule;
  workTypeColors: ReadonlyMap<string, string>;
  selectedRequirementId: string | null;
  canManage: boolean;
  onOpenRequirement: (requirement: StaffingScheduleRequirement, trigger: HTMLElement) => void;
  onOpenMemberDay: (member: StaffingScheduleMember, date: string, trigger: HTMLElement) => void;
  onOpenMemberWeek: (member: StaffingScheduleMember, trigger: HTMLElement) => void;
  onEditAssignment: (assignment: StaffingScheduleAssignment, trigger: HTMLElement) => void;
  onReorderMembers: (membershipIds: string[]) => void;
};

type MemberSort = "first-name" | "last-name" | "date-added" | "work-type" | "manual";

export function ScheduleGrid({
  schedule,
  workTypeColors,
  selectedRequirementId,
  canManage,
  onOpenRequirement,
  onOpenMemberDay,
  onOpenMemberWeek,
  onEditAssignment,
  onReorderMembers,
}: Props) {
  const { t } = useTranslation("business");
  const locale = normalizeLanguage(i18n.resolvedLanguage);
  const [showWeeklyHours, setShowWeeklyHours] = useState(false);
  const [memberSort, setMemberSort] = useState<MemberSort>("manual");
  const [manualOrder, setManualOrder] = useState<string[] | null>(null);
  const [draggingMemberId, setDraggingMemberId] = useState<string | null>(null);
  const gestureStart = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const suppressNextClick = useRef(false);
  const memberPress = useRef<{ membershipId: string; pointerId: number; startX: number; startY: number; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const assignments = assignmentIndex(schedule);
  const issueIndex = new Map(schedule.issues.map((issue) => [issue.issueKey, issue]));
  const sortedMembers = useMemo(() => sortMembers(schedule.members, memberSort, assignments), [schedule.members, memberSort, assignments]);
  const visibleMembers = useMemo(() => {
    if (!manualOrder) return sortedMembers;
    const byId = new Map(schedule.members.map((member) => [member.membershipId, member]));
    return [...manualOrder.map((id) => byId.get(id)).filter((member): member is StaffingScheduleMember => Boolean(member)),
      ...sortedMembers.filter((member) => !manualOrder.includes(member.membershipId))];
  }, [manualOrder, schedule.members, sortedMembers]);

  const finishGesture = (pointerId: number, x: number, y: number) => {
    const start = gestureStart.current;
    gestureStart.current = null;
    if (!start || start.pointerId !== pointerId) return;
    const distance = x - start.x;
    const verticalDistance = y - start.y;
    // This intentionally matches the work-type swipe: a short, clearly horizontal
    // gesture is enough, while ordinary vertical page scrolling is ignored.
    if (Math.abs(distance) < 24 || Math.abs(distance) <= Math.abs(verticalDistance)) return;
    const nextShowWeeklyHours = distance < 0;
    if (nextShowWeeklyHours === showWeeklyHours) return;
    suppressNextClick.current = true;
    setShowWeeklyHours(nextShowWeeklyHours);
  };

  const clearMemberPress = () => {
    if (memberPress.current?.timer) clearTimeout(memberPress.current.timer);
    memberPress.current = null;
  };
  const reorderMembers = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const ids = visibleMembers.map((member) => member.membershipId);
    const from = ids.indexOf(fromId); const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1); ids.splice(to, 0, fromId);
    setManualOrder(ids); setMemberSort("manual");
    onReorderMembers(ids);
  };

  const finishMemberPress = (pointerId: number) => {
    const press = memberPress.current;
    if (!press || press.pointerId !== pointerId) return;
    clearMemberPress();
    // A long press only selects a row.  The next tap places it before that row,
    // so normal one-finger page scrolling remains entirely native on tablets.
    if (draggingMemberId === press.membershipId) suppressNextClick.current = true;
  };

  return (
    <section
      className={`schedule-grid${showWeeklyHours ? " is-showing-week-hours" : ""}`}
      aria-labelledby="schedule-grid-title"
      onPointerDown={(event) => {
        gestureStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => finishGesture(event.pointerId, event.clientX, event.clientY)}
      onPointerCancel={() => { gestureStart.current = null; }}
      onClickCapture={(event) => {
        if (!suppressNextClick.current) return;
        suppressNextClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <header className="schedule-grid__heading">
        <div>
          <h2 id="schedule-grid-title">{t("planning.schedule.gridTitle")}</h2>
          <p>{draggingMemberId
            ? "Employee selected — scroll normally, then tap a person to place them before that row."
            : t("planning.schedule.gridHint")}</p>
        </div>
        <div className="schedule-grid__tools">
          <label className="schedule-grid__sort">
            <span>Sort people</span>
            <select aria-label="Sort employees" value={memberSort} onChange={(event) => { const next = event.target.value as MemberSort; setMemberSort(next); if (next !== "manual") setManualOrder(null); }}>
              <option value="first-name">First name</option>
              <option value="last-name">Last name</option>
              <option value="date-added">Date added</option>
              <option value="work-type">Work type</option>
              <option value="manual">Custom order</option>
            </select>
          </label>
          <div className="schedule-grid__legend" aria-label={t("planning.schedule.legend")}>
            <span data-status="VACATION">U · {t("planning.schedule.status.VACATION")}</span>
            <span data-status="REST_DAY">F · {t("planning.schedule.status.REST_DAY")}</span>
            <span data-status="SICK">S · {t("planning.schedule.status.SICK")}</span>
            <span data-status="PENDING">? · {t("planning.schedule.status.PENDING")}</span>
            <span data-status="CONFLICT">! · {t("planning.schedule.status.CONFLICT")}</span>
          </div>
        </div>
      </header>
      <div className="schedule-grid__scroller" role="region" aria-label={t("planning.schedule.gridTitle")}>
        <table>
          <ScheduleColumnGroup showWeeklyHours={showWeeklyHours} />
          <caption className="sr-only">{t("planning.schedule.tableCaption")}</caption>
          <thead>
            <ScheduleHeader schedule={schedule} locale={locale} t={t} showWeeklyHours={showWeeklyHours} />
          </thead>
          <tbody>
            <tr className="schedule-grid__open-row">
              <th scope="row">
                <UserRoundPlus aria-hidden="true" />
                <span>
                  <strong>{t("planning.schedule.openPositions")}</strong>
                  <small>{t("planning.schedule.selectPosition")}</small>
                </span>
              </th>
              {schedule.days.map((day) => {
                const open = day.requirements.filter((requirement) => requirement.coverage.openPositions > 0);
                return (
                  <td key={day.date} data-empty={open.length === 0 || undefined}>
                    {open.length === 0 ? <span aria-label={t("planning.schedule.noOpenPositions")}>—</span> : null}
                    {open.map((requirement) => (
                      <button
                        type="button"
                        key={requirement.requirementId}
                        className={selectedRequirementId === requirement.requirementId ? "is-selected" : ""}
                        data-work-type-color={workTypeColors.has(requirement.workTypeId) || undefined}
                        style={workTypeStyle(requirement.workTypeId, workTypeColors)}
                        disabled={!canManage}
                        aria-label={t("planning.schedule.assignPosition", {
                          code: requirement.workTypeName,
                          date: formatLongDate(requirement.date, locale),
                          count: requirement.coverage.openPositions,
                        })}
                        onClick={(event) => onOpenRequirement(requirement, event.currentTarget)}
                      >
                        <strong>{requirement.workTypeName}</strong>
                        <span>{requirement.coverage.effectiveAssigned}/{requirement.requiredWorkers}</span>
                        <small>{formatInterval(requirement.startTime, requirement.endTime)}</small>
                      </button>
                    ))}
                  </td>
                );
              })}
              {showWeeklyHours ? <td aria-hidden="true">—</td> : null}
            </tr>
            {visibleMembers.map((member) => (
              <tr key={member.membershipId} data-member-id={member.membershipId} data-dragging={draggingMemberId === member.membershipId || undefined}>
                <th scope="row">
                  <button
                    type="button"
                    className="schedule-grid__member"
                    disabled={!canManage}
                    aria-label={t("planning.schedule.assignWeekForMember", {
                      member: member.displayName,
                      defaultValue: "Assign work across the week for {{member}}",
                    })}
                    onPointerDown={(event) => {
                      if (!canManage) return;
                      const timer = setTimeout(() => {
                        if (memberPress.current?.membershipId !== member.membershipId) return;
                        setDraggingMemberId(member.membershipId);
                      }, 420);
                      memberPress.current = { membershipId: member.membershipId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, timer };
                    }}
                    onPointerMove={(event) => {
                      const press = memberPress.current;
                      if (!press || press.pointerId !== event.pointerId) return;
                      if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) > 8) {
                        clearMemberPress();
                      }
                    }}
                    onPointerUp={(event) => finishMemberPress(event.pointerId)}
                    onPointerCancel={() => { clearMemberPress(); }}
                    onClick={(event) => {
                      if (draggingMemberId) {
                        if (draggingMemberId === member.membershipId) {
                          setDraggingMemberId(null);
                        } else {
                          reorderMembers(draggingMemberId, member.membershipId);
                          setDraggingMemberId(null);
                        }
                        return;
                      }
                      onOpenMemberWeek(member, event.currentTarget);
                    }}
                  >
                    <strong>{member.displayName}</strong>
                    <small>{t(`memberStatus.${member.membershipStatus}`)}</small>
                  </button>
                </th>
                {schedule.days.map((day) => {
                  const dayAssignments = member.assignmentIds
                    .map((id) => assignments.get(id))
                    .filter((value): value is IndexedAssignment => value?.requirement.date === day.date)
                    .sort((left, right) => assignmentStart(left).localeCompare(assignmentStart(right)));
                  const status = member.dayStatuses.find((entry) => entry.date === day.date);
                  // A manager can set a day status or deliberately overstaff a
                  // requirement.  Open positions are a planning hint, not a
                  // condition for opening an employee's day menu.
                  const canAssignFromCell = canManage && !status;
                  const hasConflict = dayAssignments.some(({ assignment }) => assignment.issueKeys
                    .some((key) => issueIndex.get(key)?.severity === "BLOCKING_CONFLICT"));
                  return (
                    <td
                      key={day.date}
                      data-target={selectedRequirementId && day.requirements.some((item) => item.requirementId === selectedRequirementId) || undefined}
                      data-assignable={canAssignFromCell || undefined}
                      role={canAssignFromCell ? "button" : undefined}
                      tabIndex={canAssignFromCell ? 0 : undefined}
                      aria-label={canAssignFromCell ? t("planning.schedule.chooseWorkForMember", {
                        member: member.displayName,
                        date: formatLongDate(day.date, locale),
                        defaultValue: "Choose work for {{member}} on {{date}}",
                      }) : undefined}
                      onClick={canAssignFromCell ? (event) => {
                        if (event.target === event.currentTarget) {
                          onOpenMemberDay(member, day.date, event.currentTarget);
                        }
                      } : undefined}
                      onKeyDown={canAssignFromCell ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onOpenMemberDay(member, day.date, event.currentTarget);
                        }
                      } : undefined}
                    >
                      {status ? (
                        <button
                          type="button"
                          className="schedule-grid__status"
                          data-status={status.pending ? "PENDING" : status.status}
                          disabled={!canManage || status.source !== "MEMBER_DAY"}
                          aria-label={`Edit ${statusCode(status.status, status.pending)} for ${member.displayName}`}
                          onClick={(event) => onOpenMemberDay(member, day.date, event.currentTarget)}
                        >
                          <strong>{statusCode(status.status, status.pending)}</strong>
                          <small>{t(`planning.schedule.status.${status.pending ? "PENDING" : status.status}`, { defaultValue: status.status })}</small>
                        </button>
                      ) : null}
                      {dayAssignments.length === 2 ? <div className="schedule-grid__assignment-pair">{dayAssignments.map((item) => <ScheduleAssignmentCard key={item.assignment.assignmentId} item={item} memberName={member.displayName} date={day.date} locale={locale} hasConflict={hasConflict} canManage={canManage} workTypeColors={workTypeColors} t={t} onEditAssignment={onEditAssignment} />)}</div> : dayAssignments.map((item) => <ScheduleAssignmentCard key={item.assignment.assignmentId} item={item} memberName={member.displayName} date={day.date} locale={locale} hasConflict={hasConflict} canManage={canManage} workTypeColors={workTypeColors} t={t} onEditAssignment={onEditAssignment} />)}
                    </td>
                  );
                })}
                {showWeeklyHours ? (
                  <td className="schedule-grid__week-total">
                    <Clock3 aria-hidden="true" />
                    <strong>{formatMinutes(weeklyMinutes(member.assignmentIds, assignments))}</strong>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function workTypeStyle(workTypeId: string, colors: ReadonlyMap<string, string>): CSSProperties | undefined {
  const color = colors.get(workTypeId);
  return color ? { "--schedule-work-type-color": color } as CSSProperties : undefined;
}

function ScheduleAssignmentCard({ item, memberName, date, locale, hasConflict, canManage, workTypeColors, t, onEditAssignment }: {
  item: IndexedAssignment; memberName: string; date: string; locale: string; hasConflict: boolean; canManage: boolean;
  workTypeColors: ReadonlyMap<string, string>; t: ReturnType<typeof useTranslation>["t"];
  onEditAssignment: Props["onEditAssignment"];
}) {
  const { assignment, requirement } = item;
  return <button
    type="button"
    className="schedule-grid__assignment"
    data-conflict={hasConflict || undefined}
    data-work-type-color={workTypeColors.has(requirement.workTypeId) || undefined}
    style={workTypeStyle(requirement.workTypeId, workTypeColors)}
    disabled={!canManage}
    aria-label={t("planning.schedule.editAssignmentLabel", { member: memberName, code: requirement.workTypeName, date: formatLongDate(date, locale) })}
    onClick={(event) => onEditAssignment(assignment, event.currentTarget)}
  >
    <strong>{requirement.workTypeName}</strong>
    <span>{formatInterval(assignment.startTime, assignment.endTime)}</span>
    {hasConflict ? <AlertTriangle aria-label={t("planning.schedule.conflict")} /> : null}
  </button>;
}

function assignmentStart({ assignment, requirement }: IndexedAssignment) {
  return assignment.startTime ?? requirement.startTime ?? "99:99:99";
}

function ScheduleColumnGroup({ showWeeklyHours }: { showWeeklyHours: boolean }) {
  return (
    <colgroup>
      <col className="schedule-grid__member-column" />
      <col span={7} />
      {showWeeklyHours ? <col className="schedule-grid__hours-column" /> : null}
    </colgroup>
  );
}

function ScheduleHeader({
  schedule,
  locale,
  t,
  showWeeklyHours,
}: Pick<Props, "schedule"> & { locale: string; t: ReturnType<typeof useTranslation>["t"]; showWeeklyHours: boolean }) {
  return (
    <tr>
      <th scope="col" className="schedule-grid__member-column">
        {t("planning.schedule.employee")}
      </th>
      {schedule.days.map((day) => (
        <th key={day.date} scope="col">
          <span>{formatWeekday(day.date, locale)}</span>
          <strong>{formatDay(day.date, locale)}</strong>
          <small data-open={day.coverage.openPositions > 0 || undefined}>
            {day.coverage.openPositions > 0
              ? t("planning.schedule.openCount", { count: day.coverage.openPositions })
              : t("planning.schedule.covered")}
          </small>
        </th>
      ))}
      {showWeeklyHours ? (
        <th scope="col" className="schedule-grid__hours-column">
          {t("planning.schedule.weekHours")}
        </th>
      ) : null}
    </tr>
  );
}

type IndexedAssignment = {
  assignment: StaffingScheduleAssignment;
  requirement: StaffingScheduleRequirement;
};

function assignmentIndex(schedule: StaffingSchedule) {
  const result = new Map<string, IndexedAssignment>();
  for (const day of schedule.days) {
    for (const requirement of day.requirements) {
      for (const assignment of requirement.assignments) {
        if (assignment.status !== "ASSIGNED") continue;
        result.set(assignment.assignmentId, { assignment, requirement });
      }
    }
  }
  return result;
}

function sortMembers(
  members: StaffingScheduleMember[],
  sort: MemberSort,
  assignments: Map<string, IndexedAssignment>,
) {
  const collator = new Intl.Collator(normalizeLanguage(i18n.resolvedLanguage), { sensitivity: "base" });
  const namePart = (member: StaffingScheduleMember, part: "first" | "last") => {
    const words = member.displayName.trim().split(/\s+/).filter(Boolean);
    return part === "first" ? words[0] ?? "" : words.slice(1).join(" ") || words[0] || "";
  };
  if (sort === "manual") return [...members];
  const workType = (member: StaffingScheduleMember) => member.assignmentIds
    .map((id) => assignments.get(id)?.requirement.workTypeName ?? "")
    .filter(Boolean).sort((left, right) => collator.compare(left, right))[0] ?? "\uffff";
  return [...members].sort((left, right) => {
    if (sort === "date-added") {
      const comparison = (right.createdAt ?? "").localeCompare(left.createdAt ?? "");
      return comparison || collator.compare(left.displayName, right.displayName);
    }
    const comparison = sort === "work-type"
      ? collator.compare(workType(left), workType(right))
      : collator.compare(namePart(left, sort === "first-name" ? "first" : "last"), namePart(right, sort === "first-name" ? "first" : "last"));
    return comparison || collator.compare(left.displayName, right.displayName);
  });
}

function weeklyMinutes(ids: string[], assignments: Map<string, IndexedAssignment>) {
  return ids.reduce((total, id) => {
    const assignment = assignments.get(id)?.assignment;
    if (!assignment?.startTime || !assignment.endTime) return total;
    return total + intervalMinutes(assignment.startTime, assignment.endTime);
  }, 0);
}

function intervalMinutes(start: string, end: string) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  return Math.max(0, endHour * 60 + endMinute - startHour * 60 - startMinute);
}

export function formatMinutes(value: number) {
  return `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}m`;
}

export function formatInterval(start: string | null, end: string | null) {
  if (start && !end) return start.slice(0, 5);
  if (!start || !end) return "—";
  return `${start.slice(0, 5)}–${end.slice(0, 5)}`;
}

function formatWeekday(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(`${value}T12:00:00`));
}

function formatDay(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit" }).format(new Date(`${value}T12:00:00`));
}

export function formatLongDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" })
    .format(new Date(`${value}T12:00:00`));
}

function statusCode(status: string, pending: boolean) {
  if (pending) return "?";
  if (status === "VACATION") return "U";
  if (status === "REST_DAY") return "F";
  if (status === "SICK") return "S";
  return status.slice(0, 1);
}

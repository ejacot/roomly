import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, LoaderCircle, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  batchStaffingAssignments,
  cancelStaffingAssignment,
  createStaffingAssignment,
  findStaffingPlan,
  getStaffingAssignmentCandidates,
  getStaffingSchedule,
  reorderStaffingMembers,
  updateStaffingAssignment,
} from "../api/business-planning";
import { getApiError } from "../api/api-errors";
import { listBusinessWorkTypes, listOrganizations, listOrganizationUnits, removeStaffingDayEntry, setStaffingDayEntry } from "../api/endpoints";
import {
  AssignmentCandidateInspector,
  AssignmentEditor,
  MemberDayRequirementPicker,
  MemberWeekAssignmentPicker,
} from "../components/business-planning/assignment-inspector";
import { BusinessPlanningShell } from "../components/business-planning/business-planning-shell";
import { ScheduleGrid } from "../components/business-planning/schedule-grid";
import { ScheduleMobileView } from "../components/business-planning/schedule-mobile-view";
import type {
  StaffingAssignmentCandidate,
  StaffingSchedule,
  StaffingScheduleMember,
  StaffingScheduleRequirement,
} from "../types/business-planning";
import "../styles/business-planning.css";
import "../styles/business-schedule.css";

type Notice = {
  type: "success" | "error" | "info";
  message: string;
  undo?: { assignmentId: string };
};

type MemberDayTarget = {
  member: StaffingScheduleMember;
  date: string;
};

export function BusinessSchedulePage() {
  const { t } = useTranslation("business");
  const { organizationId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedRequirementId, setSelectedRequirementId] = useState<string | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberDayTarget, setMemberDayTarget] = useState<MemberDayTarget | null>(null);
  const [memberWeekTarget, setMemberWeekTarget] = useState<StaffingScheduleMember | null>(null);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(null);
  const [replacingAssignmentId, setReplacingAssignmentId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [density, setDensity] = useState<"compact" | "comfortable">("comfortable");
  const [candidateReturnFocus, setCandidateReturnFocus] = useState<HTMLElement | null>(null);
  const [editorReturnFocus, setEditorReturnFocus] = useState<HTMLElement | null>(null);
  const operationKeys = useRef(new Map<string, string>());
  const contextRef = useRef("");

  const organizationsQuery = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const workTypesQuery = useQuery({
    queryKey: ["organizations", organizationId, "work-types"],
    queryFn: () => listBusinessWorkTypes(organizationId),
    enabled: Boolean(organizationId),
  });
  const workTypeColors = useMemo(
    () => new Map((workTypesQuery.data ?? []).map((workType) => [workType.id, workType.color])),
    [workTypesQuery.data],
  );
  const businessOrganizations = useMemo(
    () => (organizationsQuery.data ?? []).filter((item) => item.type === "BUSINESS"),
    [organizationsQuery.data],
  );
  const organization = businessOrganizations.find((item) => item.id === organizationId);
  const unitsQuery = useQuery({
    queryKey: ["organizations", organizationId, "units"],
    queryFn: () => listOrganizationUnits(organizationId),
    enabled: Boolean(organization),
  });
  const activeUnits = useMemo(
    () => (unitsQuery.data ?? []).filter((unit) => unit.active),
    [unitsQuery.data],
  );
  const requestedUnitId = searchParams.get("unit") ?? "";
  const unitId = activeUnits.some((unit) => unit.id === requestedUnitId)
    ? requestedUnitId
    : activeUnits[0]?.id ?? "";
  const weekStart = normalizeMonday(searchParams.get("week"));
  const weekEnd = addDays(weekStart, 6);
  const contextKey = `${organizationId}:${unitId}:${weekStart}`;

  useEffect(() => {
    if (!unitId || requestedUnitId === unitId) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("unit", unitId);
      next.set("week", weekStart);
      return next;
    }, { replace: true });
  }, [requestedUnitId, setSearchParams, unitId, weekStart]);

  useEffect(() => {
    contextRef.current = contextKey;
    setSelectedRequirementId(null);
    setSelectedMemberId(null);
    setMemberDayTarget(null);
    setMemberWeekTarget(null);
    setSelectedAssignmentId(null);
    setReplacingAssignmentId(null);
    setSelectedDate(weekStart);
    setNotice(null);
  }, [contextKey, weekStart]);

  const lookupQuery = useQuery({
    queryKey: ["staffing-plan", organizationId, unitId, weekStart],
    queryFn: () => findStaffingPlan(organizationId, unitId, weekStart),
    enabled: Boolean(organization && unitId),
    retry: false,
  });
  const lookedUpPlan = lookupQuery.data?.data.plan ?? null;
  const plan = lookedUpPlan?.unitId === unitId && lookedUpPlan.weekStart === weekStart
    ? lookedUpPlan
    : null;
  const scheduleQuery = useQuery({
    queryKey: ["staffing-plan", organizationId, plan?.planId, "schedule"],
    queryFn: () => getStaffingSchedule(organizationId, plan!.planId),
    enabled: Boolean(plan?.planId),
    retry: false,
  });
  const schedule = scheduleQuery.data?.data ?? null;
  const selectedRequirement = findRequirement(schedule, selectedRequirementId);
  const selectedAssignment = findAssignment(schedule, selectedAssignmentId)?.assignment ?? null;
  const selectedAssignmentRequirement = findAssignment(schedule, selectedAssignmentId)?.requirement ?? null;
  const replacingAssignment = findAssignment(schedule, replacingAssignmentId)?.assignment ?? null;
  const canManage = Boolean(plan?.capabilities.manage);

  const candidatesQuery = useQuery({
    queryKey: [
      "staffing-plan",
      organizationId,
      plan?.planId,
      "assignment-candidates",
      selectedRequirementId,
      schedule?.draftRevision,
    ],
    queryFn: () => getStaffingAssignmentCandidates(
      organizationId,
      plan!.planId,
      selectedRequirementId!,
    ),
    enabled: Boolean(plan && schedule && selectedRequirementId && canManage),
    retry: false,
  });
  const selectedMemberCandidate = selectedMemberId
    ? candidatesQuery.data?.data.candidates.find((candidate) =>
      candidate.membershipId === selectedMemberId) ?? null
    : null;

  const updateSearchContext = (nextUnitId: string, nextWeekStart: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("unit", nextUnitId);
    next.set("week", nextWeekStart);
    setSearchParams(next);
  };

  const refreshSchedule = async () => {
    if (!plan) return null;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["staffing-plan", organizationId, unitId, weekStart] }),
      queryClient.invalidateQueries({ queryKey: ["staffing-plan", organizationId, plan.planId, "assignment-candidates"] }),
    ]);
    const result = await scheduleQuery.refetch();
    return result.data?.data ?? null;
  };

  const handleMutationError = async (cause: unknown, startContext: string) => {
    if (contextRef.current !== startContext) return;
    const error = getApiError(cause);
    if (error.status === 412) {
      setNotice({ type: "info", message: t("planning.schedule.stale") });
      await refreshSchedule();
      return;
    }
    setNotice({ type: "error", message: error.message });
  };

  const assignCandidate = async (candidate: StaffingAssignmentCandidate) => {
    if (!plan || !schedule || !selectedRequirement || mutationBusy) return;
    const startContext = contextRef.current;
    const semanticKey = replacingAssignment
      ? `replace:${plan.planId}:${schedule.draftRevision}:${replacingAssignment.assignmentId}:${selectedRequirement.requirementId}:${candidate.membershipId}`
      : `assign:${plan.planId}:${schedule.draftRevision}:${selectedRequirement.requirementId}:${candidate.membershipId}`;
    setMutationBusy(true);
    try {
      if (replacingAssignment) {
        await batchStaffingAssignments(
          organizationId,
          plan.planId,
          currentEtag(schedule),
          stableOperationKey(operationKeys.current, semanticKey),
          [
            { operation: "CANCEL", assignmentId: replacingAssignment.assignmentId, create: null, update: null },
            {
              operation: "CREATE",
              assignmentId: null,
              create: {
                requirementId: selectedRequirement.requirementId,
                membershipId: candidate.membershipId,
                startTime: selectedRequirement.startTime,
                endTime: selectedRequirement.endTime,
              },
              update: null,
            },
          ],
        );
      } else {
        await createStaffingAssignment(
          organizationId,
          plan.planId,
          currentEtag(schedule),
          stableOperationKey(operationKeys.current, semanticKey),
          {
            requirementId: selectedRequirement.requirementId,
            membershipId: candidate.membershipId,
            startTime: selectedRequirement.startTime,
            endTime: selectedRequirement.endTime,
          },
        );
      }
      operationKeys.current.delete(semanticKey);
      const requirementId = selectedRequirement.requirementId;
      const next = await refreshSchedule();
      if (contextRef.current !== startContext) return;
      const created = findAssignmentByMember(next, requirementId, candidate.membershipId);
      setNotice({
        type: "success",
        message: t("planning.schedule.assignedConfirmation", {
          name: candidate.displayName,
          code: selectedRequirement.workTypeCode,
          day: weekday(selectedRequirement.date),
          interval: interval(selectedRequirement.startTime, selectedRequirement.endTime),
        }),
        undo: created ? { assignmentId: created.assignmentId } : undefined,
      });
      setSelectedRequirementId(null);
      setSelectedMemberId(null);
      setReplacingAssignmentId(null);
    } catch (cause) {
      await handleMutationError(cause, startContext);
    } finally {
      if (contextRef.current === startContext) setMutationBusy(false);
    }
  };

  const assignMemberWeek = async (requirements: StaffingScheduleRequirement[]) => {
    if (!plan || !schedule || !memberWeekTarget || mutationBusy || requirements.length === 0) return;
    const startContext = contextRef.current;
    const requirementIds = requirements.map((requirement) => requirement.requirementId).sort();
    const semanticKey = `assign-week:${plan.planId}:${schedule.draftRevision}:${memberWeekTarget.membershipId}:${requirementIds.join(",")}`;
    setMutationBusy(true);
    try {
      await batchStaffingAssignments(
        organizationId,
        plan.planId,
        currentEtag(schedule),
        stableOperationKey(operationKeys.current, semanticKey),
        requirements.map((requirement) => ({
          operation: "CREATE" as const,
          assignmentId: null,
          create: {
            requirementId: requirement.requirementId,
            membershipId: memberWeekTarget.membershipId,
            startTime: requirement.startTime,
            endTime: requirement.endTime,
          },
          update: null,
        })),
      );
      operationKeys.current.delete(semanticKey);
      await refreshSchedule();
      if (contextRef.current !== startContext) return;
      setNotice({
        type: "success",
        message: t("planning.schedule.assignedWeekConfirmation", {
          name: memberWeekTarget.displayName,
          count: requirements.length,
          defaultValue: "{{name}} assigned on {{count}} day(s).",
        }),
      });
      setMemberWeekTarget(null);
    } catch (cause) {
      await handleMutationError(cause, startContext);
    } finally {
      if (contextRef.current === startContext) setMutationBusy(false);
    }
  };

  const saveAssignment = async (startTime: string | null, endTime: string | null) => {
    if (!plan || !schedule || !selectedAssignment || mutationBusy) return;
    const startContext = contextRef.current;
    setMutationBusy(true);
    try {
      await updateStaffingAssignment(
        organizationId,
        plan.planId,
        selectedAssignment.assignmentId,
        currentEtag(schedule),
        { startTime, endTime },
      );
      await refreshSchedule();
      if (contextRef.current !== startContext) return;
      setSelectedAssignmentId(null);
      setNotice({ type: "success", message: t("planning.schedule.assignmentUpdated") });
    } catch (cause) {
      await handleMutationError(cause, startContext);
    } finally {
      if (contextRef.current === startContext) setMutationBusy(false);
    }
  };

  const cancelAssignment = async (assignmentId = selectedAssignment?.assignmentId) => {
    if (!plan || !schedule || !assignmentId || mutationBusy) return;
    const startContext = contextRef.current;
    setMutationBusy(true);
    try {
      await cancelStaffingAssignment(
        organizationId,
        plan.planId,
        assignmentId,
        currentEtag(schedule),
      );
      await refreshSchedule();
      if (contextRef.current !== startContext) return;
      setSelectedAssignmentId(null);
      setNotice({ type: "success", message: t("planning.schedule.assignmentCancelled") });
    } catch (cause) {
      await handleMutationError(cause, startContext);
    } finally {
      if (contextRef.current === startContext) setMutationBusy(false);
    }
  };

  const setMemberDayStatus = async (type: "REST_DAY" | "SICK" | "VACATION") => {
    if (!memberDayTarget || mutationBusy) return;
    const startContext = contextRef.current;
    setMutationBusy(true);
    try {
      await setStaffingDayEntry(organizationId, memberDayTarget.member.membershipId,
        memberDayTarget.date, type);
      await refreshSchedule();
      if (contextRef.current !== startContext) return;
      setMemberDayTarget(null);
      setSelectedMemberId(null);
      setSelectedRequirementId(null);
      setNotice({ type: "success", message: t(`planning.schedule.status.${type}`) });
    } catch (cause) {
      await handleMutationError(cause, startContext);
    } finally {
      if (contextRef.current === startContext) setMutationBusy(false);
    }
  };

  const removeMemberDayStatus = async () => {
    if (!memberDayTarget || mutationBusy) return;
    const startContext = contextRef.current;
    setMutationBusy(true);
    try {
      await removeStaffingDayEntry(organizationId, memberDayTarget.member.membershipId,
        memberDayTarget.date);
      await refreshSchedule();
      if (contextRef.current !== startContext) return;
      setMemberDayTarget(null);
      setSelectedMemberId(null);
      setSelectedRequirementId(null);
      setNotice({ type: "success", message: "Day status cleared" });
    } catch (cause) {
      await handleMutationError(cause, startContext);
    } finally {
      if (contextRef.current === startContext) setMutationBusy(false);
    }
  };

  if (organizationsQuery.isLoading) return <BusinessRouteSkeleton />;
  if (!organization) {
    return <BusinessState title={t("planning.states.notFoundTitle")} description={t("planning.states.notFoundDescription")} />;
  }
  if (unitsQuery.isLoading) return <BusinessRouteSkeleton />;
  if (activeUnits.length === 0) {
    return <BusinessState title={t("planning.states.noUnitTitle")} description={t("planning.states.noUnitDescription")} />;
  }

  return (
    <BusinessPlanningShell
      organizations={businessOrganizations}
      organizationId={organizationId}
      units={activeUnits}
      unitId={unitId}
      weekStart={weekStart}
      weekEnd={weekEnd}
      onOrganizationChange={(id) => navigate(`/business/${id}/plan/schedule?unit=${unitId}&week=${weekStart}`)}
      onUnitChange={(id) => updateSearchContext(id, weekStart)}
      onPreviousWeek={() => updateSearchContext(unitId, addDays(weekStart, -7))}
      onNextWeek={() => updateSearchContext(unitId, addDays(weekStart, 7))}
      onCurrentWeek={() => updateSearchContext(unitId, mondayIso(new Date()))}
    >
      <section className="business-schedule__intro">
        <div>
          <p>{t("planning.schedule.eyebrow")}</p>
          <h1>{t("planning.schedule.title")}</h1>
          <span>{t("planning.schedule.description")}</span>
        </div>
        <div className="business-schedule__density" role="group" aria-label={t("planning.schedule.density")}>
          <button type="button" className={density === "compact" ? "is-active" : ""} onClick={() => setDensity("compact")}>{t("planning.schedule.compact")}</button>
          <button type="button" className={density === "comfortable" ? "is-active" : ""} onClick={() => setDensity("comfortable")}>{t("planning.schedule.comfortable")}</button>
        </div>
      </section>

      {notice ? (
        <div className={`business-schedule__notice is-${notice.type}`} role={notice.type === "error" ? "alert" : "status"}>
          {notice.type === "success" ? <Check aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
          <span>{notice.message}</span>
          {notice.undo ? (
            <button type="button" disabled={mutationBusy} onClick={() => void cancelAssignment(notice.undo!.assignmentId)}>
              <RotateCcw aria-hidden="true" />{t("planning.schedule.undo")}
            </button>
          ) : null}
          <button type="button" onClick={() => setNotice(null)} aria-label={t("planning.close")}>×</button>
        </div>
      ) : null}

      {lookupQuery.isLoading || (plan && scheduleQuery.isLoading) ? <ScheduleLoading /> : null}
      {lookupQuery.isError || scheduleQuery.isError ? (
        <BusinessState
          compact
          title={t("planning.states.loadErrorTitle")}
          description={getApiError(lookupQuery.error ?? scheduleQuery.error).message}
          action={<button type="button" onClick={() => void (lookupQuery.isError ? lookupQuery.refetch() : scheduleQuery.refetch())}><RefreshCw aria-hidden="true" />{t("planning.retry")}</button>}
        />
      ) : null}
      {lookupQuery.data && !lookupQuery.data.data.found ? (
        <BusinessState
          compact
          title={t("planning.states.noPlanTitle")}
          description={t("planning.schedule.noPlanDescription")}
          action={<Link to={`/business/${organizationId}/plan/demand?unit=${unitId}&week=${weekStart}`}>{t("planning.schedule.openDemand")}</Link>}
        />
      ) : null}
      {schedule ? (
        <div className={`business-schedule is-${density}`}>
          <ScheduleCoverage schedule={schedule} />
          {schedule.days.every((day) => day.requirements.length === 0) ? (
            <BusinessState
              compact
              title={t("planning.schedule.emptyTitle")}
              description={t("planning.schedule.emptyDescription")}
              action={<Link to={`/business/${organizationId}/plan/demand?unit=${unitId}&week=${weekStart}`}>{t("planning.schedule.openDemand")}</Link>}
            />
          ) : (
            <>
              <ScheduleGrid
                schedule={schedule}
                workTypeColors={workTypeColors}
                selectedRequirementId={selectedRequirementId}
                canManage={canManage}
                onOpenRequirement={(requirement, trigger) => {
                  setCandidateReturnFocus(trigger);
                  setSelectedMemberId(null);
                  setReplacingAssignmentId(null);
                  setSelectedRequirementId(requirement.requirementId);
                }}
                onOpenMemberDay={(member, date, trigger) => {
                  setCandidateReturnFocus(trigger);
                  setSelectedMemberId(member.membershipId);
                  setMemberDayTarget({ member, date });
                }}
                onOpenMemberWeek={(member, trigger) => {
                  setCandidateReturnFocus(trigger);
                  setSelectedRequirementId(null);
                  setSelectedMemberId(null);
                  setMemberDayTarget(null);
                  setMemberWeekTarget(member);
                }}
                onEditAssignment={(assignment, trigger) => {
                  setEditorReturnFocus(trigger);
                  setSelectedAssignmentId(assignment.assignmentId);
                }}
                onReorderMembers={(membershipIds) => {
                  void reorderStaffingMembers(organizationId, membershipIds)
                    .then(() => refreshSchedule())
                    .catch((cause) => void handleMutationError(cause, contextRef.current));
                }}
              />
              <ScheduleMobileView
                schedule={schedule}
                selectedDate={selectedDate || schedule.weekStart}
                selectedRequirementId={selectedRequirementId}
                canManage={canManage}
                onDateChange={setSelectedDate}
                onOpenRequirement={(requirement, trigger) => {
                  setCandidateReturnFocus(trigger);
                  setSelectedMemberId(null);
                  setReplacingAssignmentId(null);
                  setSelectedRequirementId(requirement.requirementId);
                }}
                onEditAssignment={(assignment, trigger) => {
                  setEditorReturnFocus(trigger);
                  setSelectedAssignmentId(assignment.assignmentId);
                }}
              />
            </>
          )}
          {!canManage ? <p className="business-schedule__readonly">{t("planning.states.readOnly")}</p> : null}
        </div>
      ) : null}

      <AssignmentCandidateInspector
        open={Boolean(selectedRequirement) && !memberDayTarget}
        requirement={selectedRequirement}
        replacingAssignment={replacingAssignment}
        data={candidatesQuery.data?.data ?? null}
        loading={candidatesQuery.isLoading || candidatesQuery.isFetching}
        error={candidatesQuery.isError ? getApiError(candidatesQuery.error).message : null}
        busy={mutationBusy}
        preferredMembershipId={selectedMemberId}
        returnFocus={candidateReturnFocus}
        onClose={() => {
          setSelectedRequirementId(null);
          setSelectedMemberId(null);
          setReplacingAssignmentId(null);
        }}
        onRetry={() => void candidatesQuery.refetch()}
        onAssign={(candidate) => void assignCandidate(candidate)}
      />
      <MemberDayRequirementPicker
        open={Boolean(memberDayTarget)}
        memberName={memberDayTarget?.member.displayName ?? null}
        date={memberDayTarget?.date ?? null}
        requirements={(memberDayTarget
          ? schedule?.days.find((day) => day.date === memberDayTarget.date)?.requirements
          : []) ?? []}
        selectedRequirementId={memberDayTarget ? selectedRequirementId : null}
        checkingCandidate={candidatesQuery.isLoading || candidatesQuery.isFetching}
        busy={mutationBusy}
        returnFocus={candidateReturnFocus}
        onClose={() => {
          setMemberDayTarget(null);
          setSelectedMemberId(null);
        }}
        onChoose={(requirement) => {
          if (selectedRequirementId !== requirement.requirementId) {
            setReplacingAssignmentId(null);
            setSelectedRequirementId(requirement.requirementId);
            return;
          }
          if (!selectedMemberCandidate || candidatesQuery.isLoading || candidatesQuery.isFetching) {
            return;
          }
          setMemberDayTarget(null);
          if (selectedMemberCandidate.eligibility === "ELIGIBLE") {
            void assignCandidate(selectedMemberCandidate);
            return;
          }
          setReplacingAssignmentId(null);
        }}
        onSetDayStatus={(type) => void setMemberDayStatus(type)}
        currentDayStatus={memberDayTarget
          ? schedule?.members.find((member) => member.membershipId === memberDayTarget.member.membershipId)
            ?.dayStatuses.find((entry) => entry.date === memberDayTarget.date && entry.source === "MEMBER_DAY")?.status ?? null
          : null}
        onRemoveDayStatus={() => void removeMemberDayStatus()}
      />
      <MemberWeekAssignmentPicker
        member={memberWeekTarget}
        days={schedule?.days ?? []}
        busy={mutationBusy}
        returnFocus={candidateReturnFocus}
        onClose={() => setMemberWeekTarget(null)}
        onAssign={(requirements) => void assignMemberWeek(requirements)}
      />
      <AssignmentEditor
        assignment={selectedAssignment}
        requirement={selectedAssignmentRequirement}
        busy={mutationBusy}
        returnFocus={editorReturnFocus}
        onClose={() => setSelectedAssignmentId(null)}
        onSave={(start, end) => void saveAssignment(start, end)}
        onCancelAssignment={() => void cancelAssignment()}
        onReplace={() => {
          if (!selectedAssignmentRequirement || !selectedAssignment) return;
          setReplacingAssignmentId(selectedAssignment.assignmentId);
          setSelectedRequirementId(selectedAssignmentRequirement.requirementId);
          setSelectedAssignmentId(null);
        }}
      />
    </BusinessPlanningShell>
  );
}

function ScheduleCoverage({ schedule }: { schedule: StaffingSchedule }) {
  const { t } = useTranslation("business");
  return (
    <section className="business-schedule__coverage" aria-label={t("planning.coverage.title")}>
      <div><span>{t("planning.coverage.required")}</span><strong>{schedule.coverage.required}</strong></div>
      <div><span>{t("planning.coverage.assigned")}</span><strong>{schedule.coverage.effectiveAssigned}</strong></div>
      <div data-alert={schedule.coverage.openPositions > 0 || undefined}><span>{t("planning.coverage.open")}</span><strong>{schedule.coverage.openPositions}</strong></div>
      <div className="business-schedule__coverage-meter">
        <span>{t("planning.coverage.covered")}</span>
        <strong>{Number(schedule.coverage.percentage).toFixed(0)}%</strong>
        <i><b style={{ width: `${Math.min(100, Number(schedule.coverage.percentage))}%` }} /></i>
      </div>
    </section>
  );
}

function ScheduleLoading() {
  const { t } = useTranslation("business");
  return <div className="business-schedule__loading" role="status"><LoaderCircle className="is-spinning" aria-hidden="true" />{t("planning.schedule.loading")}</div>;
}

function BusinessRouteSkeleton() {
  return <div className="business-route-skeleton" aria-label="Loading Business workspace"><div /><div /><div /></div>;
}

function BusinessState({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <main className={`business-state${compact ? " is-compact" : ""}`}>
      <span>ALVERYN · BUSINESS</span><h1>{title}</h1><p>{description}</p>{action ? <div>{action}</div> : null}
    </main>
  );
}

function findRequirement(schedule: StaffingSchedule | null, requirementId: string | null) {
  if (!schedule || !requirementId) return null;
  return schedule.days.flatMap((day) => day.requirements).find((item) => item.requirementId === requirementId) ?? null;
}

function findAssignment(schedule: StaffingSchedule | null, assignmentId: string | null) {
  if (!schedule || !assignmentId) return null;
  for (const day of schedule.days) {
    for (const requirement of day.requirements) {
      const assignment = requirement.assignments.find((item) =>
        item.assignmentId === assignmentId && item.status === "ASSIGNED");
      if (assignment) return { assignment, requirement };
    }
  }
  return null;
}

function findAssignmentByMember(schedule: StaffingSchedule | null, requirementId: string, membershipId: string) {
  return findRequirement(schedule, requirementId)?.assignments.find((item) =>
    item.membershipId === membershipId && item.status === "ASSIGNED") ?? null;
}

function stableOperationKey(store: Map<string, string>, semanticKey: string) {
  const existing = store.get(semanticKey);
  if (existing) return existing;
  const value = `web-${operationId()}`;
  store.set(semanticKey, value);
  return value;
}

function operationId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint32Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(8, "0")).join("-");
}

function currentEtag(schedule: StaffingSchedule) {
  return schedule.etag.startsWith('"') ? schedule.etag : `"${schedule.etag}"`;
}

function interval(start: string | null, end: string | null) {
  return start && end ? `${start.slice(0, 5)}–${end.slice(0, 5)}` : "—";
}

function weekday(date: string) {
  return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(new Date(`${date}T12:00:00`));
}

function normalizeMonday(value: string | null) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T12:00:00`);
    if (!Number.isNaN(parsed.getTime()) && parsed.getDay() === 1) return value;
  }
  return mondayIso(new Date());
}

function mondayIso(date: Date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  return localIso(copy);
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return localIso(date);
}

function localIso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

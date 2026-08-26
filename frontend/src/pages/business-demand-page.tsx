import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  batchStaffingDemand,
  createStaffingPlan,
  createStaffingRequirement,
  deleteStaffingRequirement,
  findStaffingPlan,
  getStaffingDemand,
  updateStaffingRequirement,
} from "../api/business-planning";
import { getApiError } from "../api/api-errors";
import {
  getOrganizationAccess,
  listBusinessWorkTypes,
  listOrganizations,
  listOrganizationUnits,
} from "../api/endpoints";
import { BusinessPlanningShell } from "../components/business-planning/business-planning-shell";
import { DemandActions } from "../components/business-planning/demand-actions";
import { DemandMatrix } from "../components/business-planning/demand-matrix";
import { DemandMobileView } from "../components/business-planning/demand-mobile-view";
import { DemandRequirementEditor } from "../components/business-planning/demand-requirement-editor";
import type { BusinessWorkType } from "../types/business";
import type {
  StaffingDemand,
  StaffingDemandBatchAction,
  StaffingDemandDay,
  StaffingDemandRequirement,
} from "../types/business-planning";
import "../styles/business-planning.css";

type Notice = { type: "success" | "error" | "info"; message: string };

export function BusinessDemandPage() {
  const { t } = useTranslation("business");
  const { organizationId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyCells, setBusyCells] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [copying, setCopying] = useState(false);
  const [bootstrapBusy, setBootstrapBusy] = useState(false);
  const [editingRequirement, setEditingRequirement] =
    useState<StaffingDemandRequirement | null>(null);
  const [bulkWorkTypeId, setBulkWorkTypeId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkWorkTypeFixed, setBulkWorkTypeFixed] = useState(false);
  const [bulkAnchor, setBulkAnchor] = useState<DOMRect | null>(null);
  const operationKeys = useRef(new Map<string, string>());
  const restoredReturnScroll = useRef(false);

  const organizationsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: listOrganizations,
  });
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

  useEffect(() => {
    if (!unitId || requestedUnitId === unitId) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("unit", unitId);
      next.set("week", weekStart);
      return next;
    }, { replace: true });
  }, [requestedUnitId, setSearchParams, unitId, weekStart]);

  const accessQuery = useQuery({
    queryKey: ["organizations", organizationId, "access"],
    queryFn: () => getOrganizationAccess(organizationId),
    enabled: Boolean(organization),
  });
  const workTypesQuery = useQuery({
    queryKey: ["organizations", organizationId, "work-types"],
    queryFn: () => listBusinessWorkTypes(organizationId),
    enabled: Boolean(organization),
  });
  const workTypes = useMemo(
    () => (workTypesQuery.data ?? [])
      .filter((workType) => workType.active && !workType.compositeEnabled)
      .sort((left, right) => left.displayOrder - right.displayOrder),
    [workTypesQuery.data],
  );

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
  const demandQuery = useQuery({
    queryKey: ["staffing-plan", organizationId, plan?.planId, "demand"],
    queryFn: () => getStaffingDemand(organizationId, plan!.planId),
    enabled: Boolean(plan?.planId),
    retry: false,
  });
  const demand = demandQuery.data?.data ?? null;
  const canManage = Boolean(plan?.capabilities.manage);
  const returnScrollY = (location.state as { restoreScrollY?: unknown } | null)?.restoreScrollY;

  useEffect(() => {
    if (
      restoredReturnScroll.current
      || typeof returnScrollY !== "number"
      || !Number.isFinite(returnScrollY)
      || returnScrollY < 0
      || !demand
      || workTypesQuery.isLoading
    ) return;
    restoredReturnScroll.current = true;
    const restore = () => window.scrollTo({ top: returnScrollY, left: 0, behavior: "auto" });
    restore();
    const frame = window.requestAnimationFrame(restore);
    return () => window.cancelAnimationFrame(frame);
  }, [demand, returnScrollY, workTypesQuery.isLoading]);

  const updateSearchContext = (nextUnitId: string, nextWeekStart: string) => {
    setNotice(null);
    setEditingRequirement(null);
    setBulkOpen(false);
    setBulkWorkTypeFixed(false);
    const next = new URLSearchParams(searchParams);
    next.set("unit", nextUnitId);
    next.set("week", nextWeekStart);
    setSearchParams(next);
  };

  const refreshCurrent = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["staffing-plan", organizationId, unitId, weekStart],
      }),
      plan?.planId
        ? queryClient.invalidateQueries({
            queryKey: ["staffing-plan", organizationId, plan.planId, "demand"],
          })
        : Promise.resolve(),
      plan?.planId
        ? queryClient.invalidateQueries({
            // The Schedule page has its own cached projection.  Demand changes
            // alter its open-position rows, so it must not wait for the normal
            // dynamic-query cache window before showing the new requirement.
            queryKey: ["staffing-plan", organizationId, plan.planId, "schedule"],
          })
        : Promise.resolve(),
    ]);
  };

  const handleMutationError = async (cause: unknown) => {
    const error = getApiError(cause);
    if (error.status === 412) {
      setNotice({ type: "info", message: t("planning.messages.stale") });
      await refreshCurrent();
      return;
    }
    setNotice({ type: "error", message: error.message });
  };

  const withBusyCell = async (key: string, operation: () => Promise<void>) => {
    setBusyCells((current) => new Set(current).add(key));
    try {
      await operation();
    } finally {
      setBusyCells((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const commitCell = async (
    workType: BusinessWorkType,
    day: StaffingDemandDay,
    workers: number,
  ) => {
    if (!plan || !demand || !canManage) return;
    const cellKey = `${day.date}:${workType.id}`;
    const matches = day.requirements.filter((item) => item.workTypeId === workType.id);
    if (matches.length > 1) {
      setNotice({ type: "error", message: t("planning.messages.multipleRequirements") });
      return;
    }
    const requirement = matches[0];
    if ((requirement?.requiredWorkers ?? 0) === workers) return;

    await withBusyCell(cellKey, async () => {
      try {
        if (!requirement && workers > 0) {
          const semanticKey = `create:${plan.planId}:${cellKey}:${workers}`;
          await createStaffingRequirement(
            organizationId,
            plan.planId,
            currentEtag(demand),
            stableOperationKey(operationKeys.current, semanticKey),
            requirementInput(workType, day.date, workers),
          );
          operationKeys.current.delete(semanticKey);
        } else if (requirement && workers === 0) {
          await deleteStaffingRequirement(
            organizationId,
            plan.planId,
            requirement.requirementId,
            currentEtag(demand),
          );
        } else if (requirement) {
          await updateStaffingRequirement(
            organizationId,
            plan.planId,
            requirement.requirementId,
            currentEtag(demand),
            {
              startTime: requirement.startTime,
              endTime: requirement.endTime,
              requiredWorkers: workers,
              requiredQuantity: requirement.requiredQuantity,
              notes: requirement.notes,
            },
          );
        }
        setNotice({ type: "success", message: t("planning.messages.saved") });
        await refreshCurrent();
      } catch (cause) {
        await handleMutationError(cause);
      }
    });
  };

  const applyBatch = async (
    actions: StaffingDemandBatchAction[],
    semanticKey: string,
  ) => {
    if (!plan || !demand || actions.length === 0 || !canManage) return;
    setBatchBusy(true);
    try {
      await batchStaffingDemand(
        organizationId,
        plan.planId,
        currentEtag(demand),
        stableOperationKey(operationKeys.current, semanticKey),
        actions.slice(0, 100),
      );
      operationKeys.current.delete(semanticKey);
      setNotice({ type: "success", message: t("planning.messages.batchSaved", { count: actions.length }) });
      await refreshCurrent();
    } catch (cause) {
      await handleMutationError(cause);
    } finally {
      setBatchBusy(false);
    }
  };

  const handleBulkApply = (
    workType: BusinessWorkType,
    dates: string[],
    workers: number,
  ) => {
    if (!demand || !plan) return;
    const actions = dates.flatMap((date) => {
      const day = demand.days.find((item) => item.date === date);
      if (!day) return [];
      return buildCellAction(day, workType, workers);
    });
    void applyBatch(
      actions,
      `bulk:${plan.planId}:${workType.id}:${[...dates].sort().join(",")}:${workers}`,
    );
  };
  const openBulkApply = (workType: BusinessWorkType, trigger?: HTMLElement) => {
    setBulkWorkTypeId(workType.id);
    setBulkWorkTypeFixed(true);
    setBulkAnchor(trigger?.getBoundingClientRect() ?? null);
    setBulkOpen(true);
  };
  const changeBulkOpen = (open: boolean) => {
    setBulkOpen(open);
    if (!open) { setBulkWorkTypeFixed(false); setBulkAnchor(null); }
  };

  const handlePaste = (workTypeIndex: number, dayIndex: number, text: string) => {
    if (!demand || !plan) return;
    const rows = text.replace(/\r/g, "").split("\n");
    const actions: StaffingDemandBatchAction[] = [];
    rows.forEach((row, rowOffset) => {
      row.split("\t").forEach((raw, columnOffset) => {
        const workType = workTypes[workTypeIndex + rowOffset];
        const day = demand.days[dayIndex + columnOffset];
        if (!workType || !day || !/^\s*\d{1,2}\s*$/.test(raw)) return;
        actions.push(...buildCellAction(day, workType, Number(raw.trim())));
      });
    });
    if (actions.length === 0) {
      setNotice({ type: "error", message: t("planning.messages.pasteInvalid") });
      return;
    }
    void applyBatch(actions, `paste:${plan.planId}:${hashText(text)}:${workTypeIndex}:${dayIndex}`);
  };

  const copyPreviousWeek = async () => {
    if (!plan || !demand || batchBusy) return;
    if (demand.days.some((day) => day.requirements.length > 0)) {
      setNotice({ type: "info", message: t("planning.messages.copyRequiresEmpty") });
      return;
    }
    setCopying(true);
    try {
      const previousStart = addDays(weekStart, -7);
      const lookup = await findStaffingPlan(organizationId, unitId, previousStart);
      if (!lookup.data.found || !lookup.data.plan) {
        setNotice({ type: "info", message: t("planning.messages.noPreviousWeek") });
        return;
      }
      const previous = await getStaffingDemand(organizationId, lookup.data.plan.planId);
      const actions = previous.data.days.flatMap((day, index) =>
        day.requirements.map<StaffingDemandBatchAction>((requirement) => ({
          operation: "CREATE",
          requirementId: null,
          create: {
            date: demand.days[index]?.date ?? addDays(weekStart, index),
            workTypeId: requirement.workTypeId,
            startTime: requirement.startTime,
            endTime: requirement.endTime,
            requiredWorkers: requirement.requiredWorkers,
            requiredQuantity: requirement.requiredQuantity,
            notes: requirement.notes,
          },
          update: null,
        })),
      );
      if (actions.length === 0) {
        setNotice({ type: "info", message: t("planning.messages.noPreviousWeek") });
        return;
      }
      await applyBatch(actions, `copy:${plan.planId}:${lookup.data.plan.planId}`);
    } catch (cause) {
      await handleMutationError(cause);
    } finally {
      setCopying(false);
    }
  };

  const bootstrapPlan = async () => {
    if (!organization || !unitId || bootstrapBusy) return;
    const semanticKey = `bootstrap:${organization.id}:${unitId}:${weekStart}`;
    setBootstrapBusy(true);
    try {
      await createStaffingPlan(
        organization.id,
        { unitId, weekStart },
        stableOperationKey(operationKeys.current, semanticKey),
      );
      operationKeys.current.delete(semanticKey);
      setNotice({ type: "success", message: t("planning.messages.planCreated") });
      await refreshCurrent();
    } catch (cause) {
      await handleMutationError(cause);
    } finally {
      setBootstrapBusy(false);
    }
  };

  const saveRequirementDetails = async (
    value: Parameters<typeof updateStaffingRequirement>[4],
  ) => {
    if (!plan || !demand || !editingRequirement) return;
    const key = `${editingRequirement.requirementId}:details`;
    await withBusyCell(key, async () => {
      try {
        await updateStaffingRequirement(
          organizationId,
          plan.planId,
          editingRequirement.requirementId,
          currentEtag(demand),
          value,
        );
        setEditingRequirement(null);
        setNotice({ type: "success", message: t("planning.messages.saved") });
        await refreshCurrent();
      } catch (cause) {
        await handleMutationError(cause);
      }
    });
  };

  const deleteEditedRequirement = async () => {
    if (!plan || !demand || !editingRequirement) return;
    const key = `${editingRequirement.requirementId}:details`;
    await withBusyCell(key, async () => {
      try {
        await deleteStaffingRequirement(
          organizationId,
          plan.planId,
          editingRequirement.requirementId,
          currentEtag(demand),
        );
        setEditingRequirement(null);
        setNotice({ type: "success", message: t("planning.messages.deleted") });
        await refreshCurrent();
      } catch (cause) {
        await handleMutationError(cause);
      }
    });
  };

  if (organizationsQuery.isLoading) return <BusinessRouteSkeleton />;
  if (!organization) {
    return (
      <BusinessState
        title={businessOrganizations.length === 0
          ? t("planning.states.noBusinessTitle")
          : t("planning.states.notFoundTitle")}
        description={businessOrganizations.length === 0
          ? t("planning.states.noBusinessDescription")
          : t("planning.states.notFoundDescription")}
        action={<Link to="/business">{t("planning.states.openBusiness")}</Link>}
      />
    );
  }
  if (unitsQuery.isLoading || accessQuery.isLoading || workTypesQuery.isLoading) {
    return <BusinessRouteSkeleton />;
  }
  if (activeUnits.length === 0) {
    return (
      <BusinessState
        title={t("planning.states.noUnitTitle")}
        description={t("planning.states.noUnitDescription")}
        action={<Link to="/business">{t("planning.states.configureUnit")}</Link>}
      />
    );
  }

  return (
    <BusinessPlanningShell
      organizations={businessOrganizations}
      organizationId={organizationId}
      units={activeUnits}
      unitId={unitId}
      weekStart={weekStart}
      weekEnd={weekEnd}
      onOrganizationChange={(id) => navigate(`/business/${id}/plan/demand?week=${weekStart}`)}
      onUnitChange={(id) => updateSearchContext(id, weekStart)}
      onPreviousWeek={() => updateSearchContext(unitId, addDays(weekStart, -7))}
      onNextWeek={() => updateSearchContext(unitId, addDays(weekStart, 7))}
      onCurrentWeek={() => updateSearchContext(unitId, mondayIso(new Date()))}
    >
      <section className="business-demand__intro">
        <div>
          <p>{t("planning.demand.eyebrow")}</p>
          <h1>{t("planning.demand.title")}</h1>
          <span>{t("planning.demand.description")}</span>
        </div>
        {demand ? (
          <DemandActions
            days={demand.days}
            workTypes={workTypes}
            disabled={!canManage || batchBusy}
            copying={copying}
            applying={batchBusy}
            open={bulkOpen}
            selectedWorkTypeId={bulkWorkTypeId}
            fixedWorkType={bulkWorkTypeFixed}
            showCopyAction={false}
            showApplyAction={false}
            anchorRect={bulkAnchor}
            onOpenChange={changeBulkOpen}
            onCopyPreviousWeek={() => void copyPreviousWeek()}
            onApply={handleBulkApply}
          />
        ) : null}
      </section>

      {notice ? (
        <div className={`business-demand__notice is-${notice.type}`} role={notice.type === "error" ? "alert" : "status"}>
          {notice.type === "success" ? <Check aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
          <span>{notice.message}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t("planning.close")}>×</button>
        </div>
      ) : null}

      {lookupQuery.isLoading ? <DemandLoading /> : null}
      {lookupQuery.isError ? (
        <BusinessState
          compact
          title={t("planning.states.loadErrorTitle")}
          description={getApiError(lookupQuery.error).message}
          action={(
            <button type="button" onClick={() => void lookupQuery.refetch()}>
              <RefreshCw aria-hidden="true" /> {t("planning.retry")}
            </button>
          )}
        />
      ) : null}
      {lookupQuery.data && !lookupQuery.data.data.found ? (
        <BusinessState
          compact
          title={t("planning.states.noPlanTitle")}
          description={t("planning.states.noPlanDescription")}
          action={canCreatePlan(accessQuery.data?.permissions ?? []) ? (
            <button type="button" onClick={() => void bootstrapPlan()} disabled={bootstrapBusy}>
              {bootstrapBusy ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
              {bootstrapBusy ? t("planning.states.creatingPlan") : t("planning.states.createPlan")}
            </button>
          ) : (
            <span>{t("planning.states.readOnly")}</span>
          )}
        />
      ) : null}
      {plan && demandQuery.isLoading ? <DemandLoading /> : null}
      {plan && demandQuery.isError ? (
        <BusinessState
          compact
          title={t("planning.states.loadErrorTitle")}
          description={getApiError(demandQuery.error).message}
          action={(
            <button type="button" onClick={() => void demandQuery.refetch()}>
              <RefreshCw aria-hidden="true" /> {t("planning.retry")}
            </button>
          )}
        />
      ) : null}
      {demand ? (
        <>
          <CoverageSummary demand={demand} />
          {workTypes.length === 0 ? (
            <BusinessState
              compact
              title={t("planning.states.noWorkTypesTitle")}
              description={t("planning.states.noWorkTypesDescription")}
              action={<Link to={`/business/${organizationId}/work-types`}>{t("planning.states.configureWorkTypes")}</Link>}
            />
          ) : (
            <>
              <DemandMatrix
                days={demand.days}
                workTypes={workTypes}
                canManage={canManage}
                copying={copying}
                busyCells={busyCells}
                onCommit={(workType, day, value) => void commitCell(workType, day, value)}
                onPaste={handlePaste}
                onEdit={setEditingRequirement}
                onApplyWorkType={openBulkApply}
                onEditWorkType={(workType) => navigate(
                  `/business/${organizationId}/work-types/${workType.id}?returnTo=${encodeURIComponent(`/business/${organizationId}/plan/demand?unit=${encodeURIComponent(unitId)}&week=${encodeURIComponent(weekStart)}`)}&returnScroll=${Math.round(window.scrollY)}`,
                )}
                onCopyPreviousWeek={() => void copyPreviousWeek()}
              />
              <DemandMobileView
                days={demand.days}
                workTypes={workTypes}
                canManage={canManage}
                copying={copying}
                busyCells={busyCells}
                onCommit={(workType, day, value) => void commitCell(workType, day, value)}
                onEdit={setEditingRequirement}
                onApplyWorkType={openBulkApply}
                onEditWorkType={(workType) => navigate(
                  `/business/${organizationId}/work-types/${workType.id}?returnTo=${encodeURIComponent(`/business/${organizationId}/plan/demand?unit=${encodeURIComponent(unitId)}&week=${encodeURIComponent(weekStart)}`)}&returnScroll=${Math.round(window.scrollY)}`,
                )}
                onCopyPreviousWeek={() => void copyPreviousWeek()}
              />
            </>
          )}
        </>
      ) : null}

      <DemandRequirementEditor
        requirement={editingRequirement}
        busy={editingRequirement ? busyCells.has(`${editingRequirement.requirementId}:details`) : false}
        onClose={() => setEditingRequirement(null)}
        onSave={(value) => void saveRequirementDetails(value)}
        onDelete={() => void deleteEditedRequirement()}
      />
    </BusinessPlanningShell>
  );
}

function CoverageSummary({ demand }: { demand: StaffingDemand }) {
  const { t } = useTranslation("business");
  const totals = demand.coverage;
  return (
    <section className="business-demand__coverage" aria-label={t("planning.coverage.title")}>
      <div>
        <span>{t("planning.coverage.required")}</span>
        <strong>{totals.required}</strong>
      </div>
      <div>
        <span>{t("planning.coverage.assigned")}</span>
        <strong>{totals.effectiveAssigned}</strong>
      </div>
      <div data-alert={totals.openPositions > 0 || undefined}>
        <span>{t("planning.coverage.open")}</span>
        <strong>{totals.openPositions}</strong>
      </div>
      <div className="business-demand__coverage-meter">
        <span>{t("planning.coverage.covered")}</span>
        <strong>{Number(totals.percentage).toFixed(0)}%</strong>
        <i><b style={{ width: `${Math.min(100, Number(totals.percentage))}%` }} /></i>
      </div>
    </section>
  );
}

function DemandLoading() {
  const { t } = useTranslation("business");
  return (
    <div className="business-demand__loading" role="status">
      <LoaderCircle className="is-spinning" aria-hidden="true" />
      <span>{t("planning.loadingDemand")}</span>
    </div>
  );
}

function BusinessRouteSkeleton() {
  return (
    <div className="business-route-skeleton" aria-label="Loading Business workspace">
      <div /><div /><div />
    </div>
  );
}

function BusinessState({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description: string;
  action: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <main className={`business-state${compact ? " is-compact" : ""}`}>
      <span>ALVERYN · BUSINESS</span>
      <h1>{title}</h1>
      <p>{description}</p>
      <div>{action}</div>
    </main>
  );
}

function buildCellAction(
  day: StaffingDemandDay,
  workType: BusinessWorkType,
  workers: number,
): StaffingDemandBatchAction[] {
  const matches = day.requirements.filter((item) => item.workTypeId === workType.id);
  if (matches.length > 1) return [];
  const requirement = matches[0];
  if (!requirement && workers > 0) {
    return [{
      operation: "CREATE",
      requirementId: null,
      create: requirementInput(workType, day.date, workers),
      update: null,
    }];
  }
  if (requirement && workers === 0) {
    return [{ operation: "DELETE", requirementId: requirement.requirementId, create: null, update: null }];
  }
  if (requirement && requirement.requiredWorkers !== workers) {
    return [{
      operation: "UPDATE",
      requirementId: requirement.requirementId,
      create: null,
      update: {
        startTime: requirement.startTime,
        endTime: requirement.endTime,
        requiredWorkers: workers,
        requiredQuantity: requirement.requiredQuantity,
        notes: requirement.notes,
      },
    }];
  }
  return [];
}

function requirementInput(workType: BusinessWorkType, date: string, workers: number) {
  return {
    date,
    workTypeId: workType.id,
    startTime: workType.defaultStartTime?.slice(0, 5) ?? null,
    endTime: workType.defaultEndTime?.slice(0, 5) ?? null,
    requiredWorkers: workers,
    requiredQuantity: null,
    notes: null,
  };
}

function stableOperationKey(store: Map<string, string>, semanticKey: string) {
  const existing = store.get(semanticKey);
  if (existing) return existing;
  const value = `web-${operationId()}`;
  store.set(semanticKey, value);
  return value;
}

function operationId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const values = new Uint32Array(4);
    globalThis.crypto.getRandomValues(values);
    return Array.from(values, (value) => value.toString(16).padStart(8, "0")).join("-");
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function currentEtag(demand: StaffingDemand) {
  return demand.etag.startsWith('"') ? demand.etag : `"${demand.etag}"`;
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
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function canCreatePlan(permissions: string[]) {
  return permissions.includes("MANAGE_SCHEDULE");
}

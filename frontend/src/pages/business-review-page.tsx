import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  History,
  Info,
  LoaderCircle,
  LockKeyhole,
  Printer,
  RefreshCw,
  Send,
  ShieldAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  findStaffingPlan,
  getStaffingCoverage,
  getStaffingReview,
  getStaffingVersion,
  getStaffingVersions,
  publishStaffingPlan,
} from "../api/business-planning";
import { getApiError } from "../api/api-errors";
import { listOrganizations, listOrganizationUnits } from "../api/endpoints";
import { BusinessPlanningShell } from "../components/business-planning/business-planning-shell";
import type {
  ApiEntityResult,
  StaffingIssue,
  StaffingIssueGroup,
  StaffingPublishResult,
  StaffingReview,
  StaffingVersionDetail,
  StaffingVersionListItem,
  StaffingVersions,
} from "../types/business-planning";
import "../styles/business-planning.css";
import "../styles/business-review.css";

type Notice = { type: "success" | "error" | "info"; message: string };
type VersionPage = ApiEntityResult<StaffingVersions>;
type VersionDetailResult = ApiEntityResult<StaffingVersionDetail>;
type ReviewStateKind =
  | "BLOCKED"
  | "ACKNOWLEDGEMENT_REQUIRED"
  | "READY_TO_PUBLISH"
  | "PUBLISHING"
  | "PUBLISHED_CURRENT"
  | "UNPUBLISHED_CHANGES";
type ReviewUiState = {
  kind: ReviewStateKind;
  canPublish: boolean;
  blockingCount: number;
  remainingAcknowledgementCount: number;
  latestVersionNumber: number | null;
  hasUnpublishedChanges: boolean;
};
type StaffingPlan = NonNullable<Awaited<ReturnType<typeof findStaffingPlan>>["data"]["plan"]>;

const PAGE_SIZE = 8;
const SEVERITY_ORDER: StaffingIssue["severity"][] = [
  "BLOCKING_CONFLICT",
  "WARNING",
  "PENDING_REQUEST",
  "UNCONFIRMED_CHANGE",
  "INFORMATION",
];

export function BusinessReviewPage() {
  const { t, i18n } = useTranslation("business");
  const { organizationId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [publicationNote, setPublicationNote] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [published, setPublished] = useState<StaffingPublishResult | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [olderPages, setOlderPages] = useState<VersionPage[]>([]);
  const [olderLoading, setOlderLoading] = useState(false);
  const contextRef = useRef("");
  const operationKeys = useRef(new Map<string, string>());
  const versionPageCache = useRef(new Map<string, VersionPage>());
  const versionDetailCache = useRef(new Map<number, VersionDetailResult>());
  const firstBlockerRef = useRef<HTMLElement | null>(null);
  const firstActionableIssueRef = useRef<HTMLElement | null>(null);

  const organizationsQuery = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
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
    setAcknowledged(new Set());
    setPublicationNote("");
    setPublished(null);
    setSelectedVersion(null);
    setOlderPages([]);
    versionPageCache.current.clear();
    versionDetailCache.current.clear();
  }, [contextKey]);

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
  const coverageQuery = useQuery({
    queryKey: ["staffing-plan", organizationId, plan?.planId, "coverage"],
    queryFn: () => getStaffingCoverage(organizationId, plan!.planId),
    enabled: Boolean(plan),
    retry: false,
  });
  const reviewQuery = useQuery({
    queryKey: ["staffing-plan", organizationId, plan?.planId, "review"],
    queryFn: () => getStaffingReview(organizationId, plan!.planId),
    enabled: Boolean(plan),
    retry: false,
  });
  const firstVersionsQuery = useQuery({
    queryKey: ["staffing-plan", organizationId, plan?.planId, "versions", "first"],
    queryFn: () => loadVersionPage(
      organizationId,
      plan!.planId,
      undefined,
      versionPageCache.current,
    ),
    enabled: Boolean(plan),
    retry: false,
  });

  const review = reviewQuery.data?.data ?? null;
  const coverage = coverageQuery.data?.data ?? null;
  const versions = useMemo(
    () => [...(firstVersionsQuery.data?.data.versions ?? []), ...olderPages.flatMap((page) => page.data.versions)]
      .filter((item, index, values) => values.findIndex((value) => value.versionId === item.versionId) === index),
    [firstVersionsQuery.data, olderPages],
  );
  const lastPage = olderPages.at(-1) ?? firstVersionsQuery.data ?? null;
  const canLoadOlder = Boolean(lastPage?.data.hasMore && lastPage.data.nextBeforeVersion != null);
  const requiredKeys = useMemo(
    () => new Set(review?.requiredAcknowledgementKeys ?? []),
    [review],
  );
  const reviewState = useMemo(
    () => plan && review
      ? deriveReviewState(plan, review, acknowledged, publishing)
      : null,
    [acknowledged, plan, publishing, review],
  );

  useEffect(() => {
    setAcknowledged(new Set());
  }, [review?.etag]);

  useEffect(() => {
    if (published && plan && plan.draftRevision > published.sourceDraftRevision) {
      setPublished(null);
    }
  }, [plan, published]);

  const selectedDetailQuery = useQuery({
    queryKey: ["staffing-plan", organizationId, plan?.planId, "version", selectedVersion],
    queryFn: () => loadVersionDetail(
      organizationId,
      plan!.planId,
      selectedVersion!,
      versionDetailCache.current,
    ),
    enabled: Boolean(plan && selectedVersion != null),
    retry: false,
  });
  const previousVersionNumber = selectedVersion != null && selectedVersion > 1
    ? selectedVersion - 1
    : null;
  const previousDetailQuery = useQuery({
    queryKey: ["staffing-plan", organizationId, plan?.planId, "version", previousVersionNumber],
    queryFn: () => loadVersionDetail(
      organizationId,
      plan!.planId,
      previousVersionNumber!,
      versionDetailCache.current,
    ),
    enabled: Boolean(plan && previousVersionNumber != null && selectedVersion != null),
    retry: false,
  });

  const updateSearchContext = (nextUnitId: string, nextWeekStart: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("unit", nextUnitId);
    next.set("week", nextWeekStart);
    setSearchParams(next);
  };

  const refreshReview = async () => {
    if (!plan) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["staffing-plan", organizationId, unitId, weekStart], refetchType: "none" }),
      queryClient.invalidateQueries({ queryKey: ["staffing-plan", organizationId, plan.planId, "coverage"], refetchType: "none" }),
      queryClient.invalidateQueries({ queryKey: ["staffing-plan", organizationId, plan.planId, "review"], refetchType: "none" }),
      queryClient.invalidateQueries({ queryKey: ["staffing-plan", organizationId, plan.planId, "versions"], refetchType: "none" }),
    ]);
    setOlderPages([]);
    versionPageCache.current.clear();
    await Promise.all([lookupQuery.refetch(), coverageQuery.refetch(), reviewQuery.refetch(), firstVersionsQuery.refetch()]);
  };

  const handlePublish = async () => {
    if (!plan || !review || !reviewState?.canPublish || publishing) return;
    const startContext = contextRef.current;
    const keys = [...acknowledged].filter((key) => requiredKeys.has(key)).sort();
    const note = publicationNote.trim() || null;
    const semantic = JSON.stringify({ planId: plan.planId, etag: review.etag, keys, note });
    const idempotencyKey = stableOperationKey(operationKeys.current, semantic);
    setPublishing(true);
    setNotice(null);
    try {
      const result = await publishStaffingPlan(
        organizationId,
        plan.planId,
        strongEtag(review.etag),
        idempotencyKey,
        { acknowledgementKeys: keys, publicationNote: note },
      );
      if (contextRef.current !== startContext) return;
      operationKeys.current.delete(semantic);
      setAcknowledged(new Set());
      versionDetailCache.current.delete(result.data.versionNumber);
      await refreshReview();
      if (contextRef.current !== startContext) return;
      setPublished(result.data);
      setNotice(result.idempotentReplay
        ? { type: "info", message: t("planning.review.replay") }
        : { type: "success", message: t("planning.review.publishedTitle", { version: result.data.versionNumber }) });
    } catch (cause) {
      if (contextRef.current !== startContext) return;
      const error = getApiError(cause);
      if (error.status === 412) {
        operationKeys.current.clear();
        setAcknowledged(new Set());
        setNotice({ type: "info", message: t("planning.review.stale") });
        await refreshReview();
        window.setTimeout(() => firstBlockerRef.current?.focus(), 0);
      } else if (error.status === 409 && error.code === "IDEMPOTENCY_CONFLICT") {
        operationKeys.current.clear();
        setAcknowledged(new Set());
        setNotice({ type: "error", message: t("planning.review.idempotencyConflict") });
        await refreshReview();
      } else {
        setNotice({ type: "error", message: error.message || t("planning.review.publishError") });
      }
    } finally {
      if (contextRef.current === startContext) setPublishing(false);
    }
  };

  const focusFirstPublishRequirement = () => {
    const target = firstActionableIssueRef.current ?? firstBlockerRef.current;
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    const acknowledgement = target.querySelector<HTMLInputElement>("input:not(:checked)");
    window.setTimeout(() => (acknowledgement ?? target).focus(), 250);
  };

  const loadOlder = async () => {
    if (!plan || !lastPage?.data.nextBeforeVersion || olderLoading) return;
    setOlderLoading(true);
    try {
      const page = await loadVersionPage(
        organizationId,
        plan.planId,
        lastPage.data.nextBeforeVersion,
        versionPageCache.current,
      );
      if (contextRef.current === contextKey) setOlderPages((current) => [...current, page]);
    } catch (cause) {
      setNotice({ type: "error", message: getApiError(cause).message });
    } finally {
      setOlderLoading(false);
    }
  };

  if (organizationsQuery.isLoading) return <BusinessRouteSkeleton />;
  if (!organization) return <BusinessState title={t("planning.states.notFoundTitle")} description={t("planning.states.notFoundDescription")} />;
  if (unitsQuery.isLoading) return <BusinessRouteSkeleton />;
  if (activeUnits.length === 0) return <BusinessState title={t("planning.states.noUnitTitle")} description={t("planning.states.noUnitDescription")} />;

  const loading = lookupQuery.isLoading || Boolean(plan && (coverageQuery.isLoading || reviewQuery.isLoading));
  const loadError = lookupQuery.error ?? coverageQuery.error ?? reviewQuery.error ?? firstVersionsQuery.error;

  return (
    <BusinessPlanningShell
      organizations={businessOrganizations}
      organizationId={organizationId}
      units={activeUnits}
      unitId={unitId}
      weekStart={weekStart}
      weekEnd={weekEnd}
      onOrganizationChange={(id) => navigate(`/business/${id}/plan/review?unit=${unitId}&week=${weekStart}`)}
      onUnitChange={(id) => updateSearchContext(id, weekStart)}
      onPreviousWeek={() => updateSearchContext(unitId, addDays(weekStart, -7))}
      onNextWeek={() => updateSearchContext(unitId, addDays(weekStart, 7))}
      onCurrentWeek={() => updateSearchContext(unitId, mondayIso(new Date()))}
    >
      <section className="business-review__intro">
        <div><p>{t("planning.review.eyebrow")}</p><h1>{t("planning.review.title")}</h1><span>{t("planning.review.description")}</span></div>
        {plan && reviewState ? <PlanPublicationState state={reviewState} /> : null}
      </section>

      {notice ? (
        <div className={`business-review__notice is-${notice.type}`} role={notice.type === "error" ? "alert" : "status"}>
          {notice.type === "success" ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
          <span>{notice.message}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t("planning.close")}><X aria-hidden="true" /></button>
        </div>
      ) : null}

      {loading ? <div className="business-review__loading" role="status"><LoaderCircle className="is-spinning" aria-hidden="true" />{t("planning.review.loading")}</div> : null}
      {loadError ? <BusinessState compact title={t("planning.review.loadError")} description={getApiError(loadError).message} action={<button type="button" onClick={() => void refreshReview()}><RefreshCw aria-hidden="true" />{t("planning.retry")}</button>} /> : null}
      {lookupQuery.data && !lookupQuery.data.data.found ? <BusinessState compact title={t("planning.states.noPlanTitle")} description={t("planning.states.noPlanDescription")} action={<Link to={`/business/${organizationId}/plan/demand?unit=${unitId}&week=${weekStart}`}>{t("planning.review.goDemand")}</Link>} /> : null}

      {plan && review && coverage && reviewState ? (
        <div className="business-review">
          <div className="business-review__content">
            <CoverageOverview review={review} state={reviewState} />
            <section className="business-review__publish-scope">
              <div><span>{t("planning.review.whatPublishes")}</span><strong>{plan.unitName} · {formatWeekRange(plan.weekStart, plan.weekEnd, i18n.resolvedLanguage ?? i18n.language)}</strong></div>
              <p>{t("planning.review.whatPublishesHint", { revision: review.draftRevision })}</p>
              <div><b>{coverage.requirements.length}</b><span>{t("planning.review.demandSnapshot")}</span><b>{coverage.totals.rawAssigned}</b><span>{t("planning.review.assignmentSnapshot")}</span></div>
            </section>
            <IssueReview
              groups={review.groups}
              review={review}
              state={reviewState}
              acknowledged={acknowledged}
              firstBlockerRef={firstBlockerRef}
              firstActionableIssueRef={firstActionableIssueRef}
              onToggle={(key) => setAcknowledged((current) => toggleSet(current, key))}
              onAcknowledgeAll={() => setAcknowledged(new Set(review.requiredAcknowledgementKeys))}
              demandHref={`/business/${organizationId}/plan/demand?unit=${unitId}&week=${weekStart}`}
              scheduleHref={`/business/${organizationId}/plan/schedule?unit=${unitId}&week=${weekStart}`}
            />
            <VersionHistory
              versions={versions}
              loading={firstVersionsQuery.isLoading}
              canLoadOlder={canLoadOlder}
              loadingOlder={olderLoading}
              onLoadOlder={() => void loadOlder()}
              onOpen={setSelectedVersion}
            />
          </div>

          <PublishRail
            plan={plan}
            review={review}
            state={reviewState}
            notice={notice}
            publicationNote={publicationNote}
            publishing={publishing}
            published={published}
            onNoteChange={setPublicationNote}
            onPublish={() => void handlePublish()}
            onResolve={() => focusFirstPublishRequirement()}
            onOpenPublished={(version) => setSelectedVersion(version)}
          />
        </div>
      ) : null}

      <VersionDetailDialog
        open={selectedVersion != null}
        versionNumber={selectedVersion}
        detail={selectedDetailQuery.data?.data ?? null}
        previous={previousDetailQuery.data?.data ?? null}
        loading={selectedDetailQuery.isLoading}
        error={selectedDetailQuery.isError ? getApiError(selectedDetailQuery.error).message : null}
        onClose={() => setSelectedVersion(null)}
        onPrint={(detail) => navigate(`/business/${organizationId}/plan/${detail.planId}/versions/${detail.versionNumber}/print?unit=${encodeURIComponent(unitId)}&week=${encodeURIComponent(weekStart)}`)}
      />
    </BusinessPlanningShell>
  );
}

function PlanPublicationState({ state }: { state: ReviewUiState }) {
  const { t } = useTranslation("business");
  return (
    <div className={`business-review__plan-state is-${state.kind.toLowerCase()}${state.hasUnpublishedChanges ? " has-changes" : ""}`} data-review-state={state.kind}>
      <span>{t("planning.review.planStatus")}</span>
      <strong>{reviewStateLabel(t, state)}</strong>
    </div>
  );
}

function CoverageOverview({ review, state }: { review: StaffingReview; state: ReviewUiState }) {
  const { t } = useTranslation("business");
  const values = [
    ["required", review.coverage.required],
    ["rawAssigned", review.coverage.rawAssigned],
    ["effectiveAssigned", review.coverage.effectiveAssigned],
    ["missing", review.coverage.missing],
    ["overstaffed", review.coverage.overstaffed],
  ] as const;
  return (
    <section className="business-review__coverage" aria-label={t("planning.coverage.title")}>
      <div className="business-review__coverage-primary">
        <span>{t("planning.coverage.covered")}</span>
        <strong>{formatPercent(review.coverage.percentage)}%</strong>
        <p>{review.coverage.covered} / {review.coverage.required}</p>
        <i><b style={{ width: `${Math.min(100, Number(review.coverage.percentage))}%` }} /></i>
      </div>
      <div className="business-review__coverage-values">
        {values.map(([key, value]) => <div key={key} className={key === "missing" && value > 0 ? "is-alert" : ""}><span>{t(key === "required" ? "planning.coverage.required" : `planning.review.${key}`)}</span><strong>{value}</strong></div>)}
      </div>
      <div className={`business-review__readiness is-${state.kind.toLowerCase()}`} data-review-state={state.kind}>
        <ReviewStateIcon state={state} />
        <div><strong>{reviewStateLabel(t, state)}</strong><span>{review.warningCount} {t("planning.review.groups.WARNING").toLocaleLowerCase()}</span></div>
      </div>
    </section>
  );
}

function IssueReview({
  groups,
  review,
  state,
  acknowledged,
  firstBlockerRef,
  firstActionableIssueRef,
  onToggle,
  onAcknowledgeAll,
  demandHref,
  scheduleHref,
}: {
  groups: StaffingIssueGroup[];
  review: StaffingReview;
  state: ReviewUiState;
  acknowledged: Set<string>;
  firstBlockerRef: React.MutableRefObject<HTMLElement | null>;
  firstActionableIssueRef: React.MutableRefObject<HTMLElement | null>;
  onToggle: (key: string) => void;
  onAcknowledgeAll: () => void;
  demandHref: string;
  scheduleHref: string;
}) {
  const { t, i18n } = useTranslation("business");
  const grouped = new Map(groups.map((group) => [group.severity, group]));
  const firstBlockerKey = groups
    .find((group) => group.severity === "BLOCKING_CONFLICT")
    ?.issues.at(0)?.issueKey;
  const firstActionableKey = groups.flatMap((group) => group.issues)
    .find((issue) => issue.publishBlocking || issue.acknowledgementRequired)?.issueKey;
  return (
    <section className="business-review__issues" aria-label={t("planning.review.title")} data-review-state={state.kind}>
      <header>
        <div><span>{reviewStateLabel(t, state)}</span><h2>{t("planning.review.title")}</h2></div>
        {review.requiredAcknowledgementKeys.length > 1 && state.kind !== "PUBLISHED_CURRENT" && state.kind !== "PUBLISHING" ? <button type="button" onClick={onAcknowledgeAll}><Check aria-hidden="true" />{t("planning.review.acknowledgeAll")}</button> : null}
      </header>
      {SEVERITY_ORDER.map((severity) => {
        const group = grouped.get(severity);
        if (!group || group.issues.length === 0) return null;
        return (
          <section className={`business-review__issue-group is-${severity.toLowerCase()}`} key={severity} aria-labelledby={`issue-group-${severity}`}>
            <header><SeverityIcon severity={severity} /><h3 id={`issue-group-${severity}`}>{t(`planning.review.groups.${severity}`)}</h3><span>{group.count}</span></header>
            <div>
              {group.issues.map((issue) => {
                const isFirstBlocker = issue.issueKey === firstBlockerKey;
                const isFirstActionable = issue.issueKey === firstActionableKey;
                const goesToSchedule = Boolean(issue.assignmentId) || ["INVITATION_PENDING", "INTERVAL_OVERRIDE", "DUPLICATE_ASSIGNMENT", "INCOMPATIBLE_OVERLAP", "PENDING_REQUEST", "SUSPENDED_MEMBER"].includes(issue.code);
                const destination = goesToSchedule
                  ? scheduleHref
                  : demandHref;
                return (
                  <article key={issue.issueKey} tabIndex={isFirstBlocker || isFirstActionable ? -1 : undefined} ref={isFirstBlocker || isFirstActionable ? (node) => {
                    if (isFirstBlocker) firstBlockerRef.current = node;
                    if (isFirstActionable) firstActionableIssueRef.current = node;
                  } : undefined}>
                    <div><strong>{issueMessage(t, issue)}</strong><span>{issue.date ? t("planning.review.issueDate", { date: formatDate(issue.date, i18n.resolvedLanguage ?? i18n.language), code: issue.code }) : issue.code}</span></div>
                    {issue.acknowledgementRequired && state.kind === "PUBLISHED_CURRENT" ? (
                      <span className="business-review__published-issue"><Check aria-hidden="true" />{t("planning.review.includedInPublished")}</span>
                    ) : issue.acknowledgementRequired ? (
                      <label><input type="checkbox" checked={acknowledged.has(issue.issueKey)} disabled={state.kind === "PUBLISHING"} onChange={() => onToggle(issue.issueKey)} /><span>{t("planning.review.acknowledge")}</span></label>
                    ) : <Link to={destination}>{goesToSchedule ? t("planning.review.goSchedule") : t("planning.review.goDemand")}<ArrowRight aria-hidden="true" /></Link>}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
      {flattenIssues(review).length === 0 ? <div className="business-review__no-issues"><ReviewStateIcon state={state} /><strong>{reviewStateLabel(t, state)}</strong></div> : null}
    </section>
  );
}

function PublishRail({
  plan,
  review,
  state,
  notice,
  publicationNote,
  publishing,
  published,
  onNoteChange,
  onPublish,
  onResolve,
  onOpenPublished,
}: {
  plan: StaffingPlan;
  review: StaffingReview;
  state: ReviewUiState;
  notice: Notice | null;
  publicationNote: string;
  publishing: boolean;
  published: StaffingPublishResult | null;
  onNoteChange: (value: string) => void;
  onPublish: () => void;
  onResolve: () => void;
  onOpenPublished: (version: number) => void;
}) {
  const { t, i18n } = useTranslation("business");
  const currentVersion = published?.versionNumber ?? state.latestVersionNumber;
  if (state.kind === "PUBLISHED_CURRENT" && currentVersion != null) {
    const publishedAt = published?.publishedAt ?? plan.latestPublishedVersion?.publishedAt;
    const checksum = published?.checksum ?? plan.latestPublishedVersion?.checksum;
    return (
      <aside className="business-review__publish-rail is-success" role="status" aria-live="polite" data-review-state={state.kind}>
        <CheckCircle2 aria-hidden="true" />
        <span>{reviewStateLabel(t, state)}</span>
        <h2>{published ? t("planning.review.publishedTitle", { version: currentVersion }) : t("planning.review.currentTitle")}</h2>
        <p>{published ? t("planning.review.publishedCoverage", { covered: published.canonicalCoverage.covered, required: published.canonicalCoverage.required }) : t("planning.review.currentHint")}</p>
        {publishedAt ? <small>{t("planning.review.publishedAt", { date: formatDateTime(publishedAt, i18n.resolvedLanguage ?? i18n.language) })}</small> : null}
        {checksum ? <code>{checksum.slice(0, 12)}</code> : null}
        <button type="button" onClick={() => onOpenPublished(currentVersion)}>{t("planning.review.openVersion")}<ArrowRight aria-hidden="true" /></button>
        <Link to={`../schedule?unit=${plan.unitId}&week=${plan.weekStart}`}>{t("planning.review.continueDraft")}</Link>
      </aside>
    );
  }
  const actionableIssues = flattenIssues(review)
    .filter((issue) => issue.publishBlocking || issue.acknowledgementRequired);
  const needsResolution = state.kind === "BLOCKED" || state.kind === "ACKNOWLEDGEMENT_REQUIRED" || state.kind === "UNPUBLISHED_CHANGES";
  return (
    <aside className="business-review__publish-rail" aria-busy={publishing} data-review-state={state.kind}>
      <LockKeyhole aria-hidden="true" />
      <span>{reviewStateLabel(t, state)}</span>
      <h2>{t("planning.review.publishTitle")}</h2>
      <p>{t("planning.review.publishHint")}</p>
      {notice ? <div className={`business-review__publish-notice is-${notice.type}`} role={notice.type === "error" ? "alert" : "status"}>{notice.message}</div> : null}
      <dl><div><dt>{t("planning.coverage.covered")}</dt><dd>{review.coverage.covered}/{review.coverage.required}</dd></div><div><dt>{t("planning.review.groups.WARNING")}</dt><dd>{review.warningCount}</dd></div><div><dt>{t("planning.review.openPositions")}</dt><dd>{review.coverage.openPositions}</dd></div></dl>
      <label><span>{t("planning.review.publicationNote")}</span><textarea maxLength={1000} value={publicationNote} disabled={state.kind === "PUBLISHING"} onChange={(event) => onNoteChange(event.target.value)} placeholder={t("planning.review.publicationNotePlaceholder")} /></label>
      {needsResolution && actionableIssues.length > 0 ? (
        <div className="business-review__publish-requirements" role="status">
          <strong>{reviewStateHelp(t, state)}</strong>
          <ul>{actionableIssues.slice(0, 3).map((issue) => <li key={issue.issueKey}>{issueMessage(t, issue)}</li>)}</ul>
          {actionableIssues.length > 3 ? <small>+{actionableIssues.length - 3}</small> : null}
        </div>
      ) : null}
      <button className="business-review__publish-action" type="button" disabled={publishing || (!state.canPublish && !needsResolution)} onClick={state.canPublish ? onPublish : onResolve}>
        {publishing ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : needsResolution ? <AlertTriangle aria-hidden="true" /> : <Send aria-hidden="true" />}
        {publishing
          ? t("planning.review.publishing")
          : state.canPublish
            ? t("planning.review.publish")
            : reviewStateLabel(t, state)}
      </button>
      {!plan.capabilities.publish ? <p className="business-review__publish-help">{t("planning.review.readOnly")}</p> : state.kind !== "READY_TO_PUBLISH" && state.kind !== "PUBLISHING" ? <p className="business-review__publish-help">{reviewStateHelp(t, state)}</p> : null}
    </aside>
  );
}

function VersionHistory({ versions, loading, canLoadOlder, loadingOlder, onLoadOlder, onOpen }: { versions: StaffingVersionListItem[]; loading: boolean; canLoadOlder: boolean; loadingOlder: boolean; onLoadOlder: () => void; onOpen: (version: number) => void }) {
  const { t, i18n } = useTranslation("business");
  return (
    <section className="business-review__versions">
      <header><div><span>{t("planning.review.historyTitle")}</span><h2>{t("planning.review.historyHint")}</h2></div><History aria-hidden="true" /></header>
      {loading ? <div className="business-review__versions-loading"><LoaderCircle className="is-spinning" aria-hidden="true" />{t("planning.review.loading")}</div> : null}
      {!loading && versions.length === 0 ? <p>{t("planning.review.noVersions")}</p> : null}
      <div className="business-review__version-list">
        {versions.map((version) => (
          <button type="button" key={version.versionId} onClick={() => onOpen(version.versionNumber)} aria-label={t("planning.review.openDetails", { version: version.versionNumber })}>
            <span className="business-review__version-number">v{version.versionNumber}</span>
            <span><strong>{formatDateTime(version.publishedAt, i18n.resolvedLanguage ?? i18n.language)}</strong><small>{version.publicationKind === "LEGACY_PARTIAL" ? t("planning.review.legacy") : `${t("planning.coverage.covered")} · ${version.percentage == null ? "—" : `${formatPercent(version.percentage)}%`}`}</small></span>
            <span className="business-review__version-meta">{version.latest ? <b>{t("planning.review.latest")}</b> : null}<small>r{version.sourceDraftRevision}</small></span>
            <ArrowRight aria-hidden="true" />
          </button>
        ))}
      </div>
      {canLoadOlder ? <button type="button" className="business-review__load-older" disabled={loadingOlder} onClick={onLoadOlder}>{loadingOlder ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}{loadingOlder ? t("planning.review.loadingOlder") : t("planning.review.loadOlder")}</button> : null}
    </section>
  );
}

function VersionDetailDialog({ open, versionNumber, detail, previous, loading, error, onClose, onPrint }: { open: boolean; versionNumber: number | null; detail: StaffingVersionDetail | null; previous: StaffingVersionDetail | null; loading: boolean; error: string | null; onClose: () => void; onPrint: (detail: StaffingVersionDetail) => void }) {
  const { t, i18n } = useTranslation("business");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button,[href],[tabindex]:not([tabindex="-1"])')].filter((item) => !item.hasAttribute("disabled"));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); returnFocus.current?.focus(); };
  }, [onClose, open]);
  if (!open) return null;
  const diff = detail && previous ? snapshotDiff(detail, previous) : null;
  return (
    <div className="business-version-dialog__backdrop">
      <div className="business-version-dialog" role="dialog" aria-modal="true" aria-labelledby="version-dialog-title" ref={dialogRef}>
        <header><div><span>{detail ? formatDateTime(detail.publishedAt, i18n.resolvedLanguage ?? i18n.language) : "ALVERYN · BUSINESS"}</span><h2 id="version-dialog-title">{t("planning.review.versionDetail", { version: versionNumber })}</h2><p>{t("planning.review.snapshotOnly")}</p></div><button type="button" ref={closeRef} onClick={onClose} aria-label={t("planning.review.closeVersion")}><X aria-hidden="true" /></button></header>
        {loading ? <div className="business-version-dialog__loading" role="status"><LoaderCircle className="is-spinning" aria-hidden="true" />{t("planning.review.loading")}</div> : null}
        {error ? <div className="business-version-dialog__error" role="alert">{error}</div> : null}
        {detail ? (
          <div className="business-version-dialog__body">
            <section className="business-version-dialog__summary"><div><span>{t("planning.coverage.covered")}</span><strong>{detail.percentage == null ? "—" : `${formatPercent(detail.percentage)}%`}</strong><small>{detail.covered ?? "—"}/{detail.required ?? "—"}</small></div><div><span>{t("planning.review.groups.WARNING")}</span><strong>{detail.warningCount}</strong><small>{detail.coverageBasis}</small></div><div><span>CHECKSUM</span><strong>{detail.checksum.slice(0, 12)}</strong><small>{detail.publicationKind}</small></div></section>
            <button type="button" className="business-version-dialog__print" aria-label={t("planning.print.openPreview")} onClick={() => onPrint(detail)}><Printer aria-hidden="true" /><span><strong>{t("planning.print.openPreview")}</strong><small>{t("planning.print.openPreviewHint")}</small></span><ArrowRight aria-hidden="true" /></button>
            {detail.percentage == null ? <p className="business-version-dialog__legacy-note">{t("planning.review.coverageUnavailable")}</p> : null}
            <SnapshotDiffView current={detail} previous={previous} diff={diff} />
            <section className="business-version-dialog__snapshot"><h3>{t("planning.review.demandSnapshot")}</h3><div className="business-version-dialog__requirements">{detail.requirements.map((item, index) => <article key={item.sourceRequirementId ?? `${item.date}:${item.workTypeCode}:${index}`}><span>{formatDate(item.date, i18n.resolvedLanguage ?? i18n.language)}</span><strong>{item.workTypeCode} · {item.workTypeName}</strong><small>{interval(item.startTime, item.endTime)} · {item.requiredWorkers}</small></article>)}</div></section>
            <section className="business-version-dialog__snapshot"><h3>{t("planning.review.assignmentSnapshot")}</h3>{detail.assignments.length === 0 ? <p>{t("planning.review.noAssignments")}</p> : <div className="business-version-dialog__assignments">{detail.assignments.map((item, index) => <article key={item.sourceAssignmentId ?? `${item.date}:${item.memberDisplayName}:${index}`}><span>{formatDate(item.date, i18n.resolvedLanguage ?? i18n.language)}</span><strong>{item.memberDisplayName}</strong><small>{item.workTypeCode} · {interval(item.startTime, item.endTime)}</small></article>)}</div>}</section>
            {detail.memberDays.length > 0 ? <section className="business-version-dialog__snapshot"><h3>{t("planning.review.timeAwaySnapshot")}</h3><div className="business-version-dialog__member-days">{detail.memberDays.map((item, index) => <span key={item.sourceDayEntryId ?? `${item.date}:${item.memberDisplayName}:${index}`}><b>{item.memberDisplayName}</b>{formatDate(item.date, i18n.resolvedLanguage ?? i18n.language)} · {item.status}</span>)}</div></section> : null}
            {detail.acknowledgements.length > 0 ? <section className="business-version-dialog__snapshot"><h3>{t("planning.review.acknowledgements")}</h3><ul>{detail.acknowledgements.map((item) => <li key={item.issueKey}>{item.severity} · {item.issueKey}</li>)}</ul></section> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SnapshotDiffView({ current, previous, diff }: { current: StaffingVersionDetail; previous: StaffingVersionDetail | null; diff: ReturnType<typeof snapshotDiff> | null }) {
  const { t } = useTranslation("business");
  if (!previous || !diff) return <section className="business-version-dialog__diff"><h3>{t("planning.review.diffUnavailable")}</h3></section>;
  return (
    <section className="business-version-dialog__diff">
      <h3>{t("planning.review.diffTitle", { from: previous.versionNumber, to: current.versionNumber })}</h3>
      <div>{(["requirements", "assignments", "memberDays"] as const).map((key) => <article key={key}><span>{t(`planning.review.diff.${key}`)}</span><strong>{t("planning.review.diff.added", { count: diff[key].added })}</strong><small>{t("planning.review.diff.removed", { count: diff[key].removed })} · {t("planning.review.diff.changed", { count: diff[key].changed })}</small></article>)}<article><span>{t("planning.review.diff.coverage")}</span><strong>{t("planning.review.diff.coverageChange", { from: previous.percentage == null ? "—" : formatPercent(previous.percentage), to: current.percentage == null ? "—" : formatPercent(current.percentage) })}</strong><small>{previous.covered ?? "—"}/{previous.required ?? "—"} → {current.covered ?? "—"}/{current.required ?? "—"}</small></article></div>
    </section>
  );
}

function deriveReviewState(
  plan: StaffingPlan,
  review: StaffingReview,
  acknowledged: Set<string>,
  publishing: boolean,
): ReviewUiState {
  const requiredKeys = [...new Set(review.requiredAcknowledgementKeys)];
  const remainingAcknowledgementCount = requiredKeys.filter((key) => !acknowledged.has(key)).length;
  const latestVersionNumber = plan.latestPublishedVersion?.versionNumber ?? null;
  const base = {
    canPublish: false,
    blockingCount: review.blockingIssueCount,
    remainingAcknowledgementCount,
    latestVersionNumber,
    hasUnpublishedChanges: plan.hasUnpublishedChanges,
  };
  if (publishing) return { ...base, kind: "PUBLISHING" };
  if (!plan.hasUnpublishedChanges && latestVersionNumber != null) {
    return { ...base, kind: "PUBLISHED_CURRENT" };
  }
  if (review.blockingIssueCount > 0) return { ...base, kind: "BLOCKED" };
  if (latestVersionNumber != null && plan.hasUnpublishedChanges && remainingAcknowledgementCount > 0) {
    return { ...base, kind: "UNPUBLISHED_CHANGES" };
  }
  if (remainingAcknowledgementCount > 0) return { ...base, kind: "ACKNOWLEDGEMENT_REQUIRED" };
  if (plan.hasUnpublishedChanges && review.publishable) {
    return { ...base, kind: "READY_TO_PUBLISH", canPublish: plan.capabilities.publish };
  }
  return { ...base, kind: "UNPUBLISHED_CHANGES" };
}

function reviewStateLabel(t: ReturnType<typeof useTranslation>["t"], state: ReviewUiState) {
  if (state.kind === "BLOCKED") return t("planning.review.statusBlocked", { count: state.blockingCount });
  if (state.kind === "ACKNOWLEDGEMENT_REQUIRED") return t("planning.review.statusAcknowledge", { count: state.remainingAcknowledgementCount });
  if (state.kind === "READY_TO_PUBLISH") return t("planning.review.statusReady");
  if (state.kind === "PUBLISHING") return t("planning.review.statusPublishing");
  if (state.kind === "PUBLISHED_CURRENT") return t("planning.review.statusPublishedCurrent", { version: state.latestVersionNumber });
  return t("planning.review.statusUnpublished");
}

function reviewStateHelp(t: ReturnType<typeof useTranslation>["t"], state: ReviewUiState) {
  if (state.kind === "BLOCKED") return t("planning.review.blockedHelp");
  if (state.kind === "ACKNOWLEDGEMENT_REQUIRED") return t("planning.review.acknowledgementHelp");
  return t("planning.review.unpublishedHelp", { version: state.latestVersionNumber });
}

function ReviewStateIcon({ state }: { state: ReviewUiState }) {
  if (state.kind === "BLOCKED") return <ShieldAlert aria-hidden="true" />;
  if (state.kind === "ACKNOWLEDGEMENT_REQUIRED" || state.kind === "UNPUBLISHED_CHANGES") return <AlertTriangle aria-hidden="true" />;
  if (state.kind === "PUBLISHING") return <LoaderCircle className="is-spinning" aria-hidden="true" />;
  return <CheckCircle2 aria-hidden="true" />;
}

function SeverityIcon({ severity }: { severity: StaffingIssue["severity"] }) {
  if (severity === "BLOCKING_CONFLICT") return <ShieldAlert aria-hidden="true" />;
  if (severity === "WARNING") return <AlertTriangle aria-hidden="true" />;
  if (severity === "PENDING_REQUEST" || severity === "UNCONFIRMED_CHANGE") return <Clock3 aria-hidden="true" />;
  return <Info aria-hidden="true" />;
}

async function loadVersionPage(organizationId: string, planId: string, beforeVersion: number | undefined, cache: Map<string, VersionPage>) {
  const key = beforeVersion == null ? "first" : String(beforeVersion);
  const cached = cache.get(key);
  const result = await getStaffingVersions(organizationId, planId, { limit: PAGE_SIZE, beforeVersion, ifNoneMatch: cached?.etag ?? undefined });
  if (result.status === 304) {
    if (!cached) throw new Error("Version page returned 304 without a local representation.");
    return cached;
  }
  const page = result as VersionPage;
  cache.set(key, page);
  return page;
}

async function loadVersionDetail(organizationId: string, planId: string, versionNumber: number, cache: Map<number, VersionDetailResult>) {
  const cached = cache.get(versionNumber);
  const result = await getStaffingVersion(organizationId, planId, versionNumber, cached?.etag ?? undefined);
  if (result.status === 304) {
    if (!cached) throw new Error("Version detail returned 304 without a local representation.");
    return cached;
  }
  const detail = result as VersionDetailResult;
  cache.set(versionNumber, detail);
  return detail;
}

function snapshotDiff(current: StaffingVersionDetail, previous: StaffingVersionDetail) {
  return {
    requirements: compareSnapshots(previous.requirements, current.requirements, (item) => item.sourceRequirementId ?? `legacy:${item.date}:${item.unitId}:${item.workTypeCode}`, (item) => JSON.stringify([item.date, item.workTypeCode, item.startTime, item.endTime, item.breakMinutes, item.requiredWorkers, item.requiredQuantity])),
    assignments: compareSnapshots(previous.assignments, current.assignments, (item) => item.sourceAssignmentId ?? `legacy:${item.sourceRequirementId}:${item.membershipId}:${item.date}:${item.workTypeCode}`, (item) => JSON.stringify([item.sourceRequirementId, item.membershipId, item.date, item.workTypeCode, item.startTime, item.endTime, item.status])),
    memberDays: compareSnapshots(previous.memberDays, current.memberDays, (item) => item.sourceDayEntryId ?? `legacy:${item.membershipId}:${item.date}`, (item) => JSON.stringify([item.membershipId, item.date, item.status, item.source])),
  };
}

function compareSnapshots<T>(previous: T[], current: T[], key: (item: T) => string, value: (item: T) => string) {
  const before = snapshotGroups(previous, key, value);
  const after = snapshotGroups(current, key, value);
  let added = 0;
  let removed = 0;
  let changed = 0;
  new Set([...before.keys(), ...after.keys()]).forEach((itemKey) => {
    const oldValues = [...(before.get(itemKey) ?? [])];
    const newValues = [...(after.get(itemKey) ?? [])];
    for (let index = oldValues.length - 1; index >= 0; index -= 1) {
      const match = newValues.indexOf(oldValues[index]);
      if (match >= 0) {
        oldValues.splice(index, 1);
        newValues.splice(match, 1);
      }
    }
    const paired = Math.min(oldValues.length, newValues.length);
    changed += paired;
    removed += oldValues.length - paired;
    added += newValues.length - paired;
  });
  return { added, removed, changed };
}

function snapshotGroups<T>(items: T[], key: (item: T) => string, value: (item: T) => string) {
  const groups = new Map<string, string[]>();
  items.forEach((item) => {
    const itemKey = key(item);
    groups.set(itemKey, [...(groups.get(itemKey) ?? []), value(item)].sort());
  });
  return groups;
}

function issueMessage(t: ReturnType<typeof useTranslation>["t"], issue: StaffingIssue) {
  const key = `planning.review.issues.${issue.code}`;
  return t(key, { ...issue.parameters, defaultValue: t("planning.review.unknownIssue") });
}

function flattenIssues(review: StaffingReview | null) {
  return review?.groups.flatMap((group) => group.issues) ?? [];
}

function toggleSet(current: Set<string>, key: string) {
  const next = new Set(current);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}

function stableOperationKey(store: Map<string, string>, semanticKey: string) {
  const existing = store.get(semanticKey);
  if (existing) return existing;
  const value = `web-publish-${operationId()}`;
  store.set(semanticKey, value);
  return value;
}

/**
 * iPad Safari exposes crypto.randomUUID only in a secure context. Local pilot testing is
 * intentionally also available through http://<LAN-IP>, so publishing needs the same safe
 * idempotency-key fallback used by Demand instead of failing before the request is sent.
 */
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

function strongEtag(value: string) {
  if (!/^"[^"\r\n]+"$/.test(value) || value.startsWith("W/")) {
    throw new Error("Publishing requires a current strong plan ETag.");
  }
  return value;
}

function formatPercent(value: number) { return Number(value).toFixed(Number(value) % 1 === 0 ? 0 : 1); }
function interval(start: string | null, end: string | null) { return start && end ? `${start.slice(0, 5)}–${end.slice(0, 5)}` : "—"; }
function formatDate(value: string, locale: string) { return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00`)); }
function formatDateTime(value: string, locale: string) { return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function formatWeekRange(from: string, to: string, locale: string) { return `${formatDate(from, locale)} – ${formatDate(to, locale)}`; }

function normalizeMonday(value: string | null) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T12:00:00`);
    if (!Number.isNaN(parsed.getTime()) && parsed.getDay() === 1) return value;
  }
  return mondayIso(new Date());
}
function mondayIso(date: Date) { const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12); const day = copy.getDay() || 7; copy.setDate(copy.getDate() - day + 1); return localIso(copy); }
function addDays(value: string, amount: number) { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + amount); return localIso(date); }
function localIso(date: Date) { const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, "0"); const day = String(date.getDate()).padStart(2, "0"); return `${year}-${month}-${day}`; }

function BusinessRouteSkeleton() { return <div className="business-route-skeleton" aria-label="Loading Business workspace"><div /><div /><div /></div>; }
function BusinessState({ title, description, action, compact = false }: { title: string; description: string; action?: ReactNode; compact?: boolean }) { return <main className={`business-state${compact ? " is-compact" : ""}`}><span>ALVERYN · BUSINESS</span><h1>{title}</h1><p>{description}</p>{action ? <div>{action}</div> : null}</main>; }

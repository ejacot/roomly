import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  StaffingCoverage,
  StaffingIssue,
  StaffingPublishResult,
  StaffingReview,
  StaffingVersionDetail,
  StaffingVersions,
} from "../types/business-planning";
import { BusinessReviewPage } from "./business-review-page";

const mocks = vi.hoisted(() => ({
  findPlan: vi.fn(),
  getCoverage: vi.fn(),
  getReview: vi.fn(),
  getVersions: vi.fn(),
  getVersion: vi.fn(),
  publish: vi.fn(),
  apiError: vi.fn((cause: { status?: number; message?: string }) => ({
    status: cause?.status ?? 500,
    message: cause?.message ?? "Request failed",
  })),
}));

vi.mock("../api/business-planning", () => ({
  findStaffingPlan: mocks.findPlan,
  getStaffingCoverage: mocks.getCoverage,
  getStaffingReview: mocks.getReview,
  getStaffingVersions: mocks.getVersions,
  getStaffingVersion: mocks.getVersion,
  publishStaffingPlan: mocks.publish,
}));
vi.mock("../api/api-errors", () => ({ getApiError: mocks.apiError }));
vi.mock("../api/endpoints", () => ({
  listOrganizations: vi.fn(async () => [{ id: "org-1", name: "PUIU GmbH", type: "BUSINESS", timezone: "Europe/Berlin", role: "OWNER" }]),
  listOrganizationUnits: vi.fn(async () => [{ id: "unit-1", parentId: null, name: "Hotel München", type: "LOCATION", checkInMode: "OPTIONAL", active: true, displayOrder: 0 }]),
}));

const totals = (required: number, assigned: number) => ({
  required,
  rawAssigned: assigned,
  effectiveAssigned: assigned,
  covered: Math.min(required, assigned),
  missing: Math.max(0, required - assigned),
  overstaffed: Math.max(0, assigned - required),
  percentage: required === 0 ? 100 : Math.round((Math.min(required, assigned) / required) * 100),
  openPositions: Math.max(0, required - assigned),
});

const plan = {
  planId: "plan-1",
  organizationId: "org-1",
  unitId: "unit-1",
  unitName: "Hotel München",
  weekStart: "2026-08-10",
  weekEnd: "2026-08-16",
  timezone: "Europe/Berlin",
  status: "ACTIVE" as const,
  draftRevision: 6,
  etag: '"plan-plan-1-rev-6"',
  latestPublishedVersion: null,
  publishedRevision: null,
  publishedAt: null,
  hasUnpublishedChanges: true,
  capabilities: { view: true, manage: true, publish: true },
};

function publishedPlan(draftRevision = 6, hasUnpublishedChanges = false) {
  return {
    ...plan,
    draftRevision,
    etag: `"plan-plan-1-rev-${draftRevision}"`,
    latestPublishedVersion: {
      versionId: "version-3",
      versionNumber: 3,
      sourceDraftRevision: 6,
      publishedAt: "2026-08-14T13:00:00Z",
      publicationKind: "ATOMIC_WEEKLY" as const,
      coverageBasis: "CANONICAL_V94" as const,
      checksum: "new-version-checksum",
    },
    publishedRevision: 6,
    publishedAt: "2026-08-14T13:00:00Z",
    hasUnpublishedChanges,
  };
}

const warning: StaffingIssue = {
  issueKey: "UNDERCOVERAGE:req-spa",
  code: "UNDERCOVERAGE",
  severity: "WARNING",
  date: "2026-08-16",
  requirementId: "req-spa",
  assignmentId: null,
  membershipId: null,
  messageKey: "staffing.issue.undercoverage",
  parameters: { effectiveAssigned: "1", required: "2" },
  acknowledgementRequired: true,
  publishBlocking: false,
};

function reviewWith(issues: StaffingIssue[] = [warning], revision = 6): StaffingReview {
  const blocking = issues.filter((issue) => issue.publishBlocking).length;
  const warnings = issues.filter((issue) => issue.severity === "WARNING").length;
  return {
    planId: "plan-1",
    organizationId: "org-1",
    unitId: "unit-1",
    weekStart: "2026-08-10",
    draftRevision: revision,
    etag: `"plan-plan-1-rev-${revision}"`,
    coverage: totals(99, 98),
    groups: [
      ...blocking ? [{ severity: "BLOCKING_CONFLICT" as const, count: blocking, issues: issues.filter((issue) => issue.severity === "BLOCKING_CONFLICT") }] : [],
      ...warnings ? [{ severity: "WARNING" as const, count: warnings, issues: issues.filter((issue) => issue.severity === "WARNING") }] : [],
    ],
    blockingIssueCount: blocking,
    warningCount: warnings,
    informationCount: 0,
    publishable: blocking === 0,
    requiredAcknowledgementKeys: issues.filter((issue) => issue.acknowledgementRequired).map((issue) => issue.issueKey),
  };
}

function coverage(): StaffingCoverage {
  return {
    planId: "plan-1",
    organizationId: "org-1",
    unitId: "unit-1",
    weekStart: "2026-08-10",
    draftRevision: 6,
    etag: plan.etag,
    totals: totals(99, 98),
    requirements: [{
      requirementId: "req-spa",
      planDayId: "day-sun",
      date: "2026-08-16",
      workTypeId: "spa-s",
      workTypeCode: "SPA S",
      workTypeName: "Spa Spät",
      startTime: "12:00:00",
      endTime: "20:30:00",
      totals: totals(2, 1),
      assignmentIds: ["assignment-1"],
      effectiveAssignmentIds: ["assignment-1"],
      issueKeys: [warning.issueKey],
    }],
    days: [{ date: "2026-08-16", totals: totals(2, 1), issueKeys: [warning.issueKey] }],
    issues: [warning],
    blockingIssueCount: 0,
    warningCount: 1,
    informationCount: 0,
    publishable: true,
  };
}

function versions(): StaffingVersions {
  return {
    planId: "plan-1",
    organizationId: "org-1",
    unitId: "unit-1",
    limit: 8,
    nextBeforeVersion: null,
    hasMore: false,
    versions: [{
      versionId: "version-2",
      versionNumber: 2,
      sourceDraftRevision: 5,
      required: 98,
      rawAssigned: 98,
      effectiveAssigned: 98,
      covered: 98,
      missing: 0,
      overstaffed: 0,
      percentage: 100,
      coverageBasis: "CANONICAL_V94",
      warningCount: 0,
      checksum: "version-two-checksum",
      publicationKind: "ATOMIC_WEEKLY",
      sourceDraftComplete: true,
      publisherDisplayName: "Eusebiu Jacot",
      publishedAt: "2026-08-14T12:00:00Z",
      latest: true,
    }],
  };
}

function version(versionNumber: number): StaffingVersionDetail {
  const current = versionNumber === 2;
  return {
    versionId: `version-${versionNumber}`,
    planId: "plan-1",
    organizationId: "org-1",
    unitId: "unit-1",
    versionNumber,
    sourceDraftRevision: current ? 5 : 4,
    required: current ? 98 : 97,
    rawAssigned: current ? 98 : 96,
    effectiveAssigned: current ? 98 : 96,
    covered: current ? 98 : 96,
    missing: current ? 0 : 1,
    overstaffed: 0,
    percentage: current ? 100 : 99,
    coverageBasis: "CANONICAL_REQUIREMENT_V1",
    warningCount: current ? 0 : 1,
    checksum: `checksum-${versionNumber}`,
    checksumFormatVersion: 2,
    granularCoverageAvailable: true,
    publicationKind: "ATOMIC_WEEKLY",
    sourceDraftComplete: true,
    publishedAt: current ? "2026-08-14T12:00:00Z" : "2026-08-13T12:00:00Z",
    timezone: "Europe/Berlin",
    weekStart: "2026-08-10",
    days: [{ sourcePlanDayId: "day-sun", date: "2026-08-16", roomsContext: 10, source: "MANUAL" }],
    requirements: [{
      sourceRequirementId: "req-spa",
      sourcePlanDayId: "day-sun",
      date: "2026-08-16",
      unitId: "unit-1",
      unitName: "Hotel München",
      workTypeId: "spa-s",
      workTypeCode: "SPA S",
      workTypeName: "Spa Spät",
      startTime: "12:00:00",
      endTime: "20:30:00",
      breakMinutes: 30,
      requiredWorkers: current ? 2 : 1,
      requiredQuantity: null,
      legacyPublicationStatus: "PUBLISHED",
    }],
    assignments: current ? [{
      sourceAssignmentId: "assignment-2",
      sourceRequirementId: "req-spa",
      membershipId: "member-2",
      memberDisplayName: "Ana Dumitru",
      membershipStatus: "ACTIVE",
      date: "2026-08-16",
      unitId: "unit-1",
      unitName: "Hotel München",
      workTypeId: "spa-s",
      workTypeCode: "SPA S",
      workTypeName: "Spa Spät",
      startTime: "12:00:00",
      endTime: "20:30:00",
      status: "ASSIGNED",
      checkInMode: null,
      checkedInAt: null,
      checkedOutAt: null,
    }] : [],
    memberDays: [],
    acknowledgements: [],
    requirementCoverage: [],
    dayCoverage: [],
  };
}

function entity<T>(data: T, etag = plan.etag, status = 200) {
  return { data, etag, location: null, status, idempotentReplay: false };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const result = render(
    <MemoryRouter initialEntries={["/business/org-1/plan/review?unit=unit-1&week=2026-08-10"]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/business/:organizationId/plan/review" element={<BusinessReviewPage />} />
          <Route path="/business/:organizationId/plan/demand" element={<p>Demand destination</p>} />
          <Route path="/business/:organizationId/plan/schedule" element={<p>Schedule destination</p>} />
          <Route path="/business/:organizationId/plan/:planId/versions/:versionNumber/print" element={<p>Dedicated print destination</p>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...result, client };
}

function expectReviewState(kind: string) {
  const surfaces = [...document.querySelectorAll<HTMLElement>("[data-review-state]")];
  expect(surfaces.length).toBeGreaterThanOrEqual(4);
  expect(new Set(surfaces.map((surface) => surface.dataset.reviewState))).toEqual(new Set([kind]));
}

describe("BusinessReviewPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findPlan.mockResolvedValue(entity({ found: true, plan }));
    mocks.getCoverage.mockResolvedValue(entity(coverage()));
    mocks.getReview.mockResolvedValue(entity(reviewWith()));
    mocks.getVersions.mockResolvedValue(entity(versions(), '"versions-page"'));
    mocks.getVersion.mockImplementation(async (_org: string, _plan: string, number: number) => entity(version(number), `"version-${number}"`));
    const result: StaffingPublishResult = {
      planId: "plan-1",
      versionId: "version-3",
      versionNumber: 3,
      sourceDraftRevision: 6,
      publishedRevision: 6,
      publishedAt: "2026-08-14T13:00:00Z",
      publicationKind: "ATOMIC_WEEKLY",
      canonicalCoverage: { required: 99, rawAssigned: 98, effectiveAssigned: 98, covered: 98, missing: 1, overstaffed: 0, percentage: 99 },
      warningCount: 1,
      checksum: "new-version-checksum",
      idempotentReplay: false,
    };
    mocks.publish.mockResolvedValue(entity(result, '"version-3"', 201));
  });

  it("uses canonical review values and sends only the current acknowledgement set", async () => {
    const user = userEvent.setup();
    mocks.findPlan.mockReset();
    mocks.findPlan
      .mockResolvedValueOnce(entity({ found: true, plan }))
      .mockResolvedValue(entity({ found: true, plan: publishedPlan() }));
    renderPage();

    expect(await screen.findByText("98 / 99")).toBeInTheDocument();
    expectReviewState("ACKNOWLEDGEMENT_REQUIRED");
    expect(screen.queryByText("Ready to publish")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review and acknowledge 1 warning" })).toBeEnabled();
    await user.click(screen.getByRole("checkbox", { name: /reviewed and acknowledge/ }));
    await waitFor(() => expectReviewState("READY_TO_PUBLISH"));
    await user.type(screen.getByLabelText("Publication note (optional)"), "  Hotel confirmed  ");
    await user.click(screen.getByRole("button", { name: "Publish week" }));

    await waitFor(() => expect(mocks.publish).toHaveBeenCalledWith(
      "org-1",
      "plan-1",
      plan.etag,
      expect.stringMatching(/^web-/),
      { acknowledgementKeys: [warning.issueKey], publicationNote: "Hotel confirmed" },
    ));
    expect(await screen.findByRole("heading", { name: "Version v3 published" })).toBeInTheDocument();
    expect(screen.getByText("98 of 99 required positions covered")).toBeInTheDocument();
    expectReviewState("PUBLISHED_CURRENT");
    expect(screen.queryByRole("checkbox", { name: /reviewed and acknowledge/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish week" })).not.toBeInTheDocument();
  });

  it("publishes when LAN Safari does not provide crypto.randomUUID", async () => {
    const user = userEvent.setup();
    const getRandomValues = vi.fn((values: Uint32Array) => {
      values.set([1, 2, 3, 4]);
      return values;
    });
    vi.stubGlobal("crypto", { getRandomValues });
    mocks.findPlan.mockReset();
    mocks.findPlan
      .mockResolvedValueOnce(entity({ found: true, plan }))
      .mockResolvedValue(entity({ found: true, plan: publishedPlan() }));
    renderPage();

    await user.click(await screen.findByRole("checkbox", { name: /reviewed and acknowledge/ }));
    await user.click(screen.getByRole("button", { name: "Publish week" }));

    await waitFor(() => expect(mocks.publish).toHaveBeenCalledWith(
      "org-1",
      "plan-1",
      plan.etag,
      "web-publish-00000001-00000002-00000003-00000004",
      expect.anything(),
    ));
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });

  it("uses one PUBLISHING verdict without enabling a second submit", async () => {
    const user = userEvent.setup();
    const result = await mocks.publish();
    let finishPublish: ((value: typeof result) => void) | undefined;
    mocks.publish.mockReset();
    mocks.publish.mockImplementation(() => new Promise((resolve) => { finishPublish = resolve; }));
    mocks.findPlan.mockReset();
    mocks.findPlan
      .mockResolvedValueOnce(entity({ found: true, plan }))
      .mockResolvedValue(entity({ found: true, plan: publishedPlan() }));
    renderPage();

    await user.click(await screen.findByRole("checkbox", { name: /reviewed and acknowledge/ }));
    await user.click(screen.getByRole("button", { name: "Publish week" }));

    await waitFor(() => expectReviewState("PUBLISHING"));
    expect(screen.getByRole("button", { name: "Publishing week…" })).toBeDisabled();
    expect(mocks.publish).toHaveBeenCalledTimes(1);

    finishPublish?.(result);
    expect(await screen.findByRole("heading", { name: "Version v3 published" })).toBeInTheDocument();
    expectReviewState("PUBLISHED_CURRENT");
  });

  it("returns to a fresh acknowledgement state after the published draft changes", async () => {
    mocks.findPlan.mockResolvedValue(entity({ found: true, plan: publishedPlan() }));
    const { client } = renderPage();

    expect((await screen.findAllByText("Published v3 · Draft matches this version")).length).toBeGreaterThanOrEqual(1);
    expectReviewState("PUBLISHED_CURRENT");
    expect(screen.queryByRole("checkbox", { name: /reviewed and acknowledge/ })).not.toBeInTheDocument();

    mocks.findPlan.mockResolvedValue(entity({ found: true, plan: publishedPlan(7, true) }));
    mocks.getReview.mockResolvedValue(entity(reviewWith([warning], 7), '"plan-plan-1-rev-7"'));
    await client.invalidateQueries({ queryKey: ["staffing-plan"] });

    expect((await screen.findAllByText("Unpublished changes")).length).toBeGreaterThanOrEqual(1);
    await waitFor(() => expectReviewState("UNPUBLISHED_CHANGES"));
    expect(screen.getByRole("checkbox", { name: /reviewed and acknowledge/ })).not.toBeChecked();
    await userEvent.click(screen.getByRole("checkbox", { name: /reviewed and acknowledge/ }));
    await waitFor(() => expectReviewState("READY_TO_PUBLISH"));
  });

  it("derives unpublished changes directly from a published backend plan in a fresh browser state", async () => {
    mocks.findPlan.mockResolvedValue(entity({ found: true, plan: publishedPlan(7, true) }));
    mocks.getReview.mockResolvedValue(entity(reviewWith([warning], 7), '"plan-plan-1-rev-7"'));
    renderPage();

    await waitFor(() => expectReviewState("UNPUBLISHED_CHANGES"));
    expect(window.sessionStorage.length).toBe(0);
    expect(screen.getByRole("checkbox", { name: /reviewed and acknowledge/ })).not.toBeChecked();
  });

  it("allows an operational conflict to be acknowledged before publishing and links it to Schedule", async () => {
    const blocker: StaffingIssue = {
      ...warning,
      issueKey: "INCOMPATIBLE_OVERLAP:assignment-1",
      code: "INCOMPATIBLE_OVERLAP",
      severity: "WARNING",
      assignmentId: "assignment-1",
      acknowledgementRequired: true,
      publishBlocking: false,
    };
    mocks.getReview.mockResolvedValue(entity(reviewWith([blocker])));
    renderPage();

    expect((await screen.findAllByText("Review and acknowledge 1 warning")).length).toBeGreaterThanOrEqual(1);
    expectReviewState("ACKNOWLEDGEMENT_REQUIRED");
    expect(screen.getByRole("button", { name: "Review and acknowledge 1 warning" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /reviewed and acknowledge/ })).toBeInTheDocument();
  });

  it("never auto-retries a stale publish and clears the obsolete acknowledgement", async () => {
    const user = userEvent.setup();
    mocks.publish.mockRejectedValueOnce({ status: 412, message: "stale" });
    renderPage();

    const acknowledgement = await screen.findByRole("checkbox", { name: /reviewed and acknowledge/ });
    await user.click(acknowledgement);
    await user.click(screen.getByRole("button", { name: "Publish week" }));

    expect((await screen.findAllByText(/plan changed during review/)).length).toBeGreaterThan(0);
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(acknowledgement).not.toBeChecked());
  });

  it("opens one immutable version and derives the summary diff from two snapshots", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Open version v2" }));
    const dialog = await screen.findByRole("dialog", { name: "Immutable version v2" });
    expect(within(dialog).getByText("Ana Dumitru")).toBeInTheDocument();
    expect(within(dialog).getByText("Changes from v1 to v2")).toBeInTheDocument();
    expect(within(dialog).getByText("1 added")).toBeInTheDocument();
    expect(mocks.getVersion).toHaveBeenCalledWith("org-1", "plan-1", 2, undefined);
    expect(mocks.getVersion).toHaveBeenCalledWith("org-1", "plan-1", 1, undefined);

    await user.click(within(dialog).getByRole("button", { name: "Review and print this version" }));
    expect(await screen.findByText("Dedicated print destination")).toBeInTheDocument();
    expect(mocks.getVersion).toHaveBeenCalledTimes(2);
  });

  it("does not offer another publish when the draft already matches the latest version", async () => {
    mocks.findPlan.mockResolvedValue(entity({
      found: true,
      plan: {
        ...plan,
        hasUnpublishedChanges: false,
        publishedRevision: 6,
        latestPublishedVersion: {
          versionId: "version-2",
          versionNumber: 2,
          sourceDraftRevision: 6,
          publishedAt: "2026-08-14T12:00:00Z",
          publicationKind: "ATOMIC_WEEKLY",
          coverageBasis: "CANONICAL_V94",
          checksum: "version-two-checksum",
        },
      },
    }));
    mocks.getReview.mockResolvedValue(entity(reviewWith([])));
    renderPage();

    expect((await screen.findAllByText("Published v2 · Draft matches this version")).length).toBeGreaterThanOrEqual(1);
    expectReviewState("PUBLISHED_CURRENT");
    expect(screen.queryByRole("button", { name: "Publish week" })).not.toBeInTheDocument();
  });

  it("distinguishes an idempotent replay from a new publication", async () => {
    const user = userEvent.setup();
    const replay = await mocks.publish();
    mocks.publish.mockReset();
    mocks.publish.mockResolvedValue({ ...replay, idempotentReplay: true, status: 200 });
    mocks.findPlan.mockReset();
    mocks.findPlan
      .mockResolvedValueOnce(entity({ found: true, plan }))
      .mockResolvedValue(entity({ found: true, plan: publishedPlan() }));
    renderPage();

    await user.click(await screen.findByRole("checkbox", { name: /reviewed and acknowledge/ }));
    await user.click(screen.getByRole("button", { name: "Publish week" }));

    expect(await screen.findByText(/original publication response was recovered safely/)).toBeInTheDocument();
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    expectReviewState("PUBLISHED_CURRENT");
  });

  it("labels legacy history honestly when canonical coverage is unavailable", async () => {
    const user = userEvent.setup();
    const legacy = version(1);
    legacy.percentage = null;
    legacy.required = null;
    legacy.covered = null;
    legacy.coverageBasis = "LEGACY_V90";
    legacy.publicationKind = "LEGACY_PARTIAL";
    mocks.getVersions.mockResolvedValue(entity({
      ...versions(),
      versions: [{
        ...versions().versions[0],
        versionId: "version-1",
        versionNumber: 1,
        required: null,
        covered: null,
        percentage: null,
        coverageBasis: "LEGACY_V90",
        publicationKind: "LEGACY_PARTIAL",
      }],
    }));
    mocks.getVersion.mockResolvedValue(entity(legacy, '"version-1"'));
    renderPage();

    expect(await screen.findByText("Legacy snapshot")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open version v1" }));
    expect(await screen.findByText(/Canonical coverage was not recorded/)).toBeInTheDocument();
  });
});

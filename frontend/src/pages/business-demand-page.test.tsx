import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessDemandPage } from "./business-demand-page";

const mocks = vi.hoisted(() => ({
  findPlan: vi.fn(),
  createPlan: vi.fn(),
  getDemand: vi.fn(),
  createRequirement: vi.fn(),
  updateRequirement: vi.fn(),
  deleteRequirement: vi.fn(),
  batchDemand: vi.fn(),
  apiError: vi.fn((cause: { status?: number; message?: string }) => ({
    status: cause?.status ?? 500,
    message: cause?.message ?? "Request failed",
  })),
}));

vi.mock("../api/business-planning", () => ({
  findStaffingPlan: mocks.findPlan,
  createStaffingPlan: mocks.createPlan,
  getStaffingDemand: mocks.getDemand,
  createStaffingRequirement: mocks.createRequirement,
  updateStaffingRequirement: mocks.updateRequirement,
  deleteStaffingRequirement: mocks.deleteRequirement,
  batchStaffingDemand: mocks.batchDemand,
}));

vi.mock("../api/api-errors", () => ({ getApiError: mocks.apiError }));

vi.mock("../api/endpoints", () => ({
  listOrganizations: vi.fn(async () => [{
    id: "org-1",
    name: "PUIU GmbH",
    type: "BUSINESS",
    timezone: "Europe/Berlin",
    role: "OWNER",
  }]),
  listOrganizationUnits: vi.fn(async () => [{
    id: "unit-1",
    parentId: null,
    name: "Hotel München",
    type: "LOCATION",
    checkInMode: "OPTIONAL",
    active: true,
    displayOrder: 0,
  }]),
  getOrganizationAccess: vi.fn(async () => ({
    permissions: ["VIEW_SCHEDULE", "MANAGE_SCHEDULE", "PUBLISH_SCHEDULE"],
  })),
  listBusinessWorkTypes: vi.fn(async () => [workType]),
}));

const workType = {
  id: "work-1",
  unitId: "unit-1",
  parentId: null,
  code: "ROOM",
  name: "Room cleaning",
  color: "#087f61",
  defaultStartTime: "09:00:00",
  defaultEndTime: "16:30:00",
  defaultBreakMinutes: 30,
  calculationMethod: "TIME_BASED" as const,
  compensationMethod: "HOURLY" as const,
  unitLabel: null,
  unitSymbol: null,
  unitsPerHour: null,
  ratePerUnit: null,
  currency: null,
  teamworkEnabled: true,
  extraPayEnabled: false,
  compositeEnabled: false,
  displayOrder: 0,
  active: true,
};

const coverage = {
  required: 4,
  rawAssigned: 0,
  effectiveAssigned: 0,
  covered: 0,
  missing: 4,
  overstaffed: 0,
  percentage: 0,
  openPositions: 4,
};

const plan = {
  planId: "plan-1",
  organizationId: "org-1",
  unitId: "unit-1",
  unitName: "Hotel München",
  weekStart: "2026-08-10",
  weekEnd: "2026-08-16",
  timezone: "Europe/Berlin",
  status: "ACTIVE" as const,
  draftRevision: 3,
  etag: '"plan-plan-1-rev-3"',
  latestPublishedVersion: null,
  publishedRevision: null,
  publishedAt: null,
  hasUnpublishedChanges: true,
  capabilities: { view: true, manage: true, publish: true },
};

const requirement = {
  requirementId: "requirement-1",
  planDayId: "day-1",
  workTypeId: workType.id,
  workTypeCode: workType.code,
  workTypeName: workType.name,
  startTime: "09:00:00",
  endTime: "16:30:00",
  breakMinutes: 30,
  requiredWorkers: 4,
  requiredQuantity: null,
  legacyPublicationStatus: "DRAFT" as const,
  notes: null,
  coverage,
  issueKeys: [],
};

function demand() {
  return {
    planId: plan.planId,
    organizationId: plan.organizationId,
    unitId: plan.unitId,
    weekStart: plan.weekStart,
    weekEnd: plan.weekEnd,
    draftRevision: 3,
    etag: plan.etag,
    coverage,
    days: Array.from({ length: 7 }, (_, index) => ({
      planDayId: index === 0 ? "day-1" : null,
      date: `2026-08-${String(10 + index).padStart(2, "0")}`,
      persisted: index === 0,
      roomsContext: index === 0 ? 50 : null,
      notes: null,
      source: index === 0 ? "MANUAL" as const : null,
      coverage: index === 0 ? coverage : { ...coverage, required: 0, missing: 0, openPositions: 0 },
      requirements: index === 0 ? [requirement] : [],
      issueKeys: [],
    })),
  };
}

function entity<T>(data: T, etag: string | null = plan.etag, status = 200) {
  return { data, etag, status, idempotentReplay: false };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const result = render(
    <MemoryRouter initialEntries={["/business/org-1/plan/demand?unit=unit-1&week=2026-08-10"]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/business/:organizationId/plan/demand" element={<BusinessDemandPage />} />
          <Route path="/business/:organizationId/work-types/:workTypeId" element={<h1>Work type settings</h1>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...result, client };
}

describe("BusinessDemandPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findPlan.mockResolvedValue(entity({ found: true, plan }));
    mocks.getDemand.mockResolvedValue(entity(demand()));
    mocks.updateRequirement.mockResolvedValue(entity({
      planId: plan.planId,
      previousDraftRevision: 3,
      currentDraftRevision: 4,
      changed: true,
      affectedResourceIds: [requirement.requirementId],
    }, '"plan-plan-1-rev-4"'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads aggregate-native Demand and saves a direct numeric edit with If-Match", async () => {
    const user = userEvent.setup();
    const { client } = renderPage();
    const scheduleKey = ["staffing-plan", "org-1", "plan-1", "schedule"];
    const invalidateQueries = vi.spyOn(client, "invalidateQueries");

    expect(await screen.findByRole("heading", { name: "What does the hotel need this week?" })).toBeInTheDocument();
    const inputs = await screen.findAllByRole("spinbutton", {
      name: /People required for Room cleaning on Monday/,
    });
    await user.clear(inputs[0]);
    await user.type(inputs[0], "5");
    fireEvent.blur(inputs[0]);

    await waitFor(() => expect(mocks.updateRequirement).toHaveBeenCalledWith(
      "org-1",
      "plan-1",
      "requirement-1",
      '"plan-plan-1-rev-3"',
      expect.objectContaining({ requiredWorkers: 5 }),
    ));
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: scheduleKey }));
  });

  it("opens Apply to days from its Demand row", async () => {
    const user = userEvent.setup();
    renderPage();

    const workType = await screen.findByRole("button", { name: "Apply Room cleaning to days" });
    await user.click(workType);
    expect(await screen.findByRole("heading", { name: "Apply one requirement to several days" })).toBeInTheDocument();
  });

  it("shows the chosen work type name and planning time instead of its generated code", async () => {
    renderPage();

    expect((await screen.findAllByText("Room cleaning")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("09:00–16:30 · 7h").length).toBeGreaterThan(0);
    expect(screen.queryByText("ROOM")).not.toBeInTheDocument();
  });

  it("requires an explicit bootstrap when the selected week has no plan", async () => {
    const user = userEvent.setup();
    mocks.findPlan
      .mockResolvedValueOnce(entity({ found: false, plan: null }, null))
      .mockResolvedValue(entity({ found: true, plan }));
    mocks.createPlan.mockResolvedValue(entity({
      planId: plan.planId,
      organizationId: "org-1",
      unitId: "unit-1",
      weekStart: "2026-08-10",
      timezone: "Europe/Berlin",
      status: "ACTIVE",
      draftRevision: 0,
      created: true,
      idempotentReplay: false,
      capabilities: plan.capabilities,
    }, '"plan-plan-1-rev-0"', 201));
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Create this weekly plan" }));

    await waitFor(() => expect(mocks.createPlan).toHaveBeenCalledWith(
      "org-1",
      { unitId: "unit-1", weekStart: "2026-08-10" },
      expect.stringMatching(/^web-/),
    ));
  });

  it("creates a weekly plan when Safari does not provide crypto.randomUUID", async () => {
    const user = userEvent.setup();
    const getRandomValues = vi.fn((values: Uint32Array) => {
      values.set([1, 2, 3, 4]);
      return values;
    });
    vi.stubGlobal("crypto", { getRandomValues });
    mocks.findPlan
      .mockResolvedValueOnce(entity({ found: false, plan: null }, null))
      .mockResolvedValue(entity({ found: true, plan }));
    mocks.createPlan.mockResolvedValue(entity({
      planId: plan.planId,
      organizationId: "org-1",
      unitId: "unit-1",
      weekStart: "2026-08-10",
      timezone: "Europe/Berlin",
      status: "ACTIVE",
      draftRevision: 0,
      created: true,
      idempotentReplay: false,
      capabilities: plan.capabilities,
    }, '"plan-plan-1-rev-0"', 201));
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Create this weekly plan" }));

    await waitFor(() => expect(mocks.createPlan).toHaveBeenCalledWith(
      "org-1",
      { unitId: "unit-1", weekStart: "2026-08-10" },
      "web-00000001-00000002-00000003-00000004",
    ));
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });

  it("reloads the canonical week after a stale 412 without replaying the mutation", async () => {
    const user = userEvent.setup();
    mocks.updateRequirement.mockRejectedValueOnce({ status: 412, message: "stale" });
    renderPage();

    const input = (await screen.findAllByRole("spinbutton", {
      name: /People required for Room cleaning on Monday/,
    }))[0];
    await user.clear(input);
    await user.type(input, "6");
    fireEvent.blur(input);

    expect(await screen.findByText(/The current version has been reloaded/)).toBeInTheDocument();
    expect(mocks.updateRequirement).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.getDemand.mock.calls.length).toBeGreaterThan(1));
  });

  it("pastes an Excel range through one atomic C5b batch", async () => {
    renderPage();
    const input = (await screen.findAllByRole("spinbutton", {
      name: /People required for Room cleaning on Monday/,
    }))[0];
    fireEvent.paste(input, {
      clipboardData: { getData: () => "5\t4\t3" },
    });

    await waitFor(() => expect(mocks.batchDemand).toHaveBeenCalledWith(
      "org-1",
      "plan-1",
      '"plan-plan-1-rev-3"',
      expect.stringMatching(/^web-/),
      expect.arrayContaining([
        expect.objectContaining({ operation: "UPDATE", requirementId: "requirement-1" }),
        expect.objectContaining({ operation: "CREATE" }),
      ]),
    ));
  });
});

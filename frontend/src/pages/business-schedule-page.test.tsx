import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffingSchedule } from "../types/business-planning";
import { BusinessSchedulePage } from "./business-schedule-page";

const mocks = vi.hoisted(() => ({
  findPlan: vi.fn(),
  getSchedule: vi.fn(),
  getCandidates: vi.fn(),
  createAssignment: vi.fn(),
  updateAssignment: vi.fn(),
  cancelAssignment: vi.fn(),
  batchAssignments: vi.fn(),
  setDayEntry: vi.fn(),
  apiError: vi.fn((cause: { status?: number; message?: string }) => ({
    status: cause?.status ?? 500,
    message: cause?.message ?? "Request failed",
  })),
}));

vi.mock("../api/business-planning", () => ({
  findStaffingPlan: mocks.findPlan,
  getStaffingSchedule: mocks.getSchedule,
  getStaffingAssignmentCandidates: mocks.getCandidates,
  createStaffingAssignment: mocks.createAssignment,
  updateStaffingAssignment: mocks.updateAssignment,
  cancelStaffingAssignment: mocks.cancelAssignment,
  batchStaffingAssignments: mocks.batchAssignments,
}));
vi.mock("../api/api-errors", () => ({ getApiError: mocks.apiError }));
vi.mock("../api/endpoints", () => ({
  listOrganizations: vi.fn(async () => [{ id: "org-1", name: "PUIU GmbH", type: "BUSINESS", timezone: "Europe/Berlin", role: "OWNER" }]),
  listOrganizationUnits: vi.fn(async () => [{ id: "unit-1", parentId: null, name: "Hotel München", type: "LOCATION", checkInMode: "OPTIONAL", active: true, displayOrder: 0 }]),
  listBusinessWorkTypes: vi.fn(async () => [{ id: "spa-s", color: "#7c3aed" }]),
  setStaffingDayEntry: mocks.setDayEntry,
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
  planId: "plan-1", organizationId: "org-1", unitId: "unit-1", unitName: "Hotel München",
  weekStart: "2026-08-10", weekEnd: "2026-08-16", timezone: "Europe/Berlin",
  status: "ACTIVE" as const, draftRevision: 4, etag: '"plan-plan-1-rev-4"',
  latestPublishedVersion: null, publishedRevision: null, publishedAt: null,
  hasUnpublishedChanges: true, capabilities: { view: true, manage: true, publish: true },
};

function schedule(assigned = false): StaffingSchedule {
  const currentAssignments = [assignment("assignment-1", "member-1", "Mara Ionescu")];
  if (assigned) currentAssignments.push(assignment("assignment-2", "member-2", "Ana Dumitru"));
  const requirement = {
    requirementId: "req-spa", planDayId: "day-sun", date: "2026-08-16", workTypeId: "spa-s",
    workTypeCode: "SPA S", workTypeName: "Spa Spät", startTime: "12:00:00", endTime: "20:30:00",
    breakMinutes: 30, requiredWorkers: 2, coverage: totals(2, currentAssignments.length),
    assignments: currentAssignments, issueKeys: [],
  };
  return {
    planId: "plan-1", organizationId: "org-1", unitId: "unit-1", weekStart: "2026-08-10",
    weekEnd: "2026-08-16", draftRevision: assigned ? 5 : 4,
    etag: `"plan-plan-1-rev-${assigned ? 5 : 4}"`, coverage: totals(2, currentAssignments.length),
    days: Array.from({ length: 7 }, (_, index) => ({
      planDayId: `day-${index}`, date: `2026-08-${10 + index}`, persisted: true,
      roomsContext: index === 6 ? 10 : 40, source: "MANUAL",
      coverage: index === 6 ? totals(2, currentAssignments.length) : totals(0, 0),
      requirements: index === 6 ? [requirement] : [], issueKeys: [],
    })),
    members: [
      { membershipId: "member-1", displayName: "Mara Ionescu", membershipStatus: "ACTIVE", assignmentIds: ["assignment-1"], dayStatuses: [] },
      { membershipId: "member-2", displayName: "Ana Dumitru", membershipStatus: "ACTIVE", assignmentIds: assigned ? ["assignment-2"] : [], dayStatuses: [] },
      { membershipId: "member-3", displayName: "Ioana Stan", membershipStatus: "ACTIVE", assignmentIds: [], dayStatuses: [{ membershipId: "member-3", date: "2026-08-16", status: "VACATION", source: "MANAGER", pending: false }] },
    ],
    issues: [],
  };
}

function assignment(id: string, membershipId: string, name: string) {
  return {
    assignmentId: id, requirementId: "req-spa", membershipId, memberDisplayName: name,
    membershipStatus: "ACTIVE" as const, status: "ASSIGNED" as const, startTime: "12:00:00",
    endTime: "20:30:00", intervalOverride: false, effective: true, issueKeys: [],
  };
}

function candidates(warning = false) {
  return {
    planId: "plan-1", requirementId: "req-spa", draftRevision: 4, etag: plan.etag,
    requirement: {
      requirementId: "req-spa", date: "2026-08-16", workTypeId: "spa-s", workTypeCode: "SPA S",
      workTypeName: "Spa Spät", startTime: "12:00:00", endTime: "20:30:00", requiredWorkers: 2,
      coverage: totals(2, 1),
    },
    candidates: [{
      membershipId: "member-2", displayName: "Ana Dumitru", membershipStatus: "ACTIVE",
      recommended: true, rank: 1, eligibility: warning ? "ELIGIBLE_WITH_WARNING" as const : "ELIGIBLE" as const,
      availability: warning ? "PENDING_REQUEST" : "AVAILABLE", alreadyAssignedThisDay: false,
      weeklyScheduledMinutes: 1_440, matchingWorkTypeAssignments: 6,
      conflict: { duplicateAssignment: false, overlappingAssignment: false, assignmentsOnDay: 0 },
      reasons: [{ code: warning ? "PENDING_REQUEST" : "USUAL_WORK_TYPE", messageKey: "candidate", parameters: warning ? {} : { occurrences: "6" } }],
    }],
    projection: { membershipId: "member-2", before: totals(2, 1), after: totals(2, 2), resolvesOpenPosition: true },
    limitations: [], capabilities: plan.capabilities,
  };
}

function entity<T>(data: T) { return { data, etag: plan.etag, status: 200, idempotentReplay: false }; }

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <MemoryRouter initialEntries={["/business/org-1/plan/schedule?unit=unit-1&week=2026-08-10"]}>
      <QueryClientProvider client={client}>
        <Routes><Route path="/business/:organizationId/plan/schedule" element={<BusinessSchedulePage />} /></Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("BusinessSchedulePage", () => {
  let assigned = false;
  beforeEach(() => {
    vi.clearAllMocks();
    assigned = false;
    mocks.findPlan.mockResolvedValue(entity({ found: true, plan }));
    mocks.getSchedule.mockImplementation(async () => entity(schedule(assigned)));
    mocks.getCandidates.mockResolvedValue(entity(candidates()));
    mocks.createAssignment.mockImplementation(async () => {
      assigned = true;
      return entity({ planId: "plan-1", previousDraftRevision: 4, currentDraftRevision: 5, changed: true, affectedResourceIds: ["assignment-2"] });
    });
    mocks.setDayEntry.mockResolvedValue({});
  });

  it("connects an open position to C5e and saves it through C5b before showing coverage", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Assign Spa Spät on Sunday/ }));
    const ana = await screen.findByRole("button", { name: /^Ana Dumitru.*Recommended/ });
    await user.click(ana);
    await user.click(ana);

    await waitFor(() => expect(mocks.createAssignment).toHaveBeenCalledWith(
      "org-1", "plan-1", '"plan-plan-1-rev-4"', expect.stringMatching(/^web-/),
      { requirementId: "req-spa", membershipId: "member-2", startTime: "12:00:00", endTime: "20:30:00" },
    ));
    expect(await screen.findByText(/Ana Dumitru assigned/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("0").length).toBeGreaterThan(0));
  });

  it("assigns one work type to the same employee on selected days in one batch", async () => {
    const user = userEvent.setup();
    const weekly = schedule();
    weekly.days[0].requirements = [{
      ...weekly.days[6].requirements[0],
      requirementId: "req-mon",
      planDayId: "day-0",
      date: "2026-08-10",
      assignments: [],
      coverage: totals(2, 0),
    }];
    mocks.getSchedule.mockResolvedValue(entity(weekly));
    mocks.batchAssignments.mockResolvedValue(entity({
      planId: "plan-1", previousDraftRevision: 4, currentDraftRevision: 5, changed: true, affectedResourceIds: ["assignment-2"],
    }));
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Assign work across the week for Ana Dumitru/ }));
    await user.click(screen.getByRole("checkbox", { name: /Monday/ }));
    await user.click(screen.getByRole("checkbox", { name: /Sunday/ }));
    await user.click(screen.getByRole("button", { name: "Assign to 2 day(s)" }));

    await waitFor(() => expect(mocks.batchAssignments).toHaveBeenCalledWith(
      "org-1", "plan-1", '"plan-plan-1-rev-4"', expect.stringMatching(/^web-/),
      expect.arrayContaining([
        expect.objectContaining({ operation: "CREATE", create: expect.objectContaining({ requirementId: "req-mon", membershipId: "member-2" }) }),
        expect.objectContaining({ operation: "CREATE", create: expect.objectContaining({ requirementId: "req-spa", membershipId: "member-2" }) }),
      ]),
    ));
  });

  it("uses the configured work-type color for an assigned work card", async () => {
    renderPage();

    const card = await screen.findByRole("button", { name: /Edit Mara Ionescu assignment for Spa Spät/ });
    await waitFor(() => expect(card).toHaveStyle("--schedule-work-type-color: #7c3aed"));
  });

  it("requires explicit confirmation for an eligible candidate with warning", async () => {
    const user = userEvent.setup();
    mocks.getCandidates.mockResolvedValue(entity(candidates(true)));
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Assign Spa Spät on Sunday/ }));
    await user.click(await screen.findByRole("button", { name: /^Ana Dumitru.*Recommended/ }));
    const assign = screen.getByRole("button", { name: "Assign Ana Dumitru" });
    expect(assign).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    expect(assign).toBeEnabled();
  });

  it("filters the available people by name", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Assign Spa Spät on Sunday/ }));
    const search = await screen.findByRole("searchbox", { name: "Search people" });
    await user.type(search, "missing");
    expect(screen.getByText("No matching person.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Ana Dumitru.*Recommended/ })).not.toBeInTheDocument();
  });

  it("shows weekly hours with a left swipe and hides them with a right swipe", async () => {
    renderPage();

    await screen.findByRole("heading", { name: "Weekly employee plan" });
    const grid = document.querySelector(".schedule-grid");
    expect(grid).not.toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Week" })).not.toBeInTheDocument();

    fireEvent(grid!, pointerGesture("pointerdown", 1, 220));
    fireEvent(grid!, pointerGesture("pointerup", 1, 120));
    expect(await screen.findByRole("columnheader", { name: "Week" })).toBeInTheDocument();

    fireEvent(grid!, pointerGesture("pointerdown", 2, 120));
    fireEvent(grid!, pointerGesture("pointerup", 2, 220));
    await waitFor(() => expect(screen.queryByRole("columnheader", { name: "Week" })).not.toBeInTheDocument());
  });

  it("offers candidates and saves a day-based position without inventing an interval", async () => {
    const user = userEvent.setup();
    const dayBased = schedule();
    dayBased.days[6].requirements[0].startTime = null;
    dayBased.days[6].requirements[0].endTime = null;
    mocks.getSchedule.mockResolvedValue(entity(dayBased));
    const dayCandidates = candidates();
    dayCandidates.requirement.startTime = null;
    dayCandidates.requirement.endTime = null;
    mocks.getCandidates.mockResolvedValue(entity(dayCandidates));
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Assign Spa Spät on Sunday/ }));
    const ana = await screen.findByRole("button", { name: /^Ana Dumitru.*Recommended/ });
    await user.click(ana);
    await user.click(ana);

    await waitFor(() => expect(mocks.createAssignment).toHaveBeenCalledWith(
      "org-1", "plan-1", '"plan-plan-1-rev-4"', expect.stringMatching(/^web-/),
      { requirementId: "req-spa", membershipId: "member-2", startTime: null, endTime: null },
    ));
  });

  it("assigns an employee from their day cell after selecting the work twice", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Choose work for Ana Dumitru on Sunday/ }));
    const spa = screen.getByRole("button", { name: /Choose Spa Spät for Ana Dumitru on Sunday/ });
    await user.click(spa);
    expect(spa).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(mocks.getCandidates).toHaveBeenCalled());
    await user.click(spa);

    await waitFor(() => expect(mocks.createAssignment).toHaveBeenCalledWith(
      "org-1", "plan-1", '"plan-plan-1-rev-4"', expect.stringMatching(/^web-/),
      { requirementId: "req-spa", membershipId: "member-2", startTime: "12:00:00", endTime: "20:30:00" },
    ));
  });

  it("keeps an employee day menu available after all positions are covered", async () => {
    assigned = true;
    renderPage();

    await userEvent.setup().click(await screen.findByRole("button", {
      name: /Choose work for Mara Ionescu on Sunday/,
    }));
    expect(screen.getByRole("button", { name: /Choose Spa Spät for Mara Ionescu on Sunday/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Day off/ })).toBeEnabled();
  });

  it("offers F, K and U directly from an employee day cell", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Choose work for Ana Dumitru on Sunday/ }));
    await user.click(screen.getByRole("button", { name: /Day off/ }));

    await waitFor(() => expect(mocks.setDayEntry).toHaveBeenCalledWith(
      "org-1", "member-2", "2026-08-16", "REST_DAY",
    ));
  });

  it("reloads after stale 412 and never replays the assignment automatically", async () => {
    const user = userEvent.setup();
    mocks.createAssignment.mockRejectedValueOnce({ status: 412, message: "stale" });
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Assign Spa Spät on Sunday/ }));
    await user.click(await screen.findByRole("button", { name: /^Ana Dumitru.*Recommended/ }));
    await user.click(screen.getByRole("button", { name: "Assign Ana Dumitru" }));
    expect(await screen.findByText(/changed elsewhere/)).toBeInTheDocument();
    expect(mocks.createAssignment).toHaveBeenCalledTimes(1);
    expect(mocks.getSchedule.mock.calls.length).toBeGreaterThan(1);
  });

  it("keeps cancelled assignments out of the editable weekly grid", async () => {
    const cancelled = schedule();
    cancelled.days[6].requirements[0].assignments[0] = {
      ...cancelled.days[6].requirements[0].assignments[0],
      status: "CANCELLED",
      effective: false,
    };
    cancelled.days[6].requirements[0].coverage = totals(2, 0);
    cancelled.days[6].coverage = totals(2, 0);
    cancelled.coverage = totals(2, 0);
    mocks.getSchedule.mockResolvedValue(entity(cancelled));

    renderPage();

    expect(await screen.findByText("Mara Ionescu")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit Mara Ionescu/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Mara Ionescu" })).not.toBeInTheDocument();
  });
});

function pointerGesture(type: "pointerdown" | "pointerup", pointerId: number, clientX: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
  });
  return event;
}

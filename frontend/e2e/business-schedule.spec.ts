import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  StaffingAssignmentCandidate,
  StaffingCoverageTotals,
  StaffingSchedule,
  StaffingScheduleAssignment,
} from "../src/types/business-planning";

test.use({ serviceWorkers: "block" });

const organizationId = "org-puiu";
const unitId = "unit-munich";
const planId = "plan-kw33";
const weekStart = "2026-08-10";

type RequestLog = { method: string; path: string; headers: Record<string, string>; body: unknown };
type MockState = {
  revision: number;
  assignments: StaffingScheduleAssignment[];
  requests: RequestLog[];
  staleNext: boolean;
};

test.describe("authenticated Business Schedule", () => {
  test("connects an open position, recommendation, assignment, and canonical coverage", async ({ page }) => {
    const state = await installScheduleMocks(page);
    await openSchedule(page, 1440, 980);

    await expect(page.getByRole("heading", { name: "Build the week around real demand." })).toBeVisible();
    await expect(page.locator(".business-schedule__coverage > div").nth(2).getByText("1")).toBeVisible();
    await capture(page, "schedule-desktop-initial.png");
    await pause(page);

    await page.getByRole("button", { name: /Assign Spa Spät on Sunday/ }).click();
    await expect(page.getByRole("dialog", { name: /Spa Spät/ })).toBeVisible();
    await capture(page, "schedule-desktop-open-selected.png");
    await pause(page);

    await page.getByRole("dialog", { name: /Spa Spät/ }).getByRole("button", { name: /^Ana Dumitru/ }).click();
    await capture(page, "schedule-desktop-inspector.png");
    await page.getByRole("button", { name: "Assign Ana Dumitru" }).click();

    await expect(page.getByText(/Ana Dumitru assigned/)).toBeVisible();
    await expect(page.locator(".business-schedule__coverage > div").nth(2).getByText("0")).toBeVisible();
    await expect(page.locator(".business-schedule__coverage-meter strong")).toHaveText("100%");
    await expect(page.getByRole("button", { name: /Edit Ana Dumitru assignment/ })).toBeVisible();
    await capture(page, "schedule-desktop-assigned.png");
    await pause(page);

    const create = state.requests.find((request) => request.method === "POST" && request.path.endsWith("/schedule/assignments"));
    expect(create?.headers["if-match"]).toBe('"plan-plan-kw33-rev-7"');
    expect(create?.headers["idempotency-key"]).toBeTruthy();
    expect(state.requests.filter((request) => request.path.includes("/staffing/requirements"))).toEqual([]);

    await page.getByRole("button", { name: /Edit Ana Dumitru assignment/ }).click();
    await page.getByLabel("Start time").fill("13:00");
    await page.getByLabel("End time").fill("21:30");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Assignment interval updated.")).toBeVisible();
    await capture(page, "schedule-desktop-edited.png");
    await pause(page);

    await page.getByRole("button", { name: /Edit Ana Dumitru assignment/ }).click();
    await page.getByRole("button", { name: "Choose another person" }).click();
    await page.getByRole("dialog", { name: /Spa Spät/ }).getByRole("button", { name: /^Mihaela Petrescu/ }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Confirm replacement" }).click();
    await expect(page.getByText(/Mihaela Petrescu assigned/)).toBeVisible();
    await capture(page, "schedule-desktop-reassigned.png");
    await pause(page);

    await page.getByRole("button", { name: /Edit Mihaela Petrescu assignment/ }).click();
    await page.getByRole("button", { name: "Cancel assignment" }).click();
    await expect(page.getByText("Assignment cancelled. The position is open again.")).toBeVisible();
    await expect(page.locator(".business-schedule__coverage > div").nth(2).getByText("1")).toBeVisible();
    await capture(page, "schedule-desktop-cancelled.png");
    await pause(page);
  });

  test("requires warning confirmation for a manual candidate", async ({ page }) => {
    const state = await installScheduleMocks(page);
    await openSchedule(page, 1366, 900);
    await pause(page);
    await page.getByRole("button", { name: /Assign Spa Spät on Sunday/ }).click();
    await page.getByRole("dialog", { name: /Spa Spät/ }).getByRole("button", { name: /^Mihaela Petrescu/ }).click();
    await expect(page.getByRole("button", { name: "Assign Mihaela Petrescu" })).toBeDisabled();
    await capture(page, "schedule-desktop-warning.png");
    await pause(page);
    await page.getByRole("checkbox").check();
    await pause(page);
    await page.getByRole("button", { name: "Assign Mihaela Petrescu" }).click();
    await expect(page.getByText(/Mihaela Petrescu assigned/)).toBeVisible();
    await pause(page);
    expect(state.assignments.some((item) => item.membershipId === "member-mihaela")).toBe(true);
  });

  test("never replays a stale assignment automatically", async ({ page }) => {
    const state = await installScheduleMocks(page, { staleNext: true });
    await openSchedule(page, 1280, 800);
    await page.getByRole("button", { name: /Assign Spa Spät on Sunday/ }).click();
    await page.getByRole("dialog", { name: /Spa Spät/ }).getByRole("button", { name: /^Ana Dumitru/ }).click();
    await page.getByRole("button", { name: "Assign Ana Dumitru" }).click();
    await expect(page.getByText(/changed elsewhere/)).toBeVisible();
    expect(state.requests.filter((request) => request.method === "POST" && request.path.endsWith("/schedule/assignments"))).toHaveLength(1);
    await expect(page.getByRole("dialog", { name: /Spa Spät/ })).toBeVisible();
  });

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
  ]) {
    test(`keeps the day schedule operational at ${viewport.width}px`, async ({ page }) => {
      const theme = viewport.width === 375 ? "dark" : "light";
      await installScheduleMocks(page, { theme: theme === "dark" ? "DARK" : "LIGHT" });
      await openSchedule(page, viewport.width, viewport.height, theme);
      await page.getByRole("tab").last().click();
      await expect(page.getByRole("heading", { name: /Sunday/ })).toBeVisible();
      await capture(page, `schedule-mobile-${viewport.width}-${theme}.png`);
      await page.getByRole("button", { name: /Spa Spät/ }).first().click();
      await expect(page.getByRole("dialog", { name: /Spa Spät/ })).toBeVisible();
      await capture(page, `schedule-mobile-${viewport.width}-${theme}-recommendation.png`);
      await page.getByRole("dialog", { name: /Spa Spät/ }).getByRole("button", { name: /^Ana Dumitru/ }).click();
      await page.getByRole("button", { name: "Assign Ana Dumitru" }).click();
      await expect(page.getByText(/Ana Dumitru assigned/)).toBeVisible();
      await capture(page, `schedule-mobile-${viewport.width}-${theme}-assigned.png`);
      if (viewport.width === 375) {
        await page.getByRole("button", { name: /Edit Ana Dumitru assignment/ }).click();
        await page.getByLabel("Start time").fill("13:00");
        await page.getByLabel("End time").fill("21:30");
        await page.getByRole("button", { name: "Save changes" }).click();
        await expect(page.getByText("Assignment interval updated.")).toBeVisible();
        await capture(page, "schedule-mobile-375-dark-edited.png");
        await pause(page);

        await page.getByRole("button", { name: /Edit Ana Dumitru assignment/ }).click();
        await page.getByRole("button", { name: "Cancel assignment" }).click();
        await expect(page.getByText("Assignment cancelled. The position is open again.")).toBeVisible();
        await capture(page, "schedule-mobile-375-dark-cancelled.png");
        await pause(page);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      const lastSection = page.locator(".schedule-mobile__section").last();
      await lastSection.scrollIntoViewIfNeeded();
      const [sectionBox, navigationBox] = await Promise.all([
        lastSection.boundingBox(),
        page.locator(".business-planning__rail").boundingBox(),
      ]);
      expect(sectionBox).not.toBeNull();
      expect(navigationBox).not.toBeNull();
      expect(sectionBox!.y + Math.min(sectionBox!.height, 40)).toBeLessThan(navigationBox!.y);
    });
  }

  test("keeps graphite dark mode readable", async ({ page }) => {
    await installScheduleMocks(page, { theme: "DARK" });
    await openSchedule(page, 1440, 980, "dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await capture(page, "schedule-desktop-dark.png");
  });
});

async function installScheduleMocks(
  page: Page,
  options: { staleNext?: boolean; theme?: "LIGHT" | "DARK" } = {},
) {
  const state: MockState = {
    revision: 7,
    assignments: [assignment("assignment-mara", "member-mara", "Mara Ionescu")],
    requests: [],
    staleNext: options.staleNext ?? false,
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (!path.startsWith("/api/")) {
      return route.continue();
    }
    const method = request.method();
    const headers = request.headers();
    let body: unknown = null;
    try { body = request.postDataJSON(); } catch { body = request.postData(); }
    state.requests.push({ method, path, headers, body });

    if (path === "/api/auth/refresh") return json(route, authTokens());
    if (path === "/api/me") return json(route, currentUser(options.theme ?? "LIGHT"));
    if (path === "/api/organizations") return json(route, [{ id: organizationId, name: "PUIU GmbH", type: "BUSINESS", timezone: "Europe/Berlin", role: "OWNER" }]);
    if (path === `/api/organizations/${organizationId}/units`) return json(route, [{ id: unitId, parentId: null, name: "Hotel München", type: "LOCATION", checkInMode: "OPTIONAL", active: true, displayOrder: 0 }]);
    if (path === `/api/organizations/${organizationId}/access`) {
      return json(route, {
        permissions: ["VIEW_SCHEDULE", "MANAGE_SCHEDULE", "PUBLISH_SCHEDULE", "MANAGE_SETTINGS"],
      });
    }
    if (path === `/api/organizations/${organizationId}/staffing/plans` && method === "GET") {
      return json(route, { found: true, plan: planHeader(state.revision) }, 200, { ETag: etag(state.revision) });
    }
    if (path.endsWith(`/${planId}/schedule`) && method === "GET") {
      return json(route, buildSchedule(state), 200, { ETag: etag(state.revision) });
    }
    if (path.endsWith(`/${planId}/assignment-candidates`) && method === "GET") {
      return json(route, buildCandidates(state), 200, { ETag: etag(state.revision) });
    }
    if (path.endsWith(`/${planId}/schedule/assignments`) && method === "POST") {
      if (state.staleNext) {
        state.staleNext = false;
        state.revision += 1;
        return apiError(route, 412, "STALE_PLAN_REVISION", "Stale plan revision");
      }
      const input = body as { requirementId: string; membershipId: string; startTime: string; endTime: string };
      const name = input.membershipId === "member-ana" ? "Ana Dumitru" : "Mihaela Petrescu";
      state.assignments.push(assignment(`assignment-${input.membershipId}`, input.membershipId, name));
      return mutation(route, state, [`assignment-${input.membershipId}`], 201);
    }
    if (path.includes(`/${planId}/schedule/assignments/`) && method === "DELETE") {
      const id = path.split("/").at(-1)!;
      state.assignments = state.assignments.filter((item) => item.assignmentId !== id);
      return mutation(route, state, [id]);
    }
    if (path.includes(`/${planId}/schedule/assignments/`) && method === "PUT") {
      const id = path.split("/").at(-1)!;
      const input = body as { startTime: string; endTime: string };
      state.assignments = state.assignments.map((item) => item.assignmentId === id ? { ...item, ...input, intervalOverride: true } : item);
      return mutation(route, state, [id]);
    }
    if (path.endsWith(`/${planId}/schedule/assignments/batch`) && method === "POST") {
      const actions = (body as { actions: Array<{ operation: string; assignmentId: string | null; create: { membershipId: string } | null }> }).actions;
      for (const action of actions) {
        if (action.operation === "CANCEL") state.assignments = state.assignments.filter((item) => item.assignmentId !== action.assignmentId);
        if (action.operation === "CREATE" && action.create) {
          const name = action.create.membershipId === "member-ana" ? "Ana Dumitru" : "Mihaela Petrescu";
          state.assignments.push(assignment(`assignment-${action.create.membershipId}`, action.create.membershipId, name));
        }
      }
      return mutation(route, state, []);
    }
    return apiError(route, 501, "UNMOCKED_REQUEST", `${method} ${path}`);
  });
  return state;
}

function buildSchedule(state: MockState): StaffingSchedule {
  const assigned = state.assignments.length;
  const requirement = {
    requirementId: "requirement-spa-sun", planDayId: "day-6", date: "2026-08-16",
    workTypeId: "spa-s", workTypeCode: "SPA S", workTypeName: "Spa Spät",
    startTime: "12:00:00", endTime: "20:30:00", breakMinutes: 30, requiredWorkers: 2,
    coverage: coverage(2, assigned), assignments: state.assignments, issueKeys: [],
  };
  const members = [
    member("member-mara", "Mara Ionescu", ["assignment-mara"]),
    member("member-ana", "Ana Dumitru", state.assignments.some((item) => item.membershipId === "member-ana") ? ["assignment-member-ana"] : []),
    member("member-mihaela", "Mihaela Petrescu", state.assignments.some((item) => item.membershipId === "member-mihaela") ? ["assignment-member-mihaela"] : [], [{ membershipId: "member-mihaela", date: "2026-08-16", status: "REST_DAY", source: "MANAGER", pending: true }]),
    member("member-ioana", "Ioana Stan", [], [{ membershipId: "member-ioana", date: "2026-08-16", status: "VACATION", source: "MANAGER", pending: false }]),
    ...Array.from({ length: 8 }, (_, index) => member(`member-${index}`, `Employee ${index + 1}`, [])),
  ];
  return {
    planId, organizationId, unitId, weekStart, weekEnd: "2026-08-16", draftRevision: state.revision,
    etag: etag(state.revision), coverage: coverage(2, assigned),
    days: Array.from({ length: 7 }, (_, index) => ({
      planDayId: `day-${index}`, date: addDate(weekStart, index), persisted: true,
      roomsContext: [50, 40, 40, 30, 30, 50, 10][index], source: "IMPORT",
      coverage: index === 6 ? coverage(2, assigned) : coverage(0, 0),
      requirements: index === 6 ? [requirement] : [], issueKeys: [],
    })),
    members,
    issues: [],
  };
}

function buildCandidates(state: MockState) {
  const candidates: StaffingAssignmentCandidate[] = [
    candidate("member-ana", "Ana Dumitru", "ELIGIBLE", true, "AVAILABLE", "USUAL_WORK_TYPE"),
    candidate("member-mihaela", "Mihaela Petrescu", "ELIGIBLE_WITH_WARNING", false, "PENDING_REQUEST", "PENDING_REQUEST"),
    candidate("member-ioana", "Ioana Stan", "INELIGIBLE", false, "APPROVED_TIME_AWAY", "APPROVED_TIME_AWAY"),
  ];
  return {
    planId, requirementId: "requirement-spa-sun", draftRevision: state.revision, etag: etag(state.revision),
    requirement: {
      requirementId: "requirement-spa-sun", date: "2026-08-16", workTypeId: "spa-s",
      workTypeCode: "SPA S", workTypeName: "Spa Spät", startTime: "12:00:00",
      endTime: "20:30:00", requiredWorkers: 2, coverage: coverage(2, state.assignments.length),
    },
    candidates,
    projection: {
      membershipId: "member-ana", before: coverage(2, state.assignments.length),
      after: coverage(2, state.assignments.length + 1), resolvesOpenPosition: true,
    },
    limitations: ["SKILLS_NOT_CONFIGURED", "DECLARED_AVAILABILITY_NOT_CONFIGURED"],
    capabilities: { view: true, manage: true, publish: true },
  };
}

function candidate(
  membershipId: string,
  displayName: string,
  eligibility: StaffingAssignmentCandidate["eligibility"],
  recommended: boolean,
  availability: string,
  reason: string,
): StaffingAssignmentCandidate {
  return {
    membershipId, displayName, membershipStatus: "ACTIVE", recommended,
    rank: recommended ? 1 : eligibility === "INELIGIBLE" ? null : 2, eligibility, availability,
    alreadyAssignedThisDay: false, weeklyScheduledMinutes: recommended ? 1_440 : 1_920,
    matchingWorkTypeAssignments: recommended ? 8 : null,
    conflict: { duplicateAssignment: false, overlappingAssignment: false, assignmentsOnDay: 0 },
    reasons: [{ code: reason, messageKey: `staffing.candidate.reason.${reason.toLowerCase()}`, parameters: reason === "USUAL_WORK_TYPE" ? { occurrences: "8" } : {} }],
  };
}

function assignment(id: string, membershipId: string, name: string): StaffingScheduleAssignment {
  return {
    assignmentId: id, requirementId: "requirement-spa-sun", membershipId,
    memberDisplayName: name, membershipStatus: "ACTIVE", status: "ASSIGNED",
    startTime: "12:00:00", endTime: "20:30:00", intervalOverride: false,
    effective: true, issueKeys: [],
  };
}

function member(membershipId: string, displayName: string, assignmentIds: string[], dayStatuses: StaffingSchedule["members"][number]["dayStatuses"] = []) {
  return { membershipId, displayName, membershipStatus: "ACTIVE" as const, assignmentIds, dayStatuses };
}

function coverage(required: number, effectiveAssigned: number): StaffingCoverageTotals {
  const covered = Math.min(required, effectiveAssigned);
  return {
    required, rawAssigned: effectiveAssigned, effectiveAssigned, covered,
    missing: Math.max(0, required - effectiveAssigned), overstaffed: Math.max(0, effectiveAssigned - required),
    percentage: required === 0 ? 100 : (covered / required) * 100,
    openPositions: Math.max(0, required - effectiveAssigned),
  };
}

async function mutation(route: Route, state: MockState, affectedResourceIds: string[], status = 200) {
  const previousDraftRevision = state.revision;
  state.revision += 1;
  return json(route, { planId, previousDraftRevision, currentDraftRevision: state.revision, changed: true, affectedResourceIds }, status, { ETag: etag(state.revision) });
}

function planHeader(revision: number) {
  return {
    planId, organizationId, unitId, unitName: "Hotel München", weekStart, weekEnd: "2026-08-16",
    timezone: "Europe/Berlin", status: "ACTIVE", draftRevision: revision, etag: etag(revision),
    latestPublishedVersion: null, publishedRevision: null, publishedAt: null,
    hasUnpublishedChanges: true, capabilities: { view: true, manage: true, publish: true },
  };
}

async function openSchedule(page: Page, width: number, height: number, theme: "light" | "dark" = "light") {
  await page.setViewportSize({ width, height });
  await page.addInitScript(({ selectedTheme }) => {
    localStorage.setItem("alveryn.session", "1");
    localStorage.setItem("alveryn.publicTheme", selectedTheme);
  }, { selectedTheme: theme });
  await page.goto(`/business/${organizationId}/plan/schedule?unit=${unitId}&week=${weekStart}`);
  await expect(page.locator(".business-schedule")).toBeVisible();
}

function currentUser(theme: "LIGHT" | "DARK") {
  return {
    account: { id: "manager-user", email: "manager@example.com", emailVerified: true, status: "ACTIVE", lastLoginAt: null },
    profile: { firstName: "Mara", lastName: "Manager" },
    preferences: { id: "preferences-manager", language: "en", timezone: "Europe/Berlin", currency: "EUR", firstDayOfWeek: "MONDAY", dateFormat: "dd/MM/yyyy", timeFormat: "H24", theme, defaultBreakMinutes: 30, preferredDailyMinutes: 480, paidSickLeave: true, paidVacation: true, onboardingCompleted: true, trackingSetupVersionCompleted: 1 },
  };
}

function authTokens() {
  return { accessToken: "e2e-business-token", tokenType: "Bearer", accessTokenExpiresIn: 900, user: { id: "manager-user", email: "manager@example.com", emailVerified: true, status: "ACTIVE", lastLoginAt: null } };
}

function etag(revision: number) { return `"plan-${planId}-rev-${revision}"`; }
function addDate(value: string, days: number) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function json(route: Route, data: unknown, status = 200, headers: Record<string, string> = {}) { return route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify({ data }) }); }
function apiError(route: Route, status: number, code: string, message: string) { return route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ status, code, message, errors: [], path: route.request().url(), timestamp: new Date(0).toISOString() }) }); }

async function capture(page: Page, name: string) {
  const directory = process.env.ALVERYN_D2_ARTIFACT_DIR;
  if (directory) await page.screenshot({ path: `${directory}/${name}`, fullPage: true });
}

async function pause(page: Page) {
  if (process.env.ALVERYN_E2E_RECORD_VIDEO === "true") await page.waitForTimeout(650);
}

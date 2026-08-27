import { expect, test, type Page, type Route } from "@playwright/test";
import type { BusinessWorkType } from "../src/types/business";
import type {
  StaffingCoverageTotals,
  StaffingDemand,
  StaffingDemandBatchAction,
  StaffingDemandRequirement,
} from "../src/types/business-planning";

test.use({ serviceWorkers: "block" });

const organizationId = "org-puiu";
const unitId = "unit-munich";
const planId = "plan-kw33";
const weekStart = "2026-08-10";

const workTypes: BusinessWorkType[] = [
  workType("room", "ROOM", "Room cleaning", "09:00", "17:30", "#12a876"),
  workType("pf", "PF", "Public Früh", "05:00", "13:30", "#297967"),
  workType("ps", "PS", "Public Spät", "13:30", "22:00", "#486f65"),
  workType("hd", "HD", "Handyman", "09:00", "17:30", "#6d746e"),
  workType("hsk", "HSK", "Housekeeping late shift", "13:30", "22:00", "#397465"),
  workType("spa-f", "SPA F", "Spa Früh", "05:00", "08:00", "#727f60"),
  workType("spa-s", "SPA S", "Spa Spät", "12:00", "20:30", "#5d7768"),
  workType("ch", "CH", "Checker", "09:00", "17:30", "#826c4f"),
  workType("ww", "WW", "Wäsche / Wasser", "09:00", "17:30", "#536f75"),
  workType("liste", "LISTE", "Room lists", "08:30", "10:30", "#6c7269"),
];

type MockState = {
  found: boolean;
  revision: number;
  requirements: StaffingDemandRequirement[];
  staleOnce: boolean;
  requests: { method: string; path: string; headers: Record<string, string>; body: unknown }[];
};

test.describe("authenticated Business Demand", () => {
  test("uses the aggregate APIs, keyboard editing, batch paste, and backend coverage", async ({ page }) => {
    const state = await installBusinessDemandMocks(page);
    await openDemand(page, 1440, 980);

    await expect(page.getByRole("heading", { name: "What does the hotel need this week?" })).toBeVisible();
    await expect(page.getByLabel("Workspace")).toHaveValue(`business:${organizationId}`);
    await expect(page.getByLabel("Location")).toHaveValue(unitId);
    await captureIfRequested(page, "desktop-light-initial.png");
    await recordingPause(page);

    const mondayRooms = page.getByRole("spinbutton", {
      name: "People required for Room cleaning on Monday, August 10",
    });
    await mondayRooms.fill("5");
    await mondayRooms.press("Enter");
    await expect(page.getByText("Demand saved.")).toBeVisible();
    await recordingPause(page);

    const update = state.requests.find((request) =>
      request.method === "PUT" && request.path.endsWith("/demand/requirements/req-room-0"));
    expect(update?.headers["if-match"]).toBe('"plan-plan-kw33-rev-1"');

    const mondayPf = page.getByRole("spinbutton", {
      name: "People required for Public Früh on Monday, August 10",
    });
    await mondayPf.focus();
    await mondayPf.evaluate((element) => {
      const clipboard = new DataTransfer();
      clipboard.setData("text/plain", "3\t3\t3");
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: clipboard }));
    });
    await expect.poll(() => state.requests.filter((request) => request.path.endsWith("/demand/batch")).length).toBe(1);
    await captureIfRequested(page, "desktop-light-edited.png");
    await recordingPause(page);
    const batch = state.requests.find((request) => request.path.endsWith("/demand/batch"));
    expect(batch?.headers["if-match"]).toMatch(/^"plan-plan-kw33-rev-/);
    expect(batch?.headers["idempotency-key"]).toBeTruthy();

    const legacyCalls = state.requests.filter((request) =>
      request.path.includes("/staffing/requirements") || request.path.endsWith("/staffing/publish"));
    expect(legacyCalls).toEqual([]);
  });

  test("requires explicit C5d bootstrap for a missing week", async ({ page }) => {
    const state = await installBusinessDemandMocks(page, { found: false });
    await openDemand(page, 1280, 800);
    const create = page.getByRole("button", { name: "Create this weekly plan" });
    await expect(create).toBeVisible();
    await create.click();
    await expect(page.getByRole("heading", { name: "Weekly staffing demand" })).toBeVisible();
    const bootstrap = state.requests.find((request) =>
      request.method === "POST" && request.path.endsWith("/staffing/plans"));
    expect(bootstrap?.headers["idempotency-key"]).toBeTruthy();
  });

  test("reloads canonical Demand after a stale If-Match response", async ({ page }) => {
    const state = await installBusinessDemandMocks(page, { staleOnce: true });
    await openDemand(page, 1280, 800);
    const input = page.getByRole("spinbutton", {
      name: "People required for Room cleaning on Monday, August 10",
    });
    await input.fill("5");
    await input.press("Enter");
    await expect(page.getByText("This week changed elsewhere. The current version has been reloaded; review it before saving again.")).toBeVisible();
    expect(state.requests.filter((request) => request.path.endsWith("/demand")).length).toBeGreaterThan(1);
  });

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
  ]) {
    test(`keeps Demand operational without horizontal overflow at ${viewport.width}px`, async ({ page }) => {
      const theme = viewport.width === 320 ? "light" : "dark";
      await installBusinessDemandMocks(page, { theme: theme === "dark" ? "DARK" : "LIGHT" });
      await openDemand(page, viewport.width, viewport.height, theme);
      await expect(page.getByRole("heading", { name: "Monday, August 10" })).toBeVisible();
      const device = viewport.width === 768 ? "tablet" : "mobile";
      await captureIfRequested(page, `${device}-${viewport.width}-${theme}-initial.png`);
      await recordingPause(page);
      await page.getByRole("tab").last().click();
      await expect(page.getByRole("heading", { name: "Sunday, August 16" })).toBeVisible();
      await recordingPause(page);
      const input = page.getByRole("spinbutton", {
        name: "People required for Room cleaning on Sunday, August 16",
      });
      await input.fill("3");
      await input.press("Enter");
      await expect(page.getByText("Demand saved.")).toBeVisible();
      await captureIfRequested(page, `${device}-${viewport.width}-${theme}-edited.png`);
      await recordingPause(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

      const finalControl = page.getByRole("spinbutton").last();
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      const [controlBox, navigationBox] = await Promise.all([
        finalControl.boundingBox(),
        page.locator(".business-planning__rail").boundingBox(),
      ]);
      expect(controlBox).not.toBeNull();
      expect(navigationBox).not.toBeNull();
      expect(controlBox!.y + controlBox!.height).toBeLessThan(navigationBox!.y);
    });
  }

  test("keeps dark mode readable with the selected account language", async ({ page }) => {
    await installBusinessDemandMocks(page, { theme: "DARK" });
    await openDemand(page, 1440, 980, "dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await captureIfRequested(page, "desktop-dark-en.png");
    await expect(page.getByRole("heading", { name: "What does the hotel need this week?" })).toBeVisible();
    await captureIfRequested(page, "desktop-dark-final.png");
  });
});

async function openDemand(
  page: Page,
  width: number,
  height: number,
  theme: "light" | "dark" = "light",
) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(({ selectedTheme }) => {
    localStorage.setItem("alveryn.session", "1");
    localStorage.setItem("alveryn.publicTheme", selectedTheme);
  }, { selectedTheme: theme });
  await page.goto(`/business/${organizationId}/plan/demand?unit=${unitId}&week=${weekStart}`);
  await expect(page.locator(".business-planning")).toBeVisible();
}

async function installBusinessDemandMocks(
  page: Page,
  options: { found?: boolean; staleOnce?: boolean; theme?: "LIGHT" | "DARK" } = {},
) {
  const state: MockState = {
    found: options.found ?? true,
    revision: 1,
    requirements: buildRequirements(),
    staleOnce: options.staleOnce ?? false,
    requests: [],
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

    if (path === "/api/auth/refresh") {
      return json(route, authTokens());
    }
    if (path === "/api/me") {
      return json(route, currentUser(options.theme ?? "LIGHT"));
    }
    if (path === "/api/organizations" && method === "GET") {
      return json(route, [{ id: organizationId, name: "PUIU GmbH", type: "BUSINESS", timezone: "Europe/Berlin", role: "OWNER" }]);
    }
    if (path === `/api/organizations/${organizationId}/units`) {
      return json(route, [{ id: unitId, parentId: null, name: "Hotel München", type: "LOCATION", checkInMode: "OPTIONAL", active: true, displayOrder: 0 }]);
    }
    if (path === `/api/organizations/${organizationId}/access`) {
      return json(route, { permissions: ["VIEW_SCHEDULE", "MANAGE_SCHEDULE", "PUBLISH_SCHEDULE", "MANAGE_SETTINGS"] });
    }
    if (path === `/api/organizations/${organizationId}/staffing/work-types`) {
      return json(route, workTypes);
    }
    if (path === `/api/organizations/${organizationId}/staffing/plans` && method === "GET") {
      return json(route, {
        found: state.found,
        plan: state.found ? planHeader(state.revision) : null,
      }, 200, { ETag: etag(state.revision) });
    }
    if (path === `/api/organizations/${organizationId}/staffing/plans` && method === "POST") {
      state.found = true;
      return json(route, {
        planId,
        organizationId,
        unitId,
        weekStart,
        timezone: "Europe/Berlin",
        status: "ACTIVE",
        draftRevision: state.revision,
        created: true,
        idempotentReplay: false,
        capabilities: { view: true, manage: true, publish: true },
      }, 201, { ETag: etag(state.revision) });
    }
    if (path === `/api/organizations/${organizationId}/staffing/plans/${planId}/demand` && method === "GET") {
      return json(route, buildDemand(state), 200, { ETag: etag(state.revision) });
    }
    if (path.startsWith(`/api/organizations/${organizationId}/staffing/plans/${planId}/demand/requirements/`) && method === "PUT") {
      if (state.staleOnce) {
        state.staleOnce = false;
        state.revision += 1;
        return apiError(route, 412, "STALE_PLAN_REVISION", "Stale plan revision");
      }
      const id = path.split("/").at(-1)!;
      const input = body as Partial<StaffingDemandRequirement>;
      state.requirements = state.requirements.map((item) => item.requirementId === id
        ? { ...item, ...input, coverage: coverage(input.requiredWorkers ?? item.requiredWorkers, input.requiredWorkers ?? item.requiredWorkers) }
        : item);
      return mutation(route, state, [id]);
    }
    if (path.endsWith("/demand/requirements") && method === "POST") {
      const input = body as { date: string; workTypeId: string; requiredWorkers: number; startTime: string | null; endTime: string | null; breakMinutes?: number; requiredQuantity: number | null; notes: string | null };
      const type = workTypes.find((item) => item.id === input.workTypeId)!;
      const id = `req-${type.id}-${input.date}`;
      state.requirements.push({
        requirementId: id,
        planDayId: `day-${input.date}`,
        workTypeId: type.id,
        workTypeCode: type.code,
        workTypeName: type.name,
        startTime: input.startTime,
        endTime: input.endTime,
        breakMinutes: input.breakMinutes ?? type.defaultBreakMinutes,
        requiredWorkers: input.requiredWorkers,
        requiredQuantity: input.requiredQuantity,
        legacyPublicationStatus: "DRAFT",
        notes: input.notes,
        coverage: coverage(input.requiredWorkers, input.requiredWorkers),
        issueKeys: [],
      });
      return mutation(route, state, [id]);
    }
    if (path.endsWith("/demand/batch") && method === "POST") {
      for (const action of (body as { actions: StaffingDemandBatchAction[] }).actions) applyBatchAction(state, action);
      return mutation(route, state, []);
    }
    if (path.includes("/demand/requirements/") && method === "DELETE") {
      const id = path.split("/").at(-1)!;
      state.requirements = state.requirements.filter((item) => item.requirementId !== id);
      return mutation(route, state, [id]);
    }

    return apiError(route, 501, "UNMOCKED_REQUEST", `${method} ${path}`);
  });

  return state;
}

function applyBatchAction(state: MockState, action: StaffingDemandBatchAction) {
  if (action.operation === "UPDATE") {
    state.requirements = state.requirements.map((item) => item.requirementId === action.requirementId
      ? { ...item, ...action.update, coverage: coverage(action.update.requiredWorkers, action.update.requiredWorkers) }
      : item);
  } else if (action.operation === "DELETE") {
    state.requirements = state.requirements.filter((item) => item.requirementId !== action.requirementId);
  } else {
    const input = action.create;
    const type = workTypes.find((item) => item.id === input.workTypeId)!;
    state.requirements.push({
      requirementId: `req-${type.id}-${input.date}`,
      planDayId: `day-${input.date}`,
      workTypeId: type.id,
      workTypeCode: type.code,
      workTypeName: type.name,
      startTime: input.startTime,
      endTime: input.endTime,
      breakMinutes: type.defaultBreakMinutes,
      requiredWorkers: input.requiredWorkers,
      requiredQuantity: input.requiredQuantity,
      legacyPublicationStatus: "DRAFT",
      notes: input.notes,
      coverage: coverage(input.requiredWorkers, input.requiredWorkers),
      issueKeys: [],
    });
  }
}

async function mutation(route: Route, state: MockState, affectedResourceIds: string[]) {
  const previousDraftRevision = state.revision;
  state.revision += 1;
  return json(route, {
    planId,
    previousDraftRevision,
    currentDraftRevision: state.revision,
    changed: true,
    affectedResourceIds,
  }, 200, { ETag: etag(state.revision) });
}

function buildDemand(state: MockState): StaffingDemand {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDate(weekStart, index);
    const requirements = state.requirements.filter((item) => item.planDayId === `day-${index}`);
    const total = combineCoverage(requirements.map((item) => item.coverage));
    return {
      planDayId: `day-${index}`,
      date,
      persisted: true,
      roomsContext: [50, 40, 40, 30, 30, 50, 10][index],
      notes: index === 6 ? "Stayover rooms and strip departure beds" : null,
      source: "IMPORT" as const,
      coverage: total,
      requirements,
      issueKeys: total.openPositions ? [`UNDERCOVERED:${date}`] : [],
    };
  });
  return {
    planId,
    organizationId,
    unitId,
    weekStart,
    weekEnd: "2026-08-16",
    draftRevision: state.revision,
    etag: etag(state.revision),
    coverage: combineCoverage(days.map((day) => day.coverage)),
    days,
  };
}

function buildRequirements() {
  const counts: Record<string, number[]> = {
    room: [4, 4, 4, 2, 2, 4, 2],
    pf: [2, 2, 2, 2, 2, 2, 1],
    ps: [2, 2, 2, 2, 2, 2, 1],
    hd: [1, 1, 1, 1, 1, 1, 0],
    hsk: [1, 1, 1, 1, 1, 1, 1],
    "spa-f": [2, 2, 2, 2, 2, 2, 1],
    "spa-s": [1, 1, 1, 1, 1, 1, 2],
    ch: [0, 0, 0, 1, 1, 1, 0],
    ww: [1, 1, 1, 1, 1, 1, 1],
    liste: [1, 1, 1, 1, 1, 1, 1],
  };
  return workTypes.flatMap((type) => counts[type.id].flatMap((requiredWorkers, index) => {
    if (requiredWorkers === 0) return [];
    const open = type.id === "spa-s" && index === 6 ? 1 : 0;
    const effective = Math.max(0, requiredWorkers - open);
    const start = type.id === "room" && index >= 5 ? "10:00" : type.defaultStartTime;
    return [{
      requirementId: `req-${type.id}-${index}`,
      planDayId: `day-${index}`,
      workTypeId: type.id,
      workTypeCode: type.code,
      workTypeName: type.name,
      startTime: start,
      endTime: type.defaultEndTime,
      breakMinutes: type.defaultBreakMinutes,
      requiredWorkers,
      requiredQuantity: null,
      legacyPublicationStatus: "DRAFT" as const,
      notes: null,
      coverage: coverage(requiredWorkers, effective),
      issueKeys: open ? [`UNDERCOVERED:${type.id}:${index}`] : [],
    }];
  }));
}

function coverage(required: number, effectiveAssigned: number): StaffingCoverageTotals {
  const covered = Math.min(required, effectiveAssigned);
  return {
    required,
    rawAssigned: effectiveAssigned,
    effectiveAssigned,
    covered,
    missing: Math.max(0, required - effectiveAssigned),
    overstaffed: Math.max(0, effectiveAssigned - required),
    percentage: required === 0 ? 100 : (covered / required) * 100,
    openPositions: Math.max(0, required - effectiveAssigned),
  };
}

function combineCoverage(items: StaffingCoverageTotals[]): StaffingCoverageTotals {
  const required = items.reduce((sum, item) => sum + item.required, 0);
  const rawAssigned = items.reduce((sum, item) => sum + item.rawAssigned, 0);
  const effectiveAssigned = items.reduce((sum, item) => sum + item.effectiveAssigned, 0);
  const covered = items.reduce((sum, item) => sum + item.covered, 0);
  return {
    required,
    rawAssigned,
    effectiveAssigned,
    covered,
    missing: items.reduce((sum, item) => sum + item.missing, 0),
    overstaffed: items.reduce((sum, item) => sum + item.overstaffed, 0),
    percentage: required === 0 ? 100 : (covered / required) * 100,
    openPositions: items.reduce((sum, item) => sum + item.openPositions, 0),
  };
}

function planHeader(revision: number) {
  return {
    planId,
    organizationId,
    unitId,
    unitName: "Hotel München",
    weekStart,
    weekEnd: "2026-08-16",
    timezone: "Europe/Berlin",
    status: "ACTIVE",
    draftRevision: revision,
    etag: etag(revision),
    latestPublishedVersion: null,
    publishedRevision: null,
    publishedAt: null,
    hasUnpublishedChanges: true,
    capabilities: { view: true, manage: true, publish: true },
  };
}

function workType(
  id: string,
  code: string,
  name: string,
  defaultStartTime: string,
  defaultEndTime: string,
  color: string,
): BusinessWorkType {
  return {
    id,
    unitId,
    parentId: null,
    code,
    name,
    color,
    defaultStartTime,
    defaultEndTime,
    defaultBreakMinutes: 30,
    calculationMethod: "TIME_BASED",
    compensationMethod: "HOURLY",
    unitLabel: null,
    unitSymbol: null,
    unitsPerHour: null,
    ratePerUnit: null,
    currency: "EUR",
    teamworkEnabled: true,
    extraPayEnabled: false,
    compositeEnabled: false,
    displayOrder: 0,
    active: true,
  };
}

function currentUser(theme: "LIGHT" | "DARK") {
  return {
    account: { id: "manager-user", email: "manager@example.com", emailVerified: true, status: "ACTIVE", lastLoginAt: null },
    profile: { firstName: "Mara", lastName: "Manager" },
    preferences: {
      id: "preferences-manager",
      language: "en",
      timezone: "Europe/Berlin",
      currency: "EUR",
      firstDayOfWeek: "MONDAY",
      dateFormat: "dd/MM/yyyy",
      timeFormat: "H24",
      theme,
      defaultBreakMinutes: 30,
      preferredDailyMinutes: 480,
      paidSickLeave: true,
      paidVacation: true,
      onboardingCompleted: true,
      trackingSetupVersionCompleted: 1,
    },
  };
}

function authTokens() {
  return {
    accessToken: "e2e-business-token",
    tokenType: "Bearer",
    accessTokenExpiresIn: 900,
    user: { id: "manager-user", email: "manager@example.com", emailVerified: true, status: "ACTIVE", lastLoginAt: null },
  };
}

function etag(revision: number) {
  return `"plan-${planId}-rev-${revision}"`;
}

function addDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function json(route: Route, data: unknown, status = 200, headers: Record<string, string> = {}) {
  return route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify({ data }) });
}

function apiError(route: Route, status: number, code: string, message: string) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify({ status, code, message, errors: [], path: route.request().url(), timestamp: new Date(0).toISOString() }),
  });
}

async function captureIfRequested(page: Page, name: string) {
  const directory = process.env.ALVERYN_D1_ARTIFACT_DIR;
  if (!directory) return;
  await page.screenshot({ path: `${directory}/${name}`, fullPage: true });
}

async function recordingPause(page: Page) {
  if (process.env.ALVERYN_E2E_RECORD_VIDEO === "true") {
    await page.waitForTimeout(500);
  }
}

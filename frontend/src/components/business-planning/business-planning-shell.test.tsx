import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessPlanningShell } from "./business-planning-shell";
import { WorkspaceProvider } from "../../contexts/workspace-context";

const getAccess = vi.fn();

vi.mock("../../api/endpoints", () => ({
  getOrganizationAccess: (...args: unknown[]) => getAccess(...args),
  listOrganizations: () => Promise.resolve([
    { id: "personal-1", name: "Personal", type: "PERSONAL", timezone: "Europe/Berlin", role: "OWNER" },
    { id: "org-1", name: "PUIU", type: "BUSINESS", timezone: "Europe/Berlin", role: "OWNER" },
  ]),
}));

describe("BusinessPlanningShell", () => {
  beforeEach(() => {
    getAccess.mockResolvedValue({
      permissions: ["MANAGE_MEMBERS", "MANAGE_ROLES", "MANAGE_TEAMS", "MANAGE_SCHEDULE"],
    });
  });

  it("exposes every authorized management destination from the mobile menu", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter initialEntries={["/business/org-1/plan/schedule"]}>
        <QueryClientProvider client={client}>
          <WorkspaceProvider><BusinessPlanningShell
            organizations={[{ id: "org-1", name: "PUIU", type: "BUSINESS", timezone: "Europe/Berlin", role: "OWNER" }]}
            organizationId="org-1"
            units={[{ id: "unit-1", parentId: null, name: "Hotel", type: "LOCATION", checkInMode: "OPTIONAL", active: true, displayOrder: 0 }]}
            unitId="unit-1"
            weekStart="2026-08-17"
            weekEnd="2026-08-23"
            onOrganizationChange={vi.fn()}
            onUnitChange={vi.fn()}
            onPreviousWeek={vi.fn()}
            onNextWeek={vi.fn()}
            onCurrentWeek={vi.fn()}
          >
            <div>Schedule content</div>
          </BusinessPlanningShell></WorkspaceProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Open Business management" }));
    const dialog = screen.getByRole("dialog", { name: "Business management" });
    const menu = within(dialog);
    expect(dialog).toBeInTheDocument();
    expect(menu.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/business/org-1/overview");
    expect(await menu.findByRole("link", { name: "Team" })).toHaveAttribute("href", "/business/org-1/people");
    expect(menu.getByRole("link", { name: "Roles" })).toHaveAttribute("href", "/business/org-1/roles");
    expect(menu.getByRole("link", { name: "Structure" })).toHaveAttribute("href", "/business/org-1/locations");
    expect(menu.getByRole("link", { name: "Work types" })).toHaveAttribute("href", "/business/org-1/work-types");

    await user.click(menu.getByRole("button", { name: "Close" }));
    expect(dialog).not.toBeInTheDocument();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { APP_HOME_PATH } from "../routes/app-paths";
import { AppLayout } from "./app-layout";

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );

  return {
    ...actual,
    Outlet: ({ context }: { context?: unknown }) => (
      <div data-testid="outlet" data-has-context={Boolean(context)} />
    )
  };
});

vi.mock("../pages/profile-page", () => ({
  ProfilePage: () => <div data-testid="settings-master-pane-content" />
}));

vi.mock("../api/endpoints", () => ({
  listOrganizations: vi.fn().mockResolvedValue([]),
}));

describe("AppLayout", () => {
  it("renders normal routed content without the persistent swipe workspace", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false }
      }
    });

    render(
      <MemoryRouter initialEntries={[APP_HOME_PATH]}>
        <QueryClientProvider client={queryClient}>
          <AppLayout />
        </QueryClientProvider>
      </MemoryRouter>
    );

    expect(screen.getByTestId("outlet")).toHaveAttribute("data-has-context", "true");
    expect(screen.queryByTestId("main-workspace")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Work schedule" })).not.toBeInTheDocument();
  });

  it("keeps the full-screen background and hides primary navigation on settings subroutes", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false }
      }
    });

    const { container } = render(
      <MemoryRouter initialEntries={["/settings/work-types/new"]}>
        <QueryClientProvider client={queryClient}>
          <AppLayout />
        </QueryClientProvider>
      </MemoryRouter>
    );

    expect(container.querySelector(".app-background")).not.toBeNull();
    expect(screen.getByTestId("settings-master-pane-content")).toBeInTheDocument();
    expect(screen.queryByLabelText("Primary navigation")).not.toBeInTheDocument();
  });

  it.each([
    "/business/org-1/overview",
    "/business/org-1/people",
    "/business/org-1/roles",
    "/business/org-1/locations",
    "/business/org-1/work-types",
  ])("gives every business product route the full-screen shell: %s", (path) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { container } = render(
      <MemoryRouter initialEntries={[path]}>
        <QueryClientProvider client={queryClient}>
          <AppLayout />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(container.querySelector("main.business-planning-route-shell")).not.toBeNull();
    expect(screen.queryByLabelText("Primary navigation")).not.toBeInTheDocument();
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
  });
});

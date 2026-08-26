import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { BottomNav } from "../components/navigation/bottom-nav";
import { RouteScrollReset } from "../components/navigation/route-scroll-reset";
import { WorkspaceSwitcher } from "../components/navigation/workspace-switcher";
import { PersonalWorkspaceShell } from "../components/navigation/personal-workspace-shell";
import { WorkspaceProvider } from "../contexts/workspace-context";
import { ProfilePage } from "../pages/profile-page";
import { APP_HOME_PATH } from "../routes/app-paths";
import { cn } from "../utils/cn";

export function AppLayout() {
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const location = useLocation();
  const settingsSplitView = location.pathname.startsWith("/settings/");
  const businessProductView = /^\/business\/[^/]+\//.test(location.pathname);
  const businessWorkspaceView = location.pathname === "/business" || businessProductView;
  const personalWorkspaceView = [APP_HOME_PATH, "/calendar", "/statistics", "/schedule", "/profile"].includes(location.pathname);
  const desktopWorkspaceView = [
    APP_HOME_PATH,
    "/calendar",
    "/statistics",
    "/schedule",
    "/business",
  ].includes(location.pathname);
  const showBottomNavigation =
    !settingsSplitView &&
    !location.pathname.startsWith("/records/") &&
    !businessProductView &&
    !personalWorkspaceView;
  const ambientView =
    location.pathname === APP_HOME_PATH ||
    location.pathname === "/preview/dashboard" ||
    location.pathname === "/calendar" ||
    location.pathname === "/statistics" ||
    location.pathname.startsWith("/business") ||
    location.pathname === "/schedule" ||
    location.pathname === "/profile" ||
    location.pathname.startsWith("/records/") ||
    location.pathname.startsWith("/settings");

  return (
    <WorkspaceProvider>
      <div className={settingsSplitView ? "settings-split-view" : undefined}>
        <RouteScrollReset />
        <div
          className={cn(
            "app-background",
            ambientView && "app-background--dashboard",
          )}
          aria-hidden="true"
        />
        {settingsSplitView ? (
          <aside
            className="settings-master-pane"
            aria-label="Settings navigation"
          >
            <ProfilePage embedded />
          </aside>
        ) : null}
        <main
          key={location.pathname}
          className={cn(
            "screen-shell space-y-4",
            desktopWorkspaceView && "desktop-workspace-shell",
            businessWorkspaceView && "business-workspace-shell",
            businessProductView && "business-planning-route-shell",
            personalWorkspaceView && "personal-workspace-route-shell",
          )}
        >
          {!settingsSplitView && !businessProductView && !personalWorkspaceView ? <WorkspaceSwitcher /> : null}
          {personalWorkspaceView ? (
            <PersonalWorkspaceShell>
              <Outlet context={{ selectedDate, setSelectedDate }} />
            </PersonalWorkspaceShell>
          ) : <Outlet context={{ selectedDate, setSelectedDate }} />}
        </main>
        {showBottomNavigation ? <BottomNav /> : null}
      </div>
    </WorkspaceProvider>
  );
}

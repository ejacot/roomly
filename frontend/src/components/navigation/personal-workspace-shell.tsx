import {
  BarChart3,
  Building2,
  CalendarDays,
  CalendarRange,
  House,
  Settings2,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { APP_HOME_PATH } from "../../routes/app-paths";
import { AppLogo } from "../branding/app-logo";
import { useWorkspace } from "../../contexts/workspace-context";
import "../../styles/personal-workspace.css";

type Props = {
  children: ReactNode;
};

/**
 * The personal product is a workspace, not a separate application.  This shell
 * deliberately mirrors the Business planner's information architecture while
 * leaving the existing personal pages and their data contracts intact.
 */
export function PersonalWorkspaceShell({ children }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const { organizations, activeWorkspaceId, isLoading, setActiveWorkspaceId } = useWorkspace();
  const personalWorkspace = organizations.find((item) => item.type === "PERSONAL");
  const businessWorkspace = organizations.find((item) => item.type === "BUSINESS");
  const pageTitle = personalPageTitle(location.pathname);

  useEffect(() => {
    if (!isLoading && !businessWorkspace && location.pathname === "/schedule") {
      navigate(APP_HOME_PATH, { replace: true });
    }
  }, [businessWorkspace, isLoading, location.pathname, navigate]);

  const selectWorkspace = (id: string) => {
    const workspace = organizations.find((item) => item.id === id);
    if (!workspace) return;
    setActiveWorkspaceId(id);
    navigate(workspace.type === "BUSINESS" ? `/business/${workspace.id}/overview` : APP_HOME_PATH);
  };

  return (
    <div className="personal-workspace">
      <div className="personal-workspace__grid" aria-hidden="true" />
      <header className="personal-workspace__topbar">
        <NavLink
          to={APP_HOME_PATH}
          className="personal-workspace__brand"
          data-page={location.pathname === APP_HOME_PATH ? "today" : "contextual"}
          aria-label="Alveryn Personal"
        >
          <AppLogo wordmark className="personal-workspace__brand-logo" />
          <span className="personal-workspace__page-title">{pageTitle}</span>
        </NavLink>
        <label className="personal-workspace__workspace-control">
          <span>Workspace</span>
          <select
            aria-label="Workspace"
            value={personalWorkspace?.id ?? activeWorkspaceId ?? ""}
            disabled={isLoading || organizations.length === 0}
            onChange={(event) => selectWorkspace(event.target.value)}
          >
            {organizations.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.type === "PERSONAL" ? `Personal · ${workspace.name}` : workspace.name}
              </option>
            ))}
          </select>
        </label>
        <div className="personal-workspace__page-control" aria-label="Current page">
          <span>Page</span>
          <strong>{pageTitle}</strong>
        </div>
        <div className="personal-workspace__context-label"><span>Personal workspace</span></div>
        <div id="personal-workspace-header-actions" className="personal-workspace__header-actions" />
        <div className="personal-workspace__tools">
          {businessWorkspace ? <button
            type="button"
            className="personal-workspace__tool personal-workspace__business-switch"
            aria-label="Open Business workspace"
            onClick={() => selectWorkspace(businessWorkspace.id)}
          >
            <Building2 aria-hidden="true" />
          </button> : null}
        </div>
      </header>

      <aside className="personal-workspace__rail" aria-label="Personal navigation">
        <nav>
          <WorkspaceLink to={APP_HOME_PATH} icon={House} label="Today" end />
          <WorkspaceLink to="/calendar" icon={CalendarDays} label="Calendar" />
          <WorkspaceLink to="/statistics" icon={BarChart3} label="Statistics" />
          {businessWorkspace ? <WorkspaceLink to="/schedule" icon={CalendarRange} label="Work schedule" /> : null}
        </nav>
        <nav className="personal-workspace__rail-secondary">
          <WorkspaceLink to="/profile" icon={Settings2} label="Account & settings" />
        </nav>
      </aside>

      <main className="personal-workspace__main">{children}</main>
      <nav className="personal-workspace__mobile-nav" data-business={Boolean(businessWorkspace)} aria-label="Personal navigation">
        <WorkspaceLink to={APP_HOME_PATH} icon={House} label="Today" end />
        <WorkspaceLink to="/calendar" icon={CalendarDays} label="Calendar" />
        <WorkspaceLink to="/statistics" icon={BarChart3} label="Statistics" />
        {businessWorkspace ? <WorkspaceLink to="/schedule" icon={CalendarRange} label="Work schedule" /> : null}
        <WorkspaceLink to="/profile" icon={Settings2} label="Settings" />
      </nav>
    </div>
  );
}

function WorkspaceLink({ to, icon: Icon, label, end = false }: { to: string; icon: typeof House; label: string; end?: boolean }) {
  return <NavLink to={to} end={end}><Icon aria-hidden="true" /><span>{label}</span></NavLink>;
}

function personalPageTitle(pathname: string) {
  if (pathname === "/calendar") return "Calendar";
  if (pathname === "/statistics") return "Statistics";
  if (pathname === "/schedule") return "Work schedule";
  if (pathname === "/profile") return "Settings";
  return "Today";
}

import {
  BarChart3,
  Building2,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Menu,
  Settings2,
  MapPinned,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { i18n } from "../../i18n";
import { getOrganizationAccess } from "../../api/endpoints";
import { normalizeLanguage } from "../../i18n/language";
import type { Organization, OrganizationUnit } from "../../types/business";
import { AppLogo } from "../branding/app-logo";
import { APP_HOME_PATH } from "../../routes/app-paths";
import { useOptionalWorkspace } from "../../contexts/workspace-context";

type Props = {
  organizations: Organization[];
  organizationId: string;
  units: OrganizationUnit[];
  unitId: string;
  weekStart: string;
  weekEnd: string;
  children: ReactNode;
  onOrganizationChange: (organizationId: string) => void;
  onUnitChange: (unitId: string) => void;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onCurrentWeek: () => void;
  showWeekControls?: boolean;
  sectionLabel?: string;
};

export function BusinessPlanningShell({
  organizations,
  organizationId,
  units,
  unitId,
  weekStart,
  weekEnd,
  children,
  onOrganizationChange,
  onUnitChange,
  onPreviousWeek,
  onNextWeek,
  onCurrentWeek,
  showWeekControls = true,
  sectionLabel,
}: Props) {
  const { t } = useTranslation("business");
  const navigate = useNavigate();
  const workspace = useOptionalWorkspace();
  const availableWorkspaces = workspace?.organizations ?? organizations;
  const locale = normalizeLanguage(i18n.resolvedLanguage);
  const weekLabel = formatWeek(weekStart, weekEnd, locale);
  const planningSearch = `?unit=${encodeURIComponent(unitId)}&week=${encodeURIComponent(weekStart)}`;
  const access = useQuery({
    queryKey: ["organizations", organizationId, "access"],
    queryFn: () => getOrganizationAccess(organizationId),
  });
  const permissions = access.data?.permissions ?? [];
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [mobileMenuOpen]);

  return (
    <div className="business-planning">
      <div className="business-planning__grid" aria-hidden="true" />
      <header className="business-planning__topbar">
        <Link to={`/business/${organizationId}/overview`} className="business-planning__brand" aria-label="Alveryn Business">
          <AppLogo wordmark />
          <span className="business-planning__mobile-page-title">Business</span>
        </Link>

        <label className="business-planning__workspace-control">
          <span>{t("planning.workspace.label")}</span>
          <select
            aria-label={t("planning.workspace.label")}
            value={`business:${organizationId}`}
            onChange={(event) => {
              if (event.target.value === "personal") {
                const personalWorkspace = availableWorkspaces.find((workspace) => workspace.type === "PERSONAL");
                if (personalWorkspace) workspace?.setActiveWorkspaceId(personalWorkspace.id);
                navigate(APP_HOME_PATH);
                return;
              }
              const nextOrganizationId = event.target.value.replace("business:", "");
              workspace?.setActiveWorkspaceId(nextOrganizationId);
              onOrganizationChange(nextOrganizationId);
            }}
          >
            <option value="personal">{t("planning.workspace.personal")}</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={`business:${organization.id}`}>
                {organization.name}
              </option>
            ))}
          </select>
        </label>

        <label className="business-planning__unit-control">
          <span>{t("planning.unit")}</span>
          <select
            aria-label={t("planning.unit")}
            value={unitId}
            onChange={(event) => onUnitChange(event.target.value)}
          >
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>{unit.name}</option>
            ))}
          </select>
        </label>

        {showWeekControls ? <div className="business-planning__week-switcher" aria-label={t("planning.week.label")}>
          <button type="button" onClick={onPreviousWeek} aria-label={t("planning.week.previous")}>
            <ChevronLeft aria-hidden="true" />
          </button>
          <button type="button" onClick={onCurrentWeek} className="business-planning__week-label">
            <span>{t("planning.week.kicker")}</span>
            <strong>{weekLabel}</strong>
          </button>
          <button type="button" onClick={onNextWeek} aria-label={t("planning.week.next")}>
            <ChevronRight aria-hidden="true" />
          </button>
        </div> : <div className="business-planning__section-label">{sectionLabel}</div>}

        <div className="business-planning__tools">
          <button
            type="button"
            className="business-planning__tool business-planning__mobile-menu-trigger"
            aria-label={t("management.mobileOpen")}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu aria-hidden="true" />
          </button>
        </div>
      </header>

      <aside className="business-planning__rail" aria-label={t("planning.navigation.label")}>
        <nav>
          <NavLink to={`/business/${organizationId}/plan/demand${planningSearch}`}>
            <ClipboardList aria-hidden="true" />
            <span>{t("planning.navigation.demand")}</span>
          </NavLink>
          <NavLink to={`/business/${organizationId}/plan/schedule${planningSearch}`}>
            <CalendarRange aria-hidden="true" />
            <span>{t("planning.navigation.schedule")}</span>
          </NavLink>
          <NavLink to={`/business/${organizationId}/plan/review${planningSearch}`}>
            <BarChart3 aria-hidden="true" />
            <span>{t("planning.navigation.review")}</span>
          </NavLink>
        </nav>
        <div className="business-planning__rail-secondary">
          <NavLink to={`/business/${organizationId}/overview`}>
            <Building2 aria-hidden="true" />
            <span>{t("management.overview")}</span>
          </NavLink>
          {permissions.includes("MANAGE_MEMBERS") ? <NavLink to={`/business/${organizationId}/people`}>
            <UsersRound aria-hidden="true" />
            <span>{t("planning.navigation.team")}</span>
          </NavLink> : null}
          {permissions.includes("MANAGE_ROLES") ? <NavLink to={`/business/${organizationId}/roles`}>
            <ShieldCheck aria-hidden="true" />
            <span>{t("tabs.roles")}</span>
          </NavLink> : null}
          {permissions.includes("MANAGE_TEAMS") ? <NavLink to={`/business/${organizationId}/locations`}>
            <MapPinned aria-hidden="true" />
            <span>{t("tabs.teams")}</span>
          </NavLink> : null}
          {permissions.some((value) => value === "MANAGE_SCHEDULE" || value === "MANAGE_SETTINGS") ? <NavLink to={`/business/${organizationId}/work-types`}>
            <Settings2 aria-hidden="true" />
            <span>{t("planning.navigation.workTypes")}</span>
          </NavLink> : null}
        </div>
      </aside>

      {mobileMenuOpen ? <div className="business-planning__mobile-menu">
        <button type="button" className="business-planning__mobile-menu-backdrop" aria-label={t("planning.close")} onClick={() => setMobileMenuOpen(false)} />
        <aside role="dialog" aria-modal="true" aria-label={t("management.section")}>
          <header><span>{t("management.section")}</span><button type="button" aria-label={t("planning.close")} onClick={() => setMobileMenuOpen(false)}><X aria-hidden="true" /></button></header>
          <nav>
            <NavLink onClick={() => setMobileMenuOpen(false)} to={`/business/${organizationId}/overview`}><Building2 aria-hidden="true" /><span>{t("management.overview")}</span></NavLink>
            {permissions.includes("MANAGE_MEMBERS") ? <NavLink onClick={() => setMobileMenuOpen(false)} to={`/business/${organizationId}/people`}><UsersRound aria-hidden="true" /><span>{t("planning.navigation.team")}</span></NavLink> : null}
            {permissions.includes("MANAGE_ROLES") ? <NavLink onClick={() => setMobileMenuOpen(false)} to={`/business/${organizationId}/roles`}><ShieldCheck aria-hidden="true" /><span>{t("tabs.roles")}</span></NavLink> : null}
            {permissions.includes("MANAGE_TEAMS") ? <NavLink onClick={() => setMobileMenuOpen(false)} to={`/business/${organizationId}/locations`}><MapPinned aria-hidden="true" /><span>{t("tabs.teams")}</span></NavLink> : null}
            {permissions.some((value) => value === "MANAGE_SCHEDULE" || value === "MANAGE_SETTINGS") ? <NavLink onClick={() => setMobileMenuOpen(false)} to={`/business/${organizationId}/work-types`}><Settings2 aria-hidden="true" /><span>{t("planning.navigation.workTypes")}</span></NavLink> : null}
          </nav>
        </aside>
      </div> : null}

      <main className="business-planning__main">{children}</main>
    </div>
  );
}

function formatWeek(from: string, to: string, locale: string) {
  if (!from || !to) return "";
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  const formatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  const weekNumber = isoWeekNumber(start);
  return `KW ${weekNumber} · ${formatter.format(start)}–${formatter.format(end)}`;
}

function isoWeekNumber(date: Date) {
  const value = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  return Math.ceil((((value.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

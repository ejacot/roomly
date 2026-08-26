import { useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { listOrganizations, listOrganizationUnits } from "../../api/endpoints";
import { BusinessPlanningShell } from "./business-planning-shell";
import "../../styles/business-planning.css";

export function BusinessManagementShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation("business");
  const { organizationId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const organizations = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const units = useQuery({
    queryKey: ["organizations", organizationId, "units"],
    queryFn: () => listOrganizationUnits(organizationId),
    enabled: Boolean(organizationId),
  });
  const businessOrganizations = (organizations.data ?? []).filter((item) => item.type === "BUSINESS");
  const activeUnits = (units.data ?? []).filter((item) => item.active);
  const unitId = activeUnits.some((item) => item.id === searchParams.get("unit"))
    ? searchParams.get("unit")!
    : activeUnits[0]?.id ?? "";
  const weekStart = monday(new Date());
  const weekEnd = addDays(weekStart, 6);
  const suffix = location.pathname.split(`/business/${organizationId}`)[1] || "/people";

  return (
    <BusinessPlanningShell
      organizations={businessOrganizations}
      organizationId={organizationId}
      units={activeUnits}
      unitId={unitId}
      weekStart={weekStart}
      weekEnd={weekEnd}
      onOrganizationChange={(next) => navigate(`/business/${next}${suffix}`)}
      onUnitChange={(next) => navigate({ search: `?unit=${encodeURIComponent(next)}` })}
      onPreviousWeek={() => undefined}
      onNextWeek={() => undefined}
      onCurrentWeek={() => undefined}
      showWeekControls={false}
      sectionLabel={t("management.section")}
    >
      {children}
    </BusinessPlanningShell>
  );
}

function monday(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  return copy.toISOString().slice(0, 10);
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Clock3,
  Folder,
  Ruler,
  Tag,
  X,
} from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { listBusinessWorkTypes } from "../api/endpoints";
import { SettingsEmptyState } from "../components/settings/settings-empty-state";
import { SettingsPageSkeleton } from "../components/settings/settings-page-skeleton";
import { LockedModalViewport } from "../components/ui/locked-modal-viewport";
import { ModalPanel } from "../components/ui/modal-panel";
import { ScreenMessage } from "../components/ui/screen-message";
import { getApiError } from "../api/api-errors";
import { BusinessManagementShell } from "../components/business-planning/business-management-shell";
import type {
  BusinessCalculationMethod,
  BusinessWorkType,
} from "../types/business";
import "../styles/business-work-types.css";
type Option = {
  mode: string;
  method: BusinessCalculationMethod;
  title: string;
  description: string;
  icon: ReactNode;
};
export function BusinessWorkTypesPage() {
  return <BusinessManagementShell><BusinessWorkTypesContent /></BusinessManagementShell>;
}

function BusinessWorkTypesContent() {
  const { organizationId = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation("business");
  const [dialog, setDialog] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const query = useQuery({
    queryKey: ["staffing", organizationId, "types"],
    queryFn: () => listBusinessWorkTypes(organizationId),
  });
  if (query.isLoading) return <SettingsPageSkeleton />;
  if (query.error)
    return (
      <ScreenMessage
        title={t("workTypes.unavailable", {
          defaultValue: "Work types are unavailable",
        })}
        description={getApiError(query.error).message}
      />
    );
  const items = [...(query.data ?? [])].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
  );
  const roots = items.filter((v) => !v.parentId);
  const options: Option[] = [
    {
      mode: "TIME_HOURLY",
      method: "TIME_BASED",
      title: t("workTypes.methods.TIME_BASED"),
      description: t("workTypes.methodDescriptions.TIME_BASED"),
      icon: <Clock3 className="h-5 w-5" />,
    },
    {
      mode: "UNITS_PER_HOUR",
      method: "UNITS_PER_HOUR_BASED",
      title: t("workTypes.methods.UNITS_PER_HOUR_BASED"),
      description: t("workTypes.methodDescriptions.UNITS_PER_HOUR_BASED"),
      icon: <Ruler className="h-5 w-5" />,
    },
    {
      mode: "UNITS_PER_UNIT",
      method: "UNIT_BASED",
      title: t("workTypes.methods.UNIT_BASED"),
      description: t("workTypes.methodDescriptions.UNIT_BASED"),
      icon: <Tag className="h-5 w-5" />,
    },
    {
      mode: "FIXED_AMOUNT",
      method: "FIXED_PRICE_BASED",
      title: t("workTypes.methods.FIXED_PRICE_BASED"),
      description: t("workTypes.methodDescriptions.FIXED_PRICE_BASED"),
      icon: <Tag className="h-5 w-5" />,
    },
  ];
  const open = (option: Option) =>
    navigate(`/business/${organizationId}/work-types/new?mode=${option.mode}`);
  return (
    <div className="business-admin business-work-types mx-auto w-full max-w-[1040px] pb-10">
      <header className="business-admin__header">
        <div><p>WORK TYPES</p><h1>{t("workTypes.title")}</h1><span>{t("workTypes.manageHint")}</span></div>
      </header>
      <div className="business-work-types__actions">
        <button
          onClick={() => setDialog(true)}
          className="business-admin__primary"
        >
          {t("workTypes.add")}
        </button>
        <button
          onClick={() =>
            navigate(`/business/${organizationId}/work-types/new?category=true`)
          }
          className="business-admin__secondary"
        >
          {t("workTypes.addCategory")}
        </button>
      </div>
      {!roots.length ? (
        <SettingsEmptyState
          title={t("workTypes.empty")}
          description={t("workTypes.manageHint")}
          actionLabel={t("workTypes.add")}
          onAction={() => setDialog(true)}
        />
      ) : (
        <section className="business-work-types__list">
          {roots.map((item) => {
            const children = items.filter((v) => v.parentId === item.id),
              category = item.compositeEnabled,
              isExpanded = expanded.has(item.id);
            return (
              <article
                key={item.id}
                className="business-work-types__card"
                style={workTypeColor(item.color)}
              >
                <div className="business-work-types__card-main">
                  <button
                    onClick={() =>
                      navigate(
                        `/business/${organizationId}/work-types/${item.id}`,
                      )
                    }
                    className="business-work-types__card-link"
                  >
                    <span className="business-work-types__card-copy">
                      <span className="business-work-types__card-name">
                        {category ? (
                          <Folder />
                        ) : (
                          <Tag />
                        )}
                        <span className="truncate">{item.name}</span>
                      </span>
                      <span className="business-work-types__card-summary">
                        {category
                          ? `${t("workTypes.category")} · ${children.length}`
                          : summary(item, t)}
                        {!item.active
                          ? ` · ${t("workTypes.inactive", { defaultValue: "Inactive" })}`
                          : ""}
                      </span>
                    </span>
                    {!category || !children.length ? (
                      <ChevronRight />
                    ) : null}
                  </button>
                  {category && children.length ? (
                    <button
                      onClick={() =>
                        setExpanded((current) => {
                          const next = new Set(current);
                          if (next.has(item.id)) next.delete(item.id);
                          else next.add(item.id);
                          return next;
                        })
                      }
                      className="business-work-types__expand"
                    >
                      <ChevronDown
                        className={isExpanded ? "rotate-180" : ""}
                      />
                    </button>
                  ) : null}
                </div>
                {isExpanded ? (
                  <div className="business-work-types__children">
                    {children.map((child) => (
                      <button
                        key={child.id}
                        onClick={() =>
                          navigate(
                            `/business/${organizationId}/work-types/${child.id}`,
                          )
                        }
                        className="business-work-types__child"
                        style={workTypeColor(child.color)}
                      >
                        <div>
                          <div>
                            <p>
                              <Tag />
                              {child.name}
                            </p>
                            <p className="business-work-types__child-summary">
                              {summary(child, t)}
                              {!child.active
                                ? ` · ${t("workTypes.inactive", { defaultValue: "Inactive" })}`
                                : ""}
                            </p>
                          </div>
                          <ChevronRight />
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      )}
      {dialog ? (
        <LockedModalViewport
          className="z-[60] bg-black/50 px-4 py-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <button
            className="absolute inset-0"
            onClick={() => setDialog(false)}
          />
          <ModalPanel className="business-work-types__dialog max-w-sm">
            <div className="business-work-types__dialog-header">
              <h2>
                {t("workTypes.chooseMode")}
              </h2>
              <button
                onClick={() => setDialog(false)}
                className="business-work-types__dialog-close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="business-work-types__mode-list">
              {options.map((option) => (
                <button
                  key={option.mode}
                  onClick={() => open(option)}
                  className="business-work-types__mode"
                >
                  <span className="flex items-center gap-4">
                    <span className="business-work-types__mode-icon">
                      {option.icon}
                    </span>
                    <span>
                      <span>
                        {option.title}
                      </span>
                      <span className="business-work-types__mode-description">
                        {option.description}
                      </span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </ModalPanel>
        </LockedModalViewport>
      ) : null}
    </div>
  );
}

function workTypeColor(color: string): CSSProperties {
  return { "--business-work-type-color": color } as CSSProperties;
}
function summary(item: BusinessWorkType, t: (key: string) => string) {
  if (item.calculationMethod === "TIME_BASED")
    return item.defaultBreakMinutes
      ? `${item.defaultBreakMinutes} min · ${t("workTypes.methods.TIME_BASED")}`
      : t("workTypes.methods.TIME_BASED");
  if (item.calculationMethod === "UNITS_PER_HOUR_BASED")
    return item.unitsPerHour
      ? `${item.unitsPerHour} / h`
      : t("workTypes.methods.UNITS_PER_HOUR_BASED");
  if (item.calculationMethod === "FIXED_PRICE_BASED")
    return t("workTypes.methods.FIXED_PRICE_BASED");
  return item.ratePerUnit && item.currency
    ? `${item.ratePerUnit} ${item.currency} / ${item.unitSymbol ?? item.unitLabel ?? "unit"}`
    : t("workTypes.methods.UNIT_BASED");
}

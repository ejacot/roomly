import { ChevronLeft, ChevronRight, Clock3, Copy, Settings2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BusinessWorkType } from "../../types/business";
import type {
  StaffingDemandDay,
  StaffingDemandRequirement,
} from "../../types/business-planning";
import { DemandCellInput } from "./demand-cell-input";
import { timeRange, workTypePlanningSummary } from "./demand-matrix";

type Props = {
  days: StaffingDemandDay[];
  workTypes: BusinessWorkType[];
  canManage: boolean;
  copying: boolean;
  busyCells: Set<string>;
  onCommit: (workType: BusinessWorkType, day: StaffingDemandDay, value: number) => void;
  onEdit: (requirement: StaffingDemandRequirement) => void;
  onEditWorkType: (workType: BusinessWorkType) => void;
  onApplyWorkType: (workType: BusinessWorkType) => void;
  onCopyPreviousWeek: () => void;
};

export function DemandMobileView({
  days,
  workTypes,
  canManage,
  copying,
  busyCells,
  onCommit,
  onEdit,
  onEditWorkType,
  onApplyWorkType,
  onCopyPreviousWeek,
}: Props) {
  const { t, i18n } = useTranslation("business");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [revealedWorkTypeId, setRevealedWorkTypeId] = useState<string | null>(null);
  const index = Math.min(selectedIndex, Math.max(0, days.length - 1));
  const day = days[index];
  if (!day) return null;

  return (
    <section className="demand-mobile" aria-labelledby="demand-mobile-title" onPointerDownCapture={(event) => {
      if (!(event.target as Element).closest(".demand-mobile__work-type-cell")) setRevealedWorkTypeId(null);
    }}>
      <div className="demand-mobile__days" role="tablist" aria-label={t("planning.demand.chooseDay")}>
        {days.map((item, itemIndex) => (
          <button
            type="button"
            role="tab"
            aria-selected={itemIndex === index}
            key={item.date}
            onClick={() => setSelectedIndex(itemIndex)}
          >
            <span>{weekday(item.date, i18n.language)}</span>
            <strong>{new Date(`${item.date}T12:00:00`).getDate()}</strong>
            <i data-open={item.coverage.openPositions > 0 || undefined} />
          </button>
        ))}
      </div>

      <header className="demand-mobile__summary">
        <button
          type="button"
          onClick={() => setSelectedIndex(Math.max(0, index - 1))}
          disabled={index === 0}
          aria-label={t("planning.week.previousDay")}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <div>
          <span>{t("planning.demand.selectedDay")}</span>
          <h2 id="demand-mobile-title">{longDate(day.date, i18n.language)}</h2>
          <p>
            {t("planning.demand.dayCoverage", {
              assigned: day.coverage.effectiveAssigned,
              required: day.coverage.required,
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSelectedIndex(Math.min(days.length - 1, index + 1))}
          disabled={index === days.length - 1}
          aria-label={t("planning.week.nextDay")}
        >
          <ChevronRight aria-hidden="true" />
        </button>
      </header>

      <div className="demand-mobile__context">
        <span>{t("planning.demand.rooms")}</span>
        <strong>{day.roomsContext ?? "—"}</strong>
        {day.notes ? <p>{day.notes}</p> : null}
        <button
          type="button"
          className="demand-mobile__copy"
          disabled={!canManage || copying}
          onClick={onCopyPreviousWeek}
        >
          <Copy aria-hidden="true" />
          {copying ? t("planning.demand.copying") : t("planning.demand.copyPrevious")}
        </button>
      </div>

      <div className="demand-mobile__requirements">
        {workTypes.map((workType, workTypeIndex) => {
          const matches = day.requirements.filter(
            (requirement) => requirement.workTypeId === workType.id,
          );
          const requirement = matches[0];
          const value = matches.reduce((total, item) => total + item.requiredWorkers, 0);
          const key = `${day.date}:${workType.id}`;
          return (
            <article key={workType.id} data-active={value > 0 || undefined}>
              <header>
                <i style={{ "--work-type-color": workType.color } as React.CSSProperties} />
                <MobileWorkTypeCell workType={workType} canManage={canManage} settingsVisible={revealedWorkTypeId === workType.id} onReveal={() => setRevealedWorkTypeId(workType.id)} onApply={() => onApplyWorkType(workType)} onSettings={() => onEditWorkType(workType)} t={t} />
                <DemandCellInput
                  value={value}
                  label={t("planning.demand.peopleLabel", {
                    workType: workType.name,
                    date: longDate(day.date, i18n.language),
                  })}
                  cellKey={`mobile:${workTypeIndex}:${index}`}
                  disabled={!canManage || matches.length > 1}
                  busy={busyCells.has(key)}
                  onCommit={(next) => onCommit(workType, day, next)}
                />
              </header>
              {requirement ? (
                <button type="button" onClick={() => onEdit(requirement)}>
                  <Clock3 aria-hidden="true" />
                  <span>{timeRange(requirement)}</span>
                  <small>{t("planning.demand.editDetails")}</small>
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function MobileWorkTypeCell({ workType, canManage, settingsVisible, onReveal, onApply, onSettings, t }: { workType: BusinessWorkType; canManage: boolean; settingsVisible: boolean; onReveal: () => void; onApply: () => void; onSettings: () => void; t: ReturnType<typeof useTranslation>["t"] }) {
  const gesture = useRef<number | null>(null);
  const suppressClick = useRef(false);
  return <div className={`demand-mobile__work-type-cell${settingsVisible ? " is-revealed" : ""}`} onPointerDown={(event) => { gesture.current = event.clientX; if (typeof event.currentTarget.setPointerCapture === "function") event.currentTarget.setPointerCapture(event.pointerId); }} onPointerUp={(event) => { if (gesture.current !== null && event.clientX - gesture.current < -18) { suppressClick.current = true; onReveal(); } if (typeof event.currentTarget.hasPointerCapture === "function" && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); gesture.current = null; }} onPointerCancel={() => { gesture.current = null; }}>
    <button type="button" className="demand-mobile__work-type" disabled={!canManage} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onApply(); }} aria-label={t("planning.demand.applyWorkType", { workType: workType.name, defaultValue: "Apply {{workType}} to days" })}>
      <strong>{workType.name}</strong><span>{workTypePlanningSummary(workType)}</span>
    </button>
    <button type="button" className="demand-mobile__work-type-settings" onClick={onSettings} aria-label={t("planning.demand.editWorkType", { workType: workType.name, defaultValue: "Edit {{workType}} work type" })}><Settings2 aria-hidden="true" /></button>
  </div>;
}

function weekday(value: string, language: string) {
  return new Intl.DateTimeFormat(language, { weekday: "narrow" })
    .format(new Date(`${value}T12:00:00`));
}

function longDate(value: string, language: string) {
  return new Intl.DateTimeFormat(language, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${value}T12:00:00`));
}

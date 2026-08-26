import { Clock3, Copy, Settings2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BusinessWorkType } from "../../types/business";
import type {
  StaffingDemandDay,
  StaffingDemandRequirement,
} from "../../types/business-planning";
import { DemandCellInput } from "./demand-cell-input";

type Props = {
  days: StaffingDemandDay[];
  workTypes: BusinessWorkType[];
  canManage: boolean;
  copying: boolean;
  busyCells: Set<string>;
  onCommit: (workType: BusinessWorkType, day: StaffingDemandDay, value: number) => void;
  onPaste: (
    workTypeIndex: number,
    dayIndex: number,
    text: string,
  ) => void;
  onEdit: (requirement: StaffingDemandRequirement) => void;
  onApplyWorkType: (workType: BusinessWorkType, trigger: HTMLElement) => void;
  onEditWorkType: (workType: BusinessWorkType) => void;
  onCopyPreviousWeek: () => void;
};

export function DemandMatrix({
  days,
  workTypes,
  canManage,
  copying,
  busyCells,
  onCommit,
  onPaste,
  onEdit,
  onApplyWorkType,
  onEditWorkType,
  onCopyPreviousWeek,
}: Props) {
  const { t, i18n } = useTranslation("business");
  const [revealedWorkTypeId, setRevealedWorkTypeId] = useState<string | null>(null);

  return (
    <section
      className="demand-matrix"
      aria-labelledby="demand-matrix-title"
      onPointerDownCapture={(event) => {
        if (!(event.target as Element).closest(".demand-matrix__work-type-cell")) {
          setRevealedWorkTypeId(null);
        }
      }}
    >
      <header className="demand-matrix__heading">
        <div>
          <h2 id="demand-matrix-title">{t("planning.demand.matrixTitle")}</h2>
          <p>{t("planning.demand.keyboardHint")}</p>
        </div>
        <button
          type="button"
          className="demand-matrix__copy"
          disabled={!canManage || copying}
          onClick={onCopyPreviousWeek}
        >
          <Copy aria-hidden="true" />
          {copying ? t("planning.demand.copying") : t("planning.demand.copyPrevious")}
        </button>
      </header>

      <div
        className="demand-matrix__scroller"
        role="region"
        aria-label={t("planning.demand.matrixTitle")}
        // A keyboard-focusable region is required so keyboard users can scroll the wide planning matrix.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th scope="col" className="demand-matrix__work-type-column">
                {t("planning.demand.workType")}
              </th>
              {days.map((day) => (
                <th scope="col" key={day.date}>
                  <span>{formatWeekday(day.date, i18n.language)}</span>
                  <strong>{formatDay(day.date, i18n.language)}</strong>
                  <small>{day.coverage.effectiveAssigned}/{day.coverage.required}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="demand-matrix__context-row">
              <th scope="row">
                <span>{t("planning.demand.rooms")}</span>
                <small>{t("planning.demand.readOnlyContext")}</small>
              </th>
              {days.map((day) => (
                <td key={day.date}>
                  <strong>{day.roomsContext ?? "—"}</strong>
                  {day.notes ? <span title={day.notes}>●</span> : null}
                </td>
              ))}
            </tr>
            {workTypes.map((workType, workTypeIndex) => (
              <tr key={workType.id}>
                <th scope="row">
                  <WorkTypeCell
                    workType={workType}
                    canManage={canManage}
                    settingsVisible={revealedWorkTypeId === workType.id}
                    onReveal={() => setRevealedWorkTypeId(workType.id)}
                    onApply={(trigger) => onApplyWorkType(workType, trigger)}
                    onSettings={() => onEditWorkType(workType)}
                    t={t}
                  />
                </th>
                {days.map((day, dayIndex) => {
                  const matches = day.requirements.filter(
                    (requirement) => requirement.workTypeId === workType.id,
                  );
                  const requirement = matches[0];
                  const value = matches.reduce(
                    (total, item) => total + item.requiredWorkers,
                    0,
                  );
                  const key = `${day.date}:${workType.id}`;
                  const label = t("planning.demand.peopleLabel", {
                    workType: workType.name,
                    date: formatAccessibleDate(day.date, i18n.language),
                  });
                  return (
                    <td
                      key={day.date}
                      className={value > 0 ? "has-demand" : undefined}
                      data-source={day.source ?? "MANUAL"}
                    >
                      <DemandCellInput
                        value={value}
                        label={label}
                        cellKey={`${workTypeIndex}:${dayIndex}`}
                        disabled={!canManage || matches.length > 1}
                        busy={busyCells.has(key)}
                        onCommit={(next) => onCommit(workType, day, next)}
                        onPaste={(text) => onPaste(workTypeIndex, dayIndex, text)}
                      />
                      {requirement ? (
                        <button
                          type="button"
                          className="demand-matrix__time"
                          onClick={() => onEdit(requirement)}
                        >
                          <Clock3 aria-hidden="true" />
                          {timeRange(requirement)}
                        </button>
                      ) : (
                        <span className="demand-matrix__empty-time">{t("planning.demand.notNeeded")}</span>
                      )}
                      {matches.length > 1 ? (
                        <small className="demand-matrix__multiple">
                          {t("planning.demand.multipleLines", { count: matches.length })}
                        </small>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WorkTypeCell({
  workType,
  canManage,
  settingsVisible,
  onReveal,
  onApply,
  onSettings,
  t,
}: {
  workType: BusinessWorkType;
  canManage: boolean;
  settingsVisible: boolean;
  onReveal: () => void;
  onApply: (trigger: HTMLElement) => void;
  onSettings: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const gesture = useRef<number | null>(null);
  const suppressClick = useRef(false);
  return (
    <div
      className={`demand-matrix__work-type-cell${settingsVisible ? " is-revealed" : ""}`}
      onPointerDown={(event) => {
        gesture.current = event.clientX;
        if (typeof event.currentTarget.setPointerCapture === "function") event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={(event) => {
        if (gesture.current !== null && event.clientX - gesture.current < -18) {
          suppressClick.current = true;
          onReveal();
        }
        if (typeof event.currentTarget.hasPointerCapture === "function" && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        gesture.current = null;
      }}
      onPointerCancel={() => { gesture.current = null; }}
    >
      <button
        type="button"
        className="demand-matrix__work-type"
        style={{ "--work-type-color": workType.color } as React.CSSProperties}
        disabled={!canManage}
        onClick={(event) => {
          if (suppressClick.current) { suppressClick.current = false; return; }
          onApply(event.currentTarget);
        }}
        aria-label={t("planning.demand.applyWorkType", {
          workType: workType.name,
          defaultValue: "Apply {{workType}} to days",
        })}
      >
        <i />
        <span><strong>{workType.name}</strong><small>{workTypePlanningSummary(workType)}</small></span>
      </button>
      <button
        type="button"
        className="demand-matrix__work-type-settings"
        aria-label={t("planning.demand.editWorkType", { workType: workType.name, defaultValue: "Edit {{workType}} work type" })}
        onClick={onSettings}
      ><Settings2 aria-hidden="true" /></button>
    </div>
  );
}

export function timeRange(requirement: StaffingDemandRequirement) {
  if (!requirement.startTime && !requirement.endTime) return "—";
  return `${requirement.startTime?.slice(0, 5) ?? "—"}–${requirement.endTime?.slice(0, 5) ?? "—"}`;
}

export function workTypePlanningSummary(workType: BusinessWorkType) {
  const start = workType.defaultStartTime?.slice(0, 5) ?? null;
  const end = workType.defaultEndTime?.slice(0, 5) ?? null;
  if (start && end) {
    const startMinutes = toMinutes(start);
    let duration = toMinutes(end) - startMinutes;
    if (duration <= 0) duration += 24 * 60;
    const net = Math.max(0, duration - workType.defaultBreakMinutes);
    return `${start}–${end} · ${formatMinutes(net)}`;
  }
  return start ? `${start} start` : "No set time";
}

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatMinutes(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function formatWeekday(value: string, language: string) {
  return new Intl.DateTimeFormat(language, { weekday: "short" })
    .format(new Date(`${value}T12:00:00`));
}

function formatDay(value: string, language: string) {
  return new Intl.DateTimeFormat(language, { day: "2-digit", month: "2-digit" })
    .format(new Date(`${value}T12:00:00`));
}

function formatAccessibleDate(value: string, language: string) {
  return new Intl.DateTimeFormat(language, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${value}T12:00:00`));
}

import { Check, Copy, Layers3 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BusinessWorkType } from "../../types/business";
import type { StaffingDemandDay } from "../../types/business-planning";

type Props = {
  days: StaffingDemandDay[];
  workTypes: BusinessWorkType[];
  disabled: boolean;
  copying: boolean;
  applying: boolean;
  open: boolean;
  selectedWorkTypeId: string | null;
  fixedWorkType: boolean;
  showCopyAction?: boolean;
  showApplyAction?: boolean;
  anchorRect?: DOMRect | null;
  onOpenChange: (open: boolean) => void;
  onCopyPreviousWeek: () => void;
  onApply: (workType: BusinessWorkType, dates: string[], workers: number) => void;
};

export function DemandActions({
  days,
  workTypes,
  disabled,
  copying,
  applying,
  open,
  selectedWorkTypeId,
  fixedWorkType,
  showCopyAction = true,
  showApplyAction = true,
  anchorRect = null,
  onOpenChange,
  onCopyPreviousWeek,
  onApply,
}: Props) {
  const { t, i18n } = useTranslation("business");
  const [workTypeId, setWorkTypeId] = useState(workTypes[0]?.id ?? "");
  const [dates, setDates] = useState<string[]>([]);
  const [workers, setWorkers] = useState(1);
  const [workersDraft, setWorkersDraft] = useState("1");
  const [workersDirty, setWorkersDirty] = useState(false);
  const panelRef = useRef<HTMLFormElement>(null);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);
  const selectedType = useMemo(
    () => workTypes.find((workType) => workType.id === workTypeId),
    [workTypeId, workTypes],
  );
  useEffect(() => {
    if (selectedWorkTypeId && workTypes.some((type) => type.id === selectedWorkTypeId)) {
      setWorkTypeId(selectedWorkTypeId);
    }
  }, [selectedWorkTypeId, workTypes]);
  const commitWorkers = () => {
    if (!workersDirty || workersDraft === "") {
      setWorkersDraft(String(workers));
      setWorkersDirty(false);
      return workers;
    }
    const next = Math.max(0, Math.min(99, Number(workersDraft)));
    setWorkers(next);
    setWorkersDraft(String(next));
    setWorkersDirty(false);
    return next;
  };
  useLayoutEffect(() => {
    if (!open || !anchorRect || window.innerWidth <= 780) { setPanelPosition(null); return; }
    const position = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const margin = 16;
      const width = panel.getBoundingClientRect().width;
      const height = panel.getBoundingClientRect().height;
      const right = anchorRect.right + 12;
      const left = right + width <= window.innerWidth - margin
        ? right
        : Math.max(margin, anchorRect.left - width - 12);
      setPanelPosition({
        left,
        top: Math.max(margin, Math.min(anchorRect.top, window.innerHeight - height - margin)),
      });
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [anchorRect, open]);

  return (
    <div className="demand-actions">
      {showCopyAction ? <button
        type="button"
        className="demand-actions__secondary"
        disabled={disabled || copying}
        onClick={onCopyPreviousWeek}
      >
        <Copy aria-hidden="true" />
        {copying ? t("planning.demand.copying") : t("planning.demand.copyPrevious")}
      </button> : null}
      {showApplyAction ? <button
        type="button"
        className="demand-actions__primary"
        disabled={disabled || workTypes.length === 0}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <Layers3 aria-hidden="true" />
        {t("planning.demand.applyDays")}
      </button> : null}

      {open ? (
        <form
          ref={panelRef}
          className="demand-actions__panel"
          style={panelPosition ? { position: "fixed", top: panelPosition.top, left: panelPosition.left, right: "auto" } : undefined}
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedType || dates.length === 0) return;
            onApply(selectedType, dates, commitWorkers());
            onOpenChange(false);
          }}
        >
          <header>
            <div>
              <span>{t("planning.demand.bulkKicker")}</span>
              <h3>{t("planning.demand.bulkTitle")}</h3>
            </div>
            <button type="button" onClick={() => onOpenChange(false)} aria-label={t("planning.close")}>×</button>
          </header>
          {fixedWorkType ? (
            <p className="demand-actions__selected-work-type">{selectedType?.name}</p>
          ) : (
            <label>
              <span>{t("planning.demand.workType")}</span>
              <select value={workTypeId} onChange={(event) => setWorkTypeId(event.target.value)}>
                {workTypes.map((workType) => (
                  <option key={workType.id} value={workType.id}>
                    {workType.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <fieldset>
            <legend>{t("planning.demand.days")}</legend>
            <div>
              {days.map((day) => (
                <label key={day.date}>
                  <input
                    type="checkbox"
                    checked={dates.includes(day.date)}
                    onChange={() => setDates((current) =>
                      current.includes(day.date)
                        ? current.filter((date) => date !== day.date)
                        : [...current, day.date])}
                  />
                  <span>{shortDay(day.date, i18n.language)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label>
            <span>{t("planning.demand.requiredPeople")}</span>
            <input
              type="number"
              min="0"
              max="99"
              inputMode="numeric"
              value={workersDraft}
              onFocus={() => { if (!workersDirty) setWorkersDraft(""); }}
              onChange={(event) => {
                setWorkersDraft(event.target.value.replace(/[^0-9]/g, "").slice(0, 2));
                setWorkersDirty(true);
              }}
              onBlur={commitWorkers}
            />
          </label>
          <button
            type="submit"
            className="demand-actions__submit"
            disabled={applying || dates.length === 0 || !selectedType}
          >
            <Check aria-hidden="true" />
            {applying
              ? t("planning.demand.applying")
              : t("planning.demand.applyCount", { count: dates.length })}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function shortDay(value: string, language: string) {
  return new Intl.DateTimeFormat(language, { weekday: "short", day: "numeric" })
    .format(new Date(`${value}T12:00:00`));
}

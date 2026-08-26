import { AlertTriangle, Check, LoaderCircle, UserCheck, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "../../i18n";
import { normalizeLanguage } from "../../i18n/language";
import type {
  StaffingAssignmentCandidate,
  StaffingAssignmentCandidates,
  StaffingScheduleAssignment,
  StaffingScheduleDay,
  StaffingScheduleMember,
  StaffingScheduleRequirement,
} from "../../types/business-planning";
import { formatInterval, formatLongDate, formatMinutes } from "./schedule-grid";

type CandidateProps = {
  open: boolean;
  requirement: StaffingScheduleRequirement | null;
  replacingAssignment: StaffingScheduleAssignment | null;
  data: StaffingAssignmentCandidates | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  preferredMembershipId?: string | null;
  returnFocus: HTMLElement | null;
  onClose: () => void;
  onRetry: () => void;
  onAssign: (candidate: StaffingAssignmentCandidate) => void;
};

export function AssignmentCandidateInspector({
  open,
  requirement,
  replacingAssignment,
  data,
  loading,
  error,
  busy,
  preferredMembershipId = null,
  returnFocus,
  onClose,
  onRetry,
  onAssign,
}: CandidateProps) {
  const { t } = useTranslation("business");
  const locale = normalizeLanguage(i18n.resolvedLanguage);
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [warningConfirmed, setWarningConfirmed] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelectedId(preferredMembershipId);
    setWarningConfirmed(false);
    setQuery("");
    const frame = requestAnimationFrame(() => panelRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, preferredMembershipId, requirement?.requirementId]);

  useEffect(() => {
    if (!preferredMembershipId || !data?.candidates.some((candidate) =>
      candidate.membershipId === preferredMembershipId && candidate.eligibility !== "INELIGIBLE")) return;
    setSelectedId(preferredMembershipId);
  }, [data, preferredMembershipId]);

  useDialogFocus(open, panelRef, returnFocus, onClose);

  const selected = data?.candidates.find((candidate) => candidate.membershipId === selectedId) ?? null;
  const eligible = data?.candidates.filter((candidate) => candidate.eligibility !== "INELIGIBLE") ?? [];
  const visibleEligible = eligible.filter((candidate) => matchesCandidate(candidate.displayName, query));
  const ineligible = data?.candidates.filter((candidate) => candidate.eligibility === "INELIGIBLE") ?? [];
  const canConfirm = selected && selected.eligibility !== "INELIGIBLE"
    && (selected.eligibility !== "ELIGIBLE_WITH_WARNING" || warningConfirmed);

  if (!open || !requirement) return null;

  return (
    <div className="assignment-inspector">
      <button className="assignment-inspector__backdrop" type="button" aria-label={t("planning.close")} onClick={onClose} />
      <aside
        ref={panelRef}
        className="assignment-inspector__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header>
          <div>
            <span>{replacingAssignment ? t("planning.schedule.replaceKicker") : t("planning.schedule.recommendationKicker")}</span>
            <h2 id={titleId}>{requirement.workTypeName} · {formatLongDate(requirement.date, locale)}</h2>
            <p>{formatInterval(requirement.startTime, requirement.endTime)} · {t("planning.schedule.positionCoverage", {
              assigned: requirement.coverage.effectiveAssigned,
              required: requirement.requiredWorkers,
            })}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("planning.close")}><X aria-hidden="true" /></button>
        </header>

        {replacingAssignment ? (
          <div className="assignment-inspector__replace-note">
            {t("planning.schedule.replacing", { name: replacingAssignment.memberDisplayName })}
          </div>
        ) : null}

        {loading ? (
          <div className="assignment-inspector__loading" role="status">
            <LoaderCircle className="is-spinning" aria-hidden="true" />
            {t("planning.schedule.loadingCandidates")}
          </div>
        ) : null}
        {error ? (
          <div className="assignment-inspector__error" role="alert">
            <AlertTriangle aria-hidden="true" />
            <span>{error}</span>
            <button type="button" onClick={onRetry}>{t("planning.retry")}</button>
          </div>
        ) : null}

        {data && eligible.length === 0 ? (
          <div className="assignment-inspector__empty">
            <AlertTriangle aria-hidden="true" />
            <h3>{t("planning.schedule.noEligibleTitle")}</h3>
            <p>{t("planning.schedule.noEligibleDescription")}</p>
          </div>
        ) : null}

        {data && eligible.length > 0 ? (
          <div className="assignment-inspector__content">
            {selected ? (
              <section className="assignment-inspector__decision" aria-live="polite">
                <div>
                  <span>{t("planning.schedule.selectedPerson")}</span>
                  <strong>{selected.displayName}</strong>
                </div>
                {selected.reasons.length > 0 ? (
                  <div
                    className={`assignment-inspector__selection-reasons${selected.eligibility === "ELIGIBLE_WITH_WARNING" ? " is-warning" : ""}`}
                    role={selected.eligibility === "ELIGIBLE_WITH_WARNING" ? "alert" : undefined}
                  >
                    {selected.eligibility === "ELIGIBLE_WITH_WARNING" ? <AlertTriangle aria-hidden="true" /> : <Check aria-hidden="true" />}
                    <ul>
                      {selected.reasons.map((reason) => (
                        <li key={reason.code}>{candidateReason(t, reason.code, reason.parameters)}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {selected.eligibility === "ELIGIBLE_WITH_WARNING" ? (
                  <label className="assignment-inspector__warning-confirm">
                    <input
                      type="checkbox"
                      checked={warningConfirmed}
                      onChange={(event) => setWarningConfirmed(event.target.checked)}
                    />
                    <span>
                      <AlertTriangle aria-hidden="true" />
                      {t("planning.schedule.confirmWarning")}
                    </span>
                  </label>
                ) : null}
                {data.projection?.membershipId === selected.membershipId ? (
                  <div className="assignment-inspector__projection">
                    <span>{t("planning.schedule.coverageBefore")}</span>
                    <strong>{data.projection.before.effectiveAssigned}/{data.projection.before.required}</strong>
                    <i aria-hidden="true">→</i>
                    <span>{t("planning.schedule.coverageAfter")}</span>
                    <strong>{data.projection.after.effectiveAssigned}/{data.projection.after.required}</strong>
                  </div>
                ) : (
                  <p className="assignment-inspector__canonical-note">{t("planning.schedule.coverageAfterSave")}</p>
                )}
                <button
                  type="button"
                  className="assignment-inspector__confirm"
                  disabled={!canConfirm || busy}
                  aria-busy={busy}
                  onClick={() => selected && onAssign(selected)}
                >
                  {busy ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <UserCheck aria-hidden="true" />}
                  {busy
                    ? t("planning.schedule.assigning")
                    : replacingAssignment
                      ? t("planning.schedule.confirmReplacement")
                      : t("planning.schedule.assignPerson", { name: selected.displayName })}
                </button>
              </section>
            ) : null}

            <section aria-labelledby={`${titleId}-eligible`}>
              <div className="assignment-inspector__people-heading">
                <h3 id={`${titleId}-eligible`}>{t("planning.schedule.availablePeople")}</h3>
                <label className="assignment-inspector__search">
                  <span className="sr-only">{t("planning.schedule.searchPeople", { defaultValue: "Search people" })}</span>
                  <input
                    type="search"
                    value={query}
                    placeholder={t("planning.schedule.searchPeople", { defaultValue: "Search people" })}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
              </div>
              <div className="assignment-inspector__candidates">
                {visibleEligible.map((candidate) => (
                  <CandidateOption
                    key={candidate.membershipId}
                    candidate={candidate}
                    selected={candidate.membershipId === selectedId}
                    onSelect={() => {
                      if (candidate.membershipId === selectedId
                        && candidate.eligibility === "ELIGIBLE" && !busy) {
                        onAssign(candidate);
                        return;
                      }
                      setSelectedId(candidate.membershipId);
                      setWarningConfirmed(false);
                    }}
                  />
                ))}
              </div>
              {visibleEligible.length === 0 ? (
                <p className="assignment-inspector__no-search-results">{t("planning.schedule.noPeopleFound", { defaultValue: "No matching person." })}</p>
              ) : null}
            </section>

            {ineligible.length > 0 ? (
              <details className="assignment-inspector__ineligible">
                <summary>{t("planning.schedule.unavailablePeople", { count: ineligible.length })}</summary>
                <div>
                  {ineligible.map((candidate) => (
                    <CandidateOption key={candidate.membershipId} candidate={candidate} selected={false} disabled />
                  ))}
                </div>
              </details>
            ) : null}

            {data.limitations.length > 0 ? (
              <p className="assignment-inspector__limitations">{t("planning.schedule.recommendationLimits")}</p>
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

type RequirementPickerProps = {
  open: boolean;
  memberName: string | null;
  date: string | null;
  requirements: StaffingScheduleRequirement[];
  selectedRequirementId: string | null;
  checkingCandidate: boolean;
  busy: boolean;
  returnFocus: HTMLElement | null;
  onClose: () => void;
  onChoose: (requirement: StaffingScheduleRequirement) => void;
  onSetDayStatus: (type: "REST_DAY" | "SICK" | "VACATION") => void;
  currentDayStatus?: string | null;
  onRemoveDayStatus: () => void;
};

/** Starts the same assignment flow from an employee/day cell instead of an open position. */
export function MemberDayRequirementPicker({
  open,
  memberName,
  date,
  requirements,
  selectedRequirementId,
  checkingCandidate,
  busy,
  returnFocus,
  onClose,
  onChoose,
  onSetDayStatus,
  currentDayStatus,
  onRemoveDayStatus,
}: RequirementPickerProps) {
  const { t } = useTranslation("business");
  const locale = normalizeLanguage(i18n.resolvedLanguage);
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  useDialogFocus(open, panelRef, returnFocus, onClose);

  if (!open || !memberName || !date) return null;
  return (
    <div className="assignment-inspector">
      <button className="assignment-inspector__backdrop" type="button" aria-label={t("planning.close")} onClick={onClose} />
      <aside ref={panelRef} className="assignment-inspector__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header>
          <div>
            <span>{t("planning.schedule.assignToPerson", { defaultValue: "Assign work" })}</span>
            <h2 id={titleId}>{memberName}</h2>
            <p>{formatLongDate(date, locale)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("planning.close")}><X aria-hidden="true" /></button>
        </header>
        <section className="assignment-inspector__content">
          <div className="assignment-inspector__day-actions" aria-label="Day status">
            <button type="button" disabled={busy} onClick={() => onSetDayStatus("REST_DAY")}><strong>F</strong><span>{t("planning.schedule.status.REST_DAY")}</span></button>
            <button type="button" disabled={busy} onClick={() => onSetDayStatus("SICK")}><strong>K</strong><span>{t("planning.schedule.status.SICK")}</span></button>
            <button type="button" disabled={busy} onClick={() => onSetDayStatus("VACATION")}><strong>U</strong><span>{t("planning.schedule.status.VACATION")}</span></button>
          </div>
          {currentDayStatus ? (
            <button type="button" className="assignment-inspector__remove-status" disabled={busy} onClick={onRemoveDayStatus}>
              Clear {currentDayStatus}
            </button>
          ) : null}
          {requirements.length === 0 ? (
            <div className="assignment-inspector__empty">
              <AlertTriangle aria-hidden="true" />
              <h3>{t("planning.schedule.noOpenPositions")}</h3>
            </div>
          ) : (
            <div className="assignment-inspector__candidates assignment-inspector__requirements">
              {requirements.map((requirement) => (
                <button
                  type="button"
                  key={requirement.requirementId}
                  className={selectedRequirementId === requirement.requirementId ? "is-selected" : ""}
                  aria-pressed={selectedRequirementId === requirement.requirementId}
                  aria-label={t("planning.schedule.chooseRequirementForMember", {
                    code: requirement.workTypeName,
                    member: memberName,
                    date: formatLongDate(date, locale),
                    defaultValue: "Choose {{code}} for {{member}} on {{date}}",
                  })}
                  onClick={() => onChoose(requirement)}
                >
                  <strong>{requirement.workTypeName}</strong>
                  <small>{formatInterval(requirement.startTime, requirement.endTime)} · {t("planning.schedule.positionCoverage", {
                    assigned: requirement.coverage.effectiveAssigned,
                    required: requirement.requiredWorkers,
                  })}</small>
                  {selectedRequirementId === requirement.requirementId && checkingCandidate ? (
                    <small>{t("planning.schedule.loadingCandidates")}</small>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

type MemberWeekAssignmentPickerProps = {
  member: StaffingScheduleMember | null;
  days: StaffingScheduleDay[];
  busy: boolean;
  returnFocus: HTMLElement | null;
  onClose: () => void;
  onAssign: (requirements: StaffingScheduleRequirement[]) => void;
};

/** Assigns one work type to a person on several days with one atomic schedule mutation. */
export function MemberWeekAssignmentPicker({
  member,
  days,
  busy,
  returnFocus,
  onClose,
  onAssign,
}: MemberWeekAssignmentPickerProps) {
  const { t, i18n } = useTranslation("business");
  const locale = normalizeLanguage(i18n.resolvedLanguage);
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const open = Boolean(member);
  const workTypes = useMemo(() => {
    const unique = new Map<string, StaffingScheduleRequirement>();
    for (const day of days) {
      for (const requirement of day.requirements) unique.set(requirement.workTypeId, requirement);
    }
    return [...unique.values()];
  }, [days]);
  const [workTypeId, setWorkTypeId] = useState("");
  const [dates, setDates] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    setWorkTypeId(workTypes[0]?.workTypeId ?? "");
    setDates([]);
    const frame = requestAnimationFrame(() => panelRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, workTypes]);
  useDialogFocus(open, panelRef, returnFocus, onClose);

  if (!member) return null;
  const choices = days.map((day) => {
    const requirement = day.requirements.find((item) => item.workTypeId === workTypeId) ?? null;
    const absent = member.dayStatuses.some((status) => status.date === day.date);
    const alreadyAssigned = requirement?.assignments.some((assignment) =>
      assignment.membershipId === member.membershipId && assignment.status === "ASSIGNED") ?? false;
    return { day, requirement, disabled: !requirement || absent || alreadyAssigned };
  });
  const selectedRequirements = choices
    .filter((choice) => dates.includes(choice.day.date) && choice.requirement && !choice.disabled)
    .map((choice) => choice.requirement!);

  return (
    <div className="assignment-inspector">
      <button className="assignment-inspector__backdrop" type="button" aria-label={t("planning.close")} onClick={onClose} />
      <aside ref={panelRef} className="assignment-inspector__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header>
          <div>
            <span>{t("planning.schedule.assignWeekKicker", { defaultValue: "Weekly assignment" })}</span>
            <h2 id={titleId}>{member.displayName}</h2>
            <p>{t("planning.schedule.assignWeekHint", { defaultValue: "Choose an activity and the days to assign it." })}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("planning.close")}><X aria-hidden="true" /></button>
        </header>
        <section className="assignment-inspector__content assignment-inspector__week-assignment">
          {workTypes.length === 0 ? (
            <div className="assignment-inspector__empty">
              <AlertTriangle aria-hidden="true" />
              <h3>{t("planning.schedule.noOpenPositions")}</h3>
            </div>
          ) : (
            <>
              <label className="assignment-inspector__field">
                <span>{t("planning.demand.workType")}</span>
                <select value={workTypeId} onChange={(event) => setWorkTypeId(event.target.value)} disabled={busy}>
                  {workTypes.map((requirement) => (
                    <option key={requirement.workTypeId} value={requirement.workTypeId}>{requirement.workTypeName}</option>
                  ))}
                </select>
              </label>
              <fieldset className="assignment-inspector__week-days">
                <legend>{t("planning.demand.days")}</legend>
                {choices.map(({ day, requirement, disabled }) => (
                  <label key={day.date} data-disabled={disabled || undefined}>
                    <input
                      type="checkbox"
                      aria-label={formatLongDate(day.date, locale)}
                      checked={dates.includes(day.date)}
                      disabled={disabled || busy}
                      onChange={() => setDates((current) => current.includes(day.date)
                        ? current.filter((date) => date !== day.date)
                        : [...current, day.date])}
                    />
                    <span>
                      <strong>{new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(`${day.date}T12:00:00`))}</strong>
                      <small>{new Date(`${day.date}T12:00:00`).getDate()}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
              <button
                type="button"
                className="assignment-inspector__confirm"
                disabled={busy || selectedRequirements.length === 0}
                onClick={() => onAssign(selectedRequirements)}
              >
                {busy ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <UserCheck aria-hidden="true" />}
                {busy
                  ? t("planning.schedule.assigning")
                  : t("planning.schedule.assignWeekCount", { count: selectedRequirements.length, defaultValue: "Assign to {{count}} day(s)" })}
              </button>
            </>
          )}
        </section>
      </aside>
    </div>
  );
}

function CandidateOption({
  candidate,
  selected,
  disabled = false,
  onSelect,
}: {
  candidate: StaffingAssignmentCandidate;
  selected: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  const { t } = useTranslation("business");
  return (
    <button
      type="button"
      className={selected ? "is-selected" : ""}
      disabled={disabled}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="assignment-inspector__candidate-head">
        <strong>{candidate.displayName}</strong>
        {candidate.recommended ? <b><Check aria-hidden="true" />{t("planning.schedule.recommended")}</b> : null}
        {candidate.eligibility === "ELIGIBLE_WITH_WARNING" ? <b data-warning><AlertTriangle aria-hidden="true" />{t("planning.schedule.warning")}</b> : null}
      </span>
      <small>{formatMinutes(candidate.weeklyScheduledMinutes)} · {t("planning.schedule.weekScheduled")}</small>
      <ul>
        {candidate.reasons.slice(0, 3).map((reason) => (
          <li key={reason.code}>{candidateReason(t, reason.code, reason.parameters)}</li>
        ))}
      </ul>
    </button>
  );
}

function candidateReason(
  t: ReturnType<typeof useTranslation>["t"],
  code: string,
  parameters: Record<string, string>,
) {
  const key = `planning.schedule.candidateReasons.${code}`;
  return t(key, { ...parameters, defaultValue: code.replaceAll("_", " ").toLowerCase() });
}

function matchesCandidate(name: string, query: string) {
  return name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

type EditorProps = {
  assignment: StaffingScheduleAssignment | null;
  requirement: StaffingScheduleRequirement | null;
  busy: boolean;
  returnFocus: HTMLElement | null;
  onClose: () => void;
  onSave: (startTime: string | null, endTime: string | null) => void;
  onCancelAssignment: () => void;
  onReplace: () => void;
};

export function AssignmentEditor({
  assignment,
  requirement,
  busy,
  returnFocus,
  onClose,
  onSave,
  onCancelAssignment,
  onReplace,
}: EditorProps) {
  const { t } = useTranslation("business");
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const open = Boolean(assignment && requirement);

  useEffect(() => {
    if (!assignment) return;
    setStartTime(assignment.startTime?.slice(0, 5) ?? "");
    setEndTime(assignment.endTime?.slice(0, 5) ?? "");
    const frame = requestAnimationFrame(() => panelRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [assignment]);
  useDialogFocus(open, panelRef, returnFocus, onClose);

  if (!assignment || !requirement) return null;
  return (
    <div className="assignment-editor">
      <button className="assignment-editor__backdrop" type="button" aria-label={t("planning.close")} onClick={onClose} />
      <aside ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header>
          <div>
            <span>{t("planning.schedule.assignmentKicker")}</span>
            <h2 id={titleId}>{assignment.memberDisplayName}</h2>
            <p>{requirement.workTypeName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("planning.close")}><X aria-hidden="true" /></button>
        </header>
        <div className="assignment-editor__times">
          <label>{t("planning.demand.start")}<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>
          <label>{t("planning.demand.end")}<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>
        </div>
        <p>{t("planning.schedule.assignmentEditHint")}</p>
        <div className="assignment-editor__actions">
          <button type="button" onClick={onReplace} disabled={busy}>{t("planning.schedule.replacePerson")}</button>
          <button type="button" className="is-danger" onClick={onCancelAssignment} disabled={busy}>{t("planning.schedule.cancelAssignment")}</button>
          <button
            type="button"
            className="is-primary"
            disabled={busy || !startTime || !endTime || endTime <= startTime}
            aria-busy={busy}
            onClick={() => onSave(startTime || null, endTime || null)}
          >
            {busy ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : null}
            {busy ? t("planning.saving") : t("planning.save")}
          </button>
        </div>
      </aside>
    </div>
  );
}

function useDialogFocus(
  open: boolean,
  panelRef: React.RefObject<HTMLElement | null>,
  returnFocus: HTMLElement | null,
  onClose: () => void,
) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      requestAnimationFrame(() => returnFocus?.focus());
    };
  }, [open, panelRef, returnFocus]);
}

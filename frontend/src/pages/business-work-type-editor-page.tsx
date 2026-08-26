import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Clock3, Ruler, Tag, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  createBusinessWorkType,
  deactivateBusinessWorkType,
  getBusinessWorkType,
  listBusinessWorkTypes,
  updateBusinessWorkType,
  type BusinessWorkTypePayload,
} from "../api/endpoints";
import { getApiError } from "../api/api-errors";
import { SettingsConfirmDialog } from "../components/settings/settings-confirm-dialog";
import { SettingsSection } from "../components/settings/settings-section";
import { SettingsEmptyState } from "../components/settings/settings-empty-state";
import { SettingsFormActions } from "../components/settings/settings-form-actions";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { LockedModalViewport } from "../components/ui/locked-modal-viewport";
import { ModalPanel } from "../components/ui/modal-panel";
import type {
  BusinessCalculationMethod,
  BusinessWorkType,
} from "../types/business";
import { BusinessManagementShell } from "../components/business-planning/business-management-shell";
import "../styles/business-work-types.css";
type Mode = { key: string; method: BusinessCalculationMethod; icon: ReactNode };
const modes: Mode[] = [
  {
    key: "TIME_HOURLY",
    method: "TIME_BASED",
    icon: <Clock3 className="h-5 w-5" />,
  },
  {
    key: "UNITS_PER_HOUR",
    method: "UNITS_PER_HOUR_BASED",
    icon: <Ruler className="h-5 w-5" />,
  },
  {
    key: "UNITS_PER_UNIT",
    method: "UNIT_BASED",
    icon: <Tag className="h-5 w-5" />,
  },
  {
    key: "FIXED_AMOUNT",
    method: "FIXED_PRICE_BASED",
    icon: <Tag className="h-5 w-5" />,
  },
];
const workTypeColorPalette = ["#10b981", "#2563eb", "#7c3aed", "#db2777", "#ea580c", "#0891b2", "#65a30d", "#d97706"];

export function nextAvailableWorkTypeColor(workTypes: BusinessWorkType[]) {
  const used = new Set(workTypes.map((workType) => workType.color.toLowerCase()));
  return workTypeColorPalette.find((color) => !used.has(color)) ?? workTypeColorPalette[workTypes.length % workTypeColorPalette.length];
}
export function BusinessWorkTypeEditorPage() {
  return <BusinessManagementShell><BusinessWorkTypeEditorContent /></BusinessManagementShell>;
}

function BusinessWorkTypeEditorContent() {
  const { organizationId = "", workTypeId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation(["business", "settings", "common"]);
  const client = useQueryClient();
  const categoryCreation = search.get("category") === "true";
  const workTypesPath = `/business/${organizationId}/work-types`;
  const requestedReturnPath = search.get("returnTo");
  const hasReturnPath = isSafeReturnPath(requestedReturnPath, organizationId);
  const returnPath = hasReturnPath
    ? requestedReturnPath!
    : workTypesPath;
  const returnScrollY = parseReturnScroll(search.get("returnScroll"));
  const returnToOrigin = () => navigate(
    returnPath,
    returnScrollY === null ? undefined : { state: { restoreScrollY: returnScrollY } },
  );
  const selectedMode = modes.find((v) => v.key === search.get("mode"));
  const requestedParent = search.get("parentId") ?? "";
  const detail = useQuery({
    queryKey: ["staffing", organizationId, "types", workTypeId],
    queryFn: () => getBusinessWorkType(organizationId, workTypeId!),
    enabled: Boolean(workTypeId),
  });
  const all = useQuery({
    queryKey: ["staffing", organizationId, "types"],
    queryFn: () => listBusinessWorkTypes(organizationId),
  });
  const [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [unitId, setUnitId] = useState(""),
    [parentId, setParentId] = useState(requestedParent),
    [color, setColor] = useState("#10b981"),
    [unitLabel, setUnitLabel] = useState(""),
    [unitSymbol, setUnitSymbol] = useState(""),
    [unitsPerHour, setUnitsPerHour] = useState(""),
    [rate, setRate] = useState(""),
    [currency, setCurrency] = useState("EUR"),
    [defaultStartTime, setDefaultStartTime] = useState(""),
    [defaultEndTime, setDefaultEndTime] = useState(""),
    [breakMinutes, setBreakMinutes] = useState("30");
  const [method, setMethod] = useState<BusinessCalculationMethod>(
      selectedMode?.method ?? "TIME_BASED",
    ),
    [advanced, setAdvanced] = useState(false),
    [teamwork, setTeamwork] = useState(false),
    [extraPay, setExtraPay] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const colorWasChosen = useRef(false);
  const [childEditor, setChildEditor] = useState<
    BusinessWorkType | null | undefined
  >(undefined);
  useEffect(() => {
    const v = detail.data;
    if (!v) return;
    setName(editableFullName(v));
    setCode(v.code);
    setUnitId(v.unitId ?? "");
    setParentId(v.parentId ?? "");
    setColor(v.color);
    setMethod(v.calculationMethod);
    setUnitLabel(v.unitLabel ?? "");
    setUnitSymbol(v.unitSymbol ?? "");
    setUnitsPerHour(v.unitsPerHour?.toString() ?? "");
    setRate(v.ratePerUnit?.toString() ?? "");
    setCurrency(v.currency ?? "EUR");
    setDefaultStartTime(v.defaultStartTime?.slice(0, 5) ?? "");
    setDefaultEndTime(v.defaultEndTime?.slice(0, 5) ?? "");
    setBreakMinutes(String(v.defaultBreakMinutes));
    setTeamwork(v.teamworkEnabled);
    setExtraPay(v.extraPayEnabled);
  }, [detail.data]);
  useEffect(() => {
    if (selectedMode) setMethod(selectedMode.method);
  }, [selectedMode]);
  useEffect(() => {
    if (workTypeId) return;
    setName("");
    setCode("");
    setUnitId("");
    setParentId(requestedParent);
    colorWasChosen.current = false;
    setColor("#10b981");
    setUnitLabel("");
    setUnitSymbol("");
    setUnitsPerHour("");
    setRate("");
    setCurrency("EUR");
    setDefaultStartTime("");
    setDefaultEndTime("");
    setBreakMinutes("30");
    setAdvanced(false);
    setTeamwork(false);
    setExtraPay(false);
  }, [workTypeId, requestedParent]);
  useEffect(() => {
    if (workTypeId || colorWasChosen.current || !all.data) return;
    setColor(nextAvailableWorkTypeColor(all.data));
  }, [all.data, workTypeId]);
  const isCategory = categoryCreation || Boolean(detail.data?.compositeEnabled);
  const children = (all.data ?? []).filter((v) => v.parentId === workTypeId);
  const requestedParentType = (all.data ?? []).find(
    (v) => v.id === requestedParent,
  );
  const selectedParentType = (all.data ?? []).find((v) => v.id === parentId);
  const effectiveMethod =
    selectedParentType?.calculationMethod ?? selectedMode?.method ?? method;
  useEffect(() => {
    if (requestedParentType) {
      setParentId(requestedParentType.id);
      setMethod(requestedParentType.calculationMethod);
    }
  }, [requestedParentType]);
  const payload = (): BusinessWorkTypePayload => ({
    unitId: unitId || null,
    parentId: parentId || null,
    code: code.trim().toUpperCase(),
    name: name.trim() || code.trim().toUpperCase(),
    color,
    defaultStartTime: defaultStartTime || null,
    defaultEndTime: defaultEndTime || null,
    defaultBreakMinutes:
      effectiveMethod === "TIME_BASED" ? Number(breakMinutes || 0) : 0,
    calculationMethod: effectiveMethod,
    compensationMethod:
      effectiveMethod === "UNIT_BASED" ? "PER_UNIT" : "HOURLY",
    unitLabel: unitLabel || null,
    unitSymbol: unitSymbol || null,
    unitsPerHour: unitsPerHour ? Number(unitsPerHour) : null,
    ratePerUnit: rate ? Number(rate) : null,
    currency: rate ? currency.toUpperCase() : null,
    teamworkEnabled: teamwork,
    extraPayEnabled: extraPay,
    compositeEnabled: isCategory,
    displayOrder: detail.data?.displayOrder ?? 0,
    active: true,
  });
  const save = useMutation({
    mutationFn: () =>
      workTypeId
        ? updateBusinessWorkType(organizationId, workTypeId, payload())
        : createBusinessWorkType(organizationId, payload()),
    onSuccess: async (value) => {
      await client.invalidateQueries({
        queryKey: ["staffing", organizationId, "types"],
      });
      await client.invalidateQueries({
        queryKey: ["organizations", organizationId, "work-types"],
      });
      if (hasReturnPath) {
        returnToOrigin();
        return;
      }
      navigate(value.compositeEnabled ? `/business/${organizationId}/work-types/${value.id}` : returnPath);
    },
  });
  const remove = useMutation({
    mutationFn: () => deactivateBusinessWorkType(organizationId, workTypeId!),
    onSuccess: returnToOrigin,
  });
  if (!workTypeId && requestedParent && all.isLoading) {
    return (
      <div className="py-16 text-center text-white/45">{t("loading")}</div>
    );
  }
  if (!workTypeId && !selectedMode && !requestedParentType)
    return (
      <Shell
        title={t(
          categoryCreation
            ? "workTypes.chooseCategoryMode"
            : "workTypes.chooseMode",
        )}
        back={returnToOrigin}
        t={t}
      >
        <div className="space-y-3">
          {modes.map((option) => (
            <button
              key={option.key}
              onClick={() =>
                navigate(
                  `/business/${organizationId}/work-types/new?${categoryCreation ? "category=true&" : ""}mode=${option.key}${requestedParent ? `&parentId=${requestedParent}` : ""}`,
                  { replace: true },
                )
              }
              className="w-full rounded-[22px] border border-white/[0.08] bg-white/[0.045] p-4 text-left"
            >
              <span className="flex items-center gap-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.07] text-white/72">
                  {option.icon}
                </span>
                <span>
                  <strong className="block text-[.95rem] text-white">
                    {t(`workTypes.methods.${option.method}`)}
                  </strong>
                  <span className="mt-1.5 block text-xs leading-[1.15rem] text-white/48">
                    {t(`workTypes.methodDescriptions.${option.method}`)}
                  </span>
                </span>
              </span>
            </button>
          ))}
        </div>
      </Shell>
    );
  return (
    <Shell
      title={
        detail.data?.name ??
        t(isCategory ? "workTypes.categoryTitle" : "workTypes.newTitle")
      }
      back={returnToOrigin}
      t={t}
    >
      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <SettingsSection title={t("workTypes.nameSection")}>
          <div className="space-y-3">
            <Input
              label={t("workTypeEditor.shortName")}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={20}
              required
              placeholder={t("workTypeEditor.shortNamePlaceholder")}
            />
            <Input
              label={t(isCategory ? "workTypes.categoryName" : "workTypeEditor.fullName")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("workTypeEditor.namePlaceholder")}
            />
            <p className="text-xs leading-5 text-white/45">{t("workTypeEditor.nameHint")}</p>
            {!isCategory && selectedParentType ? (
              <div className="rounded-[22px] border border-emerald-400/15 bg-emerald-400/[0.07] px-4 py-3">
                <span className="block text-xs text-white/45">
                  {t("workTypes.category")}
                </span>
                <strong className="mt-1 block text-sm text-emerald-200">
                  {selectedParentType.name} ·{" "}
                  {t(
                    `workTypes.methods.${selectedParentType.calculationMethod}`,
                  )}
                </strong>
              </div>
            ) : null}
          </div>
        </SettingsSection>
        {isCategory ? (
          <SettingsSection title={t("workTypes.categoryOptions")}>
            <p className="mb-3 text-sm leading-6 text-white/54">
              {t("workTypes.categoryHint")}
            </p>
            <Checks
              teamwork={teamwork}
              setTeamwork={setTeamwork}
              extraPay={extraPay}
              setExtraPay={setExtraPay}
              t={t}
            />
          </SettingsSection>
        ) : (
          <SettingsSection title={t(`workTypes.methods.${effectiveMethod}`)}>
            <div className="space-y-4">
              {effectiveMethod === "TIME_BASED" ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      label={t("workTypeEditor.defaultStart")}
                      type="time"
                      value={defaultStartTime}
                      onChange={(e) => setDefaultStartTime(e.target.value)}
                    />
                    <Input
                      label={t("workTypeEditor.defaultEnd")}
                      type="time"
                      value={defaultEndTime}
                      onChange={(e) => setDefaultEndTime(e.target.value)}
                    />
                  </div>
                  <Input
                    label={t("workTypeEditor.defaultBreak")}
                    type="number"
                    min="0"
                    value={breakMinutes}
                    onChange={(e) => setBreakMinutes(e.target.value)}
                  />
                </div>
              ) : null}
              {effectiveMethod === "UNITS_PER_HOUR_BASED" ? (
                <Input
                  label={t("workTypes.unitsPerHour")}
                  inputMode="decimal"
                  value={unitsPerHour}
                  onChange={(e) => setUnitsPerHour(e.target.value)}
                />
              ) : null}
              {effectiveMethod === "UNIT_BASED" ? (
                <div className="grid grid-cols-[1fr_5.5rem] gap-3">
                  <Input
                    label={t("workTypes.rate")}
                    inputMode="decimal"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                  />
                  <Input
                    label={t("workTypes.currency")}
                    maxLength={3}
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  />
                </div>
              ) : null}
              {effectiveMethod !== "TIME_BASED" &&
              effectiveMethod !== "FIXED_PRICE_BASED" ? (
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label={t("workTypes.unitLabel")}
                    value={unitLabel}
                    onChange={(e) => setUnitLabel(e.target.value)}
                  />
                  <Input
                    label={t("workTypes.unitSymbol")}
                    value={unitSymbol}
                    onChange={(e) => setUnitSymbol(e.target.value)}
                  />
                </div>
              ) : null}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setAdvanced((v) => !v)}
                  className="flex min-h-12 flex-1 items-center justify-between rounded-[22px] border border-white/[0.08] bg-white/[0.025] px-4 py-3 text-sm font-semibold text-white/64"
                >
                  {t("workTypes.advanced")}
                  <ChevronDown
                    className={`h-4 w-4 transition ${advanced ? "rotate-180" : ""}`}
                  />
                </button>
                <input
                  type="color"
                  aria-label={t("workTypeEditor.color")}
                  value={color}
                  onChange={(e) => {
                    colorWasChosen.current = true;
                    setColor(e.target.value);
                  }}
                  className="h-12 w-12 cursor-pointer overflow-hidden rounded-full border-2 border-white/20 bg-transparent p-0"
                />
              </div>
              {advanced ? (
                <Checks
                  teamwork={teamwork}
                  setTeamwork={setTeamwork}
                  extraPay={extraPay}
                  setExtraPay={setExtraPay}
                  t={t}
                />
              ) : null}
            </div>
          </SettingsSection>
        )}
        {workTypeId && isCategory ? (
          <SettingsSection title={t("workTypes.inCategory")}>
            <div className="space-y-3">
              {children.map((child) => (
                <Card
                  as="button"
                  key={child.id}
                  type="button"
                  onClick={() => setChildEditor(child)}
                  className="flex w-full items-center justify-between px-5 py-4 text-left"
                >
                  <span>
                    <strong className="text-white">{child.name}</strong>
                    <span className="mt-1 block text-xs text-white/45">
                      {t(`workTypes.methods.${child.calculationMethod}`)}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-white/25" />
                </Card>
              ))}
              {!children.length ? (
                <SettingsEmptyState
                  title={t("settings:workTypeFormulas.emptyTitle")}
                  description={t("settings:workTypeFormulas.emptyDescription")}
                  actionLabel={t("settings:workSetup.addWorkType")}
                  onAction={() => setChildEditor(null)}
                />
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={() => setChildEditor(null)}
                >
                  {t("settings:workSetup.addWorkType")}
                </Button>
              )}
            </div>
          </SettingsSection>
        ) : null}
        {save.error || remove.error ? (
          <p
            role="alert"
            className="rounded-[22px] border border-red-400/20 bg-red-400/[0.08] px-4 py-3 text-sm text-red-100"
          >
            {getApiError(save.error ?? remove.error).message}
          </p>
        ) : null}
        <SettingsFormActions
          submitting={save.isPending}
          submitLabel={
            workTypeId
              ? undefined
              : t(
                  isCategory
                    ? "settings:workTypeEditor.createCategory"
                    : "settings:workTypeEditor.addActivity",
                )
          }
          submitDisabled={
            !code.trim() ||
            (effectiveMethod === "UNITS_PER_HOUR_BASED" &&
              !isCategory &&
              !Number(unitsPerHour)) ||
            (effectiveMethod === "UNIT_BASED" && !isCategory && !Number(rate)) ||
            (effectiveMethod === "TIME_BASED" && !isCategory &&
              defaultEndTime && !defaultStartTime)
          }
          onDelete={workTypeId ? () => setConfirmDeactivate(true) : undefined}
          deleteLabel={
            workTypeId ? t("settings:workTypeEditor.delete") : undefined
          }
          deleteDisabled={remove.isPending}
        />
      </form>
      <SettingsConfirmDialog
        open={confirmDeactivate}
        title={t("workTypes.deleteConfirmTitle", {
          defaultValue: "Delete work type?",
        })}
        description={t("workTypes.deleteConfirmDescription", {
          defaultValue: isCategory
            ? "An empty category is deleted. A category with work types is deactivated, so existing schedule history remains available."
            : "An unused work type is deleted. If it is already used in a plan, it is deactivated so existing schedule history remains available.",
        })}
        confirmLabel={t("settings:workTypeEditor.delete")}
        pending={remove.isPending}
        onCancel={() => setConfirmDeactivate(false)}
        onConfirm={() => remove.mutate()}
      />
      {childEditor !== undefined && detail.data ? (
        <BusinessChildWorkTypeDialog
          organizationId={organizationId}
          parent={detail.data}
          value={childEditor}
          onClose={() => setChildEditor(undefined)}
          onSaved={async () => {
            await client.invalidateQueries({
              queryKey: ["staffing", organizationId, "types"],
            });
            setChildEditor(undefined);
          }}
          t={t}
        />
      ) : null}
    </Shell>
  );
}
function Shell({
  title,
  back,
  children,
  t,
}: {
  title: string;
  back: () => void;
  children: ReactNode;
  t: (key: string) => string;
}) {
  return (
    <div className="business-admin business-work-type-editor mx-auto w-full max-w-[760px] pb-10">
      <header className="business-work-type-editor__header">
        <button type="button" className="business-admin__secondary" onClick={back}>← {t("back")}</button>
        <div>
          <p>WORK TYPES</p>
          <h1>{title}</h1>
        </div>
      </header>
      {children}
    </div>
  );
}
function Checks({
  teamwork,
  setTeamwork,
  extraPay,
  setExtraPay,
  t,
}: {
  teamwork: boolean;
  setTeamwork: (v: boolean) => void;
  extraPay: boolean;
  setExtraPay: (v: boolean) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-3 rounded-[22px] border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm text-white/64">
        <input
          type="checkbox"
          checked={teamwork}
          onChange={(e) => setTeamwork(e.target.checked)}
          className="h-4 w-4 accent-emerald-500"
        />
        <strong className="text-white/78">{t("workTypes.teamwork")}</strong>
      </label>
      <label className="flex items-center gap-3 rounded-[22px] border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm text-white/64">
        <input
          type="checkbox"
          checked={extraPay}
          onChange={(e) => setExtraPay(e.target.checked)}
          className="h-4 w-4 accent-emerald-500"
        />
        <strong className="text-white/78">{t("workTypes.extraPay")}</strong>
      </label>
    </div>
  );
}

function BusinessChildWorkTypeDialog({
  organizationId,
  parent,
  value,
  onClose,
  onSaved,
  t,
}: {
  organizationId: string;
  parent: BusinessWorkType;
  value: BusinessWorkType | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const [code, setCode] = useState(value?.code ?? "");
  const [name, setName] = useState(editableFullName(value));
  const [breakMinutes, setBreakMinutes] = useState(
    String(value?.defaultBreakMinutes ?? 30),
  );
  const [unitsPerHour, setUnitsPerHour] = useState(
    value?.unitsPerHour?.toString() ?? "",
  );
  const [rate, setRate] = useState(value?.ratePerUnit?.toString() ?? "");
  const [currency, setCurrency] = useState(value?.currency ?? "EUR");
  const [unitLabel, setUnitLabel] = useState(value?.unitLabel ?? "");
  const [unitSymbol, setUnitSymbol] = useState(value?.unitSymbol ?? "");
  const method = parent.calculationMethod;
  const childPayload = (): BusinessWorkTypePayload => ({
    unitId: parent.unitId,
    parentId: parent.id,
    code: code.trim().toUpperCase(),
    name: name.trim() || code.trim().toUpperCase(),
    color: parent.color,
    defaultStartTime: null,
    defaultEndTime: null,
    defaultBreakMinutes:
      method === "TIME_BASED" ? Number(breakMinutes || 0) : 0,
    calculationMethod: method,
    compensationMethod: method === "UNIT_BASED" ? "PER_UNIT" : "HOURLY",
    unitLabel: unitLabel.trim() || null,
    unitSymbol: unitSymbol.trim() || null,
    unitsPerHour: unitsPerHour ? Number(unitsPerHour.replace(",", ".")) : null,
    ratePerUnit: rate ? Number(rate.replace(",", ".")) : null,
    currency: method === "UNIT_BASED" ? currency.toUpperCase() : null,
    teamworkEnabled: parent.teamworkEnabled,
    extraPayEnabled: parent.extraPayEnabled,
    compositeEnabled: false,
    displayOrder: value?.displayOrder ?? 0,
    active: true,
  });
  const save = useMutation({
    mutationFn: () =>
      value
        ? updateBusinessWorkType(organizationId, value.id, childPayload())
        : createBusinessWorkType(organizationId, childPayload()),
    onSuccess: onSaved,
  });
  const remove = useMutation({
    mutationFn: () =>
      deactivateBusinessWorkType(organizationId, value?.id ?? ""),
    onSuccess: onSaved,
  });
  const invalid =
    !code.trim() ||
    (method === "UNITS_PER_HOUR_BASED" &&
      !(Number(unitsPerHour.replace(",", ".")) > 0)) ||
    (method === "UNIT_BASED" &&
      (!(Number(rate.replace(",", ".")) > 0) || currency.length !== 3));

  return (
    <LockedModalViewport
      className="z-[70] bg-black/60 px-4 py-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <ModalPanel className="max-w-md">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.05em] text-white">
              {t(
                value
                  ? "settings:workTypeFormulas.editTitle"
                  : "settings:workTypeFormulas.addTitle",
              )}
            </h2>
            <p className="mt-1 text-sm text-white/45">
              {t(`business:workTypes.methods.${method}`)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-white/50">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!invalid) save.mutate();
          }}
        >
          <Input
            label={t("business:workTypeEditor.shortName")}
            value={code}
            maxLength={20}
            required
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <Input
            label={t("business:workTypeEditor.fullName")}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {method === "TIME_BASED" ? (
            <Input
              type="number"
              min="0"
              label={t("settings:workTypeFormulas.fields.defaultBreakMinutes")}
              value={breakMinutes}
              onChange={(event) => setBreakMinutes(event.target.value)}
            />
          ) : null}
          {method === "UNITS_PER_HOUR_BASED" ? (
            <Input
              inputMode="decimal"
              label={t("settings:workTypeFormulas.fields.unitsPerHour")}
              value={unitsPerHour}
              onChange={(event) => setUnitsPerHour(event.target.value)}
            />
          ) : null}
          {method === "UNIT_BASED" ? (
            <div className="grid grid-cols-[1fr_5.5rem] gap-3">
              <Input
                inputMode="decimal"
                label={t("settings:workTypeFormulas.fields.ratePerUnit")}
                value={rate}
                onChange={(event) => setRate(event.target.value)}
              />
              <Input
                maxLength={3}
                label={t("settings:workTypeFormulas.fields.currency")}
                value={currency}
                onChange={(event) =>
                  setCurrency(event.target.value.toUpperCase())
                }
              />
            </div>
          ) : null}
          {method !== "TIME_BASED" && method !== "FIXED_PRICE_BASED" ? (
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t("settings:workTypeFormulas.fields.unitLabel")}
                value={unitLabel}
                onChange={(event) => setUnitLabel(event.target.value)}
              />
              <Input
                label={t("settings:workTypeFormulas.fields.unitSymbol")}
                value={unitSymbol}
                onChange={(event) => setUnitSymbol(event.target.value)}
              />
            </div>
          ) : null}
          {save.error || remove.error ? (
            <p role="alert" className="text-sm text-red-200">
              {getApiError(save.error ?? remove.error).message}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-between">
            {value ? (
              <Button
                type="button"
                variant="secondary"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
                className="border-red-400/18 bg-red-400/[0.05] text-white"
              >
                {t("settings:workTypeFormulas.deactivate")}
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" disabled={invalid || save.isPending}>
              {t("common:actions.save")}
            </Button>
          </div>
        </form>
      </ModalPanel>
    </LockedModalViewport>
  );
}

function editableFullName(value: BusinessWorkType | null | undefined) {
  // An older generated type stored its abbreviation as the name.  Show that
  // to the manager as an intentionally empty optional full-name field.
  return value && value.name !== value.code ? value.name : "";
}

function isSafeReturnPath(value: string | null, organizationId: string) {
  return value?.startsWith(`/business/${organizationId}/plan/demand?`) ?? false;
}

function parseReturnScroll(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100_000
    ? Math.round(parsed)
    : null;
}

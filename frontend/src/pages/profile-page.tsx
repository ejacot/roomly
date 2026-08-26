import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CalendarClock,
  CircleHelp,
  FileDown,
  FileUp,
  Globe2,
  Info,
  LogOut,
  Palette,
  Search,
  ShieldCheck
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { queryKeys } from "../api/query-keys";
import { getPreferences, getProfile, listEmployments } from "../api/endpoints";
import { useAuth } from "../features/auth/use-auth";
import { SettingsGroup, SettingsRow } from "../components/settings/settings-group";
import { SettingsProfileCard } from "../components/settings/settings-profile-card";
import { getNativeLanguageName, normalizeLanguage } from "../i18n/language";
import { useSafeBackNavigation } from "../hooks/use-safe-back-navigation";
import { APP_HOME_PATH } from "../routes/app-paths";
import { useWorkspace } from "../contexts/workspace-context";

type ProfilePageProps = {
  embedded?: boolean;
};

export function ProfilePage({ embedded = false }: ProfilePageProps) {
  const { t } = useTranslation(["settings", "common"]);
  const { user, logout } = useAuth();
  const { organizations } = useWorkspace();
  const safeBack = useSafeBackNavigation({ fallback: APP_HOME_PATH });
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const largeTitleRef = useRef<HTMLHeadingElement | null>(null);
  const [compactTitleVisible, setCompactTitleVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const profileQuery = useQuery({
    queryKey: queryKeys.profile(),
    queryFn: getProfile,
    initialData: user?.profile ?? undefined
  });
  const preferencesQuery = useQuery({
    queryKey: queryKeys.preferences(),
    queryFn: getPreferences,
    initialData: user?.preferences ?? undefined
  });
  const employmentsQuery = useQuery({
    queryKey: queryKeys.employments.all(),
    queryFn: listEmployments
  });

  const profile = profileQuery.data ?? user?.profile ?? null;
  const preferences = preferencesQuery.data ?? user?.preferences ?? null;

  const fullName = useMemo(() => {
    const composed = [profile?.firstName, profile?.lastName]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join(" ");

    return composed || profile?.displayName?.trim() || user?.account.email || "Alveryn";
  }, [profile?.displayName, profile?.firstName, profile?.lastName, user?.account.email]);

  const initials = useMemo(() => {
    const source =
      [profile?.firstName, profile?.lastName]
        .map((value) => value?.trim())
        .filter(Boolean)
        .slice(0, 2)
        .map((value) => value?.charAt(0).toUpperCase())
        .join("") ||
      user?.account.email.slice(0, 2).toUpperCase() ||
      "RM";

    return source;
  }, [profile?.firstName, profile?.lastName, user?.account.email]);

  const activeEmployments = useMemo(
    () => (employmentsQuery.data ?? []).filter((employment) => employment.active),
    [employmentsQuery.data]
  );
  const businessWorkspace = useMemo(
    () => organizations.find((workspace) => workspace.type === "BUSINESS") ?? null,
    [organizations]
  );
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const matchesSearch = (...values: string[]) =>
    !normalizedSearch || values.some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
  const showWork = matchesSearch(t("settings:workEmployments"), t("settings:employment.settingsTitle"));
  const showPreferences = matchesSearch(
    t("settings:appearanceRegion"),
    t("settings:preferencesSections.region"),
    t("settings:preferencesSections.dateTime"),
    t("settings:preferencesSections.appearance")
  );
  const showData = matchesSearch(
    t("settings:dataDocuments"),
    t("settings:dataImport.menuLabel"),
    t("settings:pdfExport.menuLabel")
  );
  const showSupport = matchesSearch(t("settings:support"), t("settings:about"), t("settings:help"));
  const showAccount = matchesSearch(t("settings:account"), t("settings:logout"));

  useEffect(() => {
    let frameId = 0;

    const updateCompactTitle = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const titleRect = largeTitleRef.current?.getBoundingClientRect();
        const buttonRect = backButtonRef.current?.getBoundingClientRect();

        if (!titleRect || !buttonRect) {
          setCompactTitleVisible(false);
          return;
        }

        setCompactTitleVisible(titleRect.top <= buttonRect.top);
      });
    };

    updateCompactTitle();
    window.addEventListener("scroll", updateCompactTitle, { passive: true });
    window.addEventListener("resize", updateCompactTitle);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", updateCompactTitle);
      window.removeEventListener("resize", updateCompactTitle);
    };
  }, []);

  return (
    <div
      className={
        embedded
          ? "settings-master-content w-full space-y-5 px-5 pb-10 pt-5"
          : "personal-settings-page mx-auto w-full max-w-[760px] space-y-6 pb-10 pt-0"
      }
    >
      {embedded ? (
        <header className="flex min-h-12 items-center gap-3">
          <button
            type="button"
            onClick={safeBack}
            aria-label={t("common:actions.back")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white/64 transition hover:bg-white/[0.06] hover:text-white"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <h1 className="text-[1.55rem] font-semibold tracking-[-0.055em] text-white">
            {t("settings:title")}
          </h1>
        </header>
      ) : (
        <header className="settings-sticky-header dashboard-sticky-header settings-page-sticky-header fixed inset-x-0 top-0 z-40 mx-auto flex w-full max-w-[560px] items-start px-5 pt-2">
        <button
          ref={backButtonRef}
          type="button"
          onClick={safeBack}
          aria-label={t("common:actions.back")}
          className="settings-sticky-header-control flex h-9 items-center gap-1.5 rounded-md px-0 text-[1rem] font-bold leading-none tracking-[-0.035em] text-white transition active:scale-95 focus:outline-none focus:ring-2 focus:ring-white/24"
        >
          <ArrowLeft className="h-[1.22rem] w-[1.22rem]" aria-hidden="true" />
          <span>{t("common:actions.back")}</span>
        </button>
        <div
          className={`settings-sticky-header-title pointer-events-none absolute left-1/2 flex h-9 -translate-x-1/2 items-center text-[1rem] font-bold leading-none tracking-[-0.035em] text-white transition duration-300 ${
            compactTitleVisible ? "translate-y-0 opacity-100 delay-100" : "translate-y-1 opacity-0 delay-0"
          }`}
          aria-hidden="true"
        >
          {t("settings:title")}
        </div>
        </header>
      )}

      {!embedded ? (
        <h1
          ref={largeTitleRef}
          className={`text-[2.25rem] font-semibold leading-none tracking-[-0.06em] text-white transition duration-200 ${
            compactTitleVisible ? "-translate-y-1 opacity-0" : "translate-y-0 opacity-100 delay-75"
          }`}
        >
          {t("settings:title")}
        </h1>
      ) : null}

      {!embedded ? (
        <div className="personal-settings-page__intro">
          <span>PERSONAL · ACCOUNT</span>
          <h1>Account and settings.</h1>
          <p>Manage your workspaces, preferences and personal data in one place.</p>
        </div>
      ) : null}

      <SettingsProfileCard
        initials={initials}
        fullName={fullName}
        email={user?.account.email ?? ""}
        ariaLabel={t("settings:profile")}
      />

      <label className="relative block">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" aria-hidden="true" />
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.currentTarget.value)}
          placeholder={t("settings:searchPlaceholder")}
          aria-label={t("settings:searchPlaceholder")}
          className="h-12 w-full rounded-[18px] border border-white/[0.08] bg-white/[0.045] pl-11 pr-4 text-sm text-white outline-none backdrop-blur-xl transition placeholder:text-white/28 focus:border-[#10b981]/25 focus:bg-white/[0.065] focus:ring-2 focus:ring-[#10b981]/12"
        />
      </label>

      {showWork ? <SettingsGroup
        title={t("settings:workEmployments")}
        icon={<BriefcaseBusiness className="h-3.5 w-3.5" />}
      >
        <SettingsRow
          to={activeEmployments.length === 1 ? `/settings/employment/${activeEmployments[0].id}` : "/settings/employment"}
          label={t("settings:employment.settingsTitle")}
          icon={<BriefcaseBusiness className="h-[18px] w-[18px]" />}
          iconClassName="bg-[#10b981]/[0.08] text-[#34d399]"
        />
        <div className="mx-5 h-px bg-white/[0.06]" />
        <SettingsRow
          to={businessWorkspace ? `/business/${businessWorkspace.id}/overview` : "/business"}
          label={t("common:nav.business")}
          icon={<BriefcaseBusiness className="h-[18px] w-[18px]" />}
          iconClassName="bg-sky-400/[0.09] text-sky-200/80"
        />
      </SettingsGroup> : null}

      {showPreferences ? <SettingsGroup
        title={t("settings:appearanceRegion")}
        icon={<Palette className="h-3.5 w-3.5" />}
      >
        <SettingsRow
          to="/settings/preferences?section=region"
          label={t("settings:preferencesSections.region")}
          value={formatLanguage(preferences?.language)}
          icon={<Globe2 className="h-[18px] w-[18px]" />}
          iconClassName="bg-sky-400/[0.09] text-sky-200/80"
        />
        <div className="mx-5 h-px bg-white/[0.06]" />
        <SettingsRow
          to="/settings/preferences?section=date-time"
          label={t("settings:preferencesSections.dateTime")}
          value={preferences?.timeFormat === "H12" ? t("settings:preferencesOptions.time12") : t("settings:preferencesOptions.time24")}
          icon={<CalendarClock className="h-[18px] w-[18px]" />}
          iconClassName="bg-violet-400/[0.09] text-violet-200/80"
        />
        <div className="mx-5 h-px bg-white/[0.06]" />
        <SettingsRow
          to="/settings/preferences?section=appearance"
          label={t("settings:preferencesSections.appearance")}
          value={t(`settings:preferencesOptions.${themeTranslationKey(preferences?.theme)}`)}
          icon={<Palette className="h-[18px] w-[18px]" />}
          iconClassName="bg-[#10b981]/[0.09] text-[#34d399]"
        />
      </SettingsGroup> : null}

      {showData ? <SettingsGroup title={t("settings:dataDocuments")} icon={<ShieldCheck className="h-3.5 w-3.5" />}>
        <SettingsRow
          to="/settings/import-data"
          label={t("settings:dataImport.menuLabel")}
          description={t("settings:dataImport.menuDescription")}
          icon={<FileUp className="h-[18px] w-[18px]" />}
          iconClassName="bg-emerald-400/[0.09] text-emerald-200/80"
        />
        <div className="mx-5 h-px bg-white/[0.06]" />
        <SettingsRow
          to="/settings/export-pdf"
          label={t("settings:pdfExport.menuLabel")}
          description={t("settings:pageInfo.pdfExport.description")}
          icon={<FileDown className="h-[18px] w-[18px]" />}
          iconClassName="bg-blue-400/[0.09] text-blue-200/80"
        />
      </SettingsGroup> : null}

      {showSupport ? <SettingsGroup title={t("settings:support")} icon={<CircleHelp className="h-3.5 w-3.5" />}>
        <SettingsRow to="/settings/about" label={t("settings:about")} icon={<Info className="h-[18px] w-[18px]" />} />
        <div className="mx-5 h-px bg-white/[0.06]" />
        <SettingsRow to="/settings/help" label={t("settings:help")} icon={<CircleHelp className="h-[18px] w-[18px]" />} />
      </SettingsGroup> : null}

      {showAccount ? <SettingsGroup title={t("settings:account")}>
        <SettingsRow
          label={t("settings:logout")}
          onClick={() => void logout()}
          destructive
          icon={<LogOut className="h-[18px] w-[18px]" />}
          iconClassName="bg-red-400/[0.08] text-red-200/75"
        />
      </SettingsGroup> : null}

      {normalizedSearch && !showWork && !showPreferences && !showData && !showSupport && !showAccount ? (
        <p className="py-10 text-center text-sm text-white/38">{t("settings:noSearchResults")}</p>
      ) : null}
    </div>
  );
}

function formatLanguage(value?: string | null) {
  return getNativeLanguageName(normalizeLanguage(value));
}

function themeTranslationKey(theme?: string | null) {
  if (theme === "LIGHT") return "lightTheme";
  if (theme === "DARK") return "darkTheme";
  return "systemTheme";
}

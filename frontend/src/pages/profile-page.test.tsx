import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as React from "react";
import { ProfilePage } from "./profile-page";
import { listEmployments } from "../api/endpoints";
import { WorkspaceProvider } from "../contexts/workspace-context";

const { logoutMock, updatePreferencesMock } = vi.hoisted(() => ({
  logoutMock: vi.fn(),
  updatePreferencesMock: vi.fn()
}));

vi.mock("../features/auth/use-auth", () => ({
  useAuth: () => ({
    user: {
      account: {
        id: "user-1",
        email: "alveryn000app@gmail.com",
        emailVerified: true,
        status: "ACTIVE",
        lastLoginAt: null
      },
      profile: {
        id: "profile-1",
        firstName: "Eusebiu",
        lastName: "Jacot",
        displayName: null,
        dateOfBirth: null,
        phone: null,
        countryCode: null,
        city: null,
        postalCode: null,
        street: null,
        houseNumber: null,
        apartment: null,
        avatarUrl: null,
        employmentStartDate: null,
        employmentEndDate: null
      },
      preferences: {
        id: "pref-1",
        language: "en",
        timezone: "Europe/Berlin",
        currency: "EUR",
        firstDayOfWeek: "MONDAY",
        dateFormat: "DD.MM.YYYY",
        timeFormat: "H24",
        theme: "SYSTEM",
        defaultBreakMinutes: 30,
        preferredDailyMinutes: 480,
        paidSickLeave: true,
        paidVacation: true,
        onboardingCompleted: true
      }
    },
    logout: logoutMock
  })
}));

vi.mock("../api/endpoints", () => ({
  getProfile: vi.fn(async () => ({
    id: "profile-1",
    firstName: "Eusebiu",
    lastName: "Jacot",
    displayName: null,
    dateOfBirth: null,
    phone: null,
    countryCode: null,
    city: null,
    postalCode: null,
    street: null,
    houseNumber: null,
    apartment: null,
    avatarUrl: null,
    employmentStartDate: null,
    employmentEndDate: null
  })),
  getPreferences: vi.fn(async () => ({
    id: "pref-1",
    language: "en",
    timezone: "Europe/Berlin",
    currency: "EUR",
    firstDayOfWeek: "MONDAY",
    dateFormat: "DD.MM.YYYY",
    timeFormat: "H24",
    theme: "SYSTEM",
    defaultBreakMinutes: 30,
    preferredDailyMinutes: 480,
    paidSickLeave: true,
    paidVacation: true,
    onboardingCompleted: true
  })),
  listHourlyRates: vi.fn(async () => [
    {
      id: "rate-1",
      hourlyRate: "17.50",
      currency: "EUR",
      validFrom: "2026-07-13",
      validTo: null
    }
  ]),
  updatePreferences: updatePreferencesMock,
  listOrganizations: vi.fn(async () => [
    { id: "business-1", name: "Puiu Group", type: "BUSINESS", timezone: "Europe/Berlin", role: "OWNER" }
  ]),
  listEmployments: vi.fn(async () => [
    {
      id: "employment-1",
      name: "Main contract",
      employmentType: null,
      compensationType: "HOURLY",
      trackingFocus: "TIME",
      hourBalanceEnabled: false,
      termsValidFrom: "2026-01-01",
      startDate: null,
      endDate: null,
      fixedSalaryAmount: null,
      currency: null,
      targetMinutes: null,
      targetPeriod: null,
      hourBalanceValidityMonths: null,
      displayOrder: 0,
      active: true,
      deletable: true
    }
  ])
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });

  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <WorkspaceProvider>
          <ProfilePage />
        </WorkspaceProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("ProfilePage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the premium settings shell with profile and grouped rows", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Eusebiu Jacot")).toBeInTheDocument();
    expect(screen.getByText("alveryn000app@gmail.com")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /^profile$/i })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /^profile$/i })).toHaveAttribute("href", "/settings/profile");
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Employment settings" })).toHaveAttribute("href", "/settings/employment/employment-1");
    });
    expect(screen.queryByRole("link", { name: "Absences" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Language & region" })).toHaveAttribute("href", "/settings/preferences?section=region");
    expect(screen.getByText("English")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Date & time" })).toHaveAttribute("href", "/settings/preferences?section=date-time");
    expect(screen.getByRole("link", { name: "Appearance" })).toHaveAttribute("href", "/settings/preferences?section=appearance");
    expect(screen.getByRole("link", { name: "Export PDF" })).toHaveAttribute("href", "/settings/export-pdf");
    expect(screen.getByRole("link", { name: "Business" })).toHaveAttribute("href", "/business/business-1/overview");
    expect(screen.getByRole("button", { name: /log out/i })).toBeInTheDocument();
  });

  it("opens preference categories from the settings menu", () => {
    renderPage();

    expect(screen.getByRole("link", { name: "Language & region" })).toHaveAttribute("href", "/settings/preferences?section=region");
    expect(screen.queryByLabelText("Currency")).not.toBeInTheDocument();
  });

  it("opens the employment list when more than one employment is active", async () => {
    vi.mocked(listEmployments).mockResolvedValueOnce([
      {
        id: "employment-1",
        name: "Main contract",
        employmentType: null,
        compensationType: "HOURLY",
        trackingFocus: "TIME",
        hourBalanceEnabled: false,
        termsValidFrom: "2026-01-01",
        startDate: null,
        endDate: null,
        fixedSalaryAmount: null,
        currency: null,
        targetMinutes: null,
        targetPeriod: null,
        hourBalanceValidityMonths: null,
        displayOrder: 0,
        active: true,
        deletable: true
      },
      {
        id: "employment-2",
        name: "Minijob",
        employmentType: null,
        compensationType: "HOURLY",
        trackingFocus: "EARNINGS",
        hourBalanceEnabled: false,
        termsValidFrom: "2026-01-01",
        startDate: null,
        endDate: null,
        fixedSalaryAmount: null,
        currency: null,
        targetMinutes: null,
        targetPeriod: null,
        hourBalanceValidityMonths: null,
        displayOrder: 1,
        active: true,
        deletable: true
      }
    ]);
    renderPage();

    expect(await screen.findByRole("link", { name: "Employment settings" })).toHaveAttribute("href", "/settings/employment");
    expect(screen.queryByText("2 employments")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Choose employment" })).not.toBeInTheDocument();
  });
});

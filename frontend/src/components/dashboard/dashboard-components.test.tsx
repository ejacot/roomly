import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardOverview } from "./dashboard-overview";
import { SummaryCards } from "./summary-cards";
import { WeeklyHoursCard } from "./weekly-hours-card";
import { i18n } from "../../i18n";
import type {
  DashboardSummaryMetrics,
  SelectedDayOverview,
  WeeklyRhythmDay
} from "../../types/dashboard";

const baseSummary: DashboardSummaryMetrics = {
  extraTimeMetric: { label: "Extra hours", value: "2h 00m", hint: "" },
  extraMoneyMetric: { label: "Extra money", value: "EUR 40.00", hint: "" },
  totalTimeMetric: { label: "Total hours", value: "10h 00m", hint: "" },
  totalMoneyMetric: { label: "Total money", value: "EUR 200.00", hint: "" }
};
const baseSelectedDay: SelectedDayOverview = {
  label: "Today",
  entriesCount: 0,
  totalDuration: "0h 00m",
  totalGross: "EUR 0.00",
  activities: []
};
const weeklyDays: WeeklyRhythmDay[] = [
  {
    key: "2026-07-13",
    label: "Mon",
    value: "0h 00m",
    minutes: 0,
    amount: 0,
    extraPayPercentages: [],
    markerLabel: null,
    status: "idle",
    percentage: 0,
    selected: false
  },
  {
    key: "2026-07-14",
    label: "Tue",
    value: "4h 00m",
    minutes: 240,
    amount: 80,
    extraPayPercentages: [],
    markerLabel: "-4",
    status: "under",
    percentage: 50,
    selected: false
  },
  {
    key: "2026-07-15",
    label: "Wed",
    value: "8h 30m",
    minutes: 510,
    amount: 170,
    extraPayPercentages: [50],
    markerLabel: null,
    status: "met",
    percentage: 100,
    selected: true
  },
  {
    key: "2026-07-16",
    label: "Thu",
    value: "0h 00m",
    minutes: 0,
    amount: 0,
    extraPayPercentages: [],
    markerLabel: null,
    status: "absence",
    absence: {
      type: "vacation",
      label: "Vacation",
      color: "#22c55e"
    },
    percentage: 0,
    selected: false
  }
];
const absenceTypes = [
  {
    id: "absence-sick-type",
    name: "Sick",
    code: "SICK_LEAVE" as const,
    paid: true,
    paidMinutesPerDay: 480,
    color: "#ef4444",
    active: true,
    displayOrder: 3
  },
  {
    id: "absence-vacation-type",
    name: "Vacation",
    code: "VACATION" as const,
    paid: true,
    paidMinutesPerDay: 480,
    color: "#22c55e",
    active: true,
    displayOrder: 2
  }
];

describe("dashboard components", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("renders the empty-day question and opens the work flow", async () => {
    const onQuickAdd = vi.fn();
    const user = userEvent.setup();

    render(
      <DashboardOverview
        selectedDay={baseSelectedDay}
        weeklyDays={[]}
        absenceTypes={absenceTypes}
        onQuickAdd={onQuickAdd}
        onCreateAbsence={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "How was your day?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I worked" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I had the day off" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "I was absent" })).toBeInTheDocument();
    expect(screen.queryByText("No activity yet")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "I worked" }));
    expect(onQuickAdd).toHaveBeenCalledTimes(1);
  });

  it("prevents combining earnings from different currencies in Flow", () => {
    render(
      <DashboardOverview
        selectedDay={{ ...baseSelectedDay, entriesCount: 1 }}
        weeklyDays={weeklyDays}
        flowAvailable={false}
        onQuickAdd={vi.fn()}
        onCreateAbsence={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Flow" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rhythm" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(
      screen.getByText("Flow is unavailable when the week contains multiple currencies.")
    ).toBeInTheDocument();
  });

  it("shows absence choices only when the selected day has no activity", async () => {
    const onCreateAbsence = vi.fn();
    const user = userEvent.setup();

    render(
      <DashboardOverview
        selectedDay={baseSelectedDay}
        weeklyDays={[]}
        absenceTypes={absenceTypes}
        onQuickAdd={vi.fn()}
        onCreateAbsence={onCreateAbsence}
      />
    );

    await user.click(screen.getByRole("button", { name: "I was absent" }));
    await user.click(screen.getByRole("button", { name: "Sick" }));
    expect(onCreateAbsence).toHaveBeenCalledWith("absence-sick-type");
  });

  it("marks and removes a rest day from the selected day panel", async () => {
    const onMarkRestDay = vi.fn();
    const onRemoveRestDay = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <DashboardOverview
        selectedDay={baseSelectedDay}
        weeklyDays={[]}
        onQuickAdd={vi.fn()}
        onCreateAbsence={vi.fn()}
        onMarkRestDay={onMarkRestDay}
      />
    );

    await user.click(screen.getByRole("button", { name: "I had the day off" }));
    expect(onMarkRestDay).toHaveBeenCalledOnce();

    rerender(
      <DashboardOverview
        selectedDay={baseSelectedDay}
        weeklyDays={[]}
        restDay
        onQuickAdd={vi.fn()}
        onCreateAbsence={vi.fn()}
        onRemoveRestDay={onRemoveRestDay}
      />
    );

    expect(screen.getByText("Confirmed as a day without work.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemoveRestDay).toHaveBeenCalledOnce();
  });

  it("explains how to configure absences when a new account has no absence types", async () => {
    const onConfigureAbsences = vi.fn();
    const user = userEvent.setup();

    render(
      <DashboardOverview
        selectedDay={baseSelectedDay}
        weeklyDays={[]}
        absenceTypes={[]}
        onQuickAdd={vi.fn()}
        onCreateAbsence={vi.fn()}
        onConfigureAbsences={onConfigureAbsences}
      />
    );

    await user.click(screen.getByRole("button", { name: "I was absent" }));

    expect(screen.getByText("No absence types configured")).toBeInTheDocument();
    expect(screen.getByText(/Create your first absence type/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create absence type" }));
    expect(onConfigureAbsences).toHaveBeenCalledOnce();
  });

  it("hides absence action when the selected day already has activity", () => {
    render(
      <DashboardOverview
        selectedDay={{
          ...baseSelectedDay,
          entriesCount: 1,
          activities: [
            {
              id: "entry-1",
              title: "Regular Shift",
              kind: "TIME_BASED",
              subtitle: "08:00 – 16:00",
              duration: "7h 30m worked",
              amount: "€150.00",
              unitBreakdown: []
            }
          ]
        }}
        weeklyDays={[]}
        onQuickAdd={vi.fn()}
        onCreateAbsence={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "Absence" })).not.toBeInTheDocument();
  });

  it("shows job notes only when the record contains text", () => {
    render(
      <DashboardOverview
        selectedDay={{
          ...baseSelectedDay,
          entriesCount: 2,
          activities: [
            {
              id: "record-with-notes",
              title: "",
              kind: "TIME_BASED",
              subtitle: "",
              projectTitle: "Hotel renovation",
              projectNotes: "Use the service entrance.",
              teamSize: 4,
              address: "Leopoldstraße 10, München",
              notes: "Call the site manager before arrival.",
              duration: "2h 00m",
              amount: "EUR 40.00",
              unitBreakdown: [
                {
                  id: "line-with-extra-pay",
                  label: "Overtime shift",
                  enteredValue: "20:00–22:00",
                  interval: "20:00–22:00",
                  hours: "2h 00m",
                  quantity: "4 rooms",
                  price: "EUR 40.00",
                  extraPayPercentage: 100
                }
              ]
            },
            {
              id: "record-without-notes",
              title: "",
              kind: "FIXED_PRICE_BASED",
              subtitle: "",
              notes: "   ",
              duration: "",
              amount: "EUR 500.00",
              unitBreakdown: []
            }
          ]
        }}
        weeklyDays={[]}
        onQuickAdd={vi.fn()}
        onCreateAbsence={vi.fn()}
      />
    );

    expect(screen.getByText("Call the site manager before arrival.")).toBeInTheDocument();
    expect(screen.queryByText("Notes")).not.toBeInTheDocument();
    expect(screen.getByText("Use the service entrance.")).toBeInTheDocument();
    expect(screen.queryByText("Project notes")).not.toBeInTheDocument();
    expect(screen.getByText("Hotel renovation")).toBeInTheDocument();
    expect(screen.getByLabelText("4 people")).toHaveTextContent("4");
    expect(screen.getByText("Leopoldstraße 10, München")).toBeInTheDocument();
    expect(screen.getByText("20:00–22:00")).toBeInTheDocument();
    expect(screen.getAllByText("2h 00m")).not.toHaveLength(0);
    expect(screen.getAllByText("EUR 40.00")).not.toHaveLength(0);
    expect(screen.getByText("Overtime shift").closest("div")).toHaveTextContent("20:00–22:00+100%");
    expect(screen.queryByText("4 rooms")).not.toBeInTheDocument();
    expect(screen.getByText("+100%")).toBeInTheDocument();
  });

  it("renders absence as a day activity item", () => {
    render(
      <DashboardOverview
        selectedDay={{
          ...baseSelectedDay,
          entriesCount: 1,
          activities: [
            {
              id: "absence-1",
              title: "Vacation",
              kind: "ABSENCE",
              subtitle: "Day off",
              duration: "No work planned",
              amount: "",
              marker: "vacation",
              unitBreakdown: []
            }
          ]
        }}
        weeklyDays={[]}
        onQuickAdd={vi.fn()}
        onCreateAbsence={vi.fn()}
      />
    );

    expect(screen.getByText("Vacation")).toBeInTheDocument();
    expect(screen.getByText("Day off")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /vacation/i })).not.toBeInTheDocument();
  });

  it("does not crash without metrics and renders one metric safely", () => {
    const { rerender } = render(<SummaryCards metrics={null} />);
    expect(screen.queryByText("Today")).not.toBeInTheDocument();

    rerender(
      <SummaryCards
        metrics={{
          primaryMetric: {
            label: "Today",
            value: "8h 00m",
            hint: "1 tracked entry"
          }
        }}
      />
    );

    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("8h 00m")).toBeInTheDocument();
  });

  it("renders the expected dashboard metric structure", () => {
    render(<SummaryCards metrics={baseSummary} />);

    expect(screen.queryByText("Today hours")).not.toBeInTheDocument();
    expect(screen.queryByText("Today money")).not.toBeInTheDocument();
    expect(screen.getByText("Extra hours")).toBeInTheDocument();
    expect(screen.getByText("Extra money")).toBeInTheDocument();
    expect(screen.getByText("Total hours")).toBeInTheDocument();
    expect(screen.getByText("Total money")).toBeInTheDocument();
  });

  it("renders the paid absence block and omits an empty unpaid block", () => {
    const { rerender } = render(
      <SummaryCards
        metrics={{
          absenceMetric: {
            label: "Vacation",
            duration: "8h 00m",
            amount: "EUR 160.00"
          }
        }}
      />
    );

    expect(screen.getByText("Vacation")).toBeInTheDocument();
    expect(screen.getByText("8h 00m")).toBeInTheDocument();
    expect(screen.getByText("EUR 160.00")).toBeInTheDocument();

    rerender(
      <SummaryCards
        metrics={{ absenceMetric: null }}
      />
    );

    expect(screen.queryByText("Day off")).not.toBeInTheDocument();
    expect(screen.queryByText("8h 00m")).not.toBeInTheDocument();
    expect(screen.queryByText("EUR 160.00")).not.toBeInTheDocument();
  });

  it("hides the time column when the summary only contains money", () => {
    render(
      <SummaryCards
        metrics={{
          secondaryMetrics: [
            { label: "Gross", value: "EUR 160.00", hint: "Today" }
          ],
          tertiaryMetric: { label: "Week gross", value: "EUR 640.00", hint: "This week" }
        }}
      />
    );

    expect(screen.queryByText("Time")).not.toBeInTheDocument();
    expect(screen.getByText("EUR 160.00")).toBeInTheDocument();
    expect(screen.getByText("EUR 640.00")).toBeInTheDocument();
  });

  it("shows only worked for rhythm, then total including extra and extra for flow", () => {
    const summaryDays = weeklyDays.map((day) =>
      day.key === "2026-07-15"
        ? { ...day, extraMinutes: 60, baseAmount: 150, extraAmount: 20 }
        : { ...day, extraMinutes: 0, baseAmount: day.amount, extraAmount: 0 }
    );
    const { rerender } = render(<WeeklyHoursCard days={summaryDays} />);

    expect(screen.getByText("Worked")).toBeInTheDocument();
    expect(screen.queryByText("Hours actually worked")).not.toBeInTheDocument();
    expect(screen.getByText("Extra")).toBeInTheDocument();
    expect(screen.queryByText("Extra-pay equivalent hours")).not.toBeInTheDocument();
    expect(screen.queryByText("Total")).not.toBeInTheDocument();
    expect(screen.getByText("12h 30m")).toBeInTheDocument();
    expect(screen.getByText("1h 00m")).toBeInTheDocument();
    expect(screen.queryByText("13h 30m")).not.toBeInTheDocument();
    expect(screen.getByText("+50%")).toBeInTheDocument();
    expect(screen.getByText("+50%")).toHaveStyle({
      bottom: "clamp(0.8rem, calc(100% + 0.15rem), calc(100% - 0.9rem))"
    });

    rerender(<WeeklyHoursCard variant="flow" days={summaryDays} flowCurrency="EUR" />);

    expect(screen.getByText("Extra")).toBeInTheDocument();
    expect(screen.getByText("Weekly gross")).toBeInTheDocument();
    expect(screen.queryByText("Worked + extra")).not.toBeInTheDocument();
    expect(screen.queryByText("Additional earnings only")).not.toBeInTheDocument();
    expect(screen.queryByText("Worked")).not.toBeInTheDocument();
    expect(screen.queryByText("€230.00")).not.toBeInTheDocument();
    expect(screen.getByText("€20.00")).toBeInTheDocument();
    expect(screen.getByText("€250.00")).toBeInTheDocument();
    expect(screen.getByText("+50%")).toBeInTheDocument();

    const flowBar = screen.getByTestId("flow-segmented-bar-2026-07-15");
    expect(flowBar.querySelector('[data-segment="worked"]')).toBeInTheDocument();
    expect(flowBar.querySelector('[data-segment="worked"]')).toHaveStyle({
      backgroundColor: "#34d399"
    });
    expect(flowBar.querySelector('[data-segment="extra"]')).toHaveStyle({
      height: `${(20 / 170) * 100}%`
    });
    expect(
      screen
        .getByTestId("flow-segmented-bar-2026-07-14")
        .querySelector('[data-segment="worked"]')
    ).toHaveStyle({
      backgroundColor: "rgba(255, 255, 255, 0.42)"
    });
  });

  it("aligns the daily-average guide with a full-height bar when their values match", () => {
    const equalDays = weeklyDays.map((day) =>
      day.key === "2026-07-14" || day.key === "2026-07-15"
        ? { ...day, minutes: 480, amount: 160, status: "met" as const }
        : day,
    );

    render(<WeeklyHoursCard days={equalDays} />);

    expect(screen.getByTestId("weekly-average-guide")).toHaveAttribute(
      "data-average-percentage",
      "100",
    );
  });

  it("does not invent an average when a day contains different extra-pay rates", () => {
    const days = weeklyDays.map((day) =>
      day.key === "2026-07-15"
        ? { ...day, extraPayPercentages: [25, 35, 50] }
        : day
    );
    const { rerender } = render(<WeeklyHoursCard days={days} />);

    expect(screen.queryByText("+36.7%")).not.toBeInTheDocument();

    rerender(<WeeklyHoursCard variant="flow" days={days} flowCurrency="EUR" />);

    expect(screen.queryByText("+36.7%")).not.toBeInTheDocument();
    expect(screen.queryByText("+25%")).not.toBeInTheDocument();
    expect(screen.queryByText("+35%")).not.toBeInTheDocument();
    expect(screen.queryByText("+50%")).not.toBeInTheDocument();
  });

  it("renders localized weekly-hours empty state and chart", async () => {
    const onDaySelect = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<WeeklyHoursCard days={[]} />);
    expect(screen.queryByText("Weekly hours")).not.toBeInTheDocument();

    await act(async () => {
      await i18n.changeLanguage("de");
    });
    rerender(
      <WeeklyHoursCard
        days={weeklyDays}
        previousWeekAverageMinutes={300}
        onDaySelect={onDaySelect}
      />
    );
    expect(screen.queryByText("Wochenstunden")).not.toBeInTheDocument();
    expect(screen.getByText("Wed")).toBeInTheDocument();
    expect(screen.getByText("8,5")).toBeInTheDocument();
    expect(screen.getByText("+50%")).toBeInTheDocument();
    expect(screen.queryByText("-4")).not.toBeInTheDocument();
    expect(screen.queryByText("8h 00m")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Thu, Vacation")).toBeInTheDocument();
    expect(screen.queryByText("Vacation")).not.toBeInTheDocument();
    expect(screen.getByText("Tagesdurchschnitt")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByTestId("rhythm-bar-2026-07-15")).toHaveStyle({
      backgroundColor: "#34d399"
    });
    expect(screen.getByTestId("rhythm-bar-2026-07-14")).toHaveStyle({
      backgroundColor: "rgba(255, 255, 255, 0.42)"
    });
    expect(screen.queryByTestId("rhythm-bar-2026-07-13")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rhythm-bar-2026-07-16")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Tue, 4h 00m"));
    expect(onDaySelect).toHaveBeenCalledWith("2026-07-14");
  });
});

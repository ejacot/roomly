import { useOutletContext } from "react-router-dom";
import { WeekSelector } from "../components/navigation/week-selector";
import { DashboardPage } from "./dashboard-page";

type OutletContext = {
  selectedDate: Date;
  setSelectedDate: (date: Date) => void;
};

export function HomePage() {
  const { selectedDate, setSelectedDate } = useOutletContext<OutletContext>();
  return (
    <div>
      <header
        className="settings-sticky-header dashboard-sticky-header dashboard-home-header fixed inset-x-0 top-0 z-40 mx-auto w-full max-w-[560px] px-5"
        data-scroll-region="page-top"
      >
        <div className="dashboard-home-header-content pb-4">
          <div className="mt-3">
            <WeekSelector value={selectedDate} onChange={setSelectedDate} showMonthLabel />
          </div>
        </div>
      </header>
      <div className="dashboard-home-header-spacer" aria-hidden="true" />
      <DashboardPage selectedDate={selectedDate} />
    </div>
  );
}

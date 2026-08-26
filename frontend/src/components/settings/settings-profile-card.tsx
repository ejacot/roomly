import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "../ui/card";

type Props = {
  initials: string;
  fullName: string;
  email: string;
  ariaLabel: string;
};

export function SettingsProfileCard({
  initials,
  fullName,
  email,
  ariaLabel
}: Props) {
  return (
    <Card variant="ambient" className="settings-profile-card overflow-hidden">
      <Link
        to="/settings/profile"
        aria-label={ariaLabel}
        className="flex items-center gap-4 px-5 py-4 transition hover:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-white/24 focus:ring-inset"
      >
        <div className="font-name flex h-14 w-14 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.08] text-[1rem] font-semibold tracking-[-0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-name truncate text-[1.05rem] font-semibold tracking-[-0.04em] text-white">{fullName}</p>
          <p className="mt-1 truncate text-sm text-white/50">{email}</p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-white/24" aria-hidden="true" />
      </Link>
    </Card>
  );
}

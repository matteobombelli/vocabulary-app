import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ShellActions } from "../Shell";

interface Props {
  /** A sub-page's way back, shown as "‹ label"; top-level pages get Settings instead (on phones). */
  back?: { to: string; label: string };
  end?: ReactNode;
}

/** A navigation bar's buttons, over the page's large title, as on iOS. */
export function NavBar({ back, end }: Props) {
  return (
    <div className="nav-bar">
      {back ? (
        <Link to={back.to} className="button-link nav-bar__back">
          <ChevronLeft size={22} aria-hidden="true" />
          {back.label}
        </Link>
      ) : (
        <ShellActions />
      )}
      {end && <div className="nav-bar__end">{end}</div>}
    </div>
  );
}

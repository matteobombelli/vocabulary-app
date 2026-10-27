import type { LucideIcon } from "lucide-react";
import type { MouseEvent } from "react";
import { Link } from "react-router";

export interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Renders a router link instead of a button. */
  to?: string;
  className?: string;
}

export function IconButton({ icon: Icon, label, onClick, to, className }: IconButtonProps) {
  const classes = ["icon-btn", className].filter(Boolean).join(" ");
  const icon = <Icon size={18} strokeWidth={1.75} aria-hidden="true" />;
  if (to) {
    return (
      <Link to={to} className={classes} aria-label={label} title={label}>
        {icon}
      </Link>
    );
  }
  return (
    <button type="button" className={classes} aria-label={label} title={label} onClick={onClick}>
      {icon}
    </button>
  );
}

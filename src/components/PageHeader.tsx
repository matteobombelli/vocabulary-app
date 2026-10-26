import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { t } from "../strings";

export function PageHeader({ title, back, children }: { title: string; back?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex items-center gap-3">
      {back && (
        <Link to={back} className="btn px-2 py-2" aria-label={t.back}>
          <ArrowLeft className="size-4" />
        </Link>
      )}
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="ml-auto">{children}</div>
    </div>
  );
}

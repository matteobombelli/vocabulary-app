import { Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router";
import { LANGS } from "../shared/api";
import { useAuth } from "./auth/AuthProvider";
import { IconButton } from "./components/IconButton";
import { LANGUAGE_NAMES, t } from "./strings";

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** One tab per course, its icon the language code. */
function Tabs({ className }: { className: string }) {
  return (
    <nav className={className} aria-label={t.courses}>
      {LANGS.map((lang) => (
        <NavLink key={lang} to={`/${lang}`} className="tab">
          <span className="tab__code" aria-hidden="true">
            {lang.toUpperCase()}
          </span>
          <span>{LANGUAGE_NAMES[lang]}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/** Settings for a top-level page's navigation bar on phones, where there is no header. */
export function ShellActions() {
  return (
    <div className="shell-actions">
      <IconButton icon={Settings} label={t.settings} to="/settings" />
    </div>
  );
}

/** Wide screens only: the courses, and the account and settings at the bottom. */
function Sidebar() {
  const { user } = useAuth();
  return (
    <aside className="sidebar">
      <span className="sidebar__brand">{t.appName}</span>
      <Tabs className="tabs tabs--side" />
      <div className="sidebar__footer">
        <span className="sidebar__user">{user?.email}</span>
        <IconButton icon={Settings} label={t.settings} to="/settings" />
      </div>
    </aside>
  );
}

/** The signed-in app: a sidebar on wide screens, a header on tablets, a tab bar on phones. */
export default function Shell() {
  const online = useOnline();
  return (
    <div className="shell">
      <Sidebar />
      <div className="shell__content">
        <header className="app-header">
          <span className="app-header__brand">{t.appName}</span>
          <Tabs className="tabs tabs--top" />
          <div className="app-header__end">
            <IconButton icon={Settings} label={t.settings} to="/settings" />
          </div>
        </header>
        <main className="shell__main">
          {!online && (
            <div className="page page--notice">
              <p className="notice">{t.offline}</p>
            </div>
          )}
          <Outlet />
        </main>
        <Tabs className="tabs tabs--bottom" />
      </div>
    </div>
  );
}

import { LogOut } from "lucide-react";
import { Link, Outlet, useNavigate } from "react-router";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { t } from "./strings";

function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function onLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <header className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-4">
      <Link to="/" className="text-lg font-semibold text-fg no-underline">
        {t.appName}
      </Link>
      {user && (
        <div className="ml-auto flex items-center gap-2 text-sm text-muted">
          <span className="hidden sm:inline">{user.email}</span>
          <button type="button" className="btn px-2 py-2" aria-label={t.logOut} title={t.logOut} onClick={() => void onLogout()}>
            <LogOut className="size-4" />
          </button>
        </div>
      )}
    </header>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <div className="flex min-h-dvh flex-col">
        <Header />
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-12">
          <Outlet />
        </main>
        <footer className="mx-auto max-w-2xl px-4 pb-6 text-xs text-muted">{t.attribution}</footer>
      </div>
    </AuthProvider>
  );
}

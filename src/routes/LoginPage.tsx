import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthProvider";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(loginError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page--centre">
      <form className="card--auth" onSubmit={onSubmit}>
        <h1>Log in</h1>
        <div className="group">
          <input
            className="group__input"
            type="email"
            placeholder="Email"
            aria-label="Email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="group__input"
            type="password"
            placeholder="Password"
            aria-label="Password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="button--primary" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
        <p className="muted">
          No account? <Link to="/register">Register</Link>
        </p>
      </form>
    </main>
  );
}

function loginError(err: unknown): string {
  if (!(err instanceof ApiError)) return "Something went wrong. Try again.";
  if (err.status === 401) return "Invalid email or password";
  if (err.status === 400) return "Check your input";
  return err.message;
}

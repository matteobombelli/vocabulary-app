import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthProvider";

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(email, password, inviteCode);
      navigate(from, { replace: true });
    } catch (err) {
      setError(registerError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-center pt-8">
      <form className="card w-full max-w-sm space-y-3" onSubmit={onSubmit}>
        <h1 className="text-xl font-semibold">Register</h1>
        <input
          type="email"
          placeholder="Email"
          aria-label="Email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password (8+ characters)"
          aria-label="Password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          type="text"
          placeholder="Invite code"
          aria-label="Invite code"
          required
          value={inviteCode}
          onChange={(e) => setInviteCode(e.target.value)}
        />
        {error && <p className="text-sm text-bad">{error}</p>}
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy ? "Registering…" : "Register"}
        </button>
        <p className="text-sm text-muted">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}

function registerError(err: unknown): string {
  if (!(err instanceof ApiError)) return "Something went wrong. Try again.";
  if (err.status === 403) return "Invalid invite code";
  if (err.status === 409) return "Email already registered";
  if (err.status === 400) return "Check your input";
  return err.message;
}

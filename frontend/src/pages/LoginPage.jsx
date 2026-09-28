import { useState } from "react";
import {
  Database,
  Eye,
  EyeOff,
  LockKeyhole,
  LogIn,
  Sparkles,
  UserRound,
} from "lucide-react";

const API_BASE = "http://127.0.0.1:8000";

function LoginPage({ onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const isRegister = mode === "register";

  const submit = async (event) => {
    event.preventDefault();

    const cleanUsername = username.trim();

    if (!cleanUsername || !password) {
      setError("Enter your username and password.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE}/auth/${isRegister ? "register" : "login"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: cleanUsername,
            password,
          }),
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.detail ||
            (isRegister ? "Could not create the account." : "Could not log in.")
        );
      }

      onAuthenticated(data);
    } catch (requestError) {
      setError(requestError.message || "Could not connect to the backend.");
    } finally {
      setLoading(false);
    }
  };

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setError("");
    setPassword("");
  };

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <section className="auth-brand-panel">
          <div className="auth-brand-mark">
            <Sparkles size={24} />
          </div>

          <span className="auth-eyebrow">AI-Powered Data Insight Assistant</span>
          <h1>Your data workspace, ready when you are.</h1>
          <p>
            Sign in to upload CSV files, reopen previous datasets and continue
            analysing them without uploading the same file again.
          </p>

          <div className="auth-feature-list">
            <div>
              <Database size={18} />
              <span>Saved datasets linked to your account</span>
            </div>
            <div>
              <Sparkles size={18} />
              <span>Dashboard, quality, charts and AI assistant</span>
            </div>
          </div>
        </section>

        <section className="auth-form-panel">
          <div className="auth-form-heading">
            <span>{isRegister ? "Create account" : "Welcome back"}</span>
            <h2>{isRegister ? "Register" : "Sign in"}</h2>
            <p>
              {isRegister
                ? "Create a local account for this data workspace."
                : "Use your account to access your saved datasets."}
            </p>
          </div>

          <div className="auth-mode-switch">
            <button
              type="button"
              className={mode === "login" ? "active" : ""}
              onClick={() => changeMode("login")}
            >
              Sign in
            </button>
            <button
              type="button"
              className={mode === "register" ? "active" : ""}
              onClick={() => changeMode("register")}
            >
              Register
            </button>
          </div>

          <form className="auth-form" onSubmit={submit}>
            <label>
              <span>Username</span>
              <div className="auth-input-shell">
                <UserRound size={18} />
                <input
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Enter username"
                  autoComplete="username"
                  maxLength={50}
                />
              </div>
            </label>

            <label>
              <span>Password</span>
              <div className="auth-input-shell">
                <LockKeyhole size={18} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter password"
                  autoComplete={isRegister ? "new-password" : "current-password"}
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setShowPassword((previous) => !previous)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>

            {isRegister && (
              <p className="auth-password-note">
                Use at least 6 characters. Passwords are stored as secure hashes.
              </p>
            )}

            {error && <p className="auth-error">{error}</p>}

            <button
              type="submit"
              className="auth-submit"
              disabled={loading}
            >
              <LogIn size={18} />
              {loading
                ? isRegister
                  ? "Creating account..."
                  : "Signing in..."
                : isRegister
                  ? "Create account"
                  : "Sign in"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

export default LoginPage;

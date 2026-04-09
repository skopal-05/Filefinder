import { useState } from "react";

const normalizeEmail = (value) => value.trim().toLowerCase();

function AuthPanel({ onSignIn, onSignUp, onConfirm, error, isSubmitting }) {
  const [mode, setMode] = useState("signin");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    code: ""
  });
  const [infoMessage, setInfoMessage] = useState("");

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setInfoMessage("");
    const normalizedEmail = normalizeEmail(form.email);

    if (mode === "signin") {
      await onSignIn({
        email: normalizedEmail,
        password: form.password
      });
      return;
    }

    if (mode === "signup") {
      await onSignUp({
        name: form.name.trim(),
        email: normalizedEmail,
        password: form.password
      });
      setInfoMessage("Account created. Check your email for the verification code.");
      setMode("confirm");
      return;
    }

    await onConfirm({
      email: normalizedEmail,
      code: form.code.trim()
    });
    setInfoMessage("Account verified. You can now sign in.");
    setMode("signin");
  };

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <div className="auth-hero">
          <p className="eyebrow">Secure Workspace Access</p>
          <h1>Sign in to FileFinder</h1>
          <p>
            Each user gets a private file workspace with authenticated uploads,
            searchable records, and controlled delete permissions.
          </p>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${mode === "signin" ? "active" : ""}`}
            onClick={() => setMode("signin")}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === "signup" ? "active" : ""}`}
            onClick={() => setMode("signup")}
          >
            Sign Up
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === "confirm" ? "active" : ""}`}
            onClick={() => setMode("confirm")}
          >
            Verify
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "signup" && (
            <input
              className="text-input"
              type="text"
              placeholder="Full name"
              value={form.name}
              onChange={(event) => updateField("name", event.target.value)}
              maxLength={80}
              required
            />
          )}

          <input
            className="text-input"
            type="email"
            placeholder="Email address"
            value={form.email}
            onChange={(event) => updateField("email", event.target.value)}
            autoComplete="email"
            required
          />

          {mode !== "confirm" && (
            <input
              className="text-input"
              type="password"
              placeholder="Password"
              value={form.password}
              onChange={(event) => updateField("password", event.target.value)}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              minLength={8}
              required
            />
          )}

          {mode === "confirm" && (
            <input
              className="text-input"
              type="text"
              placeholder="Verification code"
              value={form.code}
              onChange={(event) => updateField("code", event.target.value)}
              inputMode="numeric"
              maxLength={12}
              required
            />
          )}

          {(error || infoMessage) && (
            <div className={`status-banner ${error ? "error" : "success"}`}>
              {error || infoMessage}
            </div>
          )}

          <button type="submit" className="primary-button auth-submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Please wait..."
              : mode === "signin"
                ? "Sign In"
                : mode === "signup"
                  ? "Create Account"
                  : "Verify Account"}
          </button>
        </form>
      </section>
    </div>
  );
}

export default AuthPanel;

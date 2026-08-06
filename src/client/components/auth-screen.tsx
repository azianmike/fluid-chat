"use client";

import { useState } from "react";
import { api, ApiError } from "../api";
import { identifyUser, track } from "../analytics";
import { useApp } from "../store";

export function AuthScreen() {
  const { actions } = useApp();
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      if (mode === "forgot") {
        const { resetToken } = await api.auth.forgotPassword(email);
        setNotice(
          resetToken
            ? `Email is not configured on this server, so here is your reset link: /reset-password/${resetToken}`
            : "If that email exists, a reset link is on its way."
        );
        setBusy(false);
        return;
      }

      const result =
        mode === "signup"
          ? await api.auth.signup({ email, password, displayName })
          : await api.auth.login(email, password);
      actions.setSession(result.user, result.workspaces);
      // Identify before capturing so the conversion lands on the person, not the anonymous id.
      identifyUser(result.user);
      track(mode === "signup" ? "signed_up" : "signed_in", { workspace_count: result.workspaces.length });
      if (result.workspaces[0]) await actions.selectWorkspace(result.workspaces[0].workspace.id);
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-hero">
        <p className="eyebrow">Fluid Chat</p>
        <h1>Where work happens, on your own terms.</h1>
        <p className="lede">
          Channels, direct messages, threads, search, files and reactions — self-hosted, exportable and yours.
        </p>
        <ul className="auth-points">
          <li>Organized conversations in public and private channels</li>
          <li>Threads, mentions, reactions, pins and saved items</li>
          <li>Realtime presence, typing indicators and unread tracking</li>
          <li>Full-text search across everything you can see</li>
        </ul>
      </section>

      <section className="auth-panel">
        <div className="segmented">
          <button type="button" className={mode === "login" ? "is-active" : ""} onClick={() => setMode("login")}>
            Sign in
          </button>
          <button type="button" className={mode === "signup" ? "is-active" : ""} onClick={() => setMode("signup")}>
            Create account
          </button>
        </div>

        <form className="stack-form" onSubmit={submit}>
          {mode === "signup" ? (
            <label className="field">
              Full name
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required autoComplete="name" />
            </label>
          ) : null}
          <label className="field">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
              autoFocus
            />
          </label>
          {mode !== "forgot" ? (
            <label className="field">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
            </label>
          ) : null}

          <button type="submit" className="button primary" disabled={busy}>
            {mode === "signup" ? "Create account" : mode === "forgot" ? "Send reset link" : "Sign in"}
          </button>

          {mode === "login" ? (
            <button type="button" className="link-button" onClick={() => setMode("forgot")}>
              Forgot your password?
            </button>
          ) : null}
          {mode === "forgot" ? (
            <button type="button" className="link-button" onClick={() => setMode("login")}>
              Back to sign in
            </button>
          ) : null}
          {notice ? <p className="notice">{notice}</p> : null}
        </form>
      </section>
    </main>
  );
}

export function WorkspaceSetupScreen() {
  const { state, actions } = useApp();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <main className="auth-page">
      <section className="auth-hero">
        <p className="eyebrow">Welcome, {state.session?.displayName}</p>
        <h1>Create your first workspace.</h1>
        <p className="lede">
          A workspace holds your channels, people and history. You can create more later, or join one from an invite link.
        </p>
      </section>
      <section className="auth-panel">
        <form
          className="stack-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              const { workspace } = await api.workspaces.create(name);
              track("workspace_created", {});
              const { user, workspaces } = await api.auth.me();
              actions.setSession(user, workspaces);
              await actions.selectWorkspace(workspace.id);
            } catch (error) {
              actions.fail(error);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            Workspace name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Acme Inc" required autoFocus />
          </label>
          <button type="submit" className="button primary" disabled={busy || name.trim().length < 2}>
            Create workspace
          </button>
          <button type="button" className="link-button" onClick={() => void actions.signOut()}>
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}

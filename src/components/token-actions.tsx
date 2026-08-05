"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "@/client/api";

function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : fallback;
}

export function InviteAccept({ token }: { token: string }) {
  const [message, setMessage] = useState("Checking this invitation…");
  const [workspaceName, setWorkspaceName] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    api.invites
      .preview(token)
      .then((data) => {
        setWorkspaceName(data.workspace.name);
        if (data.invite.email) setEmail(data.invite.email);
        setMessage(`You have been invited to join ${data.workspace.name}.`);
      })
      .catch((error) => setMessage(errorText(error, "This invitation is no longer valid.")));
    api.auth
      .me()
      .then((data) => setSignedIn(!!data.user))
      .catch(() => setSignedIn(false));
  }, [token]);

  async function accept() {
    try {
      await api.invites.accept(token);
      setAccepted(true);
      setMessage("You are in. Open OpenChat to start working.");
    } catch (error) {
      setMessage(errorText(error, "We could not accept this invitation."));
    }
  }

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    try {
      if (mode === "signup") await api.auth.signup({ email, password, displayName });
      else await api.auth.login(email, password);
      setSignedIn(true);
      await accept();
    } catch (error) {
      setMessage(errorText(error, "Authentication failed."));
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-hero">
        <p className="eyebrow">OpenChat invitation</p>
        <h1>{workspaceName || "You have been invited"}</h1>
        <p className="lede">{message}</p>
      </section>
      <section className="auth-panel">
        {signedIn ? (
          <div className="stack-form">
            <button type="button" className="button primary" onClick={accept} disabled={accepted}>
              {accepted ? "Invitation accepted" : "Accept invitation"}
            </button>
            <a className="link-button" href="/">
              Open OpenChat
            </a>
          </div>
        ) : (
          <form className="stack-form" onSubmit={submitAuth}>
            <div className="segmented">
              <button type="button" className={mode === "signup" ? "is-active" : ""} onClick={() => setMode("signup")}>
                Create account
              </button>
              <button type="button" className={mode === "login" ? "is-active" : ""} onClick={() => setMode("login")}>
                Sign in
              </button>
            </div>
            {mode === "signup" ? (
              <label className="field">
                Full name
                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
              </label>
            ) : null}
            <label className="field">
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label className="field">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
              />
            </label>
            <button type="submit" className="button primary">
              {mode === "signup" ? "Create account and join" : "Sign in and join"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

export function ResetPassword({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api.auth.resetPassword(token, password);
      setDone(true);
      setMessage("Password updated. You can sign in with your new password.");
      setPassword("");
    } catch (error) {
      setMessage(errorText(error, "This reset link is invalid or has expired."));
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-hero">
        <p className="eyebrow">OpenChat</p>
        <h1>Choose a new password</h1>
        <p className="lede">Resetting your password signs you out everywhere else.</p>
      </section>
      <section className="auth-panel">
        <form className="stack-form" onSubmit={submit}>
          <label className="field">
            New password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
              autoFocus
            />
          </label>
          <button type="submit" className="button primary" disabled={done}>
            Reset password
          </button>
          {message ? <p className="notice">{message}</p> : null}
          {done ? (
            <a className="link-button" href="/">
              Go to sign in
            </a>
          ) : null}
        </form>
      </section>
    </main>
  );
}

export function VerifyEmail({ token }: { token: string }) {
  const [message, setMessage] = useState("Verifying your email…");

  useEffect(() => {
    api.auth
      .verifyEmail(token)
      .then(() => setMessage("Email verified. You are all set."))
      .catch((error) => setMessage(errorText(error, "This verification link is invalid or has expired.")));
  }, [token]);

  return (
    <main className="auth-page">
      <section className="auth-hero">
        <p className="eyebrow">OpenChat</p>
        <h1>Email verification</h1>
        <p className="lede">{message}</p>
      </section>
      <section className="auth-panel">
        <a className="button primary" href="/">
          Open OpenChat
        </a>
      </section>
    </main>
  );
}

"use client";

import { FormEvent, useEffect, useState } from "react";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}

export function InviteAccept({ token }: { token: string }) {
  const [message, setMessage] = useState("Loading invite...");
  const [workspaceName, setWorkspaceName] = useState("");

  useEffect(() => {
    api<{ workspace: { name: string } }>("/invites/preview", { method: "POST", body: JSON.stringify({ token }) })
      .then((data) => {
        setWorkspaceName(data.workspace.name);
        setMessage("Sign in or create an account, then accept this invite.");
      })
      .catch((error) => setMessage(error.message));
  }, [token]);

  async function accept() {
    try {
      await api("/invites/accept", { method: "POST", body: JSON.stringify({ token }) });
      setMessage("Invite accepted. You can return to the app.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invite failed");
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel compact">
        <div>
          <p className="eyebrow">OpenChat invite</p>
          <h1>{workspaceName || "Workspace invite"}</h1>
        </div>
        <div className="stack">
          <p className="notice">{message}</p>
          <button className="primary" onClick={accept}>Accept invite</button>
          <a className="text-link" href="/">Open app</a>
        </div>
      </section>
    </main>
  );
}

export function ResetPassword({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) });
      setMessage("Password reset. You can log in with your new password.");
      setPassword("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reset failed");
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel compact">
        <div>
          <p className="eyebrow">OpenChat</p>
          <h1>Reset password</h1>
        </div>
        <form className="stack" onSubmit={submit}>
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={8} placeholder="New password" required />
          <button className="primary">Reset password</button>
          {message ? <p className="notice">{message}</p> : null}
        </form>
      </section>
    </main>
  );
}

export function VerifyEmail({ token }: { token: string }) {
  const [message, setMessage] = useState("Verifying email...");

  useEffect(() => {
    api("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) })
      .then(() => setMessage("Email verified. You can return to the app."))
      .catch((error) => setMessage(error.message));
  }, [token]);

  return (
    <main className="auth-page">
      <section className="auth-panel compact">
        <div>
          <p className="eyebrow">OpenChat</p>
          <h1>Email verification</h1>
        </div>
        <div className="stack">
          <p className="notice">{message}</p>
          <a className="text-link" href="/">Open app</a>
        </div>
      </section>
    </main>
  );
}

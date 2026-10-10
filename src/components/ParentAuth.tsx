"use client";
import { useState } from "react";

export function ParentAuth({ mode }: { mode: "login" | "setup" }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const body =
      mode === "login"
        ? { email: f.get("email"), password: f.get("password") }
        : {
            setupToken: f.get("setupToken"), email: f.get("email"), password: f.get("password"),
            childName: f.get("childName"), age: Number(f.get("age")), birthday: f.get("birthday") || null,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          };
    const res = await fetch(`/api/parent/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (res.ok) return window.location.reload();
    const j = await res.json().catch(() => ({}));
    setErr(j.message && j.message !== j.error ? j.message : j.error === "invalid_input" ? "Please check the form." : "That didn't work. Please try again.");
  }

  return (
    <main className="parent auth">
      <h1>{mode === "login" ? "Grown-ups only" : "Set up Lumi"}</h1>
      <p className="sub">{mode === "login" ? "Log in to manage Lumi's settings and memories." : "Create the parent account. You need the SETUP_TOKEN from your server configuration."}</p>
      <form className="card" onSubmit={submit}>
        <div className="grid2" style={{ gridTemplateColumns: "1fr" }}>
          {mode === "setup" && (
            <label className="field">Setup token<input name="setupToken" required autoComplete="off" /></label>
          )}
          <label className="field">Email<input name="email" type="email" required autoComplete="username" /></label>
          <label className="field">Password{mode === "setup" && " (at least 10 characters)"}
            <input name="password" type="password" required minLength={mode === "setup" ? 10 : 1} autoComplete={mode === "setup" ? "new-password" : "current-password"} />
          </label>
          {mode === "setup" && (
            <>
              <label className="field">Child's first name (or nickname)<input name="childName" required maxLength={40} defaultValue="Hanya" /></label>
              <label className="field">Age<input name="age" type="number" min={3} max={18} required defaultValue={5} /></label>
              <label className="field">Birthday (optional, for a birthday greeting)<input name="birthday" type="date" /></label>
            </>
          )}
        </div>
        {err && <p className="msg msg--err" role="alert">{err}</p>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" disabled={busy}>{mode === "login" ? "Log in" : "Create account"}</button>
          <a href="/" className="muted">Back to Lumi</a>
        </div>
      </form>
    </main>
  );
}

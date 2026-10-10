"use client";
import { useCallback, useEffect, useState } from "react";
import type { Stage } from "@/character/stages";
import type { Settings } from "@/lib/children";
import type { MemoryItem } from "@/memory/store";

const ACTIVITY_LABELS: Record<string, string> = {
  pretend: "Pretend play", stories: "Storytelling", animals: "Animals & nature", colours: "Colours & shapes",
  riddles: "Riddles & guessing games", jokes: "Gentle jokes", feelings: "Feelings words", drawing: "Drawing ideas", science: "Simple science",
};
const CATEGORY_LABELS: Record<string, string> = {
  preference: "Preference", interest: "Interest", story: "Shared story", game: "Game", achievement: "Achievement", communication: "How she likes to talk", milestone: "Milestone",
};
const PROVENANCE_LABELS: Record<string, string> = { child_said: "Child said", parent_added: "Parent added", inferred: "Inferred (unconfirmed)", pretend_play: "Pretend play" };
const SAFETY_LABELS: Record<string, string> = {
  distress: "Worried, sad or scared feelings", disclosure: "Possible unsafe experience", self_harm: "Talked about hurting themself",
  emergency: "Possible emergency", secrecy_request: "Asked Lumi to keep a secret", injection: "Tried to change Lumi's rules",
};

type Tab = "overview" | "settings" | "memories" | "growth" | "device";

export function ParentApp({ childrenList }: { childrenList: { id: string; display_name: string }[] }) {
  const [childId, setChildId] = useState(childrenList[0]?.id);
  const [tab, setTab] = useState<Tab>("overview");
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);

  const api = useCallback(async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`/api/parent/children/${childId}/${path}`, {
      method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { window.location.reload(); throw new Error("logged out"); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.message && j.message !== j.error ? j.message : j.error ?? "Request failed");
    return j as T;
  }, [childId]);

  const run = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null);
    try { await fn(); if (ok) setMsg({ text: ok }); } catch (e) { setMsg({ text: (e as Error).message, err: true }); }
  }, []);

  if (!childId) return <main className="parent"><p>No child profile.</p></main>;

  return (
    <main className="parent">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Lumi — parent area</h1>
          <p className="sub">Everything here is protected by your login. Changes apply on Lumi's next turn.</p>
        </div>
        <div className="row">
          {childrenList.length > 1 && (
            <select value={childId} onChange={(e) => setChildId(e.target.value)} aria-label="Child">
              {childrenList.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
            </select>
          )}
          <a className="btn btn--ghost" href="/">Open Lumi</a>
          <button className="btn btn--ghost" onClick={() => fetch("/api/parent/logout", { method: "POST" }).then(() => window.location.reload())}>Log out</button>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {(["overview", "settings", "memories", "growth", "device"] as Tab[]).map((t) => (
          <button key={t} role="tab" className="tab" aria-selected={tab === t} onClick={() => { setTab(t); setMsg(null); }}>
            {{ overview: "Overview", settings: "Settings", memories: "Memories & scrapbook", growth: "Growth", device: "Device & data" }[t]}
          </button>
        ))}
      </div>
      {msg && <p className={`msg ${msg.err ? "msg--err" : ""}`} role={msg.err ? "alert" : "status"}>{msg.text}</p>}
      {tab === "overview" && <Overview key={childId} api={api} run={run} />}
      {tab === "settings" && <SettingsTab key={childId} api={api} run={run} />}
      {tab === "memories" && <Memories key={childId} api={api} run={run} />}
      {tab === "growth" && <Growth key={childId} api={api} run={run} />}
      {tab === "device" && <Device key={childId} api={api} run={run} />}
    </main>
  );
}

type Api = <T>(method: string, path: string, body?: unknown) => Promise<T>;
type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;

interface OverviewData {
  profile: { display_name: string; age: number; birthday: string | null };
  stage: Stage;
  versions: { character: number; safetyPolicy: number };
  parentSupportPolicy: string;
  safetyEvents: { category: string; action: string; created_at: string }[];
  usageThisMonth: { provider: string; kind: string; unit: string; quantity: number; est_cost_usd: number }[];
  estimatedCostThisMonthAllChildren: number;
  budgetUsd: number | null;
  latency: { p50: number | null; p90: number | null; n: number };
  last24h: { sessions: number; turns: number };
  settings: Settings;
}

function Overview({ api, run }: { api: Api; run: Run }) {
  const [d, setD] = useState<OverviewData | null>(null);
  const load = useCallback(() => api<OverviewData>("GET", "overview").then(setD), [api]);
  useEffect(() => { void run(load); }, [load, run]);
  if (!d) return <p className="muted">Loading…</p>;

  const saveProfile = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run(() => api("PUT", "profile", { display_name: f.get("name"), age: Number(f.get("age")), birthday: f.get("birthday") || null }).then(load), "Profile saved. Age changes never change Lumi's stage automatically — see Growth.");
  };

  return (
    <>
      <section className="card">
        <h2>Profile</h2>
        <form className="grid2" onSubmit={saveProfile}>
          <label className="field">Name<input name="name" defaultValue={d.profile.display_name} maxLength={40} required /></label>
          <label className="field">Age<input name="age" type="number" min={3} max={18} defaultValue={d.profile.age} required /></label>
          <label className="field">Birthday<input name="birthday" type="date" defaultValue={d.profile.birthday ?? ""} /></label>
          <div className="row" style={{ alignItems: "end" }}><button className="btn">Save profile</button></div>
        </form>
        <p className="muted">Active stage: <b>{d.stage.label}</b> (config v{d.stage.version}) · Character v{d.versions.character} · Safety policy v{d.versions.safetyPolicy}</p>
      </section>

      <section className="card">
        <h2>Last 24 hours</h2>
        <p>{d.last24h.sessions} conversation{d.last24h.sessions === 1 ? "" : "s"}, {d.last24h.turns} things said to Lumi.</p>
        <p className="muted">Voice latency (end of speech → Lumi starts talking), last 30 days: {d.latency.n ? `median ${(d.latency.p50! / 1000).toFixed(2)} s, 90th percentile ${(d.latency.p90! / 1000).toFixed(2)} s over ${d.latency.n} turns` : "no measurements yet"}.</p>
      </section>

      <section className="card">
        <h2>Gentle check-in notices</h2>
        <p className="muted">{d.parentSupportPolicy}</p>
        {d.settings.safety_alerts === "off" ? <p className="muted"><i>Notices are turned off in Settings.</i></p> :
          d.safetyEvents.length === 0 ? <p>Nothing to report.</p> : (
            <table><thead><tr><th>When</th><th>What Lumi noticed</th><th>What Lumi did</th></tr></thead><tbody>
              {d.safetyEvents.map((e, i) => (
                <tr key={i}><td>{new Date(e.created_at).toLocaleString()}</td><td>{SAFETY_LABELS[e.category] ?? (e.category.startsWith("output_") ? "Lumi's reply was replaced by a safe one" : e.category)}</td><td>{e.action.replace(/_/g, " ")}</td></tr>
              ))}
            </tbody></table>
          )}
      </section>

      <section className="card">
        <h2>Usage this month</h2>
        <p className="muted">Costs are <b>estimates</b> from published prices, not provider invoices. Check your Anthropic and OpenAI dashboards for actual charges.</p>
        <table><thead><tr><th>Provider</th><th>Item</th><th>Quantity</th><th>Est. cost</th></tr></thead><tbody>
          {d.usageThisMonth.map((u, i) => <tr key={i}><td>{u.provider}</td><td>{u.kind}</td><td>{Math.round(u.quantity).toLocaleString()} {u.unit}</td><td>${u.est_cost_usd.toFixed(3)}</td></tr>)}
        </tbody></table>
        <p>Estimated total this month: <b>${d.estimatedCostThisMonthAllChildren.toFixed(2)}</b>{d.budgetUsd ? ` of $${d.budgetUsd} budget (Lumi rests when reached)` : " · no MONTHLY_BUDGET_USD set"}.</p>
      </section>
    </>
  );
}

function SettingsTab({ api, run }: { api: Api; run: Run }) {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => { void run(() => api<Settings>("GET", "settings").then(setS)); }, [api, run]);
  if (!s) return <p className="muted">Loading…</p>;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const save = () => run(() => api<Settings>("PUT", "settings", s).then(setS), "Settings saved.");

  return (
    <>
      <section className="card">
        <h2>Memory & privacy</h2>
        <label className="check"><input type="checkbox" checked={s.memory_enabled} onChange={(e) => set("memory_enabled", e.target.checked)} />
          <span><b>Long-term memory</b><br /><span className="muted">Lumi saves small, non-sensitive notes (favourite things, shared pretend stories). When off, nothing new is saved and old memories are not used.</span></span></label>
        <label className="check"><input type="checkbox" checked={s.retain_transcripts} onChange={(e) => set("retain_transcripts", e.target.checked)} />
          <span><b>Keep conversation text</b><br /><span className="muted">Off: conversation text is deleted about 2 hours after a conversation ends (it is only needed for the current chat). On: kept for the days below. Audio is never stored.</span></span></label>
        <label className="field" style={{ maxWidth: 240 }}>Keep text for (days)<input type="number" min={1} max={90} value={s.transcript_retention_days} onChange={(e) => set("transcript_retention_days", Number(e.target.value))} disabled={!s.retain_transcripts} /></label>
        <label className="check"><input type="checkbox" checked={s.show_transcript} onChange={(e) => set("show_transcript", e.target.checked)} />
          <span><b>Show captions on Lumi's screen</b><br /><span className="muted">Shows what was heard and what Lumi said.</span></span></label>
        <label className="check"><input type="checkbox" checked={s.safety_alerts === "category_only"} onChange={(e) => set("safety_alerts", e.target.checked ? "category_only" : "off")} />
          <span><b>Gentle check-in notices</b><br /><span className="muted">Records only the kind of concern and the time — never the words — in your Overview.</span></span></label>
      </section>

      <section className="card">
        <h2>Time</h2>
        <div className="grid2">
          <label className="field">Daily playtime (minutes)<input type="number" min={1} max={240} value={s.daily_limit_minutes} onChange={(e) => set("daily_limit_minutes", Number(e.target.value))} /></label>
          <label className="field">Longest single chat (minutes)<input type="number" min={1} max={120} value={s.max_session_minutes} onChange={(e) => set("max_session_minutes", Number(e.target.value))} /></label>
          <label className="field">Quiet time starts<input type="time" value={s.quiet_start ?? ""} onChange={(e) => set("quiet_start", e.target.value || null)} /></label>
          <label className="field">Quiet time ends<input type="time" value={s.quiet_end ?? ""} onChange={(e) => set("quiet_end", e.target.value || null)} /></label>
          <label className="field">Time zone<input value={s.timezone} onChange={(e) => set("timezone", e.target.value)} /></label>
        </div>
      </section>

      <section className="card">
        <h2>Activities Lumi may offer</h2>
        <div className="grid2">
          {Object.entries(ACTIVITY_LABELS).map(([k, label]) => (
            <label key={k} className="check"><input type="checkbox" checked={s.activities[k as keyof Settings["activities"]] !== false}
              onChange={(e) => set("activities", { ...s.activities, [k]: e.target.checked })} />{label}</label>
          ))}
        </div>
        <label className="check"><input type="checkbox" checked={s.birthday_celebration} onChange={(e) => set("birthday_celebration", e.target.checked)} />Birthday greeting on the birthday set in the profile</label>
      </section>

      <section className="card">
        <h2>Voice</h2>
        <div className="grid2">
          <label className="field">Voice<select value={s.voice.voice ?? "shimmer"} onChange={(e) => set("voice", { ...s.voice, voice: e.target.value as never })}>
            {["shimmer", "coral", "nova", "sage", "ballad", "alloy"].map((v) => <option key={v}>{v}</option>)}
          </select></label>
          <label className="field">Speaking speed ({(s.voice.speed ?? 0.95).toFixed(2)})<input type="range" min={0.8} max={1.2} step={0.05} value={s.voice.speed ?? 0.95} onChange={(e) => set("voice", { ...s.voice, speed: Number(e.target.value) })} /></label>
        </div>
      </section>
      <button className="btn" onClick={save}>Save settings</button>
    </>
  );
}

function Memories({ api, run }: { api: Api; run: Run }) {
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [onlyScrapbook, setOnlyScrapbook] = useState(false);
  const load = useCallback(() => api<MemoryItem[]>("GET", "memories").then(setItems), [api]);
  useEffect(() => { void run(load); }, [load, run]);
  if (!items) return <p className="muted">Loading…</p>;
  const shown = onlyScrapbook ? items.filter((m) => m.in_scrapbook) : items;

  const add = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const form = e.currentTarget;
    void run(() => api("POST", "memories", { category: f.get("category"), content: f.get("content"), in_scrapbook: f.get("scrap") === "on" }).then(() => { form.reset(); return load(); }), "Memory added.");
  };

  return (
    <>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>{onlyScrapbook ? "Friendship scrapbook" : "What Lumi remembers"}</h2>
          <label className="check"><input type="checkbox" checked={onlyScrapbook} onChange={(e) => setOnlyScrapbook(e.target.checked)} />Scrapbook only</label>
        </div>
        <p className="muted">Every memory shows where it came from. Lumi treats pretend-play memories as pretend and inferred ones as unconfirmed (they fade after 90 days unless you edit them). Deleting removes it from the database immediately.</p>
        {shown.length === 0 ? <p>No memories yet.</p> : (
          <ul className="list">
            {shown.map((m) => (
              <li key={m.id}>
                {editing === m.id ? (
                  <form className="row" onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(() => api("PATCH", `memories/${m.id}`, { category: f.get("category"), content: f.get("content") }).then(() => { setEditing(null); return load(); }), "Memory updated.");
                  }}>
                    <select name="category" defaultValue={m.category}>{Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <input name="content" defaultValue={m.content} maxLength={200} style={{ flex: 1, minWidth: 180 }} />
                    <button className="btn">Save</button><button type="button" className="btn btn--ghost" onClick={() => setEditing(null)}>Cancel</button>
                  </form>
                ) : (
                  <div>
                    <div>{m.content}</div>
                    <span className="tag">{CATEGORY_LABELS[m.category]}</span>
                    <span className={`tag ${m.provenance === "pretend_play" ? "tag--pretend" : m.provenance === "inferred" ? "tag--inferred" : ""}`}>{PROVENANCE_LABELS[m.provenance]}{m.confidence != null ? ` · ${Math.round(m.confidence * 100)}%` : ""}</span>
                    {m.in_scrapbook && <span className="tag">★ Scrapbook</span>}
                    <span className="muted">{new Date(m.created_at).toLocaleDateString()}</span>
                  </div>
                )}
                {editing !== m.id && (
                  <div className="row">
                    <button className="btn btn--ghost" onClick={() => run(() => api("PATCH", `memories/${m.id}`, { category: m.category, content: m.content, in_scrapbook: !m.in_scrapbook }).then(load))}>{m.in_scrapbook ? "Unstar" : "★"}</button>
                    <button className="btn btn--ghost" onClick={() => setEditing(m.id)}>Edit</button>
                    <button className="btn btn--danger" onClick={() => confirm("Delete this memory?") && run(() => api("DELETE", `memories/${m.id}`).then(load), "Memory deleted.")}>Delete</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <h2>Add a memory</h2>
        <form className="grid2" onSubmit={add}>
          <label className="field">Type<select name="category" defaultValue="preference">{Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field">Memory<input name="content" required maxLength={200} placeholder="e.g. Learned to ride her bike this week" /></label>
          <label className="check"><input type="checkbox" name="scrap" />Add to scrapbook</label>
          <div><button className="btn">Add</button></div>
        </form>
      </section>
      <section className="card">
        <h2>Delete all memories</h2>
        <p className="muted">Removes every memory for this child. Lumi will start fresh. A record that a deletion happened (with no content) is kept.</p>
        <button className="btn btn--danger" onClick={() => confirm("Delete ALL memories? This cannot be undone.") && run(() => api<{ deleted: number }>("DELETE", "memories/all").then((r) => { void load(); return r; }), "All memories deleted.")}>Delete all memories</button>
      </section>
    </>
  );
}

interface StageData { active: Stage; stages: Stage[]; suggested: string; history: { id: string; stage_id: string; config_version: number; status: string; created_at: string; decided_at: string | null }[] }
const STAGE_FIELDS: (keyof Stage)[] = ["maxSentences", "maxWords", "vocabulary", "storyComplexity", "humour", "explanations", "independence", "activities"];

function Growth({ api, run }: { api: Api; run: Run }) {
  const [d, setD] = useState<StageData | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [ack, setAck] = useState(false);
  const load = useCallback(() => api<StageData>("GET", "stage").then(setD), [api]);
  useEffect(() => { void run(load); }, [load, run]);
  if (!d) return <p className="muted">Loading…</p>;
  const pending = d.history.find((h) => h.status === "proposed");
  const target = d.stages.find((s) => s.id === (pending?.stage_id ?? preview));

  return (
    <>
      <section className="card">
        <h2>Developmental stage</h2>
        <p>Active: <b>{d.active.label}</b> (v{d.active.version}). Suggested for the profile age: {d.stages.find((s) => s.id === d.suggested)?.label}.</p>
        <p className="muted">Stages only change how Lumi talks and plays. Safety rules are identical at every stage. A birthday never changes the stage — you decide. Only “Ages 5–6” has been tested.</p>
        {!pending && (
          <div className="row">
            <select value={preview} onChange={(e) => setPreview(e.target.value)} aria-label="Stage to preview">
              <option value="">Preview a stage…</option>
              {d.stages.filter((s) => s.id !== d.active.id).map((s) => <option key={s.id} value={s.id}>{s.label}{s.tested ? "" : " (untested)"}</option>)}
            </select>
            <button className="btn" disabled={!preview} onClick={() => run(() => api("POST", "stage/propose", { stageId: preview }).then(load))}>Propose this change</button>
            <button className="btn btn--ghost" onClick={() => run(() => api("POST", "stage/revert").then(load), "Returned to the previous configuration.")}>Return to previous</button>
          </div>
        )}
      </section>
      {target && (
        <section className="card">
          <h2>{pending ? "Pending change" : "Preview"}: {d.active.label} → {target.label}</h2>
          <table><thead><tr><th>Setting</th><th>Now</th><th>Proposed</th></tr></thead><tbody>
            {STAGE_FIELDS.map((k) => {
              const a = String(Array.isArray(d.active[k]) ? (d.active[k] as string[]).join(", ") : d.active[k]);
              const b = String(Array.isArray(target[k]) ? (target[k] as string[]).join(", ") : target[k]);
              return <tr key={k} style={a !== b ? { background: "#fff7e8" } : undefined}><td>{k}</td><td>{a}</td><td>{b}</td></tr>;
            })}
          </tbody></table>
          {pending && (
            <>
              {!target.tested && (
                <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  I understand this stage has not been tested with a child yet, and I will supervise and review it.</label>
              )}
              <div className="row">
                <button className="btn" disabled={!target.tested && !ack} onClick={() => run(() => api("POST", "stage/decide", { proposalId: pending.id, approve: true, acknowledgeUntested: ack }).then(load), "Stage approved.")}>Approve</button>
                <button className="btn btn--ghost" onClick={() => run(() => api("POST", "stage/decide", { proposalId: pending.id, approve: false }).then(load), "Proposal rejected.")}>Reject</button>
              </div>
            </>
          )}
        </section>
      )}
      <section className="card">
        <h2>Version history</h2>
        <table><thead><tr><th>Stage</th><th>Config</th><th>Status</th><th>Created</th><th>Decided</th></tr></thead><tbody>
          {d.history.map((h) => <tr key={h.id}><td>{d.stages.find((s) => s.id === h.stage_id)?.label}</td><td>v{h.config_version}</td><td>{h.status}</td><td>{new Date(h.created_at).toLocaleString()}</td><td>{h.decided_at ? new Date(h.decided_at).toLocaleString() : "—"}</td></tr>)}
        </tbody></table>
      </section>
    </>
  );
}

function Device({ api, run }: { api: Api; run: Run }) {
  const [devices, setDevices] = useState<{ sha256_prefix: string; label: string; created_at: string; last_seen_at: string | null }[]>([]);
  const load = useCallback(() => api<typeof devices>("GET", "devices").then(setDevices), [api]);
  useEffect(() => { void run(load); }, [load, run]);

  const exportData = () => run(async () => {
    const data = await api("GET", "export");
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `lumi-export-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(url);
  }, "Export downloaded.");

  return (
    <>
      <section className="card">
        <h2>Child devices</h2>
        <p className="muted">Lumi only talks on devices you pair here. Pair the tablet or phone your child will use, then tap “Open Lumi”.</p>
        <button className="btn" onClick={() => run(() => api("POST", "pair").then(load), "This device is now paired. Open Lumi to start.")}>Use this device for Lumi</button>
        <ul className="list" style={{ marginTop: 12 }}>
          {devices.map((d) => (
            <li key={d.sha256_prefix}><div>{d.label}<br /><span className="muted">Paired {new Date(d.created_at).toLocaleDateString()} · last used {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : "never"}</span></div>
              <button className="btn btn--danger" onClick={() => run(() => api("DELETE", `devices/${d.sha256_prefix}`).then(load), "Device removed.")}>Remove</button></li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>Your data</h2>
        <div className="row">
          <button className="btn btn--ghost" onClick={exportData}>Export all data (JSON)</button>
          <button className="btn btn--ghost" onClick={() => confirm("Delete all stored conversation text?") && run(() => api("DELETE", "transcripts"), "Conversation text deleted.")}>Delete conversation text</button>
        </div>
        <p className="muted">Audio is never stored. Text sent to OpenAI (speech and safety checks) and Anthropic (Lumi's replies) is handled under their API data policies, which this app cannot control. Database backups held by your hosting provider may keep deleted data until their backup window expires.</p>
      </section>
      <section className="card">
        <h2>Delete this child's profile</h2>
        <p className="muted">Permanently deletes the profile, settings, memories, conversations, devices and usage records.</p>
        <button className="btn btn--danger" onClick={() => {
          if (prompt("Type DELETE to permanently remove this profile and all its data.") !== "DELETE") return;
          void run(() => api("DELETE", "profile", { confirm: "DELETE" }).then(() => window.location.reload()));
        }}>Delete profile</button>
      </section>
    </>
  );
}

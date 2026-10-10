"use client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { canListen, transition, type Mood } from "@/character/stateMachine";
import { audioContext, MicError, Player, Recorder, type Recording } from "@/client/audio";
import { Unicorn } from "./Unicorn";

interface Status { paired: boolean; mock: boolean; name?: string; resting?: string | null; showTranscript?: boolean }
type Problem = { kind: "mic_denied" | "mic_unsupported" | "no_mic" | "offline" | "service" | "playback" | "unpaired" | "unknown" } | null;

const PROBLEM_TEXT: Record<NonNullable<Problem>["kind"], string> = {
  mic_denied: "Lumi can't hear you yet. A grown-up needs to allow the microphone for this site.",
  mic_unsupported: "This browser can't record sound. Try Safari or Chrome.",
  no_mic: "No microphone found.",
  offline: "Lumi can't reach Moonpetal Meadow. Check the internet.",
  service: "Lumi's magic is taking a little nap. Try again soon.",
  playback: "Lumi's voice got stuck. Tap try again.",
  unpaired: "A grown-up needs to set up this device.",
  unknown: "Something went wobbly. Tap try again.",
};

const REST_TEXT: Record<string, string> = {
  quiet_hours: "It's quiet time. Lumi is resting.",
  daily_limit: "That's all our playtime for today. See you next time!",
  session_limit: "Time for a little break! Let's play again later.",
  rate_limit: "Slow down, little star! Let's take a breath.",
  budget: "Lumi is resting. A grown-up can check the settings.",
};

const post = (url: string, init: RequestInit) => fetch(url, { method: "POST", credentials: "same-origin", ...init });
const metric = (kind: string, value = 1) =>
  void post("/api/metric", { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, value }) }).catch(() => {});

export function ChildApp() {
  const [state, dispatch] = useReducer(transition, "IDLE");
  const [status, setStatus] = useState<Status | null>(null);
  const [problem, setProblem] = useState<Problem>(null);
  const [rest, setRest] = useState<string | null>(null);
  const [caption, setCaption] = useState<{ child?: string | null; lumi?: string } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  const recorder = useRef<Recorder | null>(null);
  const player = useRef(new Player());
  const abort = useRef<AbortController | null>(null);
  const turnId = useRef(0);
  const lastRecording = useRef<Recording | null>(null);

  useEffect(() => {
    fetch("/api/status", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s: Status) => {
        setStatus(s);
        if (s.resting) { setRest(s.resting); dispatch({ type: "REST" }); }
      })
      .catch(() => { setProblem({ kind: "offline" }); dispatch({ type: "FAILED" }); });
    return () => { recorder.current?.cancel(); player.current.stop(); abort.current?.abort(); };
  }, []);

  // Watchdog: never stay in PROCESSING.
  useEffect(() => {
    if (state !== "PROCESSING") return;
    const t = setTimeout(() => { abort.current?.abort(); setProblem({ kind: "service" }); dispatch({ type: "FAILED" }); metric("turn_error"); }, 35000);
    return () => clearTimeout(t);
  }, [state]);

  // Mood expressions fade back to idle.
  useEffect(() => {
    if (state !== "HAPPY" && state !== "CURIOUS" && state !== "COMFORTING") return;
    const t = setTimeout(() => dispatch({ type: "MOOD_DONE" }), state === "COMFORTING" ? 4000 : 2500);
    return () => clearTimeout(t);
  }, [state]);

  const speak = useCallback(async (id: number, say: string, sig: string, mood: Mood, t0: number) => {
    const res = await post("/api/speak", { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ say, sig }), signal: abort.current?.signal });
    if (id !== turnId.current) return;
    const started = () => {
      if (id !== turnId.current) return;
      dispatch({ type: "AUDIO_STARTED" });
      metric("first_audio_ms", Math.round(performance.now() - t0));
    };
    if (res.status === 204) await player.current.speakWithBrowser(say, started);
    else if (res.ok) await player.current.playBlob(await res.blob(), started);
    else throw Object.assign(new Error("speak_failed"), { status: res.status });
    if (id === turnId.current) dispatch({ type: "AUDIO_ENDED", mood });
  }, []);

  const sendTurn = useCallback(async (body: FormData) => {
    const id = ++turnId.current;
    const t0 = performance.now();
    abort.current = new AbortController();
    try {
      const res = await post("/api/turn", { body, signal: abort.current.signal });
      if (id !== turnId.current) return;
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) { setRest(data.error); dispatch({ type: "REST" }); return; }
      if (res.status === 401) { setProblem({ kind: "unpaired" }); dispatch({ type: "FAILED" }); return; }
      if (!res.ok) { setProblem({ kind: res.status === 503 ? "service" : "unknown" }); dispatch({ type: "FAILED" }); metric("turn_error"); return; }
      lastRecording.current = null;
      setCaption({ child: data.transcript, lumi: data.say });
      try {
        await speak(id, data.say, data.sig, data.mood, t0);
      } catch (e) {
        if (id !== turnId.current || (e as Error).name === "AbortError") return;
        setProblem({ kind: "playback" }); dispatch({ type: "FAILED" }); metric("playback_fail");
      }
    } catch (e) {
      if (id !== turnId.current || (e as Error).name === "AbortError") return;
      setProblem({ kind: navigator.onLine ? "service" : "offline" });
      dispatch({ type: "FAILED" });
      metric("turn_error");
    }
  }, [speak]);

  const onRecorded = useCallback((r: Recording) => {
    dispatch({ type: "MIC_STOPPED" });
    if (!r.heardSpeech || r.blob.size < 1200) {
      dispatch({ type: "CANCEL" });
      setHint("I didn't hear anything. Tap and talk to me!");
      return;
    }
    lastRecording.current = r;
    const form = new FormData();
    form.set("audio", r.blob, "turn");
    form.set("durationMs", String(r.durationMs));
    void sendTurn(form);
  }, [sendTurn]);

  const startListening = useCallback(async () => {
    setProblem(null); setHint(null);
    const rec = new Recorder();
    recorder.current = rec;
    try {
      await rec.start(onRecorded);
      dispatch({ type: "MIC_STARTED" });
    } catch (e) {
      const kind = e instanceof MicError ? (e.kind === "denied" ? "mic_denied" : e.kind === "unsupported" ? "mic_unsupported" : "no_mic") : "unknown";
      setProblem({ kind }); dispatch({ type: "FAILED" });
    }
  }, [onRecorded]);

  const interrupt = useCallback(() => {
    turnId.current++;
    abort.current?.abort();
    player.current.stop();
    dispatch({ type: "INTERRUPT" });
  }, []);

  const onTalk = useCallback(() => {
    audioContext(); // unlock audio inside the gesture (iOS)
    if (state === "LISTENING") { recorder.current?.stop(); return; }
    if (state === "SPEAKING" || state === "PROCESSING") { interrupt(); metric("interrupt"); void startListening(); return; }
    if (canListen(state)) void startListening();
  }, [state, interrupt, startListening]);

  const onStop = useCallback(() => {
    if (state === "LISTENING") { recorder.current?.cancel(); dispatch({ type: "CANCEL" }); metric("cancel"); return; }
    interrupt();
    dispatch({ type: "RECOVER" });
  }, [state, interrupt]);

  const onRetry = useCallback(() => {
    audioContext();
    setProblem(null);
    dispatch({ type: "RECOVER" });
    const r = lastRecording.current;
    if (r) {
      const form = new FormData();
      form.set("audio", r.blob, "turn");
      form.set("durationMs", String(r.durationMs));
      dispatch({ type: "MIC_STARTED" }); dispatch({ type: "MIC_STOPPED" }); // straight back to PROCESSING
      void sendTurn(form);
    }
  }, [sendTurn]);

  const onTyped = (e: React.FormEvent) => {
    e.preventDefault();
    if (!typed.trim() || !canListen(state)) return;
    audioContext();
    const form = new FormData();
    form.set("text", typed);
    setTyped("");
    dispatch({ type: "MIC_STARTED" }); dispatch({ type: "MIC_STOPPED" });
    void sendTurn(form);
  };

  if (status && !status.paired) {
    return (
      <main className="child">
        <div className="stage-wrap"><Unicorn state="RESTING" /></div>
        <p className="notice">Hi! A grown-up needs to set me up first.</p>
        <a className="grownup-link" href="/parent">Grown-ups: set up</a>
      </main>
    );
  }

  const busy = state === "SPEAKING" || state === "PROCESSING" || state === "LISTENING";
  const talkLabel = state === "LISTENING" ? "I'm done talking" : state === "SPEAKING" ? "Talk now (stop Lumi)" : "Talk to Lumi";

  return (
    <main className={`child child--${state.toLowerCase()}`}>
      {status?.mock && <div className="mock-banner" role="status">DEV MOCK MODE — fake AI, not for real use</div>}
      <GrownUpsButton />

      <div className="stage-wrap">
        <Unicorn state={state} getLevel={player.current.level} />
      </div>

      <div className="live" aria-live="polite">
        {state === "LISTENING" && <span className="pill pill--listen">Listening…</span>}
        {state === "PROCESSING" && <span className="pill">Thinking…</span>}
        {state === "SPEAKING" && <span className="pill pill--speak">Lumi is talking</span>}
        {state === "RESTING" && <span className="pill">{REST_TEXT[rest ?? ""] ?? "Lumi is resting."}</span>}
        {problem && <span className="pill pill--warn">{PROBLEM_TEXT[problem.kind]}</span>}
        {hint && !problem && state === "IDLE" && <span className="pill">{hint}</span>}
      </div>

      {status?.showTranscript && caption && (
        <div className="captions">
          {caption.child && <p className="cap cap--child">{caption.child}</p>}
          {caption.lumi && <p className="cap cap--lumi">{caption.lumi}</p>}
        </div>
      )}

      <div className="controls">
        {state === "ERROR" ? (
          <button className="talk talk--retry" onClick={onRetry} aria-label="Try again">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" /></svg>
          </button>
        ) : (
          <button className={`talk ${state === "LISTENING" ? "talk--on" : ""}`} onClick={onTalk} disabled={state === "RESTING"} aria-label={talkLabel} aria-pressed={state === "LISTENING"}>
            {state === "LISTENING" ? <span className="talk-wave" aria-hidden="true"><i /><i /><i /><i /></span> : (
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" /></svg>
            )}
          </button>
        )}
        {busy && (
          <button className="stop" onClick={onStop} aria-label={state === "LISTENING" ? "Cancel" : "Stop Lumi"}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="3" /></svg>
          </button>
        )}
      </div>

      {status?.mock && (
        <form className="mock-type" onSubmit={onTyped}>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Dev mock: type what the child says" aria-label="Type a message (dev mock)" />
          <button type="submit">Send</button>
        </form>
      )}
    </main>
  );
}

/** Press and hold for 2 seconds; the parent area is also password-protected server-side. */
function GrownUpsButton() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holding, setHolding] = useState(false);
  const start = () => { setHolding(true); timer.current = setTimeout(() => (window.location.href = "/parent"), 2000); };
  const end = () => { setHolding(false); if (timer.current) clearTimeout(timer.current); };
  return (
    <button className={`grownups ${holding ? "grownups--hold" : ""}`} onPointerDown={start} onPointerUp={end} onPointerLeave={end} onPointerCancel={end}
      onKeyDown={(e) => e.key === "Enter" && (window.location.href = "/parent")} aria-label="Grown-ups area (press and hold)">
      Grown-ups
    </button>
  );
}

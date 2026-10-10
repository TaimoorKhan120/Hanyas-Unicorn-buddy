// Browser audio: explicit microphone capture with silence auto-stop, and playback with amplitude metering.
// The microphone is only open between start() and stop(); tracks are always released.

export class MicError extends Error {
  constructor(public kind: "denied" | "unsupported" | "no_device") {
    super(kind);
  }
}

let ctx: AudioContext | null = null;
/** Must be called inside a user gesture (iOS). */
export function audioContext(): AudioContext {
  ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function pickMime(): string {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

export interface Recording { blob: Blob; durationMs: number; heardSpeech: boolean }

export class Recorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private raf = 0;
  private done: ((r: Recording) => void) | null = null;
  private heardSpeech = false;

  static supported() {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  }

  /** Resolves when capture has actually started. `onEnd` fires once with the recording. */
  async start(onEnd: (r: Recording) => void, opts = { maxMs: 15000, silenceMs: 1400 }) {
    if (!Recorder.supported()) throw new MicError("unsupported");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      const name = (e as DOMException).name;
      throw new MicError(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "no_device");
    }
    const mime = pickMime();
    this.rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.done = onEnd;
    this.heardSpeech = false;
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.onstop = () => {
      const blob = new Blob(this.chunks, { type: this.rec?.mimeType || mime || "audio/webm" });
      const r = { blob, durationMs: Date.now() - this.startedAt, heardSpeech: this.heardSpeech };
      this.release();
      this.done?.(r);
      this.done = null;
    };
    this.rec.start(250);
    this.startedAt = Date.now();
    this.watchSilence(opts.maxMs, opts.silenceMs);
  }

  /** Simple energy-based end-of-speech detection so a five-year-old doesn't have to press stop. */
  private watchSilence(maxMs: number, silenceMs: number) {
    const a = audioContext();
    const src = a.createMediaStreamSource(this.stream!);
    const an = a.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    let lastLoud = Date.now();
    const tick = () => {
      if (!this.rec || this.rec.state !== "recording") return;
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      const rms = Math.sqrt(sum / buf.length);
      const now = Date.now();
      if (rms > 0.035) {
        lastLoud = now;
        this.heardSpeech = true;
      }
      const elapsed = now - this.startedAt;
      if (elapsed > maxMs || (this.heardSpeech && now - lastLoud > silenceMs) || (!this.heardSpeech && elapsed > 7000)) {
        this.stop();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    if (this.rec && this.rec.state !== "inactive") this.rec.stop();
    else this.release();
  }

  /** Stop without delivering a recording. */
  cancel() {
    this.done = null;
    this.stop();
  }

  private release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;
  }
}

export class Player {
  private el: HTMLAudioElement | null = null;
  private analyser: AnalyserNode | null = null;
  private buf = new Uint8Array(256);
  private simulated = false;
  private utterance: SpeechSynthesisUtterance | null = null;

  /** Current speech amplitude 0..1 for mouth animation. */
  level = (): number => {
    if (this.analyser) {
      this.analyser.getByteTimeDomainData(this.buf);
      let peak = 0;
      for (const v of this.buf) peak = Math.max(peak, Math.abs(v - 128));
      return Math.min(1, (peak / 128) * 2.2);
    }
    // Believable fallback when amplitude isn't available (browser voice): syllable-like flutter.
    if (this.simulated) return 0.35 + 0.35 * Math.abs(Math.sin(Date.now() / 90)) * Math.abs(Math.sin(Date.now() / 370));
    return 0;
  };

  async playBlob(blob: Blob, onStart: () => void): Promise<void> {
    this.stop();
    const url = URL.createObjectURL(blob);
    const el = new Audio(url);
    el.preload = "auto";
    this.el = el;
    try {
      const a = audioContext();
      const src = a.createMediaElementSource(el);
      this.analyser = a.createAnalyser();
      this.analyser.fftSize = 256;
      src.connect(this.analyser);
      this.analyser.connect(a.destination);
    } catch {
      this.analyser = null;
      this.simulated = true;
    }
    return new Promise((resolve, reject) => {
      el.onplaying = () => onStart();
      el.onended = () => { URL.revokeObjectURL(url); this.reset(); resolve(); };
      el.onerror = () => { URL.revokeObjectURL(url); this.reset(); reject(new Error("playback_failed")); };
      el.onpause = () => { if (!el.ended) { URL.revokeObjectURL(url); resolve(); } }; // interrupted
      el.play().catch((e) => { this.reset(); reject(e); });
    });
  }

  /** Dev mock only: the browser's built-in voice. */
  speakWithBrowser(text: string, onStart: () => void): Promise<void> {
    this.stop();
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) { onStart(); setTimeout(resolve, 1500); return; }
      const u = new SpeechSynthesisUtterance(text);
      const voice = speechSynthesis.getVoices().find((v) => /female|samantha|karen|serena|zira|google uk english female/i.test(v.name));
      if (voice) u.voice = voice;
      u.rate = 0.95;
      u.pitch = 1.15;
      u.onstart = () => { this.simulated = true; onStart(); };
      u.onend = u.onerror = () => { this.reset(); resolve(); };
      this.utterance = u;
      speechSynthesis.speak(u);
    });
  }

  stop() {
    if (this.el) { const el = this.el; this.el = null; el.pause(); el.src = ""; }
    if (this.utterance) { this.utterance = null; speechSynthesis.cancel(); }
    this.reset();
  }

  private reset() {
    this.analyser = null;
    this.simulated = false;
  }
}

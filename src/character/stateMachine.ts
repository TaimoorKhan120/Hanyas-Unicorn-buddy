// Explicit character state machine. Pure and framework-free so it is unit-testable.
// Visual state is driven only by these real application events.

export type CharacterState =
  | "IDLE" | "LISTENING" | "PROCESSING" | "SPEAKING" | "INTERRUPTED"
  | "HAPPY" | "CURIOUS" | "COMFORTING" | "ERROR" | "RESTING";

export type Mood = "happy" | "curious" | "comforting" | "neutral";

export type CharacterEvent =
  | { type: "MIC_STARTED" }          // microphone is actually capturing
  | { type: "MIC_STOPPED" }          // capture ended, turn being processed
  | { type: "CANCEL" }               // user cancelled capture or processing
  | { type: "AUDIO_STARTED" }        // validated reply audio actually playing
  | { type: "AUDIO_ENDED"; mood: Mood }
  | { type: "MOOD_DONE" }            // expression faded back to idle
  | { type: "INTERRUPT" }            // child pressed talk/stop while Lumi was busy
  | { type: "FAILED" }
  | { type: "RECOVER" }
  | { type: "REST" }                 // limit / quiet hours reached
  | { type: "WAKE" };

const MOOD_STATE: Record<Mood, CharacterState> = {
  happy: "HAPPY", curious: "CURIOUS", comforting: "COMFORTING", neutral: "IDLE",
};

const READY: CharacterState[] = ["IDLE", "HAPPY", "CURIOUS", "COMFORTING", "INTERRUPTED", "ERROR"];

/** Legal transitions. Anything not listed is ignored (state unchanged). */
export function transition(state: CharacterState, event: CharacterEvent): CharacterState {
  if (event.type === "REST") return "RESTING";
  if (state === "RESTING") return event.type === "WAKE" ? "IDLE" : state;
  if (event.type === "FAILED") return "ERROR";

  switch (event.type) {
    case "MIC_STARTED":
      return READY.includes(state) ? "LISTENING" : state;
    case "MIC_STOPPED":
      return state === "LISTENING" ? "PROCESSING" : state;
    case "CANCEL":
      return state === "LISTENING" || state === "PROCESSING" ? "IDLE" : state;
    case "AUDIO_STARTED":
      return state === "PROCESSING" ? "SPEAKING" : state;
    case "AUDIO_ENDED":
      return state === "SPEAKING" ? MOOD_STATE[event.mood] : state;
    case "MOOD_DONE":
      return state === "HAPPY" || state === "CURIOUS" || state === "COMFORTING" ? "IDLE" : state;
    case "INTERRUPT":
      return state === "SPEAKING" || state === "PROCESSING" ? "INTERRUPTED" : state;
    case "RECOVER":
      return state === "ERROR" || state === "INTERRUPTED" ? "IDLE" : state;
    default:
      return state;
  }
}

/** True when the microphone may be opened from this state. */
export const canListen = (s: CharacterState) => READY.includes(s);

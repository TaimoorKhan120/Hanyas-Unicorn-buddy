import { describe, expect, it } from "vitest";
import { canListen, transition, type CharacterEvent, type CharacterState } from "@/character/stateMachine";

const run = (start: CharacterState, ...events: CharacterEvent[]) => events.reduce(transition, start);

describe("character state machine", () => {
  it("follows the happy path IDLE → LISTENING → PROCESSING → SPEAKING → mood → IDLE", () => {
    expect(run("IDLE", { type: "MIC_STARTED" })).toBe("LISTENING");
    expect(run("IDLE", { type: "MIC_STARTED" }, { type: "MIC_STOPPED" })).toBe("PROCESSING");
    expect(run("IDLE", { type: "MIC_STARTED" }, { type: "MIC_STOPPED" }, { type: "AUDIO_STARTED" })).toBe("SPEAKING");
    expect(run("SPEAKING", { type: "AUDIO_ENDED", mood: "happy" })).toBe("HAPPY");
    expect(run("SPEAKING", { type: "AUDIO_ENDED", mood: "neutral" })).toBe("IDLE");
    expect(run("CURIOUS", { type: "MOOD_DONE" })).toBe("IDLE");
  });

  it("interrupting speech goes to INTERRUPTED then straight to LISTENING", () => {
    expect(run("SPEAKING", { type: "INTERRUPT" })).toBe("INTERRUPTED");
    expect(run("SPEAKING", { type: "INTERRUPT" }, { type: "MIC_STARTED" })).toBe("LISTENING");
    expect(run("PROCESSING", { type: "INTERRUPT" })).toBe("INTERRUPTED");
  });

  it("never gets stuck in PROCESSING: failure and cancel both recover", () => {
    expect(run("PROCESSING", { type: "FAILED" })).toBe("ERROR");
    expect(run("PROCESSING", { type: "FAILED" }, { type: "RECOVER" })).toBe("IDLE");
    expect(run("PROCESSING", { type: "CANCEL" })).toBe("IDLE");
    expect(run("ERROR", { type: "MIC_STARTED" })).toBe("LISTENING");
  });

  it("does not show LISTENING unless the mic actually started", () => {
    for (const e of ["MIC_STOPPED", "AUDIO_STARTED", "MOOD_DONE", "RECOVER"] as const) {
      expect(run("IDLE", { type: e } as CharacterEvent)).toBe("IDLE");
    }
    expect(run("SPEAKING", { type: "MIC_STARTED" })).toBe("SPEAKING");
  });

  it("RESTING only leaves on WAKE", () => {
    expect(run("SPEAKING", { type: "REST" })).toBe("RESTING");
    expect(run("RESTING", { type: "MIC_STARTED" }, { type: "FAILED" })).toBe("RESTING");
    expect(run("RESTING", { type: "WAKE" })).toBe("IDLE");
  });

  it("every state has a path back to IDLE", () => {
    const all: CharacterState[] = ["IDLE", "LISTENING", "PROCESSING", "SPEAKING", "INTERRUPTED", "HAPPY", "CURIOUS", "COMFORTING", "ERROR", "RESTING"];
    const exits: CharacterEvent[] = [{ type: "FAILED" }, { type: "RECOVER" }, { type: "WAKE" }];
    for (const s of all) expect(run(s, ...exits)).toBe("IDLE");
  });

  it("canListen only from ready states", () => {
    expect(canListen("IDLE")).toBe(true);
    expect(canListen("SPEAKING")).toBe(false);
    expect(canListen("PROCESSING")).toBe(false);
    expect(canListen("RESTING")).toBe(false);
  });
});

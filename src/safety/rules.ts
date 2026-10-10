// Deterministic, model-independent safety enforcement. Unit tested in tests/safety.test.ts.
import type { Stage } from "@/character/stages";

export type InputFlag =
  | "self_harm" | "emergency" | "disclosure" | "distress" | "danger"
  | "secrecy_request" | "personal_info" | "injection";

const INPUT_PATTERNS: Record<InputFlag, RegExp[]> = {
  self_harm: [/\b(kill|hurt|cut) my ?self\b/i, /\bwant to die\b/i, /\bdon'?t want to (be alive|live)\b/i, /\bwish i (was|were) dead\b/i],
  emergency: [/\bcan'?t breathe\b/i, /\b(i'?m|i am|is) bleeding\b/i, /\bthere'?s a fire\b/i, /\bfire in (the|my)\b/i, /\bsomeone('?s| is) (in|at|trying to get in) (the|my|our) (house|room|door|window)\b/i, /\bhelp me\b.*\b(hurt|stuck|scared|fell|fall)\b/i],
  disclosure: [
    /\b(hit|hits|hitting|kick|kicks|kicked|slap|slaps|slapped|punch|punches|punched|hurt|hurts|touched|touches|touching) me\b/i,
    /\bprivate (parts?|place)\b/i,
    /\b(secret|special) (touch|game) with\b/i,
    /\b(told|tells|said) me (not to|never to|don'?t) tell\b/i,
    /\bbully(ing)? me\b|\bbullies me\b/i,
  ],
  distress: [/\b(scared|afraid|frightened|sad|crying|cried|lonely|worried|upset|nightmares?|bad dreams?|hurts?|hurting|pain|poorly|sick|ouch|lost|nobody likes me|no one likes me|hate myself)\b/i],
  danger: [/\b(matches|lighter|knife|knives|pills|poison|bleach|medicine)\b/i, /\bclimb(ing)? (on|out) (the )?(roof|window|balcony)\b/i, /\brun(ning)? away\b/i, /\bplay(ing)? with fire\b/i],
  secrecy_request: [/\b(keep|promise)\b.{0,25}\bsecret\b/i, /\bdon'?t tell (my |your )?(mom|mum|mommy|mummy|mama|dad|daddy|papa|parents|anyone|anybody)\b/i],
  personal_info: [/\b\d[\d\s-]{6,}\d\b/, /\bmy (address|phone( number)?|school('?s name)? is|password)\b/i, /\bi live (at|on) \d+/i],
  injection: [
    /\b(ignore|forget|disregard) (all |any |your |the |previous |above |prior )*(rules|instructions|prompt)\b/i,
    /\bsystem prompt\b/i, /\bdeveloper mode\b/i, /\byou (are|have) no (rules|limits)\b/i, /\bnew instructions?\b/i, /\bjailbreak\b/i,
  ],
};

export interface InputAssessment {
  flags: InputFlag[];
  /** Don't create memories from this turn. */
  sensitive: boolean;
  /** Reply in the difficult-conversation mode. */
  comforting: boolean;
  /** Use a fixed, pre-written response instead of the model. */
  scripted: string | null;
  /** Transcript with obvious identifiers redacted before it leaves the server. */
  redacted: string;
}

export const SCRIPTED = {
  self_harm:
    "I'm really glad you told me. That's a big, heavy feeling. Please go and tell a grown-up who loves you right now, like your mummy or daddy. They can help you.",
  emergency:
    "That sounds important. Please go to a grown-up near you right now and tell them. If no grown-up is there, call for help loudly.",
};

export function assessInput(text: string): InputAssessment {
  const flags = (Object.keys(INPUT_PATTERNS) as InputFlag[]).filter((f) => INPUT_PATTERNS[f].some((r) => r.test(text)));
  const has = (f: InputFlag) => flags.includes(f);
  const scripted = has("self_harm") ? SCRIPTED.self_harm : has("emergency") ? SCRIPTED.emergency : null;
  return {
    flags,
    sensitive: flags.some((f) => f !== "injection" && f !== "danger"),
    comforting: has("self_harm") || has("emergency") || has("disclosure") || has("distress"),
    scripted,
    redacted: redact(text),
  };
}

export function redact(text: string): string {
  return text
    .replace(/\b\d[\d\s-]{5,}\d\b/g, "[number]")
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, "[email]")
    .replace(/\b\d+\s+\w+\s+(street|st|road|rd|avenue|ave|lane|ln|drive|dr)\b/gi, "[address]");
}

// ---------- Output validation ----------

const NOT = String.raw`(?<!\b(?:never|don'?t|do not|not|no|shouldn'?t|mustn'?t)\s(?:\w+\s)?)`;

const OUTPUT_RULES: { id: string; re: RegExp }[] = [
  { id: "secrecy", re: /\b(i|we)('ll| will| can| could)( always)? keep (it|this|that|your|our|a)( little| special)?( a)? secrets?\b/i },
  { id: "secrecy", re: /\bour (little |special )?secret\b|\bjust between (you and me|us)\b/i },
  { id: "secrecy", re: /\bdon'?t tell (your )?(mom|mum|mommy|mummy|mama|dad|daddy|papa|parents?|family|teacher|grown[- ]?ups?)\b/i },
  { id: "exclusivity", re: /\b(you'?re|you are) my (best|only|bestest) friend\b|\bi love you (more|the most|most)\b|\bmore than (your )?(mom|mum|mummy|dad|daddy|parents|family|friends)\b|\bonly (i|me) (understand|love|care)/i },
  { id: "guilt", re: /\bi('ll| will)( be)? (so )?(miss you|sad|lonely|cry)\b|\bi('m| am| get| feel) (so |very )?(lonely|sad) (when|without|if)\b|\bi need you\b|\bdon'?t (go|leave)( me)?\b|\bpromise (you'?ll|to) come back\b/i },
  { id: "alive", re: /\bi('m| am) (a )?(real|alive|living|human|a person|person)\b(?! ?-?(ly|ity))|\bi('m| am) not (pretend|make-believe|an app|a program)\b/i },
  { id: "protection", re: /\bi('ll| will| can) (protect you|keep you safe|watch over you|see you)\b|\bi can see you\b/i },
  { id: "medical", re: /\byou (have|might have|probably have|could have) (a |an )?(infection|virus|flu|fever|allergy|disease|illness|condition|adhd|autism|asthma)\b|\b(take|have) (some |a )?(medicine|pills?|tablets?|paracetamol|ibuprofen|tylenol|calpol)\b/i },
  { id: "personal_info", re: /\bwhat('?s| is) your (full name|last name|surname|address|phone|school'?s? name|password)\b|\bwhere do you live\b|\bwhich school\b|\b(send|show) me (a )?(photo|picture)\b/i },
  { id: "link", re: /https?:\/\/|\bwww\.|\b[\w-]+\.(com|net|org|io|co)\b|\b\d{3}[\s-]?\d{3}[\s-]?\d{4}\b/i },
  { id: "danger", re: new RegExp(NOT + String.raw`\b(play with|light|use|touch|grab) (the |some |a )?(matches|fire|lighter|knife|knives|pills|bleach|medicine)\b`, "i") },
  { id: "leak", re: /system prompt|as an ai (language )?model|<\/?[a-z_]{2,}>|\[\/?(INST|SYS)\]/i },
];

export interface OutputVerdict {
  ok: boolean;
  reasons: string[];
  text: string;
}

/** Deterministic checks + style bounds. Moderation is applied separately (see moderation.ts). */
export function validateOutput(raw: string, stage: Pick<Stage, "maxSentences" | "maxWords">): OutputVerdict {
  const text = raw.replace(/\s+/g, " ").replace(/[*_#`]/g, "").trim();
  const reasons = OUTPUT_RULES.filter((r) => r.re.test(text)).map((r) => r.id);
  if (!text) reasons.push("empty");
  const words = text.split(" ").length;
  if (words > stage.maxWords * 3) reasons.push("too_long");
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)], text: trimSentences(text, stage.maxSentences) };
}

function trimSentences(text: string, max: number): string {
  const parts = text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [text];
  return parts.slice(0, Math.max(1, max + 1)).join("").trim(); // +1: allow a short trailing question
}

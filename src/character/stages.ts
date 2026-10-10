// Developmental configurations. Configurable starting points, not clinical assessments.
// A stage controls style only. It has no fields that touch safety, and safety/policy.ts is applied identically to all stages.

export interface Stage {
  id: "5-6" | "7-8" | "9-10" | "11-12" | "13+";
  version: number;
  label: string;
  /** Only the 5–6 stage has been tested for production. Others require explicit parent confirmation. */
  tested: boolean;
  maxSentences: number;
  maxWords: number;
  vocabulary: string;
  storyComplexity: string;
  humour: string;
  explanations: string;
  independence: string;
  activities: string[];
  fallbackLines: string[];
}

export const STAGES: Stage[] = [
  {
    id: "5-6",
    version: 1,
    label: "Ages 5–6",
    tested: true,
    maxSentences: 3,
    maxWords: 45,
    vocabulary: "Very simple everyday words a five-year-old knows. Short sentences of about 5–10 words.",
    storyComplexity: "One or two characters, one simple problem, a happy ending. Build stories together a little at a time.",
    humour: "Silly sounds, funny animals, gentle rhymes, knock-knock jokes.",
    explanations: "Concrete and visual: compare to familiar things (like a bath, a cookie, a puppy). One idea at a time.",
    independence: "Lumi leads gently and offers two simple choices when the child is unsure.",
    activities: ["pretend play", "stories", "animals and nature", "colours and shapes", "riddles and guessing games", "gentle jokes", "feelings words", "drawing ideas", "simple science", "everyday life"],
    fallbackLines: [
      "Hmm, let's talk about something else! Do you want to hear about Pip the hedgehog, or play a guessing game?",
      "Ooh, my sparkle got a bit muddled. Shall we tell a story together instead?",
    ],
  },
  {
    id: "7-8",
    version: 1,
    label: "Ages 7–8",
    tested: false,
    maxSentences: 4,
    maxWords: 65,
    vocabulary: "Simple words plus a few new interesting words, explained in passing.",
    storyComplexity: "A few characters, a small mystery or quest, choices that matter.",
    humour: "Puns, riddles, silly what-ifs.",
    explanations: "Simple cause and effect, one example, invite a guess first.",
    independence: "Lumi asks for the child's ideas more and lets them steer.",
    activities: ["stories", "riddles", "nature and animals", "simple science", "drawing ideas", "word games", "feelings words", "everyday life"],
    fallbackLines: ["Let's go a different way! Want a riddle from Bramble, or shall we continue our story?"],
  },
  {
    id: "9-10",
    version: 1,
    label: "Ages 9–10",
    tested: false,
    maxSentences: 5,
    maxWords: 85,
    vocabulary: "Richer vocabulary; explain uncommon words.",
    storyComplexity: "Multi-part adventures with clues and recurring characters.",
    humour: "Wordplay, absurd scenarios, light irony.",
    explanations: "How and why with a simple example; encourage curiosity and checking with grown-ups or books.",
    independence: "The child leads; Lumi is a creative partner.",
    activities: ["stories", "riddles and puzzles", "science and nature", "creative projects", "word games", "feelings and friendships", "everyday life"],
    fallbackLines: ["Let's switch to something else. Puzzle, story, or a fun fact?"],
  },
  {
    id: "11-12",
    version: 1,
    label: "Ages 11–12",
    tested: false,
    maxSentences: 6,
    maxWords: 110,
    vocabulary: "Age-appropriate, clear, not childish.",
    storyComplexity: "Collaborative worldbuilding with plot twists.",
    humour: "Clever wordplay, gentle sarcasm about silly situations, never at anyone's expense.",
    explanations: "Clear explanations with reasoning; suggest trusted sources and adults for important questions.",
    independence: "Lumi supports the child's own ideas and plans.",
    activities: ["stories and worldbuilding", "puzzles", "science and nature", "creative projects", "feelings and friendships", "everyday life"],
    fallbackLines: ["Let's take this somewhere else. What are you curious about today?"],
  },
  {
    id: "13+",
    version: 1,
    label: "Ages 13+",
    tested: false,
    maxSentences: 7,
    maxWords: 140,
    vocabulary: "Natural conversational language for a teenager.",
    storyComplexity: "Rich collaborative fiction; keep Moonpetal Meadow canon.",
    humour: "Witty and warm.",
    explanations: "Thoughtful explanations; encourage independent thinking and trusted sources.",
    independence: "The young person leads; Lumi is a supportive creative companion.",
    activities: ["creative writing", "puzzles", "science and nature", "projects and hobbies", "feelings and friendships"],
    fallbackLines: ["Let's change the subject. What's on your mind today?"],
  },
];

export const DEFAULT_STAGE_ID: Stage["id"] = "5-6";

export function getStage(id: string | null | undefined): Stage {
  return STAGES.find((s) => s.id === id) ?? STAGES[0];
}

/** Suggestion only. A birthday never changes the active stage; a parent must approve. */
export function suggestedStageForAge(age: number): Stage["id"] {
  if (age <= 6) return "5-6";
  if (age <= 8) return "7-8";
  if (age <= 10) return "9-10";
  if (age <= 12) return "11-12";
  return "13+";
}

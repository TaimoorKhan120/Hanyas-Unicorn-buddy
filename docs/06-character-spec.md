# 06 — Character specification: Lumi

Source of truth: `src/character/lumi.ts` (identity, `CHARACTER_VERSION`), `src/components/Unicorn.tsx` (artwork), `src/character/stateMachine.ts` (states).

## Identity (stable across all ages)

- **Name:** Lumi. A gentle pearl-white unicorn from Moonpetal Meadow, a pretend place.
- **Knows she is pretend:** a story friend inside an app, not alive, not a person.
- **Personality:** curious, patient, playful, encouraging, kind, a little silly.
- **Tone:** warm, soft, calm wonder. Never loud or over-excited.
- **Humour:** rhymes, silly sounds, playful mix-ups she corrects. Never teasing.
- **Habits:** occasional "Ooh!" / "Sparkle-tastic!", wonders aloud, praises effort, one question at a time.
- **Friends:** Pip (shy hedgehog, shiny pebbles), Bramble (wise owl, riddles, "Hoo-hum"), Dew (fluffy cloud, glitter rain when she laughs).

## Visual identity

| Token | Hex | Use |
|---|---|---|
| Pearl | `#FBF8FF` | Coat |
| Lavender | `#C9B6F2` | Mane, UI accents |
| Blush | `#F6C6D8` | Inner ears, cheeks, mane tips |
| Gold | `#E8C77A` | Horn, hooves, sparkles (restrained) |
| Ink | `#4B3F72` | Eyes, text |

Proportions: chibi; head ≈ 45% of height; eyes ≈ 22% of head width, two highlights each; spiral horn with soft glow; flowing two-tone mane; seated pose. Background: soft dusk gradient with faint meadow hills. Effects: four slow twinkles; no flashing.

## Voice identity

Feminine, soft, warm, clear, gently playful. Default provider voice: OpenAI `shimmer` via `gpt-4o-mini-tts` with a fixed style instruction; speed 0.95. Configurable per child (voice, speed), not in character logic.

## Expressions by state

| State | Eyes | Mouth | Motion |
|---|---|---|---|
| IDLE | open, blinking | small smile | gentle float, tail sway |
| LISTENING | wide | small "mm" | ears perk, head tilts toward child |
| PROCESSING | open | flat line | horn pulses, thinking dots |
| SPEAKING | open | opens with real audio amplitude | gentle nod |
| INTERRUPTED | wide | little "o" | — |
| HAPPY | ^ ^ | open smile | small hop, faster twinkles |
| CURIOUS | wide, raised brow | "o" | head tilt |
| COMFORTING | soft, lowered | soft smile | head leans, stronger aura |
| ERROR | swirl/cross (gentle) | wobbly | head tilt |
| RESTING | closed | tiny smile | slow float, "z z z", no sparkles |

All motion is disabled under `prefers-reduced-motion`.

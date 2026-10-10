"use client";
// Lumi — original hand-built SVG character. Expression is driven only by the state machine state.
// Mouth openness is driven by real audio amplitude via getLevel(), updated outside React for smoothness.
import { useEffect, useRef } from "react";
import type { CharacterState } from "@/character/stateMachine";

interface Props {
  state: CharacterState;
  /** 0..1 speech amplitude, polled every frame while SPEAKING. */
  getLevel?: () => number;
}

export function Unicorn({ state, getLevel }: Props) {
  const mouthRef = useRef<SVGEllipseElement>(null);

  useEffect(() => {
    const mouth = mouthRef.current;
    if (!mouth) return;
    if (state !== "SPEAKING" || !getLevel) {
      mouth.setAttribute("ry", "0");
      return;
    }
    let raf = 0;
    let smooth = 0;
    const tick = () => {
      smooth += (Math.min(1, getLevel()) - smooth) * 0.35;
      mouth.setAttribute("ry", (smooth * 13).toFixed(2));
      mouth.setAttribute("rx", (9 + smooth * 5).toFixed(2));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, getLevel]);

  const eyes = EYES[state] ?? "open";

  return (
    <svg className={`lumi lumi--${state.toLowerCase()}`} viewBox="0 0 400 430" role="img" aria-label={`Lumi the unicorn is ${LABEL[state]}`}>
      <defs>
        <radialGradient id="glow" cx="50%" cy="45%" r="50%">
          <stop offset="0%" stopColor="#fff6fb" stopOpacity="0.95" />
          <stop offset="60%" stopColor="#e9dcff" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#e9dcff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pearl" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#f3ecfb" />
        </linearGradient>
        <linearGradient id="mane" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#cdb8f4" />
          <stop offset="55%" stopColor="#e7b9e0" />
          <stop offset="100%" stopColor="#f7c8d9" />
        </linearGradient>
        <linearGradient id="maneDeep" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#b9a0ec" />
          <stop offset="100%" stopColor="#e3a8cf" />
        </linearGradient>
        <linearGradient id="horn" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#e2b960" />
          <stop offset="100%" stopColor="#fff1c4" />
        </linearGradient>
        <filter id="hornGlow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="soft" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="6" stdDeviation="8" floodColor="#7a5fb0" floodOpacity="0.18" />
        </filter>
      </defs>

      <circle className="lumi-aura" cx="200" cy="200" r="190" fill="url(#glow)" />
      <ellipse cx="200" cy="408" rx="120" ry="14" fill="#7a5fb0" opacity="0.12" />

      <g className="lumi-float" filter="url(#soft)">
        {/* tail */}
        <path className="lumi-tail" d="M282 330 C 340 300, 360 360, 330 392 C 316 406, 300 398, 306 384 C 318 360, 300 350, 282 352 Z" fill="url(#mane)" />
        <path d="M290 338 C 330 326, 344 360, 326 380" stroke="#fff" strokeOpacity="0.5" strokeWidth="4" fill="none" strokeLinecap="round" />

        {/* body + legs */}
        <ellipse cx="200" cy="330" rx="92" ry="68" fill="url(#pearl)" />
        <rect x="148" y="350" width="36" height="58" rx="18" fill="url(#pearl)" />
        <rect x="216" y="350" width="36" height="58" rx="18" fill="url(#pearl)" />
        <rect x="148" y="392" width="36" height="16" rx="8" fill="#e8c77a" />
        <rect x="216" y="392" width="36" height="16" rx="8" fill="#e8c77a" />

        {/* back mane */}
        <path d="M96 150 C 60 210, 70 280, 112 312 C 92 270, 104 238, 120 220 Z" fill="url(#maneDeep)" />
        <path d="M304 150 C 340 210, 330 280, 288 312 C 308 270, 296 238, 280 220 Z" fill="url(#maneDeep)" />

        <g className="lumi-head">
          {/* ears */}
          <g className="lumi-ear lumi-ear--l">
            <path d="M118 108 L 104 40 L 160 86 Z" fill="url(#pearl)" />
            <path d="M122 98 L 113 58 L 148 86 Z" fill="#f6c6d8" />
          </g>
          <g className="lumi-ear lumi-ear--r">
            <path d="M282 108 L 296 40 L 240 86 Z" fill="url(#pearl)" />
            <path d="M278 98 L 287 58 L 252 86 Z" fill="#f6c6d8" />
          </g>

          {/* horn */}
          <g className="lumi-horn" filter="url(#hornGlow)">
            <path d="M184 76 L 200 4 L 216 76 Z" fill="url(#horn)" />
            <path d="M187 62 L 213 54 M190 46 L 210 40 M193 30 L 207 25" stroke="#d6a94a" strokeWidth="3" strokeLinecap="round" />
          </g>

          {/* head */}
          <ellipse cx="200" cy="170" rx="118" ry="102" fill="url(#pearl)" />

          {/* forelock */}
          <path d="M144 96 C 156 60, 238 52, 258 92 C 246 88, 234 94, 228 108 C 218 90, 198 92, 190 112 C 182 96, 162 90, 144 96 Z" fill="url(#mane)" />
          <path d="M168 80 C 190 66, 222 66, 240 80" stroke="#fff" strokeOpacity="0.55" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M110 120 C 120 90, 150 78, 168 86 C 150 104, 136 120, 124 150 Z" fill="url(#mane)" />
          <path d="M290 120 C 280 90, 250 78, 232 86 C 250 104, 264 120, 276 150 Z" fill="url(#mane)" />

          {/* cheeks */}
          <ellipse className="lumi-cheek" cx="122" cy="206" rx="20" ry="12" fill="#f6c6d8" opacity="0.75" />
          <ellipse className="lumi-cheek" cx="278" cy="206" rx="20" ry="12" fill="#f6c6d8" opacity="0.75" />

          {/* eyes */}
          {eyes === "open" && (
            <g className="lumi-eyes">
              <g className="lumi-eye"><ellipse cx="152" cy="168" rx="24" ry="28" fill="#4b3f72" /><circle cx="160" cy="157" r="8" fill="#fff" /><circle cx="145" cy="179" r="4" fill="#fff" opacity="0.8" /></g>
              <g className="lumi-eye"><ellipse cx="248" cy="168" rx="24" ry="28" fill="#4b3f72" /><circle cx="256" cy="157" r="8" fill="#fff" /><circle cx="241" cy="179" r="4" fill="#fff" opacity="0.8" /></g>
              <path d="M126 140 Q 136 132 146 136 M274 140 Q 264 132 254 136" stroke="#4b3f72" strokeWidth="3" strokeLinecap="round" fill="none" />
            </g>
          )}
          {eyes === "wide" && (
            <g className="lumi-eyes">
              <g className="lumi-eye"><ellipse cx="152" cy="166" rx="26" ry="31" fill="#4b3f72" /><circle cx="161" cy="154" r="9" fill="#fff" /><circle cx="145" cy="179" r="4" fill="#fff" opacity="0.8" /></g>
              <g className="lumi-eye"><ellipse cx="248" cy="166" rx="26" ry="31" fill="#4b3f72" /><circle cx="257" cy="154" r="9" fill="#fff" /><circle cx="241" cy="179" r="4" fill="#fff" opacity="0.8" /></g>
              <path d="M124 128 Q 138 116 152 124 M276 132 Q 264 126 252 130" stroke="#4b3f72" strokeWidth="3" strokeLinecap="round" fill="none" />
            </g>
          )}
          {eyes === "happy" && (
            <path d="M128 172 Q 152 146 176 172 M224 172 Q 248 146 272 172" stroke="#4b3f72" strokeWidth="7" strokeLinecap="round" fill="none" />
          )}
          {eyes === "soft" && (
            <g>
              <path d="M128 166 Q 152 186 176 166" stroke="#4b3f72" strokeWidth="6" strokeLinecap="round" fill="none" />
              <path d="M224 166 Q 248 186 272 166" stroke="#4b3f72" strokeWidth="6" strokeLinecap="round" fill="none" />
              <path d="M130 140 Q 140 146 150 142 M270 140 Q 260 146 250 142" stroke="#4b3f72" strokeWidth="3" strokeLinecap="round" fill="none" />
            </g>
          )}
          {eyes === "sleep" && (
            <path d="M130 172 Q 152 182 174 172 M226 172 Q 248 182 270 172" stroke="#4b3f72" strokeWidth="5" strokeLinecap="round" fill="none" />
          )}
          {eyes === "oops" && (
            <g fill="none" stroke="#4b3f72" strokeWidth="5" strokeLinecap="round">
              <path d="M136 158 L 168 176 M136 176 L 168 158" />
              <circle cx="248" cy="168" r="16" />
            </g>
          )}

          {/* muzzle + mouth */}
          <ellipse cx="200" cy="232" rx="58" ry="34" fill="#fbf2fa" />
          <ellipse cx="184" cy="226" rx="4" ry="3" fill="#d9b3cf" />
          <ellipse cx="216" cy="226" rx="4" ry="3" fill="#d9b3cf" />
          {state === "SPEAKING" ? (
            <ellipse ref={mouthRef} cx="200" cy="246" rx="9" ry="0" fill="#a2547e" />
          ) : (
            <>
              <ellipse ref={mouthRef} cx="200" cy="246" rx="0" ry="0" />
              <path d={MOUTH[state] ?? MOUTH.IDLE} stroke="#a2547e" strokeWidth="4" strokeLinecap="round" fill={state === "HAPPY" ? "#a2547e" : "none"} />
            </>
          )}
        </g>

        {/* front mane strands */}
        <path d="M112 236 C 96 262, 104 292, 128 304 C 120 280, 124 262, 136 250 Z" fill="url(#mane)" />
      </g>

      {/* magic */}
      <g className="lumi-sparkles" fill="#e8c77a" aria-hidden="true">
        <path className="sp sp1" d="M60 120 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4z" />
        <path className="sp sp2" d="M340 90 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z" />
        <path className="sp sp3" d="M352 250 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" fill="#c9b6f2" />
        <path className="sp sp4" d="M44 290 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" fill="#f6c6d8" />
      </g>
      {state === "PROCESSING" && (
        <g className="lumi-thinking" fill="#b9a0ec" aria-hidden="true">
          <circle cx="300" cy="40" r="7" /><circle cx="324" cy="28" r="9" /><circle cx="354" cy="20" r="11" />
        </g>
      )}
      {state === "RESTING" && (
        <g className="lumi-zzz" fill="#9a86c9" fontFamily="inherit" fontWeight="700" aria-hidden="true">
          <text x="296" y="70" fontSize="26">z</text><text x="318" y="46" fontSize="32">z</text><text x="346" y="20" fontSize="38">z</text>
        </g>
      )}
    </svg>
  );
}

const EYES: Partial<Record<CharacterState, "open" | "wide" | "happy" | "soft" | "sleep" | "oops">> = {
  IDLE: "open", LISTENING: "wide", PROCESSING: "open", SPEAKING: "open", INTERRUPTED: "wide",
  HAPPY: "happy", CURIOUS: "wide", COMFORTING: "soft", ERROR: "oops", RESTING: "sleep",
};

const MOUTH: Partial<Record<CharacterState, string>> = {
  IDLE: "M186 244 Q 200 254 214 244",
  LISTENING: "M190 246 Q 200 250 210 246",
  PROCESSING: "M190 247 L 210 247",
  HAPPY: "M180 242 Q 200 266 220 242 Z",
  CURIOUS: "M196 248 a 4 4 0 1 0 8 0 a 4 4 0 1 0 -8 0",
  COMFORTING: "M188 245 Q 200 252 212 245",
  INTERRUPTED: "M194 248 a 6 6 0 1 0 12 0 a 6 6 0 1 0 -12 0",
  ERROR: "M186 252 Q 200 242 214 252",
  RESTING: "M192 248 Q 200 251 208 248",
};

const LABEL: Record<CharacterState, string> = {
  IDLE: "ready to play", LISTENING: "listening", PROCESSING: "thinking", SPEAKING: "talking", INTERRUPTED: "stopping to listen",
  HAPPY: "happy", CURIOUS: "curious", COMFORTING: "being gentle", ERROR: "a bit muddled", RESTING: "resting",
};

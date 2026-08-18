# Omaha8 Advisor — PRD

## Original Problem Statement
Rebuild an HTML Omaha8 (Omaha Hi-Lo) poker hand evaluator as a full-stack FARM app.
Goal: rank Omaha8 4-card starting hands, explain scoop potential, and give a pre-flop
play/fold recommendation.

## User Choices
- Improve/expand the poker logic (vs. exact port)
- Stateless (no evaluation history)
- No authentication
- Fresh premium redesign ("Luxury Noir" casino-analytics theme)

## Architecture
- **Backend (FastAPI)**: `POST /api/evaluate` runs the evaluation engine (low/high/fit/risk
  classes, scoop potential, plan, action, tags, teaching note). Stateless; MongoDB present but unused.
- **Frontend (React + Tailwind + shadcn + framer-motion)**: single-page dashboard
  (`pages/Evaluator.jsx`) with custom playing-card popover selector, bento results grid.
  Auto-evaluates (250ms debounce) on card change + Evaluate button.

## Core Requirements (static)
- Pick 4 unique cards (rank + suit), validate completeness/uniqueness.
- Grade Low (L0-L4), High (H0-H3), Fit (F0-F2), Risk (R0-R3); Total = L+H+F-R (0-9).
- Recommendation: Raise/Build (>=7), Play (>=5), Caution (>=3), Fold (<3).
- Scoop potential label + %, plain-English teaching note, framework formula line.

## Implemented (grows over time)
- 2026-06: Full evaluation engine with expanded logic (counterfeit protection, double-suited/
  suited-ace/connectedness high detection, quartering & trap risk, explicit scoop potential).
  Premium dark "Luxury Noir" UI: custom cards, popover selector w/ duplicate prevention,
  animated score, metric bars, scoop bar, teaching panel. Tested 100%.
- 2026-06: URL hand sharing (`?hand=AS-KS-2H-3H`); mobile responsive fix (no overflow 360/390).
- 2026-06: Photo card recognition — `POST /api/recognize-cards` (upload) + `POST /api/scan-frame`
  (lenient live) via OpenAI gpt-5.4 vision + Emergent Universal Key. Live camera scanner with
  15s countdown, "N of 4 confirmed", auto-lock.
- 2026-06: Scoop Coach spec batch — color score bands (red 0-3 / gold 4-6 / green 7-9),
  camera-first "Scan my hand" CTA, Clear (card-back placeholders), removed Share + Evaluate.
- 2026-06: Hand history (`POST/GET/DELETE /api/hands`, MongoDB, camera+upload only, scrollable
  list, reload/clear) and per-card confidence flags (amber badge on low/medium reads).
- 2026-08: V4 camera scanning uses temporal recognition, a configurable positioning delay,
  high-confidence auto-analysis, and a larger mobile-first "Scan my hand" primary action.

## Deployment
- Deployed to production: https://hand-recommend.emergent.host (user redeploys from preview).
- Stateless-friendly + no auth (public). To gate to account holders later, add auth then redeploy.

## Backlog / Enhancement options (kept in memory per user request, 2026-06)
- **Practice Quiz**: show a random hand; user guesses the grade before reveal.
- **Beginner Glossary**: tap-to-learn definitions (nut low, quartering, scoop, quartered).
- **History Filters**: filter saved hands by verdict (Fold / Playable / Premium).
- **Confidence Auto-Focus**: jump to first flagged card for one-tap verification.
- **Configurable Scan Button Position**: let each user place "Scan my hand" at the top or
  bottom of the screen to match how the phone is physically positioned and held.
- **Account Login**: Emergent Google auth or JWT to restrict access to account holders.
- **Position Advice**: early/late seat toggle that adjusts play/fold.
- **Weekly Monte-Carlo valuation refinement**; **Android distribution** (from transcript, future phases).
- **Range/equity simulation** against random opponents.

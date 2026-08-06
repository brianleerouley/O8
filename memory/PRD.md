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

## Implemented (2026-06)
- Full evaluation engine with expanded logic (counterfeit protection, double-suited/suited-ace/
  connectedness high detection, quartering & trap risk, explicit scoop potential metric).
- Premium dark UI: custom cards, popover selector with duplicate prevention, animated score
  counter, metric bars, scoop progress bar, teaching panel. All data-testids in place.
- Tested: 11/11 backend pytest + full frontend flow, 100% pass.

## Backlog
- P2: Practice quiz mode (guess the grade), beginner glossary.
- P2: Weekly Monte-Carlo valuation refinement; Android distribution.
- P2: Position-aware recommendations (early/late position adjustments).
- P2: Range/equity simulation against random opponents.

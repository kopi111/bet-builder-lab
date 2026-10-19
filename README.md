# Bet Builder Lab

Football match analysis and Bet365 Bet Builder **research and simulation** tool.
It never places bets, never connects to a bookmaker account, and never invents
statistics, fixtures or prices. If data is missing, the page says so.

## Run it

```bash
cd ~/projects/bet-builder-lab
npm start                 # node server.js → http://127.0.0.1:5350
# optional player data:
APIFOOTBALL_KEY=xxxx npm start
npm test                  # model unit tests
npm run test:e2e          # Playwright click-through (server must be running)
```

Node 18+ and no npm dependencies. Chart.js loads from cdnjs. Without internet,
charts show a text fallback and the app uses whatever `cache/` already holds.

## Architecture

```
browser (index.html, style.css, script.js + js/ ES modules)
   │  /api/fd/*   CSV results, fixtures, Bet365 odds
   │  /api/af/*   API-Football (only if APIFOOTBALL_KEY is set)
   ▼
server.js: static files + allow-listed proxy + disk cache (cache/)
   ▼
football-data.co.uk (free)          v3.football.api-sports.io (key, optional)
```

| Layer | Files | Job |
|---|---|---|
| Data | `js/data/footballData.js`, `matchRecord.js` | Fixtures, 3 seasons of results per league, Bet365 opening and closing odds |
| | `js/data/apiFootball.js` | Line-ups, injuries, player season stats (upcoming matches only) |
| | `js/data/sourceStatus.js` | Rows, fetch time, stale or failed state for the Data sources page |
| Model | `ratingTable.js`, `leagueModel.js` | Attack/defence ratings for goals, corners, cards, shots, fouls (time decay, shrinkage) |
| | `scoreMatrix.js` | Poisson + Dixon-Coles score grid |
| | `simulation.js` | Correlated simulation (Gaussian copula on measured residual correlations) |
| | `legs.js`, `combination.js` | Every selection as a testable rule; exact or simulated joint probability |
| | `markets.js`, `profiles.js`, `analysis.js` | Market tables, A/B/C profiles, 12-section report, final assessment |
| | `backtest.js` | Walk-forward evaluation, calibration, CLV, simulated flat-stake ROI |
| UI | `js/ui/*View.js`, `slipPanel.js` | Fixtures, report, builder and slip, saved and tracking, backtest, settings, sources |
| Storage | `js/store/*` | localStorage: settings, saved matches, analyses, slips, backtest summaries |

## The model in brief

- **Goals:** each team gets an attack and a defence rating, fitted iteratively on
  time-weighted league matches (half-life 180 days, 4 pseudo-matches of shrinkage).
  The goal record is blended 35% with shots on target × league conversion, a partial
  stand-in for xG, which the free source doesn't have. A Dixon-Coles correction
  adjusts low scores.
- **Corners, cards, shots, fouls:** the same rating method on each count, using a
  negative binomial whose spread comes from the league's own variance. Cards are
  adjusted by a shrunk referee factor when a referee is known.
- **Combinations:** goal-only legs are summed exactly over the score grid. Mixed
  legs use 40,000 simulated matches in which goals, corners, cards, shots and
  fouls are linked by correlations measured from past matches. Legs are never just
  multiplied together; the slip shows the independent product only for comparison.
  Player legs use binomial shares of the simulated team totals.
- **Confidence:** comes from market family, team sample size, referee and line-up
  status, and the last backtest's skill for that market type in that league.
  "Insufficient" (fewer than 6 league matches for a team) blocks all suggestions.

## Using it

1. **Select a match:** on Fixtures, filter by league or team, then open **Report**.
   Use **Recent results** to replay a finished match as of kick-off, or
   **Custom match-up** for any two teams in the same league.
2. **Analyse:** the report has 12 sections, from form to the final assessment
   (insufficient evidence, no clear value, or potential value to investigate).
3. **Bet Builder:** review profiles A/B/C (evidence, risks, missing info), or build
   your own from the market list with adjustable lines.
4. **Enter real odds:** type the combined price Bet365 shows into the slip to see
   implied probability, the gap to the model, and estimated EV. Save the combination.
5. **Track:** Saved & tracking settles saved slips automatically from the results
   feed (player legs need manual settlement) and shows hypothetical P/L.
6. **Backtest** each league before trusting any value flag.

## Configuring providers

- **football-data.co.uk:** no key needed. Gives fixtures for the current week,
  results with shots, corners, fouls, cards and referee, and Bet365 1X2,
  over/under 2.5 and Asian handicap prices (opening and closing).
- **API-Football:** set `APIFOOTBALL_KEY` on the server; the key never reaches the
  browser. It's used for line-ups, injuries and player per-90 stats. The free plan
  only covers old seasons, so current player data needs a paid plan. **This adapter
  has not been tested against a live key yet.**
- **Champions League:** results for 2024-25 come from openfootball (no key). For
  2025-26 results and current fixtures, get a free key at football-data.org and start
  the server with `FOOTBALL_DATA_ORG_KEY=... npm start`. Clubs are rated by pooling the
  11 covered top divisions with the European results, so the European games set how
  strong each league is. Clubs from uncovered countries show "Insufficient evidence".
  There are no Champions League odds, so it can't be back-tested; replaying 2024-25
  (`node tools/check-champions-league.mjs`) gave only 2.6% skill over the base rate.
- **Odds:** Bet Builder prices have no public feed. They are always entered by hand.

## Known limits

- The fixture feed only covers the current week. Champions League and Europa League
  need API-Football.
- The data has no first-half corners, no xG, and no cup matches, so rest days are
  understated.
- On the 2024-25 to 2026-27 data, the walk-forward backtest lost to Bet365 closing
  prices in the EPL, Bundesliga and La Liga, with negative closing-line value.
  Treat "potential value" as something to investigate, not as an edge.

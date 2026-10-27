# Trained model (machine learning)

Gradient-boosted trees (scikit-learn `HistGradientBoostingClassifier`) trained on football-data.co.uk results:
21 leagues, 2016/17 to now (about 72,000 matches).

- **Features, built only from matches before kick-off:** Elo ratings (goal-margin weighted, home advantage),
  exponentially weighted goals, shots, shots on target and corners for and against, points form, rest days, league
  scoring level and league. A second version also gets the Bet365 opening odds.
- **Markets:** match result (1X2) and over/under 2.5.
- **Testing:** walk-forward by season. Each season from 2021/22 is predicted by a model trained only on earlier
  seasons. Teams need 3 league matches first. Value bets are flat 1-unit stakes when model probability × Bet365 opening
  odds > 1.05.

## Result (trained 2026-10-19, 33,991 test matches)

| Market | Model log loss | Bet365 closing | Value bets | ROI at opening odds |
|---|---|---|---|---|
| Match result | 1.011 | 0.996 | 20,909 | −8.4% |
| Over/under 2.5 | 0.682 | 0.675 | 9,806 | −5.3% |

Lower log loss is better. The model lost to Bet365 in **every** test season, and adding the opening odds as a feature
still did not catch the closing line. Almost all its skill comes from the Elo difference. **Verdict: no edge.** Use it
to study a match next to the bookmaker's view, not to pick bets. Same conclusion as the Poisson model in the app.

## Run

```bash
cd ~/projects/bet-builder-lab
uv venv ml/.venv && VIRTUAL_ENV=ml/.venv uv pip install numpy pandas scikit-learn   # first time only
ml/.venv/bin/python -W ignore ml/train_football.py                                  # ~5 min; first run downloads ~230 CSVs
```

Writes `ml/output/report.json` (test results) and `ml/output/predictions.json` (this week's fixtures). The match
report shows them in the "Trained model (machine learning)" section. Re-run weekly so the fixtures are current.
football-data.co.uk is slow: downloads retry three times and fall back to the cached copy in `ml/data/`.

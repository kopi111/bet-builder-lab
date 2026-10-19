"""Trains the football models, tests them season by season against Bet365, and scores this week's fixtures.

Run: ml/.venv/bin/python ml/train_football.py
Writes: ml/output/report.json and ml/output/predictions.json
"""
from datetime import datetime, timezone
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import log_loss

from football_data import load_fixtures, load_results, LEAGUE_CODES
from football_features import FeatureBuilder, MARKET_FEATURES, TEAM_FEATURES, fair_probabilities

OUTPUT_DIR = Path(__file__).parent / 'output'
TEST_SEASONS = ['2122', '2223', '2324', '2425', '2526', '2627']
MINIMUM_MATCHES_PLAYED = 3
VALUE_MARGIN = 0.05
OUTCOMES = ['H', 'D', 'A']
FEATURE_SETS = {'stats': TEAM_FEATURES + ['league_id'],
                'stats_market': TEAM_FEATURES + ['league_id'] + MARKET_FEATURES}
MARKETS = {
    'result': {'target': lambda frame: frame['FTR'].map({'H': 0, 'D': 1, 'A': 2}),
               'open': ['B365H', 'B365D', 'B365A'], 'close': ['B365CH', 'B365CD', 'B365CA']},
    'over25': {'target': lambda frame: (frame['FTHG'] + frame['FTAG'] > 2.5).astype(int).map({1: 0, 0: 1}),
               'open': ['B365>2.5', 'B365<2.5'], 'close': ['B365C>2.5', 'B365C<2.5']},
}


def new_model():
    return HistGradientBoostingClassifier(max_iter=250, learning_rate=0.04, max_leaf_nodes=15,
                                          min_samples_leaf=80, l2_regularization=1.0,
                                          categorical_features=['league_id'], random_state=7)


def prepare(frame):
    frame = frame.copy()
    frame['league_id'] = frame['League'].map({code: index for index, code in enumerate(LEAGUE_CODES)})
    return frame


def is_established(frame):
    return (frame['home_played'] >= MINIMUM_MATCHES_PLAYED) & (frame['away_played'] >= MINIMUM_MATCHES_PLAYED)


def has_prices(frame, market):
    columns = MARKETS[market]['open'] + MARKETS[market]['close']
    return frame[columns].notna().all(axis=1) & (frame[columns] > 1).all(axis=1)


def fit(train, market, feature_set):
    rows = train[has_prices(train, market)] if feature_set == 'stats_market' else train
    model = new_model()
    model.fit(rows[FEATURE_SETS[feature_set]], MARKETS[market]['target'](rows))
    return model


def flat_stake_bets(probabilities, frame, market, outcomes_won):
    open_odds = frame[MARKETS[market]['open']].to_numpy(float)
    close_odds = frame[MARKETS[market]['close']].to_numpy(float)
    picks = probabilities * open_odds > 1 + VALUE_MARGIN
    won = np.zeros_like(picks)
    won[np.arange(len(frame)), outcomes_won] = True
    returns_open = np.where(won, open_odds - 1, -1.0)[picks]
    returns_close = np.where(won, close_odds - 1, -1.0)[picks]
    closing_value = (open_odds / close_odds - 1)[picks]
    return {'bets': int(picks.sum()),
            'roi_at_open': mean_or_zero(returns_open), 'roi_open_std_error': std_error(returns_open),
            'roi_at_close': mean_or_zero(returns_close),
            'closing_line_value': mean_or_zero(closing_value)}


def mean_or_zero(values):
    return float(values.mean()) if len(values) else 0.0


def std_error(values):
    return float(values.std(ddof=1) / np.sqrt(len(values))) if len(values) > 1 else 0.0


def evaluate_market(train, test, market):
    test = test[has_prices(test, market)]
    actual = MARKETS[market]['target'](test).to_numpy()
    labels = list(range(len(MARKETS[market]['open'])))
    scores = {'matches': int(len(test)),
              'bookmaker_open_log_loss': log_loss(actual, fair_probabilities(test[MARKETS[market]['open']]), labels=labels),
              'bookmaker_close_log_loss': log_loss(actual, fair_probabilities(test[MARKETS[market]['close']]), labels=labels)}
    for feature_set in FEATURE_SETS:
        probabilities = fit(train, market, feature_set).predict_proba(test[FEATURE_SETS[feature_set]])
        scores[f'{feature_set}_log_loss'] = log_loss(actual, probabilities, labels=labels)
        scores[f'{feature_set}_betting'] = flat_stake_bets(probabilities, test, market, actual)
    return scores


def walk_forward(history):
    seasons = []
    for season in TEST_SEASONS:
        train = history[history['Season'] < season]
        test = history[history['Season'] == season]
        print(f'season {season}: train {len(train)} test {len(test)}')
        seasons.append({'season': season, **{market: evaluate_market(train, test, market) for market in MARKETS}})
    return seasons


def pooled(seasons, market):
    weights = np.array([season[market]['matches'] for season in seasons])
    total = {'matches': int(weights.sum())}
    for key in ['bookmaker_open_log_loss', 'bookmaker_close_log_loss'] + [f'{name}_log_loss' for name in FEATURE_SETS]:
        total[key] = float(np.average([season[market][key] for season in seasons], weights=weights))
    for name in FEATURE_SETS:
        bets = np.array([season[market][f'{name}_betting']['bets'] for season in seasons])
        total[f'{name}_betting'] = {
            'bets': int(bets.sum()),
            **{key: float(np.average([season[market][f'{name}_betting'][key] for season in seasons],
                                     weights=np.maximum(bets, 1)))
               for key in ['roi_at_open', 'roi_at_close', 'closing_line_value']}}
    return total


def top_features(history):
    train = history[history['Season'] < '2526']
    test = history[(history['Season'] == '2526') & has_prices(history, 'result')]
    model = fit(train, 'result', 'stats')
    target = MARKETS['result']['target'](test)
    importance = permutation_importance(model, test[FEATURE_SETS['stats']], target, scoring='neg_log_loss',
                                        n_repeats=3, random_state=7)
    ranked = sorted(zip(FEATURE_SETS['stats'], importance.importances_mean), key=lambda pair: -pair[1])
    return [{'feature': name, 'log_loss_gain': float(gain)} for name, gain in ranked[:12]]


def verdict(summary):
    result = summary['result']
    beats_close = result['stats_log_loss'] < result['bookmaker_close_log_loss']
    profitable = result['stats_betting']['roi_at_open'] > 0
    if beats_close and profitable:
        return 'The model beat Bet365 closing odds in testing. Check it on more seasons before trusting it.'
    return ('The model does not beat Bet365 in testing. Use it to study matches, '
            'not to pick bets: the bookmaker already prices in what the model learns.')


def predict_fixtures(history, fixtures):
    established = history[is_established(history)]
    models = {(market, name): fit(established, market, name) for market in MARKETS for name in FEATURE_SETS}
    predictions = []
    for index, fixture in fixtures.iterrows():
        row = fixtures.loc[[index]]
        predictions.append(fixture_prediction(fixture, row, models))
    return predictions


def fixture_prediction(fixture, row, models):
    has_odds = bool(row[['B365H', 'B365D', 'B365A']].notna().all(axis=1).iloc[0])
    entry = {'league': fixture.League, 'date': fixture.Date.strftime('%Y-%m-%d'), 'time': str(fixture.get('Time', '')),
             'home': fixture.HomeTeam, 'away': fixture.AwayTeam,
             'established': bool(is_established(row).iloc[0]),
             'stats': {'result': probabilities_of(models[('result', 'stats')], row, 'stats'),
                       'over25': probabilities_of(models[('over25', 'stats')], row, 'stats')[0]}}
    if has_odds:
        entry['stats_market'] = {'result': probabilities_of(models[('result', 'stats_market')], row, 'stats_market'),
                                 'over25': probabilities_of(models[('over25', 'stats_market')], row, 'stats_market')[0]}
        entry['bookmaker'] = {'result': [round(float(value), 4) for value in row[MARKET_FEATURES[:3]].iloc[0]],
                              'over25': round(float(row['open_over_prob'].iloc[0]), 4)}
    return entry


def probabilities_of(model, row, feature_set):
    return [round(float(value), 4) for value in model.predict_proba(row[FEATURE_SETS[feature_set]])[0]]


def write_json(name, payload):
    OUTPUT_DIR.mkdir(exist_ok=True)
    (OUTPUT_DIR / name).write_text(json.dumps(payload, indent=1))


def main():
    builder = FeatureBuilder()
    history = prepare(builder.replay(load_results()))
    fixtures = prepare(builder.score_fixtures(load_fixtures()))
    trained_at = datetime.now(timezone.utc).isoformat(timespec='seconds')
    seasons = walk_forward(history[is_established(history)])
    summary = {market: pooled(seasons, market) for market in MARKETS}
    report = {'trained_at': trained_at, 'matches': int(len(history)),
              'seasons_loaded': sorted(history['Season'].unique().tolist()),
              'value_margin': VALUE_MARGIN, 'summary': summary, 'seasons': seasons,
              'top_features': top_features(history[is_established(history)]), 'verdict': verdict(summary)}
    write_json('report.json', report)
    write_json('predictions.json', {'trained_at': trained_at, 'fixtures': predict_fixtures(history, fixtures)})
    print(json.dumps(summary, indent=1))
    print(report['verdict'])


if __name__ == '__main__':
    main()

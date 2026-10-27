"""Pre-match features built by replaying matches in date order, so a row only sees earlier games."""
from dataclasses import dataclass, field
import math

import numpy as np
import pandas as pd

FORM_WEIGHT = 0.12
ELO_K = 20.0
ELO_HOME_ADVANTAGE = 60.0
ELO_START = 1500.0
STAT_PAIRS = {'goals': ('FTHG', 'FTAG'), 'shots': ('HS', 'AS'),
              'target': ('HST', 'AST'), 'corners': ('HC', 'AC')}

FORM_FEATURES = [f'{side}_{stat}_{direction}' for side in ('home', 'away')
                 for stat in STAT_PAIRS for direction in ('for', 'against')]
TEAM_FEATURES = ['elo_diff', 'home_elo', 'away_elo', 'home_played', 'away_played',
                 'home_rest_days', 'away_rest_days', 'home_points_form', 'away_points_form',
                 'league_home_goals', 'league_away_goals'] + FORM_FEATURES
MARKET_FEATURES = ['open_home_prob', 'open_draw_prob', 'open_away_prob', 'open_over_prob']


@dataclass
class TeamState:
    elo: float = ELO_START
    played: int = 0
    last_date: pd.Timestamp = None
    points_form: float = 1.4
    form: dict = field(default_factory=dict)


@dataclass
class LeagueState:
    home_goals: float = 1.5
    away_goals: float = 1.2
    teams: dict = field(default_factory=dict)

    def team(self, name):
        return self.teams.setdefault(name, TeamState())


def blend(previous, observed, weight=FORM_WEIGHT):
    if observed is None or (isinstance(observed, float) and math.isnan(observed)):
        return previous
    return observed if previous is None else previous + weight * (observed - previous)


def side_features(prefix, team, date):
    rest = (date - team.last_date).days if team.last_date is not None else 14
    features = {f'{prefix}_elo': team.elo, f'{prefix}_played': team.played,
                f'{prefix}_rest_days': min(rest, 30), f'{prefix}_points_form': team.points_form}
    for stat in STAT_PAIRS:
        for direction in ('for', 'against'):
            features[f'{prefix}_{stat}_{direction}'] = team.form.get(f'{stat}_{direction}', np.nan)
    return features


def pre_match_features(league, match):
    home, away = league.team(match.HomeTeam), league.team(match.AwayTeam)
    features = {**side_features('home', home, match.Date), **side_features('away', away, match.Date)}
    features['elo_diff'] = home.elo + ELO_HOME_ADVANTAGE - away.elo
    features['league_home_goals'] = league.home_goals
    features['league_away_goals'] = league.away_goals
    return features


def update_form(team, match, is_home):
    for stat, (home_column, away_column) in STAT_PAIRS.items():
        own, other = (home_column, away_column) if is_home else (away_column, home_column)
        team.form[f'{stat}_for'] = blend(team.form.get(f'{stat}_for'), getattr(match, own))
        team.form[f'{stat}_against'] = blend(team.form.get(f'{stat}_against'), getattr(match, other))


def points_for(result, is_home):
    if result == 'D':
        return 1
    return 3 if (result == 'H') == is_home else 0


def update_elo(home, away, match):
    expected_home = 1 / (1 + 10 ** (-(home.elo + ELO_HOME_ADVANTAGE - away.elo) / 400))
    actual_home = {'H': 1.0, 'D': 0.5, 'A': 0.0}[match.FTR]
    goal_margin = math.log(abs(match.FTHG - match.FTAG) + 1) + 1
    change = ELO_K * goal_margin * (actual_home - expected_home)
    home.elo += change
    away.elo -= change


def record_result(league, match):
    home, away = league.team(match.HomeTeam), league.team(match.AwayTeam)
    update_elo(home, away, match)
    for team, is_home in ((home, True), (away, False)):
        update_form(team, match, is_home)
        team.points_form = blend(team.points_form, points_for(match.FTR, is_home))
        team.played += 1
        team.last_date = match.Date
    league.home_goals = blend(league.home_goals, match.FTHG, 0.01)
    league.away_goals = blend(league.away_goals, match.FTAG, 0.01)


def start_new_season(league):
    for team in league.teams.values():
        team.elo = ELO_START + 0.8 * (team.elo - ELO_START)
        team.played = 0


def fair_probabilities(prices):
    prices = np.asarray(prices, dtype=float)
    inverse = np.where(prices > 1, 1 / np.where(prices > 1, prices, 1), np.nan)
    return inverse / inverse.sum(axis=1, keepdims=True)


def add_market_features(frame):
    opening = fair_probabilities(frame[['B365H', 'B365D', 'B365A']])
    frame['open_home_prob'], frame['open_draw_prob'], frame['open_away_prob'] = opening.T
    frame['open_over_prob'] = fair_probabilities(frame[['B365>2.5', 'B365<2.5']])[:, 0]
    return frame


class FeatureBuilder:
    """Replays results league by league; remembers final state so fixtures can be scored."""

    def __init__(self):
        self.leagues = {}
        self.seasons = {}

    def league(self, code, season):
        league = self.leagues.setdefault(code, LeagueState())
        if self.seasons.get(code) not in (None, season):
            start_new_season(league)
        self.seasons[code] = season
        return league

    def replay(self, results):
        rows = []
        for match in results.itertuples(index=False):
            league = self.league(match.League, match.Season)
            rows.append(pre_match_features(league, match))
            record_result(league, match)
        return add_market_features(pd.concat([results, pd.DataFrame(rows)], axis=1))

    def score_fixtures(self, fixtures):
        rows = [pre_match_features(self.league(match.League, match.Season), match)
                for match in fixtures.itertuples(index=False)]
        return add_market_features(pd.concat([fixtures, pd.DataFrame(rows)], axis=1))

"""Downloads and loads football-data.co.uk league CSVs for training."""
from pathlib import Path
import io
import time
import urllib.request

import pandas as pd

ORIGIN = 'https://www.football-data.co.uk'
DATA_DIR = Path(__file__).parent / 'data'
LEAGUE_CODES = ['E0', 'E1', 'E2', 'E3', 'SP1', 'SP2', 'I1', 'I2', 'D1', 'D2', 'F1', 'F2',
                'N1', 'P1', 'B1', 'T1', 'G1', 'SC0', 'SC1', 'SC2', 'SC3']
FIRST_SEASON_START_YEAR = 2016
CURRENT_SEASON_START_YEAR = 2026
REQUIRED_COLUMNS = ['Date', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG', 'FTR']
OPTIONAL_COLUMNS = ['HS', 'AS', 'HST', 'AST', 'HC', 'AC',
                    'B365H', 'B365D', 'B365A', 'B365>2.5', 'B365<2.5',
                    'B365CH', 'B365CD', 'B365CA', 'B365C>2.5', 'B365C<2.5']


def season_code(start_year):
    return f'{start_year % 100:02d}{(start_year + 1) % 100:02d}'


def all_season_codes():
    return [season_code(year) for year in range(FIRST_SEASON_START_YEAR, CURRENT_SEASON_START_YEAR + 1)]


def download(relative_url, target, always_refresh=False):
    if target.exists() and not always_refresh:
        return target.read_bytes()
    request = urllib.request.Request(f'{ORIGIN}/{relative_url}', headers={'User-Agent': 'bet-builder-lab'})
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(body)
    time.sleep(0.3)
    return body


def parse_csv(body):
    frame = pd.read_csv(io.BytesIO(body), encoding='latin-1', on_bad_lines='skip')
    frame = frame.loc[:, ~frame.columns.str.startswith('Unnamed')]
    for column in OPTIONAL_COLUMNS:
        if column not in frame.columns:
            frame[column] = float('nan')
    frame['Date'] = pd.to_datetime(frame['Date'], dayfirst=True, errors='coerce')
    return frame.dropna(subset=['Date', 'HomeTeam', 'AwayTeam'])


def load_season(league, season):
    is_current = season == season_code(CURRENT_SEASON_START_YEAR)
    try:
        body = download(f'mmz4281/{season}/{league}.csv', DATA_DIR / season / f'{league}.csv', is_current)
    except Exception as error:
        print(f'  skip {league} {season}: {error}')
        return pd.DataFrame()
    frame = parse_csv(body)
    frame['League'] = league
    frame['Season'] = season
    return frame


def load_results():
    seasons = [load_season(league, season) for league in LEAGUE_CODES for season in all_season_codes()]
    results = pd.concat([frame for frame in seasons if not frame.empty], ignore_index=True)
    results = results.dropna(subset=['FTHG', 'FTAG', 'FTR'])
    columns = ['League', 'Season'] + REQUIRED_COLUMNS + OPTIONAL_COLUMNS
    return results[columns].sort_values('Date', kind='stable').reset_index(drop=True)


def load_fixtures():
    frame = parse_csv(download('fixtures.csv', DATA_DIR / 'fixtures.csv', always_refresh=True))
    frame = frame.rename(columns={'Div': 'League'})
    frame = frame[frame['League'].isin(LEAGUE_CODES)].copy()
    frame['Season'] = season_code(CURRENT_SEASON_START_YEAR)
    for column in REQUIRED_COLUMNS[3:]:
        frame[column] = float('nan')
    columns = ['League', 'Season'] + REQUIRED_COLUMNS + OPTIONAL_COLUMNS
    return frame[columns + ['Time']].sort_values('Date', kind='stable').reset_index(drop=True)

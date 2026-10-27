# Staking and league study over the walk-forward picks from tools/strategy-backtest.mjs.
# Replays every weekend with singles and 2/3/5/10-match tickets of strong picks ($20 each) at Bet365 and best-bookmaker prices,
# and measures strong-pick returns per league, before and after 2025-07-01.
# Usage: python3 tools/staking_study.py <history-picks.json> data/staking-study.json
import json
import math
import random
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

SOURCE, OUTPUT = sys.argv[1], sys.argv[2]
STAKE = 20
UNSEEN_FROM = '2025-07-01'
STRONG = {'result': 0.55, 'goals': 0.65}  # model probability at which picks historically won 60%+
rows = json.load(open(SOURCE))


def weekend_key(row):
    shifted = datetime.fromisoformat(row['kickoff'].replace('Z', '')) - timedelta(days=4)  # Friday-to-Thursday blocks
    year, week, _ = shifted.isocalendar()
    return f'{year}-{week:02d}'


def strong_legs(match_rows, source, market=None):
    # One leg per match: its most confident strong pick that has a price at this source.
    legs = []
    for row in match_rows:
        options = [row[m] for m in ('result', 'goals') if market in (None, m) and row[m]['odds'][source] and row[m]['probability'] >= STRONG[m]]
        if options:
            legs.append(max(options, key=lambda option: option['probability']))
    return sorted(legs, key=lambda leg: -leg['probability'])


def every_leg(match_rows, source):
    return [row[m] for row in match_rows for m in ('result', 'goals') if row[m]['odds'][source]]


def ticket_profit(ticket, source):
    return STAKE * (math.prod(leg['odds'][source] for leg in ticket) - 1) if all(leg['won'] for leg in ticket) else -STAKE


def replay(source, size, every=False, unseen_only=False):
    weekends = defaultdict(list)
    for row in rows:
        if not unseen_only or row['kickoff'] >= UNSEEN_FROM:
            weekends[weekend_key(row)].append(row)
    results, tickets, wins = [], 0, 0
    for key in sorted(weekends):
        legs = every_leg(weekends[key], source) if every else strong_legs(weekends[key], source)
        chunks = [legs[i:i + size] for i in range(0, len(legs) - len(legs) % size, size)]
        if chunks:
            results.append(sum(ticket_profit(chunk, source) for chunk in chunks))
            tickets += len(chunks)
            wins += sum(1 for chunk in chunks if all(leg['won'] for leg in chunk))
    staked = STAKE * tickets
    return {'source': source, 'size': size, 'every': every, 'tickets': tickets, 'ticketWins': wins, 'roi': sum(results) / staked,
            'profitableWeekends': sum(1 for r in results if r > 0) / len(results), 'averageWeekend': sum(results) / len(results),
            'worstWeekend': min(results), 'bestWeekend': max(results)}


def roi(legs, source):
    return sum(leg['odds'][source] if leg['won'] else 0 for leg in legs) / len(legs) - 1 if legs else None


def interval(legs, source):
    if len(legs) < 30:
        return None
    rng = random.Random(1)
    values = sorted(roi([rng.choice(legs) for _ in legs], source) for _ in range(500))
    return [values[12], values[487]]


def league_table():
    by_league = defaultdict(list)
    for row in rows:
        by_league[row['league']].append(row)
    table = []
    for code, league_rows in by_league.items():
        before = [r for r in league_rows if r['kickoff'] < UNSEEN_FROM]
        after = [r for r in league_rows if r['kickoff'] >= UNSEEN_FROM]
        entry = {'league': code}
        for source in ('bet365', 'best'):
            legs = strong_legs(league_rows, source)
            entry[source] = {'bets': len(legs), 'hitRate': sum(l['won'] for l in legs) / len(legs), 'roi': roi(legs, source),
                             'interval': interval(legs, source), 'before': roi(strong_legs(before, source), source),
                             'after': roi(strong_legs(after, source), source), 'afterBets': len(strong_legs(after, source))}
        entry['resultOnly'] = roi(strong_legs(league_rows, 'best', 'result'), 'best')
        entry['goalsOnly'] = roi(strong_legs(league_rows, 'best', 'goals'), 'best')
        table.append(entry)
    return sorted(table, key=lambda e: -e['bet365']['roi'])


def leg_value(source):
    legs = [row[m] for row in rows for m in ('result', 'goals') if row[m]['odds'][source] and row[m]['probability'] >= STRONG[m]]
    return {'legs': len(legs), 'hitRate': sum(l['won'] for l in legs) / len(legs),
            'averageOdds': sum(l['odds'][source] for l in legs) / len(legs), 'evPerLeg': roi(legs, source)}


study = {
    'generatedAt': datetime.now(timezone.utc).isoformat(), 'matches': len(rows), 'stake': STAKE, 'unseenFrom': UNSEEN_FROM, 'strongThresholds': STRONG,
    'legValue': {source: leg_value(source) for source in ('bet365', 'best')},
    'strategies': [replay(source, 1, every=True) for source in ('bet365', 'best')] +
                  [replay(source, size) for source in ('bet365', 'best') for size in (1, 2, 3, 5, 10)],
    'unseen': [replay(source, size, unseen_only=True) for source in ('bet365', 'best') for size in (1, 2, 3, 5)],
    'leagues': league_table()
}
json.dump(study, open(OUTPUT, 'w'), indent=1)
print('wrote', OUTPUT)

import json
from typing import Any, List

VALID_RANKS = {'A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'}
VALID_SUITS = {'S', 'H', 'D', 'C'}
CONFIDENCE_LEVELS = {'high', 'medium', 'low'}

def parse_zone_cards_json(text: str) -> List[Any]:
    cleaned = text.strip()
    start, end = cleaned.find('{'), cleaned.rfind('}')
    if start != -1 and end != -1:
        cleaned = cleaned[start:end + 1]
    raw = json.loads(cleaned).get('cards', [])
    if len(raw) != 4:
        raise ValueError('Expected exactly four card-position results')
    result = []
    for card in raw:
        if not isinstance(card, dict):
            result.append(None)
            continue
        rank = str(card.get('rank', '')).upper().strip()
        if rank in ('T', '10'):
            rank = '10'
        suit = str(card.get('suit', '')).upper().strip()[:1]
        confidence = str(card.get('confidence', 'low')).lower().strip()
        if confidence not in CONFIDENCE_LEVELS:
            confidence = 'low'
        if rank not in VALID_RANKS or suit not in VALID_SUITS:
            result.append(None)
            continue
        stable_samples = 2 if card.get('stable_samples') == 2 else 1
        result.append({'rank': rank, 'suit': suit, 'confidence': confidence, 'stable_samples': stable_samples})
    return result

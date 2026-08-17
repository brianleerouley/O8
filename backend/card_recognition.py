import json
from typing import Any, List

VALID_RANKS = {'A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'}
VALID_SUITS = {'S', 'H', 'D', 'C'}
CONFIDENCE_LEVELS = {'high', 'medium', 'low'}

def parse_position_cards_json(text: str, expected: int) -> List[Any]:
    cleaned = text.strip()
    start, end = cleaned.find('{'), cleaned.rfind('}')
    if start != -1 and end != -1:
        cleaned = cleaned[start:end + 1]
    raw = json.loads(cleaned).get('cards', [])
    if len(raw) != expected:
        raise ValueError(f'Expected exactly {expected} card-position results')
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


def parse_zone_cards_json(text: str) -> List[Any]:
    return parse_position_cards_json(text, 4)


def parse_recognized_hand_json(text: str) -> List[Any]:
    cards = parse_position_cards_json(text, 4)
    if any(card is None for card in cards):
        raise ValueError('All four cards must have a valid rank and suit')
    ids = [f"{card['rank']}{card['suit']}" for card in cards]
    if len(set(ids)) != 4:
        raise ValueError('Recognized cards must be unique')
    return [
        {'rank': card['rank'], 'suit': card['suit'], 'confidence': card['confidence']}
        for card in cards
    ]

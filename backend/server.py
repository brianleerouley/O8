from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from pydantic import BaseModel, field_validator
from typing import List, Dict, Any
from card_recognition import parse_position_cards_json, parse_recognized_hand_json, parse_zone_cards_json
from openai_vision import VisionConfigurationError, openai_api_key, recognize_images
from persistence import clear_hand_records, list_hand_records, persistence_enabled, save_hand_record

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

PERSISTENCE_ENABLED = persistence_enabled()
client = None
db = None
if PERSISTENCE_ENABLED:
    from motor.motor_asyncio import AsyncIOMotorClient

    mongo_url = os.environ['MONGO_URL']
    client = AsyncIOMotorClient(mongo_url)
    db = client[os.environ['DB_NAME']]

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI(title="Omaha8 Hand Evaluator")
api_router = APIRouter(prefix="/api")

# ----------------------------------------------------------------------------
# Omaha8 (Omaha Hi-Lo, 8-or-better) starting hand evaluation engine
# ----------------------------------------------------------------------------

RANKS = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2']
SUITS = ['S', 'H', 'D', 'C']
SUIT_SYMBOLS = {'S': '\u2660', 'H': '\u2665', 'D': '\u2666', 'C': '\u2663'}
RANK_VALUE = {'A': 14, 'K': 13, 'Q': 12, 'J': 11, '10': 10, '9': 9,
              '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2}
LOW_RANKS = {'A', '2', '3', '4', '5', '6', '7', '8'}
WHEEL_RANKS = {'A', '2', '3', '4', '5'}
BROADWAY_RANKS = {'A', 'K', 'Q', 'J', '10'}
BIG_RANKS = {'A', 'K', 'Q', 'J'}


class Card(BaseModel):
    rank: str
    suit: str

    @field_validator('rank')
    @classmethod
    def valid_rank(cls, v):
        if v not in RANK_VALUE:
            raise ValueError(f'Invalid rank: {v}')
        return v

    @field_validator('suit')
    @classmethod
    def valid_suit(cls, v):
        if v not in SUITS:
            raise ValueError(f'Invalid suit: {v}')
        return v


class EvaluateRequest(BaseModel):
    cards: List[Card]

    @field_validator('cards')
    @classmethod
    def four_cards(cls, v):
        if len(v) != 4:
            raise ValueError('Exactly four cards are required')
        ids = [f'{c.rank}{c.suit}' for c in v]
        if len(set(ids)) != len(ids):
            raise ValueError('Cards must be unique')
        return v


def _count_map(values):
    out = {}
    for v in values:
        out[v] = out.get(v, 0) + 1
    return out


def low_class(cards) -> Dict[str, Any]:
    ranks = [c.rank for c in cards]
    low_count = sum(1 for r in ranks if r in LOW_RANKS)
    wheel_count = sum(1 for r in ranks if r in WHEEL_RANKS)
    has = {r: (r in ranks) for r in ['A', '2', '3', '4', '5']}

    if has['A'] and has['2'] and wheel_count >= 3:
        return {'code': 'L4', 'points': 4, 'label': 'Nut low + wheel backup',
                'text': 'A-2 plus extra wheel cards give the nut low with counterfeit protection.',
                'color': 'good'}
    if has['A'] and has['2']:
        return {'code': 'L3', 'points': 3, 'label': 'Nut low core',
                'text': 'A-2 makes the best possible low, but with little counterfeit protection.',
                'color': 'good'}
    if (has['A'] and has['3'] and wheel_count >= 3) or \
       ((has['2'] or has['3']) and (has['4'] or has['5']) and low_count >= 3):
        return {'code': 'L2', 'points': 2, 'label': 'Strong low draw',
                'text': 'A near-nut low draw with several low cards working together.',
                'color': 'good'}
    if (has['A'] and low_count >= 2) or low_count >= 3:
        return {'code': 'L1', 'points': 1, 'label': 'Marginal low',
                'text': 'A speculative low that will rarely be the nuts.',
                'color': 'warn'}
    return {'code': 'L0', 'points': 0, 'label': 'No low',
            'text': 'This hand cannot realistically make a qualifying low.',
            'color': 'bad'}


def high_class(cards) -> Dict[str, Any]:
    ranks = [c.rank for c in cards]
    suits = _count_map([c.suit for c in cards])
    rank_counts = sorted(_count_map(ranks).values(), reverse=True)
    broadway_count = sum(1 for r in ranks if r in BROADWAY_RANKS)
    unique_vals = sorted({(1 if r == 'A' else RANK_VALUE[r]) for r in ranks})
    span = unique_vals[-1] - unique_vals[0]
    double_suited = sorted(suits.values(), reverse=True)[:2] == [2, 2]
    suited_ace = 'A' in ranks and any(c.rank == 'A' and suits[c.suit] >= 2 for c in cards)
    big_pair = rank_counts[0] == 2 and any(r in BIG_RANKS for r in ranks)
    connected = len(unique_vals) == 4 and span <= 5

    if double_suited or (suited_ace and connected) or (big_pair and broadway_count >= 2):
        return {'code': 'H3', 'points': 3, 'label': 'Premium high',
                'text': 'Excellent high potential: strong flush and/or straight and pair power.',
                'color': 'good'}
    if suited_ace or big_pair or connected or broadway_count >= 3:
        return {'code': 'H2', 'points': 2, 'label': 'Solid high',
                'text': 'A real high plan through flushes, straights, or top pairs.',
                'color': 'good'}
    if broadway_count >= 2 or any(v >= 2 for v in suits.values()):
        return {'code': 'H1', 'points': 1, 'label': 'Weak high',
                'text': 'Only marginal high value; easily dominated.',
                'color': 'warn'}
    return {'code': 'H0', 'points': 0, 'label': 'No high',
            'text': 'Almost no high-hand potential.',
            'color': 'bad'}


def fit_class(cards, low, high) -> Dict[str, Any]:
    ranks = [c.rank for c in cards]
    low_count = sum(1 for r in ranks if r in LOW_RANKS)
    high_count = sum(1 for r in ranks if r in BROADWAY_RANKS)
    suits = _count_map([c.suit for c in cards])
    suited = any(v >= 2 for v in suits.values())

    if (low['points'] >= 2 and high['points'] >= 2) or \
       (low_count >= 3 and suited) or (high_count >= 3 and suited):
        return {'code': 'F2', 'points': 2, 'label': 'All four cards fit',
                'text': 'Every card contributes; no danglers.',
                'color': 'good'}
    if low['points'] >= 2 or high['points'] >= 2 or low_count >= 3 or high_count >= 3:
        return {'code': 'F1', 'points': 1, 'label': 'Three cards cooperate',
                'text': 'Most cards work together, but one is a dangler.',
                'color': 'warn'}
    return {'code': 'F0', 'points': 0, 'label': 'Broken hand',
            'text': 'The cards do not coordinate; likely a scattered holding.',
            'color': 'bad'}


def risk_class(cards, low, high, fit) -> Dict[str, Any]:
    ranks = [c.rank for c in cards]
    suits = _count_map([c.suit for c in cards])
    rainbow = not any(v >= 2 for v in suits.values())
    has_a2 = 'A' in ranks and '2' in ranks
    backup_wheel = any(r in {'3', '4', '5'} for r in ranks)

    if low['points'] >= 3 and high['points'] >= 2 and fit['points'] >= 2:
        return {'code': 'R0', 'penalty': 0, 'label': 'Scoop-friendly', 'danger': 'Low',
                'text': 'Both halves are covered; minimal downside.', 'color': 'good'}
    if has_a2 and not backup_wheel and high['points'] <= 1:
        return {'code': 'R2', 'penalty': 2, 'label': 'Quartering risk', 'danger': 'High',
                'text': 'A bare A-2 with no backup often gets quartered on the low.',
                'color': 'bad'}
    if (low['points'] == 0 and high['points'] <= 1) or (fit['points'] == 0 and rainbow):
        return {'code': 'R3', 'penalty': 3, 'label': 'Trap hand', 'danger': 'Very high',
                'text': 'Little to win with and easy to overplay: a classic trap.',
                'color': 'bad'}
    return {'code': 'R1', 'penalty': 1, 'label': 'Split-pot risk', 'danger': 'Medium',
            'text': 'Playable, but likely to win only half the pot.', 'color': 'warn'}


def scoop_potential(low, high) -> Dict[str, Any]:
    lp, hp = low['points'], high['points']
    if lp >= 3 and hp >= 3:
        pct, label = 78, 'Excellent'
    elif lp >= 3 and hp >= 2:
        pct, label = 62, 'Strong'
    elif lp >= 2 and hp >= 2:
        pct, label = 45, 'Moderate'
    elif lp >= 2 or hp >= 2:
        pct, label = 25, 'One-way'
    else:
        pct, label = 10, 'Poor'

    if label in ('Excellent', 'Strong'):
        text = 'This hand can chase both the high and low halves, giving it real scoop equity — the goal in Omaha8.'
    elif label == 'Moderate':
        text = 'Some two-way potential, but it needs help on the board to scoop both halves.'
    elif label == 'One-way':
        text = 'This hand mainly plays for one half of the pot, so it wins small even when it hits.'
    else:
        text = 'Almost no scoop potential — it rarely wins either half cleanly.'
    return {'label': label, 'pct': pct, 'text': text}


def classify_plan(low, high) -> str:
    if low['points'] >= 3 and high['points'] >= 2:
        return 'Two-way'
    if low['points'] >= high['points']:
        return 'Low-first' if low['points'] > 0 else 'No clear plan'
    return 'High-first'


def final_action(total) -> Dict[str, Any]:
    if total >= 7:
        return {'action': 'Raise / Build', 'chip': 'Premium', 'banner': 'good',
                'title': 'Premium Omaha8 hand'}
    if total >= 5:
        return {'action': 'Play', 'chip': 'Playable', 'banner': 'good',
                'title': 'Solid, playable hand'}
    if total >= 3:
        return {'action': 'Caution', 'chip': 'Caution', 'banner': 'warn',
                'title': 'Spot-dependent hand'}
    return {'action': 'Fold', 'chip': 'Fold', 'banner': 'bad',
            'title': 'Usually a fold'}


def tag_list(low, high, fit, risk):
    good, warn = [], []
    if low['code'] == 'L4':
        good.append('Nut low with backup')
    elif low['code'] == 'L3':
        good.append('Nut low core')
    elif low['points'] >= 1:
        good.append('Some low value')
    if high['code'] == 'H3':
        good.append('Premium high')
    elif high['code'] == 'H2':
        good.append('Solid high plan')
    if fit['code'] == 'F2':
        good.append('Cards work together')
    elif fit['code'] == 'F1':
        warn.append('One weak side card')
    if risk['code'] == 'R0':
        good.append('Scoop-friendly')
    if risk['code'] == 'R1':
        warn.append('May split often')
    if risk['code'] == 'R2':
        warn.append('Can get quartered')
    if risk['code'] == 'R3':
        warn.append('Trap hand')
    if high['points'] == 0:
        warn.append('Little high power')
    if low['points'] == 0:
        warn.append('Little low power')
    return {'good': good, 'warn': warn}


def explain(cards, total, plan, scoop):
    card_text = ' '.join(f"{c.rank}{SUIT_SYMBOLS[c.suit]}" for c in cards)
    if total >= 7:
        return (f"{card_text} is strong because it plays for both halves of the pot. "
                f"With {scoop['label'].lower()} scoop potential, you should raise to build the pot.")
    if total >= 5:
        return (f"{card_text} is playable because it has a real {plan.lower()} plan and enough "
                f"backup to avoid being a pure guess.")
    if total >= 3:
        return (f"{card_text} is spot-dependent: part of the hand works, but it does not "
                f"coordinate cleanly enough to play from every position.")
    return (f"{card_text} is usually a fold — it rarely makes the nut low or a strong high, "
            f"and carries too much split or trap risk.")


def evaluate_hand(cards) -> Dict[str, Any]:
    low = low_class(cards)
    high = high_class(cards)
    fit = fit_class(cards, low, high)
    risk = risk_class(cards, low, high, fit)
    total = max(0, low['points'] + high['points'] + fit['points'] - risk['penalty'])
    plan = classify_plan(low, high)
    action = final_action(total)
    scoop = scoop_potential(low, high)
    tags = tag_list(low, high, fit, risk)
    note = explain(cards, total, plan, scoop)
    formula = (f"{low['code']} + {high['code']} + {fit['code']} - {risk['code']} = {total}, "
               f"which means {action['action'].lower()}.")
    return {
        'cards': [{'rank': c.rank, 'suit': c.suit, 'symbol': SUIT_SYMBOLS[c.suit]} for c in cards],
        'low': low, 'high': high, 'fit': fit, 'risk': risk,
        'total': total, 'max_total': 9, 'plan': plan, 'action': action,
        'scoop': scoop, 'tags': tags, 'note': note, 'formula': formula,
    }


@api_router.get("/")
async def root():
    return {"message": "Omaha8 Hand Evaluator API"}


@api_router.post("/evaluate")
async def evaluate(req: EvaluateRequest):
    try:
        return evaluate_hand(req.cards)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ----------------------------------------------------------------------------
# Card photo recognition (vision) — extracts 4 cards from an uploaded image
# ----------------------------------------------------------------------------

ALLOWED_IMAGE_TYPES = {'image/jpeg', 'image/jpg', 'image/png', 'image/webp'}


def require_remote_recognition():
    if not openai_api_key():
        raise HTTPException(
            status_code=503,
            detail="AI card recognition is not configured. Set OPENAI_API_KEY to enable it.",
        )


RECOGNIZE_PROMPT = (
    "You are a playing-card recognizer. The image shows exactly four playing cards. "
    "Identify each card's rank and suit, reading left to right. "
    "Respond with ONLY valid JSON, no markdown, in this exact shape: "
    '{"cards":[{"rank":"A","suit":"S","confidence":"high"},{"rank":"K","suit":"H","confidence":"low"},'
    '{"rank":"10","suit":"D","confidence":"high"},{"rank":"7","suit":"C","confidence":"medium"}]}. '
    "rank must be one of: A, K, Q, J, 10, 9, 8, 7, 6, 5, 4, 3, 2 (use \"10\" for ten). "
    "suit must be one of: S (spades), H (hearts), D (diamonds), C (clubs). "
    'confidence must be "high", "medium", or "low" and reflect how sure you are about THAT card '
    "(use low/medium if the card is blurry, partially hidden, or ambiguous). "
    "Always return exactly four cards. If a card is unclear, give your best guess and mark it low."
)

CONFIDENCE_LEVELS = {'high', 'medium', 'low'}


def _parse_cards_json(text: str) -> List[Dict[str, str]]:
    cleaned = text.strip()
    if cleaned.startswith('```'):
        cleaned = cleaned.strip('`')
        if cleaned.lower().startswith('json'):
            cleaned = cleaned[4:]
    start, end = cleaned.find('{'), cleaned.rfind('}')
    if start != -1 and end != -1:
        cleaned = cleaned[start:end + 1]
    data = json.loads(cleaned)
    raw = data.get('cards', [])
    result = []
    for c in raw:
        rank = str(c.get('rank', '')).upper().strip()
        if rank in ('T', '10'):
            rank = '10'
        suit = str(c.get('suit', '')).upper().strip()[:1]
        conf = str(c.get('confidence', 'high')).lower().strip()
        if conf not in CONFIDENCE_LEVELS:
            conf = 'high'
        if rank in RANK_VALUE and suit in SUITS:
            result.append({'rank': rank, 'suit': suit, 'confidence': conf})
    return result


@api_router.post("/recognize-cards")
async def recognize_cards(file: UploadFile = File(...)):
    require_remote_recognition()
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400,
                            detail="Unsupported image type. Please upload a JPEG, PNG, or WEBP.")

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty image file.")
    try:
        response, latency_ms = await recognize_images(
            RECOGNIZE_PROMPT,
            [(image_bytes, file.content_type)],
        )
    except VisionConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        logger.error("OpenAI recognition request failed: %s", exc)
        raise HTTPException(status_code=502, detail="The vision model could not process the image.")

    try:
        cards = parse_recognized_hand_json(response)
    except Exception as exc:
        logger.warning("OpenAI recognition parse failed: %s", exc)
        raise HTTPException(status_code=422,
                            detail="Could not read the cards clearly. Try a sharper, well-lit photo.")
    logger.info("OpenAI recognition parse succeeded cards=%d latency_ms=%d", len(cards), latency_ms)
    return {"cards": cards, "latency_ms": latency_ms}


SCAN_PROMPT = (
    "You are a playing-card recognizer looking at a live camera frame. "
    "Identify every playing card you can read CONFIDENTLY (there may be zero to four). "
    "Respond with ONLY valid JSON, no markdown: "
    '{"cards":[{"rank":"A","suit":"S","confidence":"high"}]}. '
    "rank must be one of: A, K, Q, J, 10, 9, 8, 7, 6, 5, 4, 3, 2 (use \"10\" for ten). "
    "suit must be one of: S (spades), H (hearts), D (diamonds), C (clubs). "
    'confidence must be "high", "medium", or "low" for how sure you are of that card. '
    "Only include a card if you can read it. "
    "It is fine to return fewer than four cards, or an empty list, if you are unsure."
)


@api_router.post("/scan-frame")
async def scan_frame(file: UploadFile = File(...)):
    """Lenient single-frame recognizer for live camera scanning (returns 0-4 cards)."""
    require_remote_recognition()
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported image type.")

    image_bytes = await file.read()
    if not image_bytes:
        return {"cards": [], "count": 0}
    try:
        response, _latency_ms = await recognize_images(SCAN_PROMPT, [(image_bytes, file.content_type)])
        cards = _parse_cards_json(response)
    except VisionConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        logger.error("scan-frame error: %s", exc)
        return {"cards": [], "count": 0}

    # Dedupe while preserving order, cap at 4
    seen, unique = set(), []
    for c in cards:
        cid = f"{c['rank']}{c['suit']}"
        if cid not in seen:
            seen.add(cid)
            unique.append(c)
        if len(unique) == 4:
            break
    return {"cards": unique, "count": len(unique)}


ZONE_SCAN_PROMPT = (
    "You are reading four fixed playing-card positions from two rapid camera samples. "
    "Images 1-4 are sample A for card positions 1-4, left to right. "
    "Images 5-8 are sample B for those same positions 1-4. "
    "Compare each position's two crops and identify exactly one card per position. "
    "Respond with ONLY valid JSON, no markdown, shaped as: "
    '{"cards":[{"rank":"A","suit":"S","confidence":"high","stable_samples":2},null,null,null]}. '
    "Return exactly four array entries and preserve position order. Use null when unreadable. "
    "rank must be A, K, Q, J, 10, 9, 8, 7, 6, 5, 4, 3, or 2. "
    "suit must be S, H, D, or C. confidence must be high, medium, or low. "
    "Set stable_samples to 2 only when both crops support the same rank and suit; otherwise 1. "
    "Do not infer a card from another position."
)


@api_router.post("/scan-zones")
async def scan_zones(files: List[UploadFile] = File(...)):
    """Recognize four fixed card zones from two successive cropped samples."""
    require_remote_recognition()
    if len(files) != 8:
        raise HTTPException(status_code=400, detail="Expected two samples for each of four card zones.")

    images = []
    for file in files:
        if file.content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(status_code=400, detail="Unsupported card-zone image type.")
        image_bytes = await file.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="One or more card-zone images were empty.")
        images.append((image_bytes, file.content_type))

    try:
        response, latency_ms = await recognize_images(ZONE_SCAN_PROMPT, images)
        cards = parse_zone_cards_json(response)
    except VisionConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        logger.error("scan-zones error: %s", exc)
        raise HTTPException(status_code=422, detail="Could not stabilize all four card zones.")

    return {
        "cards": cards,
        "count": sum(card is not None for card in cards),
        "latency_ms": latency_ms,
    }


FALLBACK_SCAN_PROMPT = (
    "You are a fallback recognizer for unresolved playing-card corner crops. "
    "Each image contains only the upper-left rank and suit corner of one card. "
    "Read each image independently and preserve image order. "
    "Respond with ONLY valid JSON shaped as "
    '{"cards":[{"rank":"A","suit":"S","confidence":"high","stable_samples":2}]}. '
    "Return one array entry per image, using null when unreadable. "
    "rank must be A, K, Q, J, 10, 9, 8, 7, 6, 5, 4, 3, or 2. "
    "suit must be S, H, D, or C. Use stable_samples 2 only for a high-confidence reading."
)


@api_router.post("/scan-zone-fallback")
async def scan_zone_fallback(
    files: List[UploadFile] = File(...),
    positions: str = Form(...),
):
    """Remote fallback for only the card corners unresolved by local recognition."""
    require_remote_recognition()
    try:
        slot_positions = json.loads(positions)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid fallback card positions.")
    if not files or len(files) > 4 or len(slot_positions) != len(files):
        raise HTTPException(status_code=400, detail="Fallback requires one to four matching card positions.")
    if any(not isinstance(position, int) or position < 0 or position > 3 for position in slot_positions):
        raise HTTPException(status_code=400, detail="Fallback card positions must be between 0 and 3.")
    if len(set(slot_positions)) != len(slot_positions):
        raise HTTPException(status_code=400, detail="Fallback card positions must be unique.")

    images = []
    for file in files:
        if file.content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(status_code=400, detail="Unsupported fallback corner image type.")
        image_bytes = await file.read()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="One or more fallback corner images were empty.")
        images.append((image_bytes, file.content_type))

    try:
        response, latency_ms = await recognize_images(FALLBACK_SCAN_PROMPT, images)
        cards = parse_position_cards_json(response, len(files))
    except VisionConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        logger.error("scan-zone-fallback error: %s", exc)
        raise HTTPException(status_code=422, detail="Fallback could not read the unresolved card corners.")

    return {
        "positions": slot_positions,
        "cards": cards,
        "latency_ms": latency_ms,
    }


# ----------------------------------------------------------------------------
# Hand history (camera/scan-sourced hands only)
# ----------------------------------------------------------------------------

def _band(total: int) -> str:
    return 'red' if total <= 3 else 'gold' if total <= 6 else 'green'


class SaveHandRequest(BaseModel):
    cards: List[Card]
    source: str = 'camera'

    @field_validator('cards')
    @classmethod
    def four_cards(cls, v):
        if len(v) != 4:
            raise ValueError('Exactly four cards are required')
        ids = [f'{c.rank}{c.suit}' for c in v]
        if len(set(ids)) != len(ids):
            raise ValueError('Cards must be unique')
        return v


@api_router.post("/hands")
async def save_hand(req: SaveHandRequest):
    ev = evaluate_hand(req.cards)
    record = {
        'id': str(uuid.uuid4()),
        'cards': ev['cards'],
        'total': ev['total'],
        'action': ev['action']['action'],
        'chip': ev['action']['chip'],
        'title': ev['action']['title'],
        'band': _band(ev['total']),
        'plan': ev['plan'],
        'scoop': ev['scoop']['label'],
        'source': req.source if req.source in ('camera', 'upload') else 'camera',
        'timestamp': datetime.now(timezone.utc).isoformat(),
    }
    await save_hand_record(db, PERSISTENCE_ENABLED, record)
    return record


@api_router.get("/hands")
async def list_hands(limit: int = 50):
    docs = await list_hand_records(db, PERSISTENCE_ENABLED, limit)
    return {"hands": docs}


@api_router.delete("/hands")
async def clear_hands():
    deleted = await clear_hand_records(db, PERSISTENCE_ENABLED)
    return {"deleted": deleted}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    if client is not None:
        client.close()

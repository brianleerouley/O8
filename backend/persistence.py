import os
from typing import Optional


FALSE_VALUES = {'0', 'false', 'no', 'off'}


def persistence_enabled(value: Optional[str] = None) -> bool:
    """Persistence defaults on and is disabled only by an explicit false value."""
    configured = os.environ.get('PERSISTENCE_ENABLED', 'true') if value is None else value
    return configured.strip().lower() not in FALSE_VALUES


async def save_hand_record(database, enabled: bool, record):
    if enabled:
        await database.hands.insert_one({**record})


async def list_hand_records(database, enabled: bool, limit: int):
    if not enabled:
        return []
    bounded_limit = max(1, min(limit, 100))
    return await database.hands.find({}, {"_id": 0}).sort("timestamp", -1).to_list(bounded_limit)


async def clear_hand_records(database, enabled: bool) -> int:
    if not enabled:
        return 0
    result = await database.hands.delete_many({})
    return result.deleted_count

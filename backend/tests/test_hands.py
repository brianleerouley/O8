"""Tests for /api/hands (history) and confidence-flag additions."""
import os
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
HANDS = f"{BASE_URL}/api/hands"
RECOG = f"{BASE_URL}/api/recognize-cards"
SCAN = f"{BASE_URL}/api/scan-frame"

TEST_IMG = "/tmp/test_cards.jpg"


def _cards(*pairs):
    return [{"rank": r, "suit": s} for r, s in pairs]


@pytest.fixture(scope="module", autouse=True)
def clean_hands_before_and_after():
    requests.delete(HANDS)
    yield
    requests.delete(HANDS)


class TestHandsCRUD:
    def test_delete_returns_deleted_count(self):
        # start clean
        r = requests.delete(HANDS)
        assert r.status_code == 200
        assert "deleted" in r.json()

    def test_save_green_hand_and_band(self):
        # A-S K-S 2-H 3-H is a premium (total 9) -> green
        payload = {"cards": _cards(('A','S'),('K','S'),('2','H'),('3','H')), "source": "camera"}
        r = requests.post(HANDS, json=payload)
        assert r.status_code == 200, r.text
        rec = r.json()
        for k in ['id','cards','total','action','chip','title','band','plan','scoop','source','timestamp']:
            assert k in rec, f"missing {k}"
        assert rec['source'] == 'camera'
        assert rec['total'] >= 7
        assert rec['band'] == 'green'
        assert isinstance(rec['id'], str) and len(rec['id']) > 0

    def test_save_gold_hand_band(self):
        # A-S 2-H 5-C K-D usually ~5 -> gold
        payload = {"cards": _cards(('A','S'),('2','H'),('5','C'),('K','D')), "source": "upload"}
        r = requests.post(HANDS, json=payload)
        assert r.status_code == 200
        rec = r.json()
        assert 4 <= rec['total'] <= 6
        assert rec['band'] == 'gold'
        assert rec['source'] == 'upload'

    def test_save_red_hand_band(self):
        # K-S Q-H 9-C 4-D scattered, low total
        payload = {"cards": _cards(('K','S'),('Q','H'),('9','C'),('4','D')), "source": "camera"}
        r = requests.post(HANDS, json=payload)
        assert r.status_code == 200
        rec = r.json()
        assert rec['total'] <= 3
        assert rec['band'] == 'red'

    def test_list_newest_first_and_persistence(self):
        r = requests.get(HANDS)
        assert r.status_code == 200
        data = r.json()
        assert 'hands' in data
        hands = data['hands']
        assert len(hands) >= 3
        # newest first: timestamps descending
        ts = [h['timestamp'] for h in hands]
        assert ts == sorted(ts, reverse=True)
        # no mongodb _id leak
        for h in hands:
            assert '_id' not in h

    def test_limit_capped_at_100(self):
        r = requests.get(HANDS, params={"limit": 500})
        assert r.status_code == 200
        assert len(r.json()['hands']) <= 100

    def test_invalid_source_normalised_to_camera(self):
        payload = {"cards": _cards(('A','S'),('2','H'),('5','C'),('K','D')), "source": "hackyvalue"}
        r = requests.post(HANDS, json=payload)
        assert r.status_code == 200
        assert r.json()['source'] == 'camera'

    def test_duplicate_cards_rejected(self):
        payload = {"cards": _cards(('A','S'),('A','S'),('5','C'),('K','D'))}
        r = requests.post(HANDS, json=payload)
        assert r.status_code in (400, 422)

    def test_clear_all_removes_hands(self):
        r = requests.delete(HANDS)
        assert r.status_code == 200
        assert r.json()['deleted'] >= 1
        # list empty
        listing = requests.get(HANDS).json()['hands']
        assert listing == []


class TestConfidenceFlags:
    def test_recognize_returns_confidence_per_card(self):
        assert os.path.exists(TEST_IMG), "Missing /tmp/test_cards.jpg"
        with open(TEST_IMG, 'rb') as f:
            r = requests.post(RECOG, files={"file": ("cards.jpg", f, "image/jpeg")}, timeout=60)
        assert r.status_code == 200, r.text
        cards = r.json()['cards']
        assert len(cards) == 4
        for c in cards:
            assert 'confidence' in c
            assert c['confidence'] in ('high', 'medium', 'low')

    def test_scan_frame_returns_confidence(self):
        assert os.path.exists(TEST_IMG)
        with open(TEST_IMG, 'rb') as f:
            r = requests.post(SCAN, files={"file": ("cards.jpg", f, "image/jpeg")}, timeout=60)
        assert r.status_code == 200
        data = r.json()
        for c in data.get('cards', []):
            assert c.get('confidence') in ('high', 'medium', 'low')

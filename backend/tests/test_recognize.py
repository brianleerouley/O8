"""Tests for /api/recognize-cards vision endpoint"""
import io
import os
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
URL = f"{BASE_URL}/api/recognize-cards"

VALID_RANKS = {'A','K','Q','J','10','9','8','7','6','5','4','3','2'}
VALID_SUITS = {'S','H','D','C'}


class TestRecognizeCards:
    def test_reject_non_image(self):
        r = requests.post(URL, files={'file': ('t.txt', b'hello', 'text/plain')})
        assert r.status_code == 400
        assert 'Unsupported' in r.json().get('detail', '') or 'image' in r.json().get('detail','').lower()

    def test_reject_empty_image(self):
        # Empty file with image content-type still triggers empty-body check
        r = requests.post(URL, files={'file': ('e.jpg', b'', 'image/jpeg')})
        # Could be 400 (empty) or 502 (model fails) — accept either non-2xx
        assert r.status_code in (400, 422, 502)

    def test_valid_image_returns_four_cards(self):
        with open('/tmp/test_cards.jpg', 'rb') as f:
            r = requests.post(URL, files={'file': ('test_cards.jpg', f.read(), 'image/jpeg')}, timeout=90)
        assert r.status_code == 200, f"Body: {r.text}"
        data = r.json()
        assert 'cards' in data
        cards = data['cards']
        assert len(cards) == 4
        ids = set()
        for c in cards:
            assert c['rank'] in VALID_RANKS
            assert c['suit'] in VALID_SUITS
            ids.add(f"{c['rank']}{c['suit']}")
        assert len(ids) == 4, "Cards must be distinct"

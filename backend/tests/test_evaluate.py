"""Tests for Omaha8 evaluator API"""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://hand-recommend.preview.emergentagent.com').rstrip('/')
EVAL = f"{BASE_URL}/api/evaluate"


def _hand(*cards):
    return {"cards": [{"rank": r, "suit": s} for r, s in cards]}


class TestHealth:
    def test_root(self):
        r = requests.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert "Omaha8" in r.json().get("message", "")


class TestValidation:
    def test_three_cards_rejected(self):
        r = requests.post(EVAL, json=_hand(('A','S'),('2','H'),('5','C')))
        assert r.status_code in (400, 422)

    def test_five_cards_rejected(self):
        r = requests.post(EVAL, json=_hand(('A','S'),('2','H'),('5','C'),('K','D'),('Q','C')))
        assert r.status_code in (400, 422)

    def test_duplicate_cards_rejected(self):
        r = requests.post(EVAL, json=_hand(('A','S'),('A','S'),('5','C'),('K','D')))
        assert r.status_code in (400, 422)

    def test_invalid_rank(self):
        r = requests.post(EVAL, json=_hand(('Z','S'),('2','H'),('5','C'),('K','D')))
        assert r.status_code in (400, 422)

    def test_invalid_suit(self):
        r = requests.post(EVAL, json=_hand(('A','X'),('2','H'),('5','C'),('K','D')))
        assert r.status_code in (400, 422)


class TestEvaluationLogic:
    def test_default_hand_a2_5_k(self):
        # A-S 2-H 5-C K-D
        r = requests.post(EVAL, json=_hand(('A','S'),('2','H'),('5','C'),('K','D')))
        assert r.status_code == 200
        data = r.json()
        # structure
        for k in ['low','high','fit','risk','total','max_total','plan','action','scoop','tags','note','formula']:
            assert k in data
        assert data['max_total'] == 9
        assert data['low']['code'] in ('L3','L4')
        # A-2 with 5 => wheel_count>=3 -> L4
        assert data['low']['code'] == 'L4'
        # Playable-ish total around 5
        assert data['total'] >= 4
        assert data['action']['action'] in ('Play', 'Caution', 'Raise / Build')

    def test_weak_broken_hand(self):
        # K-S Q-H 7-C 3-D - scattered
        r = requests.post(EVAL, json=_hand(('K','S'),('Q','H'),('7','C'),('3','D')))
        assert r.status_code == 200
        data = r.json()
        assert data['total'] <= 4
        assert data['action']['action'] in ('Fold', 'Caution')

    def test_double_suited_premium(self):
        # A-S K-S 2-H 3-H - double suited with A2
        r = requests.post(EVAL, json=_hand(('A','S'),('K','S'),('2','H'),('3','H')))
        assert r.status_code == 200
        data = r.json()
        assert data['high']['code'] in ('H2','H3')
        # premium should have strong or excellent scoop
        assert data['scoop']['label'] in ('Strong', 'Excellent', 'Moderate')
        assert data['total'] >= 5

    def test_premium_stronger_than_broken(self):
        r1 = requests.post(EVAL, json=_hand(('A','S'),('K','S'),('2','H'),('3','H'))).json()
        r2 = requests.post(EVAL, json=_hand(('K','S'),('Q','H'),('7','C'),('3','D'))).json()
        assert r1['total'] > r2['total']
        assert r1['scoop']['pct'] > r2['scoop']['pct']

    def test_formula_string(self):
        r = requests.post(EVAL, json=_hand(('A','S'),('2','H'),('5','C'),('K','D')))
        d = r.json()
        assert '=' in d['formula']
        assert str(d['total']) in d['formula']

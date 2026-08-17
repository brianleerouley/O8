import json
import unittest

from card_recognition import parse_zone_cards_json


class ZoneCardParserTests(unittest.TestCase):
    def test_preserves_positions_and_stability(self):
        payload = {
            "cards": [
                {"rank": "A", "suit": "S", "confidence": "high", "stable_samples": 2},
                None,
                {"rank": "T", "suit": "h", "confidence": "medium", "stable_samples": 1},
                {"rank": "5", "suit": "C", "confidence": "unknown", "stable_samples": 99},
            ]
        }
        cards = parse_zone_cards_json(json.dumps(payload))
        self.assertEqual(cards[0], {"rank": "A", "suit": "S", "confidence": "high", "stable_samples": 2})
        self.assertIsNone(cards[1])
        self.assertEqual(cards[2]["rank"], "10")
        self.assertEqual(cards[2]["suit"], "H")
        self.assertEqual(cards[3]["confidence"], "low")
        self.assertEqual(cards[3]["stable_samples"], 1)

    def test_requires_four_positions(self):
        with self.assertRaisesRegex(ValueError, "four"):
            parse_zone_cards_json('{"cards":[null]}')


if __name__ == "__main__":
    unittest.main()

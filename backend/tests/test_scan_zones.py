import json
import unittest

from card_recognition import parse_position_cards_json, parse_zone_cards_json


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
        with self.assertRaisesRegex(ValueError, "4"):
            parse_zone_cards_json('{"cards":[null]}')

    def test_fallback_parser_accepts_only_the_requested_positions(self):
        cards = parse_position_cards_json(
            '{"cards":[{"rank":"Q","suit":"D","confidence":"high","stable_samples":2},null]}',
            2,
        )
        self.assertEqual(cards[0]["rank"], "Q")
        self.assertIsNone(cards[1])


if __name__ == "__main__":
    unittest.main()

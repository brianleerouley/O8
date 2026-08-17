import json
import unittest

from card_recognition import parse_position_cards_json, parse_recognized_hand_json, parse_zone_cards_json


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

    def test_complete_hand_parser_normalizes_ten(self):
        cards = parse_recognized_hand_json(json.dumps({'cards': [
            {'rank': 'A', 'suit': 'S', 'confidence': 'high'},
            {'rank': 'T', 'suit': 'C', 'confidence': 'medium'},
            {'rank': '2', 'suit': 'H', 'confidence': 'high'},
            {'rank': '3', 'suit': 'D', 'confidence': 'high'},
        ]}))
        self.assertEqual(cards[1]['rank'], '10')

    def test_complete_hand_parser_accepts_real_world_four_card_hand(self):
        cards = parse_recognized_hand_json(json.dumps({'cards': [
            {'rank': 'A', 'suit': 'S', 'confidence': 'high'},
            {'rank': 'A', 'suit': 'C', 'confidence': 'high'},
            {'rank': '2', 'suit': 'S', 'confidence': 'high'},
            {'rank': '3', 'suit': 'C', 'confidence': 'high'},
        ]}))
        self.assertEqual(
            [(card['rank'], card['suit']) for card in cards],
            [('A', 'S'), ('A', 'C'), ('2', 'S'), ('3', 'C')],
        )

    def test_complete_hand_parser_rejects_malformed_json(self):
        with self.assertRaises(json.JSONDecodeError):
            parse_recognized_hand_json('not json')

    def test_complete_hand_parser_rejects_duplicates(self):
        payload = {'cards': [
            {'rank': 'A', 'suit': 'S'}, {'rank': 'A', 'suit': 'S'},
            {'rank': '2', 'suit': 'H'}, {'rank': '3', 'suit': 'D'},
        ]}
        with self.assertRaisesRegex(ValueError, 'unique'):
            parse_recognized_hand_json(json.dumps(payload))

    def test_complete_hand_parser_rejects_fewer_than_four(self):
        with self.assertRaisesRegex(ValueError, '4'):
            parse_recognized_hand_json('{"cards":[{"rank":"A","suit":"S"}]}')

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

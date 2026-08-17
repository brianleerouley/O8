import os
import unittest
from unittest.mock import patch

from persistence import clear_hand_records, list_hand_records, persistence_enabled, save_hand_record


class DatabaseMustNotBeUsed:
    def __getattr__(self, name):
        raise AssertionError(f'database was accessed while persistence was disabled: {name}')


class PersistenceConfigurationTests(unittest.TestCase):
    def test_defaults_to_enabled(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertTrue(persistence_enabled())

    def test_explicit_false_values_disable_persistence(self):
        for value in ('false', 'FALSE', '0', 'no', 'off'):
            with self.subTest(value=value):
                self.assertFalse(persistence_enabled(value))

    def test_other_values_preserve_default_enabled_behavior(self):
        for value in ('true', '1', 'yes', ''):
            with self.subTest(value=value):
                self.assertTrue(persistence_enabled(value))


class PersistenceDisabledBehaviorTests(unittest.IsolatedAsyncioTestCase):
    async def test_save_accepts_record_without_database_access(self):
        record = {'id': 'preview-hand'}
        self.assertIsNone(await save_hand_record(DatabaseMustNotBeUsed(), False, record))

    async def test_list_returns_empty_without_database_access(self):
        self.assertEqual(await list_hand_records(DatabaseMustNotBeUsed(), False, 50), [])

    async def test_clear_returns_zero_without_database_access(self):
        self.assertEqual(await clear_hand_records(DatabaseMustNotBeUsed(), False), 0)


if __name__ == '__main__':
    unittest.main()

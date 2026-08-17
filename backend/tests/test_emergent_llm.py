import unittest

import emergent_llm


class OptionalEmergentIntegrationTests(unittest.TestCase):
    def test_missing_private_package_is_treated_as_unavailable(self):
        def missing_import(_name):
            raise ImportError('package unavailable')

        self.assertEqual(emergent_llm.load_integration(missing_import), (None, None, None))

    def test_availability_requires_all_integration_classes(self):
        original = (emergent_llm.ImageContent, emergent_llm.LlmChat, emergent_llm.UserMessage)
        try:
            emergent_llm.ImageContent = object()
            emergent_llm.LlmChat = object()
            emergent_llm.UserMessage = object()
            self.assertTrue(emergent_llm.integration_available())
            emergent_llm.UserMessage = None
            self.assertFalse(emergent_llm.integration_available())
        finally:
            emergent_llm.ImageContent, emergent_llm.LlmChat, emergent_llm.UserMessage = original

    def test_unavailable_integration_has_explanatory_response(self):
        original = (emergent_llm.ImageContent, emergent_llm.LlmChat, emergent_llm.UserMessage)
        try:
            emergent_llm.ImageContent = None
            emergent_llm.LlmChat = None
            emergent_llm.UserMessage = None
            self.assertIn('unavailable', emergent_llm.unavailable_reason('configured-key'))
        finally:
            emergent_llm.ImageContent, emergent_llm.LlmChat, emergent_llm.UserMessage = original

    def test_missing_key_has_explanatory_response(self):
        original = (emergent_llm.ImageContent, emergent_llm.LlmChat, emergent_llm.UserMessage)
        try:
            emergent_llm.ImageContent = object()
            emergent_llm.LlmChat = object()
            emergent_llm.UserMessage = object()
            self.assertIn('not configured', emergent_llm.unavailable_reason(None))
            self.assertIsNone(emergent_llm.unavailable_reason('configured-key'))
        finally:
            emergent_llm.ImageContent, emergent_llm.LlmChat, emergent_llm.UserMessage = original


if __name__ == '__main__':
    unittest.main()

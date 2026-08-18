import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from openai_vision import VisionConfigurationError, recognize_images


class FakeResponses:
    def __init__(self, output_text):
        self.output_text = output_text
        self.request = None

    async def create(self, **kwargs):
        self.request = kwargs
        return SimpleNamespace(output_text=self.output_text)


class DirectOpenAIVisionTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_api_key_has_configuration_error(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(VisionConfigurationError, 'OPENAI_API_KEY'):
                await recognize_images('read cards', [(b'image', 'image/jpeg')])

    async def test_responses_api_receives_base64_data_url(self):
        responses = FakeResponses('{"cards":[]}')
        client = SimpleNamespace(responses=responses)
        text, latency_ms = await recognize_images(
            'read cards',
            [(b'image-bytes', 'image/jpeg')],
            api_key='test-key',
            client=client,
            model='test-vision-model',
        )
        self.assertEqual(text, '{"cards":[]}')
        self.assertGreaterEqual(latency_ms, 0)
        self.assertEqual(responses.request['model'], 'test-vision-model')
        content = responses.request['input'][0]['content']
        self.assertEqual(content[0], {'type': 'input_text', 'text': 'read cards'})
        self.assertTrue(content[1]['image_url'].startswith('data:image/jpeg;base64,'))
        self.assertEqual(content[1]['detail'], 'high')
        self.assertEqual(responses.request['max_output_tokens'], 500)
        self.assertNotIn('test-key', str(responses.request))


if __name__ == '__main__':
    unittest.main()

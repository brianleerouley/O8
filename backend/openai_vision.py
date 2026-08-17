"""Direct OpenAI Responses API client for playing-card image recognition."""

import base64
import logging
import os
import time

try:
    from openai import AsyncOpenAI
except ImportError:  # Allows configuration/parser tests before dependencies are installed.
    AsyncOpenAI = None


logger = logging.getLogger(__name__)


class VisionConfigurationError(RuntimeError):
    pass


def openai_api_key():
    return os.environ.get('OPENAI_API_KEY')


async def recognize_images(prompt, images, *, api_key=None, client=None, model=None):
    key = openai_api_key() if api_key is None else api_key
    if not key:
        raise VisionConfigurationError(
            'AI card recognition is not configured. Set OPENAI_API_KEY to enable it.'
        )
    if client is None:
        if AsyncOpenAI is None:
            raise VisionConfigurationError('The OpenAI SDK is not installed on this deployment.')
        client = AsyncOpenAI(api_key=key)

    content = [{'type': 'input_text', 'text': prompt}]
    for image_bytes, content_type in images:
        encoded = base64.b64encode(image_bytes).decode('ascii')
        mime_type = 'image/jpeg' if content_type == 'image/jpg' else content_type
        content.append({
            'type': 'input_image',
            'image_url': f'data:{mime_type};base64,{encoded}',
            'detail': 'high',
        })

    selected_model = model or os.environ.get('OPENAI_VISION_MODEL', 'gpt-5.4')
    started = time.perf_counter()
    logger.info('OpenAI remote recognition invoked model=%s images=%d', selected_model, len(images))
    try:
        response = await client.responses.create(
            model=selected_model,
            input=[{'role': 'user', 'content': content}],
            max_output_tokens=500,
        )
    except Exception:
        latency_ms = round((time.perf_counter() - started) * 1000)
        logger.warning('OpenAI remote recognition failed latency_ms=%d', latency_ms)
        raise
    latency_ms = round((time.perf_counter() - started) * 1000)
    logger.info('OpenAI remote recognition completed latency_ms=%d', latency_ms)
    return response.output_text, latency_ms

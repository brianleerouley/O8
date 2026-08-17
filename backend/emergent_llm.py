"""Optional adapter for the private Emergent vision integration."""

from importlib import import_module


def load_integration(importer=import_module):
    try:
        chat = importer('emergentintegrations.llm.chat')
        return chat.ImageContent, chat.LlmChat, chat.UserMessage
    except (ImportError, AttributeError):
        return None, None, None


ImageContent, LlmChat, UserMessage = load_integration()


def integration_available() -> bool:
    return all(component is not None for component in (LlmChat, UserMessage, ImageContent))


def unavailable_reason(api_key):
    if not integration_available():
        return "Remote card recognition is unavailable on this deployment."
    if not api_key:
        return "Remote card recognition is not configured on this deployment."
    return None

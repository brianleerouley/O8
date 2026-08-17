import { cardId, EMPTY_HAND } from "./cards";

export const CARD_ZONES = [
  { left: 0.04, top: 0.18, width: 0.21, height: 0.64 },
  { left: 0.275, top: 0.18, width: 0.21, height: 0.64 },
  { left: 0.51, top: 0.18, width: 0.21, height: 0.64 },
  { left: 0.745, top: 0.18, width: 0.21, height: 0.64 },
];

export function mapDisplayRectToSource(rect, sourceWidth, sourceHeight, displayWidth, displayHeight) {
  if (![sourceWidth, sourceHeight, displayWidth, displayHeight].every((value) => value > 0)) return null;
  const scale = Math.max(displayWidth / sourceWidth, displayHeight / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const hiddenX = (renderedWidth - displayWidth) / 2;
  const hiddenY = (renderedHeight - displayHeight) / 2;
  const left = (rect.left * displayWidth + hiddenX) / scale;
  const top = (rect.top * displayHeight + hiddenY) / scale;
  const right = ((rect.left + rect.width) * displayWidth + hiddenX) / scale;
  const bottom = ((rect.top + rect.height) * displayHeight + hiddenY) / scale;
  return {
    x: Math.max(0, Math.min(sourceWidth, left)),
    y: Math.max(0, Math.min(sourceHeight, top)),
    width: Math.max(1, Math.min(sourceWidth, right) - Math.max(0, left)),
    height: Math.max(1, Math.min(sourceHeight, bottom) - Math.max(0, top)),
  };
}

export function unresolvedFallbackPositions(slots, detected, attempts, minimumAttempts = 2) {
  return slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot, index }) =>
      !slot.locked && attempts[index] >= minimumAttempts && (!detected[index] || detected[index].confidence === "low")
    )
    .map(({ index }) => index);
}

export const EMPTY_SCAN_SLOTS = () =>
  EMPTY_HAND.map((card) => ({
    card,
    candidateId: null,
    matches: 0,
    locked: false,
    confidence: "low",
  }));

const matchesNeeded = (confidence) => {
  if (confidence === "high") return 2;
  if (confidence === "medium") return 3;
  return Infinity;
};

export function stabilizeSlots(previous, detected) {
  return previous.map((slot, index) => {
    if (slot.locked) return slot;
    const card = detected[index];
    if (!card?.rank || !card?.suit) {
      return { ...slot, candidateId: null, matches: 0, confidence: "low" };
    }
    const id = cardId(card);
    const stableSamples = Math.max(1, Math.min(2, Number(card.stable_samples) || 1));
    const matches = slot.candidateId === id ? slot.matches + stableSamples : stableSamples;
    const confidence = card.confidence || "medium";
    return {
      card,
      candidateId: id,
      matches,
      confidence,
      locked: matches >= matchesNeeded(confidence),
    };
  });
}

export function forceConfirmSlot(slot, card) {
  return {
    card: { rank: card.rank, suit: card.suit, confidence: "high" },
    candidateId: cardId(card),
    matches: 3,
    confidence: "high",
    locked: true,
  };
}

export function scanValidation(slots) {
  const cards = slots.map((slot) => slot.card);
  const complete = cards.every((card) => card?.rank && card?.suit);
  const ids = complete ? cards.map(cardId) : [];
  const unique = complete && new Set(ids).size === ids.length;
  return {
    cards,
    complete,
    unique,
    ready: complete && unique && slots.every((slot) => slot.locked),
  };
}

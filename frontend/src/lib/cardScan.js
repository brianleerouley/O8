import { cardId, EMPTY_HAND } from "./cards";

export const CARD_ZONES = [
  { left: 0.04, top: 0.18, width: 0.21, height: 0.64 },
  { left: 0.275, top: 0.18, width: 0.21, height: 0.64 },
  { left: 0.51, top: 0.18, width: 0.21, height: 0.64 },
  { left: 0.745, top: 0.18, width: 0.21, height: 0.64 },
];

export const EMPTY_SCAN_SLOTS = () =>
  EMPTY_HAND.map((card) => ({
    card,
    candidateId: null,
    matches: 0,
    locked: false,
    confidence: "low",
  }));

const matchesNeeded = (confidence) => (confidence === "high" ? 2 : 3);

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

import { cardId, EMPTY_HAND, RANKS, SUITS } from "./cards";

const VALID_RANKS = new Set(RANKS);
const VALID_SUITS = new Set(SUITS.map((suit) => suit.code));

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

export function frameSlotsFromCards(cards) {
  return EMPTY_SCAN_SLOTS().map((slot, index) => {
    const card = cards[index];
    if (!card?.rank || !card?.suit) return slot;
    const confidence = card.confidence || "medium";
    return {
      ...slot,
      card: { ...card, confidence },
      candidateId: cardId(card),
      confidence,
      matches: confidence === "high" ? 2 : 1,
      locked: confidence === "high",
    };
  });
}

export function isCompleteUniqueHand(cards) {
  if (!Array.isArray(cards) || cards.length !== 4) return false;
  if (!cards.every((card) => VALID_RANKS.has(card?.rank) && VALID_SUITS.has(card?.suit))) return false;
  return new Set(cards.map(cardId)).size === 4;
}

export function needsRemoteRecognition(cards) {
  return !isCompleteUniqueHand(cards) || cards.some((card) => card.confidence !== "high");
}

export function chooseRecognitionCards(localCards, remoteCards) {
  return isCompleteUniqueHand(remoteCards) ? remoteCards : localCards;
}

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

export const EMPTY_TEMPORAL_VOTES = () => EMPTY_HAND.map(() => new Map());

export function shouldAutoStartScan({ open, ready, phase, started }) {
  return Boolean(open && ready && phase === "preview" && !started);
}

export function normalizeScanDelayMs(value, fallback = 2000) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 10000) : fallback;
}

export function shouldSkipVerification(cards) {
  return isCompleteUniqueHand(cards) && cards.every((card) => card.confidence === "high");
}

export function addTemporalVotes(votes, detected, quality = 1) {
  const confidenceWeight = { high: 1, medium: 0.65, low: 0.25 };
  return votes.map((slotVotes, index) => {
    const next = new Map(slotVotes);
    const card = detected[index];
    if (!card?.rank || !card?.suit) return next;
    const id = cardId(card);
    const weight = Math.max(0, Math.min(1, quality)) * (confidenceWeight[card.confidence] || 0.25);
    const current = next.get(id) || { card, weight: 0, observations: 0 };
    next.set(id, { card, weight: current.weight + weight, observations: current.observations + 1 });
    return next;
  });
}

export function temporalCards(votes) {
  return votes.map((slotVotes) => {
    const ranked = [...slotVotes.values()].sort((a, b) => b.weight - a.weight);
    if (!ranked.length) return null;
    const [winner, runnerUp] = ranked;
    const margin = winner.weight - (runnerUp?.weight || 0);
    const confidence = winner.observations >= 3 && winner.weight >= 2.1 && margin >= 0.7
      ? "high"
      : winner.observations >= 2 && margin >= 0.35 ? "medium" : "low";
    return { ...winner.card, confidence, stable_samples: Math.min(2, winner.observations) };
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

export const RANKS = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];

export const SUITS = [
  { code: "S", symbol: "\u2660", name: "Spades", color: "black" },
  { code: "H", symbol: "\u2665", name: "Hearts", color: "red" },
  { code: "D", symbol: "\u2666", name: "Diamonds", color: "red" },
  { code: "C", symbol: "\u2663", name: "Clubs", color: "black" },
];

export const SUIT_MAP = SUITS.reduce((acc, s) => {
  acc[s.code] = s;
  return acc;
}, {});

export const DEFAULT_HAND = [
  { rank: "A", suit: "S" },
  { rank: "2", suit: "H" },
  { rank: "5", suit: "C" },
  { rank: "K", suit: "D" },
];

export const cardId = (c) => `${c.rank}${c.suit}`;

const VALID_RANKS = new Set(RANKS);
const VALID_SUITS = new Set(SUITS.map((s) => s.code));

export function encodeHand(cards) {
  return cards.map((c) => `${c.rank}${c.suit}`).join("-");
}

export function decodeHand(str) {
  if (!str) return null;
  const tokens = str.split("-");
  if (tokens.length !== 4) return null;
  const cards = tokens.map((t) => ({ rank: t.slice(0, -1), suit: t.slice(-1) }));
  const valid = cards.every((c) => VALID_RANKS.has(c.rank) && VALID_SUITS.has(c.suit));
  if (!valid) return null;
  const ids = cards.map(cardId);
  if (new Set(ids).size !== 4) return null;
  return cards;
}

export function validateHand(cards) {
  const ids = cards.map(cardId);
  const complete = cards.length === 4 && cards.every((c) => c.rank && c.suit);
  const unique = new Set(ids).size === ids.length;
  return { complete, unique, ready: complete && unique };
}

export const COLOR_CLASSES = {
  good: {
    text: "text-emerald-400",
    ring: "ring-emerald-500/30",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    bar: "bg-emerald-500",
  },
  warn: {
    text: "text-amber-400",
    ring: "ring-amber-500/30",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    bar: "bg-amber-500",
  },
  bad: {
    text: "text-rose-400",
    ring: "ring-rose-500/30",
    bg: "bg-rose-500/10",
    border: "border-rose-500/30",
    bar: "bg-rose-500",
  },
};

import {
  buildRankGroups,
  connectedComponents,
  diceScore,
  imageDataToMask,
  normalizeComponents,
  otsuThreshold,
  reconcileSamples,
  rotateMask,
  selectFannedCandidates,
  suitComponentsBelow,
  translatedDiceScore,
} from "./localCardRecognition";

test("Otsu threshold separates dark ink from a light card", () => {
  expect(otsuThreshold([20, 22, 25, 230, 235, 240])).toBeGreaterThan(25);
  expect(otsuThreshold([20, 22, 25, 230, 235, 240])).toBeLessThan(230);
});

test("connected components and normalization preserve two glyphs", () => {
  const mask = Uint8Array.from([
    1, 1, 0, 0,
    1, 1, 0, 1,
    0, 0, 0, 1,
    0, 0, 0, 0,
  ]);
  const components = connectedComponents(mask, 4, 4);
  expect(components).toHaveLength(2);
  const normalized = normalizeComponents([components[0]], 4, 4, 4, 4);
  expect(normalized.some(Boolean)).toBe(true);
  expect(diceScore(normalized, normalized)).toBe(1);
});

test("paired local samples become a stable high-confidence card", () => {
  const card = { rank: "A", suit: "S", confidence: "high", local_score: 0.82 };
  expect(reconcileSamples([card], [card])).toEqual([
    { ...card, stable_samples: 2, local_score: 0.82 },
  ]);
});

test("disagreeing local samples stay low confidence", () => {
  const first = { rank: "A", suit: "S", confidence: "high", local_score: 0.7 };
  const second = { rank: "K", suit: "S", confidence: "high", local_score: 0.8 };
  expect(reconcileSamples([first], [second])[0]).toMatchObject({
    rank: "K",
    confidence: "low",
    stable_samples: 1,
  });
});

test("template scoring tolerates small glyph translation", () => {
  const original = new Uint8Array(24 * 32);
  const shifted = new Uint8Array(24 * 32);
  original[10 * 24 + 10] = 1;
  original[10 * 24 + 11] = 1;
  shifted[12 * 24 + 12] = 1;
  shifted[12 * 24 + 13] = 1;
  expect(diceScore(original, shifted)).toBe(0);
  expect(translatedDiceScore(original, shifted)).toBe(1);
});

test("thresholding preserves both red and black card ink across brightness changes", () => {
  const imageData = {
    width: 4,
    height: 1,
    data: Uint8ClampedArray.from([
      25, 25, 25, 255,
      175, 15, 25, 255,
      235, 235, 225, 255,
      255, 250, 245, 255,
    ]),
  };
  expect(Array.from(imageDataToMask(imageData).mask)).toEqual([1, 1, 0, 0]);
});

test("paired samples preserve the two-character 10 rank", () => {
  const card = { rank: "10", suit: "D", confidence: "high", local_score: 0.75 };
  expect(reconcileSamples([card], [card])[0]).toMatchObject({ rank: "10", suit: "D", stable_samples: 2 });
});

test("fanned candidates suppress overlapping reads and preserve left-to-right order", () => {
  const candidates = [
    { x: 0.72, card: { rank: "K", suit: "D", local_score: 0.7 } },
    { x: 0.18, card: { rank: "A", suit: "S", local_score: 0.8 } },
    { x: 0.2, card: { rank: "Q", suit: "S", local_score: 0.5 } },
    { x: 0.52, card: { rank: "5", suit: "C", local_score: 0.75 } },
    { x: 0.35, card: { rank: "2", suit: "H", local_score: 0.78 } },
  ];
  expect(selectFannedCandidates(candidates).map((card) => `${card.rank}${card.suit}`)).toEqual([
    "AS", "2H", "5C", "KD",
  ]);
});

test("fanned candidate selection leaves unresolved positions for manual correction", () => {
  const cards = selectFannedCandidates([
    { x: 0.2, card: { rank: "A", suit: "S", local_score: 0.8 } },
    { x: 0.7, card: { rank: "K", suit: "D", local_score: 0.7 } },
  ]);
  expect(cards).toHaveLength(2);
});

const rectangleComponent = (left, top, right, bottom, sourceWidth = 400) => {
  const pixels = [];
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) pixels.push(y * sourceWidth + x);
  }
  return { left, top, right, bottom, pixels };
};

test("rank grouping preserves four uneven left-to-right positions", () => {
  const components = [
    rectangleComponent(12, 20, 24, 48),
    rectangleComponent(78, 25, 91, 54),
    rectangleComponent(173, 31, 187, 61),
    rectangleComponent(320, 36, 335, 67),
  ];
  const singleGroups = buildRankGroups(components, 400).filter((group) => group.length === 1);
  expect(singleGroups.map((group) => group[0].left)).toEqual([12, 78, 173, 320]);
});

test("rank grouping joins adjacent glyphs needed for the 10 rank", () => {
  const one = rectangleComponent(40, 20, 45, 50);
  const zero = rectangleComponent(48, 20, 64, 50);
  expect(buildRankGroups([one, zero], 400).some((group) => group.length === 2)).toBe(true);
});

test("suit pairing stays below its rank across overlapping fanned card boundaries", () => {
  const rank = rectangleComponent(70, 20, 84, 48);
  const ownSuit = rectangleComponent(71, 58, 86, 80);
  const neighboringSuit = rectangleComponent(105, 54, 120, 78);
  const paired = suitComponentsBelow([rank], [rank, neighboringSuit, ownSuit], 400, 220);
  expect(paired[0]).toBe(ownSuit);
  expect(paired).not.toContain(neighboringSuit);
});

test("normalization preserves a tall glyph aspect ratio with centered padding", () => {
  const component = rectangleComponent(4, 3, 5, 10, 20);
  const normalized = normalizeComponents([component], 20, 20, 24, 32);
  const points = [];
  normalized.forEach((value, index) => {
    if (value) points.push({ x: index % 24, y: Math.floor(index / 24) });
  });
  const occupiedWidth = Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)) + 1;
  const occupiedHeight = Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)) + 1;
  expect(occupiedHeight).toBeGreaterThan(occupiedWidth * 3);
  expect(Math.min(...points.map((point) => point.x))).toBeGreaterThan(1);
  expect(Math.max(...points.map((point) => point.x))).toBeLessThan(22);
});

test("ambiguous low-confidence candidates are rejected instead of filling a slot", () => {
  const cards = selectFannedCandidates([
    { x: 0.2, card: { rank: "A", suit: "C", confidence: "medium", local_score: 0.55 } },
    { x: 0.4, card: { rank: "2", suit: "S", confidence: "low", local_score: 0.49 } },
  ]);
  expect(cards.map((card) => `${card.rank}${card.suit}`)).toEqual(["AC"]);
});

test("small rotation variants preserve glyph pixels for fan-angle matching", () => {
  const mask = new Uint8Array(24 * 32);
  for (let y = 8; y < 24; y++) mask[y * 24 + 10] = 1;
  for (let x = 10; x < 17; x++) mask[23 * 24 + x] = 1;
  const rotated = rotateMask(mask, 24, 7);
  expect(rotated.some(Boolean)).toBe(true);
  expect(diceScore(mask, rotated)).toBeGreaterThan(0.5);
});

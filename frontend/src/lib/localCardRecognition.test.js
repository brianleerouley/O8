import {
  connectedComponents,
  diceScore,
  imageDataToMask,
  normalizeComponents,
  otsuThreshold,
  reconcileSamples,
  selectFannedCandidates,
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

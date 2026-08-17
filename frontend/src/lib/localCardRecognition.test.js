import { connectedComponents, diceScore, normalizeComponents, otsuThreshold, reconcileSamples } from "./localCardRecognition";

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

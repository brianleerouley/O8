import {
  EMPTY_SCAN_SLOTS,
  frameSlotsFromCards,
  forceConfirmSlot,
  mapDisplayRectToSource,
  scanValidation,
  stabilizeSlots,
  unresolvedFallbackPositions,
} from "./cardScan";

const hand = [
  { rank: "A", suit: "S", confidence: "high" },
  { rank: "2", suit: "H", confidence: "high" },
  { rank: "5", suit: "C", confidence: "high" },
  { rank: "K", suit: "D", confidence: "high" },
];

test("high-confidence cards lock after two matching samples", () => {
  const first = stabilizeSlots(EMPTY_SCAN_SLOTS(), hand);
  expect(first.every((slot) => !slot.locked)).toBe(true);
  const second = stabilizeSlots(first, hand);
  expect(second.every((slot) => slot.locked)).toBe(true);
});

test("a changed reading resets stability for that slot", () => {
  const first = stabilizeSlots(EMPTY_SCAN_SLOTS(), hand);
  const changed = stabilizeSlots(first, [{ ...hand[0], rank: "K" }, ...hand.slice(1)]);
  expect(changed[0].matches).toBe(1);
  expect(changed[1].matches).toBe(2);
});

test("low-confidence readings remain unresolved even when repeated", () => {
  const low = hand.map((card) => ({ ...card, confidence: "low" }));
  let slots = EMPTY_SCAN_SLOTS();
  for (let sample = 0; sample < 5; sample++) slots = stabilizeSlots(slots, low);
  expect(slots.every((slot) => !slot.locked)).toBe(true);
});

test("manual correction locks a slot but duplicate validation still fails", () => {
  const slots = EMPTY_SCAN_SLOTS().map((slot, index) => forceConfirmSlot(slot, hand[index]));
  expect(scanValidation(slots).ready).toBe(true);
  slots[3] = forceConfirmSlot(slots[3], hand[0]);
  expect(scanValidation(slots)).toMatchObject({ complete: true, unique: false, ready: false });
});

test("a paired local or fallback result can lock in one recognition cycle", () => {
  const paired = hand.map((card) => ({ ...card, stable_samples: 2 }));
  const slots = stabilizeSlots(EMPTY_SCAN_SLOTS(), paired);
  expect(slots.every((slot) => slot.locked)).toBe(true);
});

test("object-cover mapping keeps visible zones aligned with a portrait camera source", () => {
  const source = mapDisplayRectToSource(
    { left: 0.25, top: 0.25, width: 0.5, height: 0.5 },
    720,
    1280,
    1600,
    900
  );
  expect(source).toEqual({ x: 180, y: 538.75, width: 360, height: 202.5 });
});

test("object-cover mapping keeps visible zones aligned with a wide camera source", () => {
  const source = mapDisplayRectToSource(
    { left: 0.25, top: 0.25, width: 0.5, height: 0.5 },
    1920,
    1080,
    900,
    1200
  );
  expect(source).toEqual({ x: 757.5, y: 270, width: 405, height: 540 });
});

test("fallback includes only unresolved unlocked positions", () => {
  const slots = EMPTY_SCAN_SLOTS();
  slots[0] = forceConfirmSlot(slots[0], hand[0]);
  const detected = [hand[0], null, { ...hand[2], confidence: "medium" }, { ...hand[3], confidence: "low" }];
  expect(unresolvedFallbackPositions(slots, detected, [9, 2, 3, 2])).toEqual([1, 3]);
});

test("single-frame results require uncertain cards to be manually verified", () => {
  const cards = hand.map((card, index) => ({
    ...card,
    confidence: index === 2 ? "medium" : "high",
  }));
  const slots = frameSlotsFromCards(cards);
  expect(slots[0].locked).toBe(true);
  expect(slots[2].locked).toBe(false);
  expect(scanValidation(slots).ready).toBe(false);
  slots[2] = forceConfirmSlot(slots[2], cards[2]);
  expect(scanValidation(slots).ready).toBe(true);
});

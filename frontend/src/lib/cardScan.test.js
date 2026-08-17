import { EMPTY_SCAN_SLOTS, forceConfirmSlot, scanValidation, stabilizeSlots } from "./cardScan";

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

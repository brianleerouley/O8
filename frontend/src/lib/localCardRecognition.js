const RANKS = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];
const SUITS = [
  { label: "S", glyph: "♠" },
  { label: "H", glyph: "♥" },
  { label: "D", glyph: "♦" },
  { label: "C", glyph: "♣" },
];
const FONTS = ["Georgia", "Times New Roman", "Arial"];
const NORMAL_WIDTH = 24;
const NORMAL_HEIGHT = 32;

let templateCache = null;

export function otsuThreshold(grays) {
  const histogram = new Array(256).fill(0);
  grays.forEach((value) => histogram[value]++);
  const total = grays.length;
  let sum = 0;
  histogram.forEach((count, value) => { sum += value * count; });
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 128;
  for (let value = 0; value < 256; value++) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (sum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }
  return Math.min(210, Math.max(55, threshold + 10));
}

export function imageDataToMask(imageData) {
  const grays = [];
  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index];
    const green = imageData.data[index + 1];
    const blue = imageData.data[index + 2];
    grays.push(Math.round(red * 0.299 + green * 0.587 + blue * 0.114));
  }
  const threshold = otsuThreshold(grays);
  return {
    width: imageData.width,
    height: imageData.height,
    mask: Uint8Array.from(grays, (gray) => (gray < threshold ? 1 : 0)),
  };
}

export function connectedComponents(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const components = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    const stack = [start];
    visited[start] = 1;
    const component = { pixels: [], left: width, top: height, right: 0, bottom: 0 };
    while (stack.length) {
      const pixel = stack.pop();
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      component.pixels.push(pixel);
      component.left = Math.min(component.left, x);
      component.right = Math.max(component.right, x);
      component.top = Math.min(component.top, y);
      component.bottom = Math.max(component.bottom, y);
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (!offsetX && !offsetY) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (mask[next] && !visited[next]) {
            visited[next] = 1;
            stack.push(next);
          }
        }
      }
    }
    components.push(component);
  }
  return components;
}

export function normalizeComponents(components, sourceWidth, sourceHeight, width = NORMAL_WIDTH, height = NORMAL_HEIGHT) {
  if (!components.length) return new Uint8Array(width * height);
  const left = Math.min(...components.map((component) => component.left));
  const right = Math.max(...components.map((component) => component.right));
  const top = Math.min(...components.map((component) => component.top));
  const bottom = Math.max(...components.map((component) => component.bottom));
  const boxWidth = Math.max(1, right - left + 1);
  const boxHeight = Math.max(1, bottom - top + 1);
  const output = new Uint8Array(width * height);
  components.forEach((component) => component.pixels.forEach((pixel) => {
    const x = pixel % sourceWidth;
    const y = Math.floor(pixel / sourceWidth);
    const targetX = Math.min(width - 1, Math.floor(((x - left) / boxWidth) * width));
    const targetY = Math.min(height - 1, Math.floor(((y - top) / boxHeight) * height));
    output[targetY * width + targetX] = 1;
  }));
  return output;
}

export function diceScore(first, second) {
  let overlap = 0;
  let firstCount = 0;
  let secondCount = 0;
  for (let index = 0; index < first.length; index++) {
    firstCount += first[index];
    secondCount += second[index];
    if (first[index] && second[index]) overlap++;
  }
  return firstCount + secondCount ? (2 * overlap) / (firstCount + secondCount) : 0;
}

export function translatedDiceScore(first, second, width = NORMAL_WIDTH, maxShift = 2) {
  let best = 0;
  const height = Math.floor(first.length / width);
  const secondCount = second.reduce((total, value) => total + value, 0);
  for (let shiftY = -maxShift; shiftY <= maxShift; shiftY++) {
    for (let shiftX = -maxShift; shiftX <= maxShift; shiftX++) {
      let firstCount = 0;
      let overlap = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const sourceX = x - shiftX;
          const sourceY = y - shiftY;
          if (
            sourceX >= 0 && sourceX < width && sourceY >= 0 && sourceY < height
            && first[sourceY * width + sourceX]
          ) {
            firstCount += 1;
            if (second[y * width + x]) overlap += 1;
          }
        }
      }
      const score = firstCount + secondCount ? (2 * overlap) / (firstCount + secondCount) : 0;
      best = Math.max(best, score);
    }
  }
  return best;
}

function renderTemplate(text, font) {
  const canvas = document.createElement("canvas");
  canvas.width = 54;
  canvas.height = 64;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "black";
  context.textBaseline = "top";
  context.font = `bold ${text.length > 1 ? 31 : 38}px ${font}`;
  context.fillText(text, 2, 1);
  const binary = imageDataToMask(context.getImageData(0, 0, canvas.width, canvas.height));
  const minimumArea = 8;
  const components = connectedComponents(binary.mask, binary.width, binary.height)
    .filter((component) => component.pixels.length >= minimumArea);
  return normalizeComponents(components, binary.width, binary.height);
}

function getTemplates() {
  if (templateCache) return templateCache;
  templateCache = {
    ranks: RANKS.flatMap((label) => FONTS.map((font) => ({ label, mask: renderTemplate(label, font) }))),
    suits: SUITS.flatMap(({ label, glyph }) => FONTS.map((font) => ({ label, mask: renderTemplate(glyph, font) }))),
  };
  return templateCache;
}

function matchTemplates(mask, templates) {
  const scores = templates
    .map((template) => ({ label: template.label, score: translatedDiceScore(mask, template.mask) }))
    .sort((a, b) => b.score - a.score);
  const bestByLabel = [];
  scores.forEach((score) => {
    if (!bestByLabel.some((item) => item.label === score.label)) bestByLabel.push(score);
  });
  const best = bestByLabel[0] || { label: null, score: 0 };
  const second = bestByLabel[1] || { score: 0 };
  return { ...best, margin: best.score - second.score };
}

function glyphGroups(imageData) {
  const binary = imageDataToMask(imageData);
  const minimumArea = Math.max(7, Math.round(binary.width * binary.height * 0.0012));
  const components = connectedComponents(binary.mask, binary.width, binary.height)
    .filter((component) => {
      const width = component.right - component.left + 1;
      const height = component.bottom - component.top + 1;
      return component.pixels.length >= minimumArea && width < binary.width * 0.8 && height < binary.height * 0.8;
    })
    .sort((a, b) => a.top - b.top);
  if (components.length < 2) return null;

  let bestSplit = -1;
  let bestGap = -Infinity;
  for (let index = 1; index < components.length; index++) {
    const topBottom = Math.max(...components.slice(0, index).map((component) => component.bottom));
    const gap = components[index].top - topBottom;
    if (gap > bestGap) {
      bestGap = gap;
      bestSplit = index;
    }
  }
  if (bestSplit < 1) return null;
  return {
    rank: normalizeComponents(components.slice(0, bestSplit), binary.width, binary.height),
    suit: normalizeComponents(components.slice(bestSplit), binary.width, binary.height),
  };
}

export function recognizeCorner(imageData) {
  const groups = glyphGroups(imageData);
  if (!groups) return null;
  const templates = getTemplates();
  const rank = matchTemplates(groups.rank, templates.ranks);
  const suit = matchTemplates(groups.suit, templates.suits);
  const weakestScore = Math.min(rank.score, suit.score);
  const weakestMargin = Math.min(rank.margin, suit.margin);
  if (!rank.label || !suit.label || weakestScore < 0.42 || weakestMargin < 0.015) return null;
  const confidence = weakestScore >= 0.6 && weakestMargin >= 0.045
    ? "high"
    : weakestScore >= 0.5 && weakestMargin >= 0.025
      ? "medium"
      : "low";
  return {
    rank: rank.label,
    suit: suit.label,
    confidence,
    local_score: Number(weakestScore.toFixed(3)),
  };
}

export function reconcileSamples(first, second) {
  return first.map((firstCard, index) => {
    const secondCard = second[index];
    if (!firstCard && !secondCard) return null;
    if (firstCard && secondCard && firstCard.rank === secondCard.rank && firstCard.suit === secondCard.suit) {
      const confidence = firstCard.confidence === "high" && secondCard.confidence === "high" ? "high" : "medium";
      return {
        ...firstCard,
        confidence,
        stable_samples: 2,
        local_score: Number(((firstCard.local_score + secondCard.local_score) / 2).toFixed(3)),
      };
    }
    const candidate = !secondCard || (firstCard && firstCard.local_score >= secondCard.local_score) ? firstCard : secondCard;
    return candidate ? { ...candidate, confidence: "low", stable_samples: 1 } : null;
  });
}

export function recognizeCornerSamples(first, second) {
  return reconcileSamples(first.map(recognizeCorner), second.map(recognizeCorner));
}

export function selectFannedCandidates(candidates, count = 4, minimumSpacing = 0.12) {
  const selected = [];
  [...candidates]
    .filter((candidate) => candidate?.card?.rank && candidate?.card?.suit)
    .sort((first, second) => (second.card.local_score || 0) - (first.card.local_score || 0))
    .forEach((candidate) => {
      if (
        selected.length < count
        && !selected.some((chosen) => Math.abs(chosen.x - candidate.x) < minimumSpacing)
      ) {
        selected.push(candidate);
      }
    });
  return selected.sort((first, second) => first.x - second.x).map((candidate) => candidate.card);
}

export function recognizeFannedCardFrame(canvas) {
  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return [];
  const windowWidth = Math.max(72, Math.round(width * 0.22));
  const windowHeight = Math.max(96, Math.round(height * 0.9));
  const maxX = Math.max(0, width - windowWidth);
  const step = Math.max(1, maxX / 12);
  const yPositions = [0, Math.max(0, height - windowHeight)];
  const candidates = [];

  for (let x = 0; x <= maxX + 0.5; x += step) {
    for (const y of yPositions) {
      const corner = document.createElement("canvas");
      corner.width = 72;
      corner.height = 96;
      const context = corner.getContext("2d", { alpha: false });
      context.drawImage(canvas, x, y, windowWidth, windowHeight, 0, 0, corner.width, corner.height);
      const card = recognizeCorner(context.getImageData(0, 0, corner.width, corner.height));
      if (card) candidates.push({ x: (x + windowWidth / 2) / width, card });
    }
  }

  return selectFannedCandidates(candidates);
}

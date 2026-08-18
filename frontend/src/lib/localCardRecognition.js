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

export function frameQualityScore(canvas) {
  const width = Math.min(160, canvas.width);
  const height = Math.max(1, Math.round(width * canvas.height / canvas.width));
  const sample = document.createElement("canvas");
  sample.width = width;
  sample.height = height;
  const sampleContext = sample.getContext("2d", { willReadFrequently: true });
  sampleContext.drawImage(canvas, 0, 0, width, height);
  const { data } = sampleContext.getImageData(0, 0, width, height);
  let glare = 0;
  let edges = 0;
  let previous = 0;
  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    if (gray > 248) glare += 1;
    if (index > 0) edges += Math.abs(gray - previous);
    previous = gray;
  }
  const pixels = width * height;
  const sharpness = Math.min(1, edges / pixels / 24);
  const glarePenalty = Math.min(1, (glare / pixels) / 0.35);
  return Math.max(0, Math.min(1, sharpness * (1 - glarePenalty * 0.75)));
}

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
  const padding = 2;
  const scale = Math.min((width - padding * 2) / boxWidth, (height - padding * 2) / boxHeight);
  const renderedWidth = boxWidth * scale;
  const renderedHeight = boxHeight * scale;
  const offsetX = (width - renderedWidth) / 2;
  const offsetY = (height - renderedHeight) / 2;
  const output = new Uint8Array(width * height);
  components.forEach((component) => component.pixels.forEach((pixel) => {
    const x = pixel % sourceWidth;
    const y = Math.floor(pixel / sourceWidth);
    const targetX = Math.min(width - 1, Math.max(0, Math.round(offsetX + (x - left) * scale)));
    const targetY = Math.min(height - 1, Math.max(0, Math.round(offsetY + (y - top) * scale)));
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

export function rotateMask(mask, width = NORMAL_WIDTH, degrees = 0) {
  if (!degrees) return mask;
  const height = Math.floor(mask.length / width);
  const output = new Uint8Array(mask.length);
  const radians = (-degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const relativeX = x - centerX;
      const relativeY = y - centerY;
      const sourceX = Math.round(relativeX * cosine - relativeY * sine + centerX);
      const sourceY = Math.round(relativeX * sine + relativeY * cosine + centerY);
      if (sourceX >= 0 && sourceX < width && sourceY >= 0 && sourceY < height) {
        output[y * width + x] = mask[sourceY * width + sourceX];
      }
    }
  }
  return output;
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
  const variants = [
    { mask, shift: 2 },
    { mask: rotateMask(mask, NORMAL_WIDTH, -7), shift: 1 },
    { mask: rotateMask(mask, NORMAL_WIDTH, 7), shift: 1 },
  ];
  const scores = templates
    .map((template) => ({
      label: template.label,
      score: Math.max(...variants.map((variant) =>
        translatedDiceScore(variant.mask, template.mask, NORMAL_WIDTH, variant.shift)
      )),
    }))
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

export function selectFannedCandidateDetails(candidates, count = 4, minimumSpacing = 0.12) {
  const selected = [];
  [...candidates]
    .filter((candidate) =>
      candidate?.card?.rank && candidate?.card?.suit && candidate.card.confidence !== "low"
    )
    .sort((first, second) => (second.card.local_score || 0) - (first.card.local_score || 0))
    .forEach((candidate) => {
      if (
        selected.length < count
        && !selected.some((chosen) => Math.abs(chosen.x - candidate.x) < minimumSpacing)
      ) {
        selected.push(candidate);
      }
    });
  return selected.sort((first, second) => first.x - second.x);
}

export function selectFannedCandidates(candidates, count = 4, minimumSpacing = 0.12) {
  return selectFannedCandidateDetails(candidates, count, minimumSpacing).map((candidate) => candidate.card);
}

function groupBounds(components) {
  return {
    left: Math.min(...components.map((component) => component.left)),
    right: Math.max(...components.map((component) => component.right)),
    top: Math.min(...components.map((component) => component.top)),
    bottom: Math.max(...components.map((component) => component.bottom)),
  };
}

function glyphComponents(binary) {
  const analysisBottom = binary.height * 0.72;
  const minimumHeight = Math.max(7, binary.height * 0.025);
  const maximumHeight = binary.height * 0.2;
  const minimumArea = Math.max(10, binary.width * binary.height * 0.00004);
  return connectedComponents(binary.mask, binary.width, binary.height).filter((component) => {
    const componentWidth = component.right - component.left + 1;
    const componentHeight = component.bottom - component.top + 1;
    const density = component.pixels.length / (componentWidth * componentHeight);
    return component.top < analysisBottom
      && componentHeight >= minimumHeight
      && componentHeight <= maximumHeight
      && componentWidth >= 2
      && componentWidth <= binary.width * 0.09
      && component.pixels.length >= minimumArea
      && density >= 0.08
      && density <= 0.9;
  });
}

export function buildRankGroups(components, frameWidth) {
  const ordered = [...components].sort((first, second) => first.left - second.left);
  const groups = ordered.map((component) => [component]);
  for (let index = 0; index < ordered.length - 1; index++) {
    const first = ordered[index];
    const second = ordered[index + 1];
    const firstHeight = first.bottom - first.top + 1;
    const secondHeight = second.bottom - second.top + 1;
    const overlap = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) + 1;
    const gap = second.left - first.right - 1;
    if (
      gap >= 0
      && gap <= Math.max(frameWidth * 0.012, Math.max(firstHeight, secondHeight) * 0.45)
      && overlap / Math.min(firstHeight, secondHeight) >= 0.55
    ) {
      groups.push([first, second]);
    }
  }
  return groups;
}

export function suitComponentsBelow(rankComponents, components, frameWidth, frameHeight) {
  const rank = groupBounds(rankComponents);
  const rankCenter = (rank.left + rank.right) / 2;
  const rankWidth = rank.right - rank.left + 1;
  const rankHeight = rank.bottom - rank.top + 1;
  return components
    .filter((component) => {
      if (rankComponents.includes(component)) return false;
      const center = (component.left + component.right) / 2;
      const gap = component.top - rank.bottom;
      const height = component.bottom - component.top + 1;
      return gap >= Math.max(1, rankHeight * 0.04)
        && gap <= Math.max(frameHeight * 0.16, rankHeight * 3)
        && Math.abs(center - rankCenter) <= Math.max(frameWidth * 0.04, rankWidth * 1.4)
        && height >= rankHeight * 0.45
        && height <= rankHeight * 2.1;
    })
    .sort((first, second) => {
      const firstCenter = (first.left + first.right) / 2;
      const secondCenter = (second.left + second.right) / 2;
      const firstDistance = first.top - rank.bottom + Math.abs(firstCenter - rankCenter) * 1.5;
      const secondDistance = second.top - rank.bottom + Math.abs(secondCenter - rankCenter) * 1.5;
      return firstDistance - secondDistance;
    });
}

function classifyComponents(components, binary, templates) {
  return matchTemplates(
    normalizeComponents(components, binary.width, binary.height),
    templates
  );
}

export function recognizeFannedCardFrame(canvas) {
  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return { cards: [], debug: { rank_candidate_count: 0, candidates: [] } };
  const context = canvas.getContext("2d", { alpha: false });
  const binary = imageDataToMask(context.getImageData(0, 0, width, height));
  const components = glyphComponents(binary);
  const rankGroups = buildRankGroups(components, width);
  const templates = getTemplates();
  const candidates = [];
  const rankCandidates = [];

  rankGroups.forEach((rankComponents) => {
    const rank = classifyComponents(rankComponents, binary, templates.ranks);
    if (!rank.label || rank.score < 0.46 || rank.margin < 0.02) return;
    const rankBox = groupBounds(rankComponents);
    rankCandidates.push({
      x: ((rankBox.left + rankBox.right) / 2) / width,
      rank: rank.label,
      score: rank.score,
    });
    const suits = suitComponentsBelow(rankComponents, components, width, height).slice(0, 4);
    suits.forEach((suitComponent) => {
      const suit = classifyComponents([suitComponent], binary, templates.suits);
      const weakestScore = Math.min(rank.score, suit.score);
      const weakestMargin = Math.min(rank.margin, suit.margin);
      if (!suit.label || weakestScore < 0.48 || weakestMargin < 0.02) return;
      const confidence = weakestScore >= 0.62 && weakestMargin >= 0.05 ? "high" : "medium";
      candidates.push({
        x: ((rankBox.left + rankBox.right) / 2) / width,
        rank_box: rankBox,
        card: {
          rank: rank.label,
          suit: suit.label,
          confidence,
          local_score: Number(weakestScore.toFixed(3)),
          rank_score: Number(rank.score.toFixed(3)),
          suit_score: Number(suit.score.toFixed(3)),
        },
      });
    });
  });

  const selected = selectFannedCandidateDetails(candidates, 4, 0.1);
  return {
    cards: selected.map((candidate) => candidate.card),
    debug: {
      rank_candidate_count: rankCandidates.length,
      rank_candidates: rankCandidates.map((candidate) => ({
        x: Number(candidate.x.toFixed(3)),
        rank: candidate.rank,
        score: Number(candidate.score.toFixed(3)),
      })),
      candidate_x_positions: selected.map((candidate) => Number(candidate.x.toFixed(3))),
      candidates: selected.map((candidate) => ({
        x: Number(candidate.x.toFixed(3)),
        rank: candidate.card.rank,
        suit: candidate.card.suit,
        rank_score: candidate.card.rank_score,
        suit_score: candidate.card.suit_score,
        confidence: candidate.card.confidence,
      })),
    },
  };
}

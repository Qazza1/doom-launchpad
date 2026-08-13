/// Shrinking token images before they are stored.
///
/// The storage account is Filebase's free plan: 5 GB of space, 500 IPFS pins, and 5 GB of
/// bandwidth a month. The pin count caps the number of tokens at 500; bandwidth is what runs out
/// first, because a discovery page full of logos costs a few megabytes every time somebody loads
/// it. Shrinking a 2 MB upload to about 200 KB makes the same allowance go roughly ten times
/// further, and a token logo is displayed small enough that nobody sees the difference.
///
/// The decisions live here so they can be tested; the canvas work that carries them out belongs to
/// the page.

export const MAX_STORED_BYTES = 200 * 1024;
export const MAX_EDGE_PIXELS = 512;
/// Tried in order until the encoded image fits. Below the last value the artefacts become obvious,
/// so the plan gives up and keeps the smallest attempt rather than degrading further.
export const QUALITY_LADDER = [0.92, 0.85, 0.75, 0.65, 0.55];

const round = value => Math.max(1, Math.round(value));

/// Works out what to draw, before drawing anything.
export function planResize({ width, height, bytes, type, maxBytes = MAX_STORED_BYTES, maxEdge = MAX_EDGE_PIXELS }) {
  // SVG is vector: it is already tiny, and rasterising it to fit a byte budget would make it worse
  // at every size it is later displayed at.
  if (type === "image/svg+xml") {
    return {
      action: bytes <= maxBytes ? "keep" : "reject",
      reason: bytes <= maxBytes
        ? "Vector images are stored as they are."
        : `This SVG is ${describeBytes(bytes)}. Vector images are not resized, so it has to be under ${describeBytes(maxBytes)}.`,
      targetWidth: width,
      targetHeight: height,
      qualities: [],
    };
  }

  const longestEdge = Math.max(width, height);
  const scale = longestEdge > maxEdge ? maxEdge / longestEdge : 1;
  const targetWidth = round(width * scale);
  const targetHeight = round(height * scale);
  const alreadySmall = scale === 1 && bytes <= maxBytes;

  return {
    action: alreadySmall ? "keep" : "resize",
    reason: alreadySmall
      ? "Already small enough."
      : `Scaling to ${targetWidth}x${targetHeight} and compressing to fit ${describeBytes(maxBytes)}.`,
    targetWidth,
    targetHeight,
    // PNG ignores the quality argument, so anything being shrunk is re-encoded as JPEG unless it
    // needs transparency. The page decides that; the ladder is the same either way.
    qualities: alreadySmall ? [] : [...QUALITY_LADDER],
  };
}

export function describeBytes(bytes) {
  const value = Number(bytes);
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

/// What to tell the creator after the fact. Silently replacing someone's upload with a smaller one
/// is the kind of thing that should be visible, not hidden.
export function describeSaving({ before, after }) {
  const from = Number(before);
  const to = Number(after);
  if (!from || to >= from) return `Stored at ${describeBytes(to)}.`;
  const saved = Math.round((1 - to / from) * 100);
  return `${describeBytes(from)} → ${describeBytes(to)}, ${saved}% smaller.`;
}

/// How far the free plan stretches, so the number is derived rather than asserted in a document
/// that will go stale.
export function storageBudget({ perImageBytes = MAX_STORED_BYTES, pins = 500, bandwidthBytes = 5 * 1024 ** 3 }) {
  return {
    tokensBeforePinLimit: pins,
    totalStorageBytes: perImageBytes * pins,
    imageViewsPerMonth: Math.floor(bandwidthBytes / perImageBytes),
  };
}

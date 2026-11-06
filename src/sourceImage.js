import { CUTOFF } from './cutoutField.js';

const FIELD_MAX_EDGE = 768;
const FIELD_MIN_EDGE = 256;
const TEXTURE_MAX_EDGE = 2048;
const COLOUR_BLEED_PASSES = 16;

function readPixels(image, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);
  return { canvas, context, pixels: context.getImageData(0, 0, width, height) };
}

function scaledSize(width, height, scale) {
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function readAlpha(image) {
  const { naturalWidth: w, naturalHeight: h } = image;
  const edge = Math.max(w, h);
  let scale = 1;
  if (edge > FIELD_MAX_EDGE) scale = FIELD_MAX_EDGE / edge;
  if (edge < FIELD_MIN_EDGE) scale = FIELD_MIN_EDGE / edge;
  const { width, height } = scaledSize(w, h, scale);
  const { data } = readPixels(image, width, height).pixels;
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  return { data: alpha, width, height };
}

// Makes an opaque texture for the Cutout. Colours spread outward from the visible
// pixels, so its edges never pick up the hidden colour of transparent pixels.
function buildTexture(image) {
  const { naturalWidth: w, naturalHeight: h } = image;
  const scale = Math.min(1, TEXTURE_MAX_EDGE / Math.max(w, h));
  const { width, height } = scaledSize(w, h, scale);
  const { canvas, context, pixels } = readPixels(image, width, height);
  const { data } = pixels;
  const total = width * height;
  const filled = new Uint8Array(total);
  const threshold = CUTOFF * 255;
  let frontier = [];
  let solidCount = 0;
  const sum = [0, 0, 0];

  for (let i = 0; i < total; i++) {
    if (data[i * 4 + 3] <= threshold) continue;
    filled[i] = 1;
    frontier.push(i);
    solidCount++;
    for (let c = 0; c < 3; c++) sum[c] += data[i * 4 + c];
  }

  for (let pass = 0; pass < COLOUR_BLEED_PASSES && frontier.length > 0; pass++) {
    const next = [];
    for (const i of frontier) {
      const x = i % width;
      const y = (i - x) / width;
      const neighbours = [
        x > 0 ? i - 1 : -1,
        x < width - 1 ? i + 1 : -1,
        y > 0 ? i - width : -1,
        y < height - 1 ? i + width : -1,
      ];
      for (const n of neighbours) {
        if (n < 0 || filled[n]) continue;
        filled[n] = 1;
        for (let c = 0; c < 3; c++) data[n * 4 + c] = data[i * 4 + c];
        next.push(n);
      }
    }
    frontier = next;
  }

  for (let i = 0; i < total; i++) {
    if (!filled[i] && solidCount > 0) {
      for (let c = 0; c < 3; c++) data[i * 4 + c] = sum[c] / solidCount;
    }
    data[i * 4 + 3] = 255;
  }

  context.putImageData(pixels, 0, 0);
  return canvas;
}

export async function loadSourceImage(file) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(`Couldn't read "${file.name}" as an image.`);
  }
  if (!image.naturalWidth || !image.naturalHeight) {
    URL.revokeObjectURL(url);
    throw new Error(`"${file.name}" has no pixel size.`);
  }

  return {
    name: file.name,
    url,
    width: image.naturalWidth,
    height: image.naturalHeight,
    alpha: readAlpha(image),
    texture: buildTexture(image),
  };
}

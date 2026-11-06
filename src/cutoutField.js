// A pixel is visible, and so part of the Cutout, above this opacity.
export const CUTOFF = 0.5;

// The Source Image is always this tall in world units.
export const WORLD_HEIGHT = 10;

const PAD = 2;
const FAR = 1e12;

function distanceTransform1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -FAR * FAR;
  z[1] = FAR * FAR;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = FAR * FAR;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

// Squared distance from every grid node to the nearest node where isTarget is true.
function squaredDistances(isTarget, width, height) {
  const grid = new Float64Array(width * height);
  for (let i = 0; i < grid.length; i++) grid[i] = isTarget(i) ? 0 : FAR;

  const size = Math.max(width, height);
  const f = new Float64Array(size);
  const d = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[x + y * width];
    distanceTransform1d(f, height, d, v, z);
    for (let y = 0; y < height; y++) grid[x + y * width] = d[y];
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[x + y * width];
    distanceTransform1d(f, width, d, v, z);
    for (let x = 0; x < width; x++) grid[x + y * width] = d[x];
  }
  return grid;
}

// The solid shape of the Cutout: where it is, and how far any point is from it.
export class CutoutField {
  constructor({ data, width, height }) {
    this.imageWidth = width;
    this.imageHeight = height;
    this.gridWidth = width + PAD * 2;
    this.gridHeight = height + PAD * 2;
    this.cell = WORLD_HEIGHT / height;

    const { gridWidth: gw, gridHeight: gh } = this;
    this.levels = new Float32Array(gw * gh).fill(-CUTOFF);
    let solidCount = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const level = data[x + y * width] / 255 - CUTOFF;
        this.levels[x + PAD + (y + PAD) * gw] = level;
        if (level > 0) solidCount++;
      }
    }
    this.isEmpty = solidCount === 0;
    this.isFullyOpaque = solidCount === width * height;
    if (this.isEmpty) return;

    this.#measureExtent();
    this.#buildDistances();
  }

  // Finds where the visible shape's edges cross between grid nodes.
  #measureExtent() {
    const { levels, gridWidth: gw, gridHeight: gh } = this;
    let lowest = -Infinity;
    let highest = Infinity;
    let left = Infinity;
    let right = -Infinity;
    const crossing = (a, b) => a / (a - b);

    for (let y = 0; y < gh - 1; y++) {
      for (let x = 0; x < gw - 1; x++) {
        const here = levels[x + y * gw];
        const below = levels[x + (y + 1) * gw];
        const beside = levels[x + 1 + y * gw];
        if (here > 0 !== below > 0) {
          const edge = y + crossing(here, below);
          lowest = Math.max(lowest, edge);
          highest = Math.min(highest, edge);
        }
        if (here > 0 !== beside > 0) {
          const edge = x + crossing(here, beside);
          left = Math.min(left, edge);
          right = Math.max(right, edge);
        }
      }
    }

    // The Cutout's lowest visible point touches the Floor at y = 0.
    this.lowestGridY = lowest;
    this.bounds = {
      left: this.gridToWorldX(left),
      right: this.gridToWorldX(right),
      bottom: 0,
      top: this.gridToWorldY(highest),
    };
  }

  #buildDistances() {
    const { levels, gridWidth: gw, gridHeight: gh, cell } = this;
    const toSolid = squaredDistances((i) => levels[i] > 0, gw, gh);
    const toEmpty = squaredDistances((i) => levels[i] <= 0, gw, gh);
    this.distances = new Float32Array(gw * gh);
    for (let i = 0; i < this.distances.length; i++) {
      const distance = levels[i] > 0 ? -(Math.sqrt(toEmpty[i]) - 0.5) : Math.sqrt(toSolid[i]) - 0.5;
      this.distances[i] = distance * cell;
    }
  }

  gridToWorldX(gx) {
    return (gx - PAD + 0.5 - this.imageWidth / 2) * this.cell;
  }

  gridToWorldY(gy) {
    return (this.lowestGridY - gy) * this.cell;
  }

  gridToUv(gx, gy) {
    const u = (gx - PAD + 0.5) / this.imageWidth;
    const v = 1 - (gy - PAD + 0.5) / this.imageHeight;
    return [Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))];
  }

  // u and v run 0 to 1 across the Flat View, with v = 0 at the top.
  dropPointToWorld(u, v) {
    return {
      x: this.gridToWorldX(u * this.imageWidth - 0.5 + PAD),
      y: this.gridToWorldY(v * this.imageHeight - 0.5 + PAD),
    };
  }

  // Signed distance to the shape, ignoring depth. Negative is inside it.
  distance2d(x, y) {
    const { gridWidth: gw, gridHeight: gh, distances, cell } = this;
    const gx = x / cell + this.imageWidth / 2 - 0.5 + PAD;
    const gy = this.lowestGridY - y / cell;
    const cx = Math.min(gw - 1, Math.max(0, gx));
    const cy = Math.min(gh - 1, Math.max(0, gy));
    const x0 = Math.min(gw - 2, Math.floor(cx));
    const y0 = Math.min(gh - 2, Math.floor(cy));
    const tx = cx - x0;
    const ty = cy - y0;
    const i = x0 + y0 * gw;
    const top = distances[i] * (1 - tx) + distances[i + 1] * tx;
    const bottom = distances[i + gw] * (1 - tx) + distances[i + gw + 1] * tx;
    const inside = top * (1 - ty) + bottom * ty;
    if (cx === gx && cy === gy) return inside;
    return inside + Math.hypot(gx - cx, gy - cy) * cell;
  }

  // Outward direction from the shape's edge, ignoring depth.
  normal2d(x, y) {
    const step = this.cell * 1.5;
    const nx = this.distance2d(x + step, y) - this.distance2d(x - step, y);
    const ny = this.distance2d(x, y + step) - this.distance2d(x, y - step);
    const length = Math.hypot(nx, ny);
    return length > 1e-9 ? [nx / length, ny / length] : [0, 1];
  }

  // Fills `hit` and returns true if a sphere of radius `reach` touches the slab.
  contact(x, y, z, halfDepth, reach, hit) {
    const dz = Math.abs(z) - halfDepth;
    if (dz >= reach) return false;
    const d2 = this.distance2d(x, y);
    if (d2 >= reach) return false;
    const zSign = z >= 0 ? 1 : -1;

    if (d2 > 0 && dz > 0) {
      const distance = Math.hypot(d2, dz);
      if (distance >= reach) return false;
      const [gx, gy] = this.normal2d(x, y);
      hit.nx = (gx * d2) / distance;
      hit.ny = (gy * d2) / distance;
      hit.nz = (zSign * dz) / distance;
      hit.depth = reach - distance;
    } else if (d2 > dz) {
      const [gx, gy] = this.normal2d(x, y);
      hit.nx = gx;
      hit.ny = gy;
      hit.nz = 0;
      hit.depth = reach - d2;
    } else {
      hit.nx = 0;
      hit.ny = 0;
      hit.nz = zSign;
      hit.depth = reach - dz;
    }
    return true;
  }
}

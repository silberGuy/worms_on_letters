const GRAVITY = -22;
const FRAME = 1 / 60;
const SUBSTEPS = 8;
const H = FRAME / SUBSTEPS;
const MAX_SPEED = 40;
const AIR_DAMPING = 0.9985;
const BODY_DAMPING = 0.02;
const REFERENCE_RADIUS = 0.35;
const BEND_COMPLIANCE = 0.0025;
const SPAWN_GAP = 0.02;
const MAX_MOVING_WORMS = 8;
const MIN_FRICTION = 0.03;
const MAX_FRICTION = 1.6;
const STILL_SPEED = 0.12;
const STILL_TIME = 0.35;
const MAX_WORM_AGE = 25;
const START_WAVES = 1.25;
const START_WAVE_SIZE = 0.6;
const HEADING_TRIES = 16;

const hit = { depth: 0, nx: 0, ny: 0, nz: 0 };

function createWorm(id, spec) {
  const { length, radius } = spec;
  const count = Math.min(56, Math.max(6, Math.round(length / (radius * 0.7)) + 1));
  const size = count * 3;
  return {
    ...spec,
    id,
    count,
    state: 'waiting',
    version: 0,
    age: 0,
    stillTime: 0,
    pos: new Float64Array(size),
    prev: new Float64Array(size),
    vel: new Float64Array(size),
    stretchRest: new Float64Array(count - 1),
    bendRest: new Float64Array(count - 2),
    selfGap: Math.ceil((2 * radius) / (length / (count - 1))) + 1,
    friction: MIN_FRICTION + (MAX_FRICTION - MIN_FRICTION) * spec.grip,
    bendAlpha: (BEND_COMPLIANCE * (REFERENCE_RADIUS / radius) ** 2) / (H * H),
    box: null,
  };
}

function layOut(worm, y) {
  const { x, z, heading, tilt, phase, length, radius, count, pos } = worm;
  const dirX = Math.cos(heading) * Math.cos(tilt);
  const dirY = Math.sin(tilt);
  const dirZ = Math.sin(heading) * Math.cos(tilt);
  const sideX = -Math.sin(heading);
  const sideZ = Math.cos(heading);
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const along = (t - 0.5) * length;
    const wave = Math.sin(t * Math.PI * 2 * START_WAVES + phase) * radius * START_WAVE_SIZE;
    pos[i * 3] = x + dirX * along + sideX * wave;
    pos[i * 3 + 1] = y + dirY * along;
    pos[i * 3 + 2] = z + dirZ * along + sideZ * wave;
  }
}

function distanceBetween(pos, a, b) {
  return Math.hypot(pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]);
}

function computeBox(worm, margin = 0) {
  const { pos, count, radius } = worm;
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const reach = radius + margin;
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 3; c++) {
      const value = pos[i * 3 + c];
      if (value - reach < box[c]) box[c] = value - reach;
      if (value + reach > box[c + 3]) box[c + 3] = value + reach;
    }
  }
  return box;
}

function boxesOverlap(a, b) {
  return a[0] <= b[3] && b[0] <= a[3] && a[1] <= b[4] && b[1] <= a[4] && a[2] <= b[5] && b[2] <= a[5];
}

function integrate(worm) {
  const { pos, prev, vel, count } = worm;
  for (let i = 0; i < count; i++) {
    const p = i * 3;
    vel[p + 1] += GRAVITY * H;
    vel[p] *= AIR_DAMPING;
    vel[p + 1] *= AIR_DAMPING;
    vel[p + 2] *= AIR_DAMPING;
    const speed = Math.hypot(vel[p], vel[p + 1], vel[p + 2]);
    if (speed > MAX_SPEED) {
      const scale = MAX_SPEED / speed;
      vel[p] *= scale;
      vel[p + 1] *= scale;
      vel[p + 2] *= scale;
    }
    for (let c = 0; c < 3; c++) {
      prev[p + c] = pos[p + c];
      pos[p + c] += vel[p + c] * H;
    }
  }
}

function solveDistance(pos, a, b, rest, alpha) {
  const pa = a * 3;
  const pb = b * 3;
  const dx = pos[pb] - pos[pa];
  const dy = pos[pb + 1] - pos[pa + 1];
  const dz = pos[pb + 2] - pos[pa + 2];
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (length < 1e-9) return;
  const s = (length - rest) / (2 + alpha) / length;
  pos[pa] += dx * s;
  pos[pa + 1] += dy * s;
  pos[pa + 2] += dz * s;
  pos[pb] -= dx * s;
  pos[pb + 1] -= dy * s;
  pos[pb + 2] -= dz * s;
}

function solveShape(worm) {
  const { pos, count, stretchRest, bendRest, bendAlpha } = worm;
  for (let i = 0; i < count - 2; i++) solveDistance(pos, i, i + 2, bendRest[i], bendAlpha);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < count - 1; i++) solveDistance(pos, i, i + 1, stretchRest[i], 0);
  }
}

// Pushes a particle out of something that doesn't move, then applies friction.
function resolveFixedContact(worm, p, nx, ny, nz, depth) {
  const { pos, prev, friction } = worm;
  pos[p] += nx * depth;
  pos[p + 1] += ny * depth;
  pos[p + 2] += nz * depth;

  const mx = pos[p] - prev[p];
  const my = pos[p + 1] - prev[p + 1];
  const mz = pos[p + 2] - prev[p + 2];
  const along = mx * nx + my * ny + mz * nz;
  const tx = mx - along * nx;
  const ty = my - along * ny;
  const tz = mz - along * nz;
  const slide = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (slide < 1e-12) return;
  const removed = Math.min(1, (friction * depth) / slide);
  pos[p] -= tx * removed;
  pos[p + 1] -= ty * removed;
  pos[p + 2] -= tz * removed;
}

function collideSpheres(a, ai, b, bi, friction) {
  const { pos: pa, prev: qa } = a;
  const { pos: pb, prev: qb } = b;
  const dx = pa[ai] - pb[bi];
  const dy = pa[ai + 1] - pb[bi + 1];
  const dz = pa[ai + 2] - pb[bi + 2];
  const reach = a.radius + b.radius;
  const squared = dx * dx + dy * dy + dz * dz;
  if (squared >= reach * reach || squared < 1e-12) return;

  const distance = Math.sqrt(squared);
  const nx = dx / distance;
  const ny = dy / distance;
  const nz = dz / distance;
  const depth = reach - distance;
  const half = depth / 2;
  pa[ai] += nx * half;
  pa[ai + 1] += ny * half;
  pa[ai + 2] += nz * half;
  pb[bi] -= nx * half;
  pb[bi + 1] -= ny * half;
  pb[bi + 2] -= nz * half;

  const mx = pa[ai] - qa[ai] - (pb[bi] - qb[bi]);
  const my = pa[ai + 1] - qa[ai + 1] - (pb[bi + 1] - qb[bi + 1]);
  const mz = pa[ai + 2] - qa[ai + 2] - (pb[bi + 2] - qb[bi + 2]);
  const along = mx * nx + my * ny + mz * nz;
  const tx = mx - along * nx;
  const ty = my - along * ny;
  const tz = mz - along * nz;
  const slide = Math.sqrt(tx * tx + ty * ty + tz * tz);
  if (slide < 1e-12) return;
  const removed = Math.min(1, (friction * depth) / slide) / 2;
  pa[ai] -= tx * removed;
  pa[ai + 1] -= ty * removed;
  pa[ai + 2] -= tz * removed;
  pb[bi] += tx * removed;
  pb[bi + 1] += ty * removed;
  pb[bi + 2] += tz * removed;
}

function collideSelf(worm) {
  const { count, selfGap, friction } = worm;
  for (let i = 0; i < count; i++) {
    for (let j = i + selfGap + 1; j < count; j++) collideSpheres(worm, i * 3, worm, j * 3, friction);
  }
}

function updateVelocities(worm) {
  const { pos, prev, vel, count } = worm;
  for (let i = 0; i < count * 3; i++) vel[i] = (pos[i] - prev[i]) / H;
  // Evens out neighbouring particles, so wobbles die away without slowing the fall.
  for (let i = 1; i < count - 1; i++) {
    for (let c = 0; c < 3; c++) {
      const p = i * 3 + c;
      vel[p] += BODY_DAMPING * ((vel[p - 3] + vel[p + 3]) / 2 - vel[p]);
    }
  }
}

function maxSpeed(worm) {
  const { vel, count } = worm;
  let squared = 0;
  for (let i = 0; i < count; i++) {
    const p = i * 3;
    const s = vel[p] * vel[p] + vel[p + 1] * vel[p + 1] + vel[p + 2] * vel[p + 2];
    if (s > squared) squared = s;
  }
  return Math.sqrt(squared);
}

// The Worms of one Composition, and the physics that moves them until they are Settled.
export class WormWorld {
  constructor(field, thickness) {
    this.field = field;
    this.halfDepth = thickness / 2;
    this.worms = [];
    this.nextId = 1;
  }

  setThickness(thickness) {
    this.halfDepth = thickness / 2;
  }

  // spec: x, y, z, heading, tilt, phase, length, radius, grip
  drop(spec) {
    const worm = createWorm(this.nextId++, spec);
    this.worms.push(worm);
    this.#startWaitingWorms();
    return worm;
  }

  remove(id) {
    this.worms = this.worms.filter((worm) => worm.id !== id);
  }

  clear() {
    this.worms = [];
  }

  #startWaitingWorms() {
    let moving = this.worms.filter((worm) => worm.state === 'moving').length;
    for (const worm of this.worms) {
      if (moving >= MAX_MOVING_WORMS) return;
      if (worm.state !== 'waiting') continue;
      this.#place(worm);
      moving++;
    }
  }

  // Starts a Worm at its Drop Point. If it doesn't fit there at any heading, it starts
  // straight above, at the lowest height where some heading fits.
  #place(worm) {
    const { field } = this;
    const preferredHeading = worm.heading;
    let y = Math.max(worm.y, worm.radius + SPAWN_GAP);
    while (field.distance2d(worm.x, y) < 0) y += field.cell;
    while (!this.#fitsAt(worm, y, preferredHeading)) y += worm.radius / 2;

    worm.prev.set(worm.pos);
    for (let i = 0; i < worm.count - 1; i++) worm.stretchRest[i] = distanceBetween(worm.pos, i, i + 1);
    for (let i = 0; i < worm.count - 2; i++) worm.bendRest[i] = distanceBetween(worm.pos, i, i + 2);
    worm.state = 'moving';
    worm.version++;
  }

  // Turns the Worm ever further from its preferred heading, keeping the first that fits.
  #fitsAt(worm, y, preferredHeading) {
    for (let k = 0; k < HEADING_TRIES; k++) {
      const turns = Math.ceil(k / 2) * (k % 2 === 1 ? 1 : -1);
      worm.heading = preferredHeading + (turns * Math.PI) / HEADING_TRIES;
      layOut(worm, y);
      if (this.#isClear(worm)) return true;
    }
    return false;
  }

  #isClear(worm) {
    const { pos, count, radius } = worm;
    const reach = radius + SPAWN_GAP;
    const box = computeBox(worm, SPAWN_GAP);
    const others = this.worms.filter(
      (other) => other !== worm && other.state !== 'waiting' && boxesOverlap(box, computeBox(other)),
    );

    for (let i = 0; i < count; i++) {
      const p = i * 3;
      const x = pos[p];
      const y = pos[p + 1];
      const z = pos[p + 2];
      if (y < reach) return false;
      if (this.field.contact(x, y, z, this.halfDepth, reach, hit)) return false;
      for (const other of others) {
        const touching = reach + other.radius;
        for (let j = 0; j < other.count; j++) {
          const q = j * 3;
          const dx = x - other.pos[q];
          const dy = y - other.pos[q + 1];
          const dz = z - other.pos[q + 2];
          if (dx * dx + dy * dy + dz * dz < touching * touching) return false;
        }
      }
    }
    return true;
  }

  // Lists the Settled spheres a moving Worm could reach during this frame.
  #nearbySettledSpheres(worm) {
    const margin = MAX_SPEED * FRAME;
    const box = computeBox(worm, margin);
    const spheres = [];
    for (const other of this.worms) {
      if (other.state !== 'settled' || !boxesOverlap(box, other.box)) continue;
      for (let i = 0; i < other.count; i++) {
        const p = i * 3;
        const x = other.pos[p];
        const y = other.pos[p + 1];
        const z = other.pos[p + 2];
        const r = other.radius;
        if (x + r < box[0] || x - r > box[3]) continue;
        if (y + r < box[1] || y - r > box[4]) continue;
        if (z + r < box[2] || z - r > box[5]) continue;
        spheres.push(x, y, z, r);
      }
    }
    return spheres;
  }

  #collideFixed(worm, spheres) {
    const { field, halfDepth } = this;
    const { pos, count, radius } = worm;
    for (let i = 0; i < count; i++) {
      const p = i * 3;
      if (pos[p + 1] < radius) resolveFixedContact(worm, p, 0, 1, 0, radius - pos[p + 1]);
      if (field.contact(pos[p], pos[p + 1], pos[p + 2], halfDepth, radius, hit)) {
        resolveFixedContact(worm, p, hit.nx, hit.ny, hit.nz, hit.depth);
      }
      for (let s = 0; s < spheres.length; s += 4) {
        const dx = pos[p] - spheres[s];
        const dy = pos[p + 1] - spheres[s + 1];
        const dz = pos[p + 2] - spheres[s + 2];
        const reach = radius + spheres[s + 3];
        const squared = dx * dx + dy * dy + dz * dz;
        if (squared >= reach * reach || squared < 1e-12) continue;
        const distance = Math.sqrt(squared);
        resolveFixedContact(worm, p, dx / distance, dy / distance, dz / distance, reach - distance);
      }
    }
  }

  #collideMoving(pairs) {
    for (const [a, b] of pairs) {
      if (!boxesOverlap(computeBox(a), computeBox(b))) continue;
      const friction = (a.friction + b.friction) / 2;
      for (let i = 0; i < a.count; i++) {
        for (let j = 0; j < b.count; j++) collideSpheres(a, i * 3, b, j * 3, friction);
      }
    }
  }

  #updateSettling(worm) {
    worm.age += FRAME;
    worm.version++;
    worm.stillTime = maxSpeed(worm) < STILL_SPEED ? worm.stillTime + FRAME : 0;
    if (worm.stillTime >= STILL_TIME || worm.age >= MAX_WORM_AGE) {
      worm.state = 'settled';
      worm.vel.fill(0);
      worm.box = computeBox(worm);
    }
  }

  // Advances the simulation by one frame.
  step() {
    this.#startWaitingWorms();
    const moving = this.worms.filter((worm) => worm.state === 'moving');
    if (moving.length === 0) return;

    const spheres = moving.map((worm) => this.#nearbySettledSpheres(worm));
    const pairs = [];
    for (let a = 0; a < moving.length; a++) {
      for (let b = a + 1; b < moving.length; b++) pairs.push([moving[a], moving[b]]);
    }

    for (let sub = 0; sub < SUBSTEPS; sub++) {
      for (const worm of moving) {
        integrate(worm);
        solveShape(worm);
        collideSelf(worm);
      }
      this.#collideMoving(pairs);
      moving.forEach((worm, i) => this.#collideFixed(worm, spheres[i]));
      for (const worm of moving) updateVelocities(worm);
    }

    for (const worm of moving) this.#updateSettling(worm);
  }
}

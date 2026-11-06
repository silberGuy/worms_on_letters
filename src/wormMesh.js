import * as THREE from 'three';

const SAMPLES_PER_SEGMENT = 5;
const CAP_RINGS = 5;
const RADIAL_SEGMENTS = 14;
const GROOVE_DEPTH = 0.035;
const GROOVE_SHADE = 0.14;
const MAX_SHADE_SHIFT = 0.04;

function catmullRom(a, b, c, d, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
}

// The visible body of one Worm: a smooth, ringed tube through its particles.
export class WormMesh {
  constructor(worm, colour) {
    this.worm = worm;
    this.version = -1;

    const bodyRings = (worm.count - 1) * SAMPLES_PER_SEGMENT + 1;
    this.bodyRings = bodyRings;
    this.ringCount = bodyRings + CAP_RINGS * 2;
    const vertexCount = this.ringCount * RADIAL_SEGMENTS;
    this.positions = new Float32Array(vertexCount * 3);
    this.normals = new Float32Array(vertexCount * 3);
    this.centres = new Float32Array(bodyRings * 3);
    this.grooves = this.#computeGrooves();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.#computeColours(colour), 3));
    geometry.setIndex(this.#computeIndices());

    const material = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.38,
      clearcoat: 0.6,
      clearcoatRoughness: 0.3,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  #computeGrooves() {
    const { worm, bodyRings } = this;
    const sampleSpacing = worm.length / (worm.count - 1) / SAMPLES_PER_SEGMENT;
    const period = Math.max(worm.radius * 0.7, sampleSpacing * 4);
    const grooves = new Float32Array(bodyRings);
    for (let i = 0; i < bodyRings; i++) {
      const wave = 0.5 + 0.5 * Math.cos((Math.PI * 2 * i * sampleSpacing) / period);
      grooves[i] = wave ** 4;
    }
    return grooves;
  }

  #computeColours(colour) {
    const base = new THREE.Color(colour).offsetHSL(0, 0, (Math.random() * 2 - 1) * MAX_SHADE_SHIFT);
    const colours = new Float32Array(this.ringCount * RADIAL_SEGMENTS * 3);
    for (let ring = 0; ring < this.ringCount; ring++) {
      const body = ring - CAP_RINGS;
      const groove = body >= 0 && body < this.bodyRings ? this.grooves[body] : 0;
      const shade = 1 - groove * GROOVE_SHADE;
      for (let a = 0; a < RADIAL_SEGMENTS; a++) {
        const i = (ring * RADIAL_SEGMENTS + a) * 3;
        colours[i] = base.r * shade;
        colours[i + 1] = base.g * shade;
        colours[i + 2] = base.b * shade;
      }
    }
    return colours;
  }

  #computeIndices() {
    const indices = [];
    for (let ring = 0; ring < this.ringCount - 1; ring++) {
      for (let a = 0; a < RADIAL_SEGMENTS; a++) {
        const next = (a + 1) % RADIAL_SEGMENTS;
        const i0 = ring * RADIAL_SEGMENTS + a;
        const i1 = ring * RADIAL_SEGMENTS + next;
        const i2 = (ring + 1) * RADIAL_SEGMENTS + a;
        const i3 = (ring + 1) * RADIAL_SEGMENTS + next;
        indices.push(i0, i1, i2, i1, i3, i2);
      }
    }
    return indices;
  }

  #computeCentres() {
    const { pos, count } = this.worm;
    const { centres } = this;
    const point = (index, c) => {
      if (index < 0) return 2 * pos[c] - pos[3 + c];
      if (index >= count) return 2 * pos[(count - 1) * 3 + c] - pos[(count - 2) * 3 + c];
      return pos[index * 3 + c];
    };
    let out = 0;
    for (let i = 0; i < count - 1; i++) {
      for (let s = 0; s < SAMPLES_PER_SEGMENT; s++) {
        const t = s / SAMPLES_PER_SEGMENT;
        for (let c = 0; c < 3; c++) {
          centres[out++] = catmullRom(point(i - 1, c), point(i, c), point(i + 1, c), point(i + 2, c), t);
        }
      }
    }
    for (let c = 0; c < 3; c++) centres[out++] = pos[(count - 1) * 3 + c];
  }

  #writeRing(ring, centre, tangent, side, up, radius, axial) {
    const { positions, normals } = this;
    const radial = Math.sqrt(Math.max(0, 1 - axial * axial));
    for (let a = 0; a < RADIAL_SEGMENTS; a++) {
      const angle = (a / RADIAL_SEGMENTS) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const i = (ring * RADIAL_SEGMENTS + a) * 3;
      const ox = side.x * cos + up.x * sin;
      const oy = side.y * cos + up.y * sin;
      const oz = side.z * cos + up.z * sin;
      positions[i] = centre.x + ox * radius;
      positions[i + 1] = centre.y + oy * radius;
      positions[i + 2] = centre.z + oz * radius;
      normals[i] = ox * radial + tangent.x * axial;
      normals[i + 1] = oy * radial + tangent.y * axial;
      normals[i + 2] = oz * radial + tangent.z * axial;
    }
  }

  #writeCap(startRing, centre, tangent, side, up, direction) {
    const { radius } = this.worm;
    const point = new THREE.Vector3();
    for (let k = 0; k < CAP_RINGS; k++) {
      // Runs from the rounded tip toward the body at the tail, and the reverse at the head.
      const fromBody = direction < 0 ? CAP_RINGS - k : k + 1;
      const angle = (fromBody / CAP_RINGS) * (Math.PI / 2);
      point.copy(centre).addScaledVector(tangent, direction * radius * Math.sin(angle));
      this.#writeRing(
        startRing + k,
        point,
        tangent,
        side,
        up,
        Math.max(radius * Math.cos(angle), radius * 0.02),
        direction * Math.sin(angle),
      );
    }
  }

  update() {
    const { worm } = this;
    this.mesh.visible = worm.state !== 'waiting';
    if (worm.state === 'waiting' || this.version === worm.version) return;
    this.version = worm.version;

    this.#computeCentres();
    const { centres, bodyRings, grooves } = this;
    const { radius } = worm;
    const centre = new THREE.Vector3();
    const before = new THREE.Vector3();
    const after = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const up = new THREE.Vector3();
    const side = new THREE.Vector3();

    for (let i = 0; i < bodyRings; i++) {
      centre.fromArray(centres, i * 3);
      before.fromArray(centres, Math.max(0, i - 1) * 3);
      after.fromArray(centres, Math.min(bodyRings - 1, i + 1) * 3);
      tangent.subVectors(after, before).normalize();

      if (i === 0) {
        side.set(Math.abs(tangent.y) < 0.9 ? 0 : 1, Math.abs(tangent.y) < 0.9 ? 1 : 0, 0);
      }
      side.addScaledVector(tangent, -side.dot(tangent)).normalize();
      up.crossVectors(tangent, side);

      if (i === 0) this.#writeCap(0, centre, tangent, side, up, -1);
      const ringRadius = radius * (1 - grooves[i] * GROOVE_DEPTH);
      this.#writeRing(CAP_RINGS + i, centre, tangent, side, up, ringRadius, 0);
      if (i === bodyRings - 1) this.#writeCap(CAP_RINGS + bodyRings, centre, tangent, side, up, 1);
    }

    const { position, normal } = this.mesh.geometry.attributes;
    position.needsUpdate = true;
    normal.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

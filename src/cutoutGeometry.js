import * as THREE from 'three';

// Overlaps interior quads slightly, so no pinholes appear where they meet the edge cells.
const SEAM_OVERLAP = 0.01;

// Builds the Cutout at unit depth, from z = -0.5 to 0.5. The mesh is scaled to its real thickness.
export function buildCutoutGeometry(field) {
  const { levels, gridWidth: gw, gridHeight: gh } = field;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const addVertex = (gx, gy, z, nx, ny, nz) => {
    positions.push(field.gridToWorldX(gx), field.gridToWorldY(gy), z);
    normals.push(nx, ny, nz);
    const [u, v] = field.gridToUv(gx, gy);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };

  // The polygon arrives clockwise as seen from the front.
  const addFaces = (polygon) => {
    const front = polygon.map(([gx, gy]) => addVertex(gx, gy, 0.5, 0, 0, 1));
    const back = polygon.map(([gx, gy]) => addVertex(gx, gy, -0.5, 0, 0, -1));
    for (let k = 1; k < polygon.length - 1; k++) {
      indices.push(front[0], front[k + 1], front[k]);
      indices.push(back[0], back[k], back[k + 1]);
    }
  };

  const addSide = (from, to) => {
    const addEdge = ([gx, gy]) => {
      const x = field.gridToWorldX(gx);
      const y = field.gridToWorldY(gy);
      const [nx, ny] = field.normal2d(x, y);
      return [addVertex(gx, gy, 0.5, nx, ny, 0), addVertex(gx, gy, -0.5, nx, ny, 0)];
    };
    const [fromFront, fromBack] = addEdge(from);
    const [toFront, toBack] = addEdge(to);
    indices.push(fromFront, toBack, fromBack);
    indices.push(fromFront, toFront, toBack);
  };

  for (let y = 0; y < gh - 1; y++) {
    let runStart = -1;
    for (let x = 0; x < gw; x++) {
      const corners =
        x < gw - 1
          ? [
              [x, y],
              [x + 1, y],
              [x + 1, y + 1],
              [x, y + 1],
            ]
          : null;
      const values = corners && corners.map(([cx, cy]) => levels[cx + cy * gw]);
      const allInside = values !== null && values.every((value) => value > 0);

      if (allInside) {
        if (runStart < 0) runStart = x;
        continue;
      }

      if (runStart >= 0) {
        addFaces([
          [runStart - SEAM_OVERLAP, y - SEAM_OVERLAP],
          [x + SEAM_OVERLAP, y - SEAM_OVERLAP],
          [x + SEAM_OVERLAP, y + 1 + SEAM_OVERLAP],
          [runStart - SEAM_OVERLAP, y + 1 + SEAM_OVERLAP],
        ]);
        runStart = -1;
      }

      if (values === null || values.every((value) => value <= 0)) continue;

      // Walks the cell's corners, keeping those inside and adding the edge crossings.
      const polygon = [];
      const crossings = [];
      for (let k = 0; k < 4; k++) {
        const next = (k + 1) % 4;
        const here = values[k];
        const there = values[next];
        if (here > 0) polygon.push(corners[k]);
        if (here > 0 !== there > 0) {
          const t = here / (here - there);
          const point = [
            corners[k][0] + (corners[next][0] - corners[k][0]) * t,
            corners[k][1] + (corners[next][1] - corners[k][1]) * t,
          ];
          polygon.push(point);
          crossings.push({ point, isExit: here > 0 });
        }
      }

      // Each stretch of the shape's edge runs from a crossing out to the next crossing back in.
      crossings.forEach(({ point, isExit }, k) => {
        if (isExit) addSide(point, crossings[(k + 1) % crossings.length].point);
      });

      addFaces(polygon);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

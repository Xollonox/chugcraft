// ============================================================================
// Shared face shading for entity and item meshes.
//
// Chunks bake directional shading into their vertex colours in the mesher.
// Entities are ordinary Three.js meshes, so they need the same treatment or
// they render as flat silhouettes. Rather than lean on three's lighting model
// (whose intensity semantics have shifted between versions), the identical
// per-face constants are baked straight into a vertex-colour attribute — which
// is deterministic, testable, and free at draw time.
// ============================================================================

import * as THREE from 'three';

/** Must match FACE_SHADE in the chunk mesher. */
export const FACE_SHADE = {
  top: 1.0,
  bottom: 0.5,
  east: 0.62,     // +/-X
  side: 0.82,     // +/-Z
};

export function shadeForNormal(nx, ny, nz) {
  if (ny > 0.5) return FACE_SHADE.top;
  if (ny < -0.5) return FACE_SHADE.bottom;
  if (Math.abs(nx) > Math.abs(nz)) return FACE_SHADE.east;
  return FACE_SHADE.side;
}

/**
 * Write a per-vertex colour attribute holding each face's shade. Safe to call
 * more than once on a cached geometry; the second call is a no-op.
 */
export function bakeFaceShade(geometry) {
  if (geometry.userData.faceShaded) return geometry;
  const normal = geometry.getAttribute('normal');
  if (!normal) { geometry.computeVertexNormals(); }
  const n = geometry.getAttribute('normal');
  const count = n.count;
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const s = shadeForNormal(n.getX(i), n.getY(i), n.getZ(i));
    col[i * 3] = s; col[i * 3 + 1] = s; col[i * 3 + 2] = s;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.userData.faceShaded = true;
  return geometry;
}

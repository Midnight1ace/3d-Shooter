/**
 * Weapon Helper Functions
 */

export function applySpread(direction, angle) {
  const spread = THREE.MathUtils.degToRad(angle);

  const randomX = (Math.random() - 0.5) * spread;
  const randomY = (Math.random() - 0.5) * spread;

  const newDir = direction.clone();
  newDir.x += randomX;
  newDir.y += randomY;

  return newDir.normalize();
}

import { buildSolidTest } from './solid_test.mjs';

export function build(scene) {
  return buildSolidTest(scene, { plain: true });
}

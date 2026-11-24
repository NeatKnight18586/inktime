// Camera slots (engine/rig/slots.mjs) and light states (engine/look/lightstate.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SLOTS, slotPoint, tickSlotDistance, sfxSlotDistance, isSlot, slotOutward } from '../engine/rig/slots.mjs';
import { lightFx } from '../engine/look/lightstate.mjs';

test('slots land on their screen point at any FOV and orientation', () => {
  for (const fov of [20, 52, 90]) {
    const cam = new THREE.PerspectiveCamera(fov, 1080 / 1920, 0.05, 9000);
    cam.position.set(3, 30, -2);
    cam.quaternion.setFromEuler(new THREE.Euler(-0.3, 0.7, 0.05, 'YXZ'));
    cam.updateMatrixWorld(true);
    for (const [name, s] of Object.entries(SLOTS)) {
      const q = slotPoint(name, cam, tickSlotDistance(fov)).project(cam);
      assert.ok(Math.abs((q.x + 1) / 2 - s.x) < 1e-6 && Math.abs((1 - q.y) / 2 - s.y) < 1e-6, `${name} @ ${fov}`);
    }
  }
  assert.ok(tickSlotDistance(20) > tickSlotDistance(90) && sfxSlotDistance(90) < tickSlotDistance(90));
  assert.ok(isSlot('cam_hands') && !isSlot('padlock'));
  const cam = new THREE.PerspectiveCamera(90, 1080 / 1920);
  assert.ok(slotOutward('cam_left', cam).x < 0 && slotOutward('cam_right', cam).x > 0);
  assert.deepEqual(SLOTS.cam_hands, { x: 0.68, y: 0.66 });
});

test('iceberg_reveal: crest light over 12 frames, scale 1.0 -> 1.35, world yaw 0 -> +4 deg', () => {
  const a = lightFx('iceberg_reveal', 0, 40);
  const z = lightFx('iceberg_reveal', 39, 40);
  assert.ok(a.glow > 0 && a.glow < 0.1);
  assert.equal(lightFx('iceberg_reveal', 11, 40).glow, 1);
  assert.equal(a.bergScale, 1);
  assert.equal(z.bergScale, 1.35);
  assert.equal(a.yaw, 0);
  assert.equal(z.yaw, 4);
  assert.equal(lightFx('night', 3, 40), null);
});

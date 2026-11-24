// Plain deck set kit (daylight): a flat wooden deck with a low rail and a few props, for proving the cast tricks
// outside the dark nest (stills frame F4, the temporary "day" look). Procedural. Units: metres, y up, +Z toward the camera.
import * as THREE from 'three';

const DEG = Math.PI / 180;

function mesh(geo, mat, x, y, z, name) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.name = name;
  return m;
}

function anchorAt(scene, anchors, name, pos, ud) {
  const o = new THREE.Object3D();
  o.name = `anchor:${name}`;
  o.position.copy(pos);
  if (ud) {
    o.quaternion.setFromEuler(new THREE.Euler(ud.pitch * DEG, ud.yaw * DEG, 0, 'YXZ'));
    o.userData = ud;
  }
  scene.add(o);
  anchors[name] = o;
}

export function build(scene) {
  const pal = scene.userData.palette;
  const L = pal.json.light;
  const anchors = {};
  const deck = pal.toon('deck', { paint: 'wood' });
  const rail = pal.toon('shade');
  const prop = pal.toon('cloud');
  const floor = mesh(new THREE.BoxGeometry(40, 0.3, 40), deck, 0, -0.15, 0, 'deck');
  floor.receiveShadow = true;
  scene.add(floor);
  // Low rail along the back and the right, props on the planks (a plain deck, but never empty).
  for (let i = -8; i <= 8; i++) scene.add(mesh(new THREE.BoxGeometry(0.12, 1.0, 0.12), rail, i * 1.2, 0.5, -3.2, `post_${i}`));
  scene.add(mesh(new THREE.BoxGeometry(20, 0.1, 0.14), rail, 0, 1.0, -3.2, 'rail_back'));
  scene.add(mesh(new THREE.BoxGeometry(0.7, 0.55, 0.7), prop, -2.6, 0.275, -1.4, 'crate_a'));
  scene.add(mesh(new THREE.BoxGeometry(0.55, 0.4, 0.55), prop, -2.0, 0.2, -1.9, 'crate_b'));
  scene.add(mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.7, 14), prop, 2.5, 0.35, -1.6, 'barrel'));
  scene.add(mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.4, 10), rail, 3.1, 0.2, -0.4, 'bollard'));
  // Sun: the key light. It casts the shadow-proxy shadows; direction from the look file (cast.keyDir).
  const k = new THREE.Vector3(...pal.json.cast.keyDir).normalize();
  const sun = new THREE.DirectionalLight(pal.color(L.key), 2.4);
  sun.position.copy(k).multiplyScalar(30);
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(pal.color(L.fill), pal.color('shade'), L.fillIntensity));
  // Characters stand 1.4 m apart; the camera sits at a 3/4 angle (about 36 deg off their line of sight).
  anchorAt(scene, anchors, 'fleet_spot', new THREE.Vector3(-0.7, 0, 0));
  anchorAt(scene, anchors, 'lee_spot', new THREE.Vector3(0.7, 0, 0));
  anchorAt(scene, anchors, 'cam_day', new THREE.Vector3(2.6, 1.5, 3.6), { yaw: 35.8, pitch: -5.1, fov: 52, panini: false });
  return { anchors, keyLight: sun, update() {} };
}

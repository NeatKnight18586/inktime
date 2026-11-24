// Solid-card test set: a striped wall behind a character card (tools/solidtest.mjs). A plain variant has one flat wall.
// Units: metres, camera at the origin looking down -Z, card 1.6 m ahead, wall 3 m ahead.
import * as THREE from 'three';

export function buildSolidTest(scene, { plain = false } = {}) {
  const pal = scene.userData.palette;
  const anchors = {};
  const dark = pal.toon('shade', { spotBlack: false });
  const light = pal.toon('cloud', { spotBlack: false });
  const flat = pal.toon('sky', { spotBlack: false });
  if (plain) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(8, 6, 0.2), flat);
    w.position.set(0, 1.4, -3);
    scene.add(w);
  } else {
    // Vertical stripes 0.2 m wide, plus a horizontal band: plenty of edges and ink lines behind the card.
    for (let i = -20; i < 20; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.2, 6, 0.2), i % 2 ? dark : light);
      s.position.set(i * 0.2 + 0.1, 1.4, -3);
      scene.add(s);
    }
    const band = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, 0.3), dark);
    band.position.set(0, 1.2, -2.9);
    scene.add(band);
  }
  const floor = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 8), pal.toon('deck', { spotBlack: false }));
  floor.position.set(0, -0.1, -2);
  scene.add(floor);
  scene.add(new THREE.HemisphereLight(pal.color('sky'), pal.color('shade'), 0.8));
  const sun = new THREE.DirectionalLight(pal.color('sun'), 2.0);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const cam = new THREE.Object3D();
  cam.name = 'anchor:cam';
  cam.position.set(0, 1.1, 0);
  cam.userData = { yaw: 0, pitch: 0, fov: 50, panini: false };
  scene.add(cam);
  anchors.cam = cam;
  const spot = new THREE.Object3D();
  spot.position.set(0, 0, -1.6);
  scene.add(spot);
  anchors.card_spot = spot;
  return { anchors, update() {} };
}

export function build(scene) {
  return buildSolidTest(scene, { plain: false });
}

// The 2007 auction room (look auction_warm). A diorama set (engine/kits/diorama.mjs): a panelled back wall with lamp sconces;
// the auctioneer's podium; a velvet stand with the brass key (its tag reads "CROWS NEST TELEPHONE"); raised bidding paddles; a
// row of heads seen from behind in the foreground. Props: the key, a gavel, the hand-lettered price card "£90,000".
import * as THREE from 'three';
import { buildDiorama, anchor } from '../../engine/kits/diorama.mjs';
import { brassKey, gavel, letteredCard } from '../props/props.mjs';

export const ANCHORS = ['cam_auction', 'cam_key', 'auctioneer_spot', 'key', 'gavel', 'price_card', 'guide_spot', 'podium'];
export const ROOM = { eye: [0.1, 1.25, 0.4], fov: 52, auctioneer: [-0.9, 0, -6.0], stand: [1.0, 0, -4.0] };

export function build(scene, rng) {
  const pal = scene.userData.palette;
  const c = (k) => pal.hexOf(k);
  const mix = (a, b, t) => pal.mixHex(a, b, t);
  const anchors = {};
  const group = new THREE.Group();
  group.name = 'auction_2007';
  scene.add(group);
  const layers = [
    {
      name: 'wall', z: -9, w: 18, h: 7.5, y: 0,
      draw(k) {
        k.shape(k.rect(-9, 0, 9, 7.5), c('wall'), { outline: false });
        // Panelling: a dado of wood panels, framed panels above, a picture rail.
        k.shape(k.rect(-9, 0, 9, 1.1), c('wood'), { line: k.lw.crease });
        for (let x = -8.6; x < 8.6; x += 1.4) {
          k.shape(k.rect(x, 0.15, x + 1.15, 0.95), mix('wood', 'wall', 0.35), { line: k.lw.texture });
          k.shape(k.rect(x, 1.5, x + 1.15, 4.4), mix('wall', 'wood', 0.3), { line: k.lw.crease });
          k.hatch(k.rect(x, 1.5, x + 0.12, 4.4), { alpha: 0.45 });
        }
        k.line([[-9, 4.8], [9, 4.8]], k.lw.crease, c('wood'));
        // Two lamp sconces: hard-edged glow rings (lamp, paper core).
        for (const x of [-3.2, 3.2]) {
          for (const [r, col] of [[0.9, mix('wall', 'lamp', 0.25)], [0.55, mix('wall', 'lamp', 0.55)], [0.28, c('lamp')], [0.12, c('paper')]]) k.shape(k.ellipse(x, 3.6, r, r, 28), col, { outline: false });
          k.shape(k.rect(x - 0.06, 2.9, x + 0.06, 3.45), c('wood'), { line: k.lw.texture });
        }
        // A picture frame (velvet) on the wall.
        k.shape(k.rect(-1.0, 2.4, 1.0, 4.2), c('velvet'), { line: k.lw.crease });
        k.shape(k.rect(-0.8, 2.6, 0.8, 4.0), mix('wall', 'paper', 0.15), { line: k.lw.texture });
      },
    },
    {
      name: 'podium', z: -5.6, w: 2.4, h: 1.3, y: 0, x: -0.9,
      draw(k) {
        const p = [[-0.55, 0], [-0.62, 1.05], [-0.7, 1.12], [0.7, 1.12], [0.62, 1.05], [0.55, 0]];
        k.shape(p, c('wood'), { line: k.lw.silhouette });
        k.shape(k.rect(-0.42, 0.2, 0.42, 0.85), mix('wood', 'wall', 0.3), { line: k.lw.crease });
        k.hatch(k.rect(0.3, 0.0, 0.55, 1.05), { alpha: 0.4 });
      },
    },
    {
      name: 'stand', z: -4.02, w: 1.0, h: 1.1, y: 0, x: ROOM.stand[0],
      draw(k) {
        // The velvet stand: a draped plinth and a cushion on top.
        k.shape([[-0.3, 0], [-0.26, 0.98], [0.26, 0.98], [0.3, 0]], c('velvet'), { line: k.lw.silhouette });
        for (const x of [-0.15, 0, 0.15]) k.line([[x, 0.05], [x * 0.9, 0.95]], k.lw.texture, mix('velvet', 'wall', 0.5));
        k.shape(k.ellipse(0, 1.0, 0.32, 0.06, 24), mix('velvet', 'paper', 0.12), { line: k.lw.crease });
      },
    },
    {
      name: 'paddles', z: -2.8, w: 6, h: 2.2, y: 0,
      draw(k) {
        // Raised bidding paddles: paper discs on sticks, one velvet.
        for (const [x, y, col] of [[-2.1, 1.75, c('paper')], [-0.3, 1.95, c('paper')], [1.7, 1.8, c('velvet')], [2.5, 1.6, c('paper')]]) {
          k.shape(k.rect(x - 0.02, y - 0.55, x + 0.02, y - 0.12), c('wood'), { line: k.lw.texture });
          k.shape(k.ellipse(x, y, 0.15, 0.15, 24), col, { line: k.lw.silhouette });
        }
      },
    },
    {
      name: 'heads', z: -1.1, w: 4.4, h: 1.5, y: 0, x: 0,
      draw(k) {
        // A row of heads seen from behind: shoulders, round heads, hair in wall and wood tones.
        const r = k.r;
        for (const x of [-1.7, -0.85, 0.15, 1.05, 1.85]) {
          const h = 1.08 + r() * 0.08;
          k.shape([[x - 0.3, 0], [x - 0.28, h - 0.25], [x - 0.12, h - 0.15], [x + 0.12, h - 0.15], [x + 0.28, h - 0.25], [x + 0.3, 0]], r() < 0.5 ? mix('wall', 'paper', 0.08) : c('velvet'), { line: k.lw.silhouette });
          k.shape(k.ellipse(x, h, 0.13, 0.15, 24), r() < 0.5 ? mix('wood', 'wall', 0.5) : c('wall'), { line: k.lw.silhouette });
          k.hatch(k.ellipse(x + 0.04, h, 0.1, 0.12, 16), { alpha: 0.3 });
        }
      },
    },
    {
      name: 'floor', z: -3.5, w: 14, h: 12, y: 0, floor: true,
      draw(k) {
        k.shape(k.rect(-7, 0, 7, 12), mix('wood', 'wall', 0.4), { outline: false });
        for (let y = 0.4; y < 12; y += 0.4) k.line([[-7, y], [7, y]], k.lw.texture, mix('wood', 'ink', 0.5));
      },
    },
  ];
  const d = buildDiorama(group, { seed: 'auction_2007', view: { eye: ROOM.eye, fov: ROOM.fov }, layers });
  // Props: the key on the velvet cushion, the gavel on the podium, the price card on an easel.
  const key = brassKey(pal, { tag: 'CROWS NEST TELEPHONE' });
  key.group.position.set(ROOM.stand[0] + 0.03, 1.03, ROOM.stand[2] + 0.02);
  key.group.rotation.set(-0.5, 0.1, 0.05);
  key.group.scale.setScalar(1.6);
  const gv = gavel(pal);
  gv.group.position.set(ROOM.auctioneer[0] + 0.35, 1.12, -5.45);
  gv.group.rotation.z = -1.25;
  gv.block.position.set(ROOM.auctioneer[0] + 0.35, 1.13, -5.45);
  const price = letteredCard(pal, '£90,000', { w: 0.62, h: 0.36 });
  price.group.position.set(1.45, 0.75, -4.9);
  price.group.rotation.y = -0.25;
  const easel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.8, 0.04), pal.toon('wood', { paint: 'wood' }));
  easel.position.set(1.45, 0.4, -4.95);
  group.add(key.group, gv.group, gv.block, price.group, easel);
  const L = pal.json.light;
  const lamp = new THREE.DirectionalLight(pal.color(L.key), 2.0);
  lamp.position.set(...pal.json.cast.keyDir.map((v) => v * 20));
  scene.add(lamp, lamp.target);
  scene.add(new THREE.HemisphereLight(pal.color('lamp'), pal.color(L.fill), L.fillIntensity));
  anchor(group, anchors, 'cam_auction', ROOM.eye, { yaw: 5, pitch: -1, fov: ROOM.fov });
  anchor(group, anchors, 'cam_key', [ROOM.stand[0] + 0.03, 1.27, ROOM.stand[2] + 0.38], { yaw: 0, pitch: -30, fov: 52 });
  anchor(group, anchors, 'auctioneer_spot', ROOM.auctioneer);
  anchor(group, anchors, 'key', [ROOM.stand[0] + 0.03, 1.03, ROOM.stand[2] + 0.02]);
  anchor(group, anchors, 'gavel', [ROOM.auctioneer[0] + 0.35, 1.25, -5.45]);
  anchor(group, anchors, 'price_card', [1.45, 0.93, -4.9]);
  anchor(group, anchors, 'podium', [ROOM.auctioneer[0], 1.1, -5.6]);
  anchor(group, anchors, 'guide_spot', [-2.2, 1.6, -3]);
  return { anchors, keyLight: lamp, update() {}, prepass: d.prepass, ready: Promise.all([d.ready, key.ready, price.ready]) };
}

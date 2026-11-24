import * as THREE from 'three';
import { LAYERS, setLayer } from '../look/layers.mjs';
import { drawStick } from '../cast/stick.mjs';
import { CARD, D_METRES, figure, billboardAngles, lightInCamera, faceTurn, drawOrder, proxyYaw, blinkFrames } from '../cast/stickmath.mjs';

export { blinkFrames };
export const CARD_HEIGHT = CARD.h * D_METRES; // plane height in metres (3.5 D figure = 1.75 m, 1 D = 0.5 m)
const PX_PER_D = 300;
const DEG = Math.PI / 180;

// Soft contact ellipse at the feet: ink, alpha fading to the edge.
function contactTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(20,20,20,0.85)');
  g.addColorStop(0.55, 'rgba(20,20,20,0.5)');
  g.addColorStop(1, 'rgba(20,20,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Stick character card in 3D (docs/STYLE.md, Characters). Per frame:
//  a) billboard: yaw faces the camera, pitch follows its elevation limited to 15 deg;
//  b) volume shading with the key light converted into camera space; the whole card multiplied by the scene tint;
//  c) face features and hat brim shift toward the look direction (0.05-0.18 D);
//  d) an invisible shadow-proxy plane facing the key light casts a real shadow; a soft contact ellipse at the feet;
//  e) far arm and leg behind the body, 10% darker (in the drawing);
//  f) key direction, shade, rim and tint come from the look file (look.cast), so one character works in day and night.
// The drawing and pose state update on twos; the billboard and the light follow the camera.
export async function makeCard(scene, spec, anchors, palette, { tint, seed = 'card', frames = 10000, keyLight = null } = {}) {
  const anchor = anchors[spec.anchor];
  if (!anchor) throw new Error(`card anchor "${spec.anchor}" missing`);
  const cast = palette.json.cast;
  if (!cast) throw new Error(`look ${palette.name}: no "cast" block (key light for characters)`);
  const params = await (await fetch(`/cast/${spec.cast}/char.json`)).json();
  const nest = spec.light === 'nest' ? { lit: cast.nest.lit, dark: cast.nest.dark } : null;
  const light = { key: palette.hex(cast.key), shade: palette.hex(cast.shade), rim: palette.hex(cast.rim) };
  const facing = (spec.facing ?? 0) * DEG;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(CARD.w * PX_PER_D);
  canvas.height = Math.round(CARD.h * PX_PER_D);
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const w = CARD.w * D_METRES;
  const h = CARD.h * D_METRES;
  const geo = new THREE.PlaneGeometry(w, h);
  geo.translate(0, h / 2 - CARD.bottom * D_METRES, 0);
  // Solid cutout (Fix 2.1): alphaTest 0.5, not transparent, depth written, so nothing behind the body shows through.
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: tint ?? 0xffffff, transparent: false, alphaTest: 0.5, depthWrite: true, side: THREE.DoubleSide, fog: true });
  // Depth/normal prepass material: the same cutout, writing view-space normals, so the edge pass treats the card as an occluder.
  const prepassMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex } },
    side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D map; varying vec2 vUv; varying vec3 vN; void main(){ if (texture2D(map, vUv).a < 0.5) discard; vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n; gl_FragColor = vec4(n * 0.5 + 0.5, 1.0); }',
  });
  const card = new THREE.Mesh(geo, mat);
  card.rotation.order = 'YXZ';
  card.name = `card:${spec.cast}`;

  // Shadow proxy (d): same silhouette, rotated to face the key light, invisible but a real shadow caster.
  const proxy = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
  proxy.name = `shadow_proxy:${spec.cast}`;
  proxy.rotation.y = proxyYaw(cast.keyDir);
  proxy.castShadow = true;
  if (keyLight) {
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.bias = -0.0004;
    keyLight.shadow.normalBias = 0.02;
    if (keyLight.isDirectionalLight) {
      const c = keyLight.shadow.camera;
      c.left = c.bottom = -6;
      c.right = c.top = 6;
      c.near = 0.5;
      c.far = 80;
      c.updateProjectionMatrix();
    }
  }
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
  );
  contact.rotation.x = -Math.PI / 2;
  contact.scale.set(1.3 * D_METRES * 2, 0.7 * D_METRES * 2, 1);
  contact.position.y = 0.006;
  contact.name = 'contact_ellipse';

  const group = new THREE.Group();
  group.name = `card:${spec.cast}`;
  group.add(contact, proxy, card);
  anchor.updateWorldMatrix(true, false);
  anchor.getWorldPosition(group.position);
  setLayer(group, LAYERS.CARD);
  card.layers.set(LAYERS.CARD_BODY);
  scene.add(group);
  const base = new THREE.Vector3();
  const api = {
    group,
    card,
    proxy,
    mat,
    prepassMat,
    last: null,
    // Swap the card's material for the depth/normal prepass material (and back) around the line-layer render.
    prepass(on) {
      card.material = on ? prepassMat : mat;
    },
    // Drawing on twos from the baked plan entry e = { pose, mouth, blink, breath } (tools/bake.mjs); the billboard follows the camera on ones.
    update(n, camera, e) {
      anchor.updateWorldMatrix(true, false);
      anchor.getWorldPosition(base);
      group.position.copy(base);
      const bb = billboardAngles(base, camera.position, h);
      card.rotation.set(bb.pitch, bb.yaw, 0);
      if (n % 2 === 0 || !api.last) {
        const p0 = e.pose;
        const k = Math.floor(n / 2);
        const pose = { ...p0 };
        if (p0.shake) pose.lean = (p0.lean ?? 0) + p0.shake * (k % 2 ? 1 : -1);
        pose.mouth = e.mouth;
        // facingCam (deg): face the camera, turned that far from it (0 = straight at you); else the fixed world facing.
        const fy = spec.facingCam !== undefined ? Math.atan2(camera.position.x - base.x, camera.position.z - base.z) + spec.facingCam * DEG : facing;
        const look = faceTurn(fy, base, camera.position, p0.look ?? 0);
        const turn = Math.cos(look.angle);
        const order = drawOrder(look.angle);
        const fig = figure(pose, e.breath, turn);
        const st = {
          fig,
          pose,
          turn,
          angle: look.angle,
          look,
          light: { ...light, cam: lightInCamera(cast.keyDir, camera) },
          order,
          seed: `${seed}:${spec.cast}`,
          nest,
          litBrim: !!nest?.lit.includes('brim'),
          blink: e.blink,
          mouth: pose.mouth,
          skin: params.skin,
          shirt: params.shirt,
          trousers: params.trousers,
          hat: params.hat,
          cheek: params.cheek ?? null,
        };
        drawStick(ctx, canvas.width, canvas.height, params, st);
        tex.needsUpdate = true;
        api.last = { n, ...bb, light: st.light.cam, shift: look.shift, back: look.back, far: order.far, angle: look.angle };
      } else {
        api.last = { ...api.last, ...bb };
      }
    },
  };
  return api;
}

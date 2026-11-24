// Render layers. SOLID: toon meshes (colour + line passes). HULL: inverted hulls (line pass only).
// FX: sky, stars, sea, glow, smoke (colour only). MIRROR: sea reflections. CARD: card shadow proxies and contact ellipses.
// CARD_BODY: the solid character card (colour pass and the depth/normal prepass, so the edge pass sees it as an occluder).
export const LAYERS = { SOLID: 0, HULL: 1, FX: 2, MIRROR: 3, CARD: 4, CARD_BODY: 5 };
export const COLOUR_LAYERS = [LAYERS.SOLID, LAYERS.FX, LAYERS.MIRROR, LAYERS.CARD, LAYERS.CARD_BODY];

export function setLayer(obj, layer) {
  obj.traverse((o) => o.layers.set(layer));
  return obj;
}

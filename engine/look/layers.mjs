// Render layers. SOLID: toon meshes (colour + line passes). HULL: inverted hulls (line pass only).
// FX: sky, stars, sea, glow, smoke (colour only). MIRROR: sea reflections. CARD: character cards.
export const LAYERS = { SOLID: 0, HULL: 1, FX: 2, MIRROR: 3, CARD: 4 };
export const COLOUR_LAYERS = [LAYERS.SOLID, LAYERS.FX, LAYERS.MIRROR, LAYERS.CARD];

export function setLayer(obj, layer) {
  obj.traverse((o) => o.layers.set(layer));
  return obj;
}

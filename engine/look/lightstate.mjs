// Per-shot light states beyond the look's base night/day light (episode shot "light"). Pure: values from the frame's place
// in the run of consecutive shots that share the state (k = 0 .. K-1).
// iceberg_reveal (the money shot): the berg crest light fades in over 12 frames, the iceberg scales 1.0 -> 1.35 across the run
// (the approach) and the world yaws +4 deg (the bow swinging to port), so the berg slides right.
export const LIGHT_STATES = {
  iceberg_reveal: { fadeFrames: 12, scale: [1, 1.35], yaw: 4 },
};
const smooth = (u) => {
  const x = Math.max(0, Math.min(1, u));
  return x * x * (3 - 2 * x);
};
// -> { glow 0..1, bergScale, yaw deg } or null for plain light states.
export function lightFx(light, k, K) {
  const s = LIGHT_STATES[light];
  if (!s) return null;
  const u = K > 1 ? k / (K - 1) : 1;
  return {
    glow: Math.min(1, (k + 1) / s.fadeFrames),
    bergScale: s.scale[0] + (s.scale[1] - s.scale[0]) * u,
    yaw: s.yaw * smooth(u),
  };
}

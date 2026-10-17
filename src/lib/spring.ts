// Motion maths for gesture-driven UI, after Apple's "Designing Fluid Interfaces": springs described by a
// damping ratio and a response time (not mass and stiffness), momentum projection and rubber-banding.
// Pure functions, so they can be tested; the components drive them from requestAnimationFrame.

export interface SpringConfig {
  /** Seconds for the value to reach its target, roughly. Lower is snappier. Not a duration: a spring has none. */
  response: number;
  /** 1 settles without overshoot; below 1 it overshoots and oscillates. */
  damping: number;
}

/** Critically damped: graceful, no overshoot. The default for anything that did not carry momentum. */
export const SMOOTH: SpringConfig = { response: 0.38, damping: 1 };
/** A little bounce, for when a flick or throw came before. */
export const MOMENTUM: SpringConfig = { response: 0.34, damping: 0.8 };

export interface SpringState {
  /** Position. */
  x: number;
  /** Velocity in units per second. */
  v: number;
}

const SUBSTEP = 1 / 240;

/** Advances a spring toward `target` by `dt` seconds. Small substeps keep it stable at any frame rate. */
export function stepSpring(state: SpringState, target: number, cfg: SpringConfig, dt: number): SpringState {
  const w = (2 * Math.PI) / cfg.response;
  const stiffness = w * w;
  const damping = 2 * cfg.damping * w;
  const steps = Math.max(1, Math.ceil(dt / SUBSTEP));
  const h = dt / steps;
  let { x, v } = state;
  for (let i = 0; i < steps; i++) {
    v += (-stiffness * (x - target) - damping * v) * h;
    x += v * h;
  }
  return { x, v };
}

export function isSettled(state: SpringState, target: number, position = 0.4, velocity = 8): boolean {
  return Math.abs(state.x - target) < position && Math.abs(state.v) < velocity;
}

/**
 * Where a throw would come to rest, like scroll deceleration. `velocity` is in px/s. This is the
 * exponential-decay form Apple ships, not the textbook v²/2a.
 */
export function projectMomentum(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Resistance past a boundary: the further it is pulled, the less it follows, and it never reaches `dimension`. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (overshoot <= 0) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * overshoot);
}

export interface Sample {
  /** Milliseconds. */
  t: number;
  y: number;
}

/** Release velocity in px/s from the last moments of a drag, not just the last two points (which are noisy). */
export function velocityFrom(samples: Sample[], windowMs = 100): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  const recent = samples.filter((s) => last.t - s.t <= windowMs);
  const first = recent[0];
  const dt = last.t - first.t;
  return dt > 0 ? ((last.y - first.y) / dt) * 1000 : 0;
}

/**
 * Whether a downward drag should dismiss a sheet: judged by where the throw would land, so a quick
 * flick closes it from a short distance and a slow pull needs to pass the middle.
 */
export function shouldDismiss(offset: number, velocity: number, height: number): boolean {
  return offset + projectMomentum(velocity) > height * 0.5;
}

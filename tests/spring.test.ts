import { describe, expect, it } from 'vitest';
import { isSettled, MOMENTUM, projectMomentum, rubberband, shouldDismiss, SMOOTH, stepSpring, velocityFrom, type SpringState } from '@/lib/spring';

function run(from: SpringState, target: number, cfg = SMOOTH, seconds = 2, fps = 60) {
  const path: SpringState[] = [from];
  let s = from;
  for (let i = 0; i < seconds * fps; i++) path.push((s = stepSpring(s, target, cfg, 1 / fps)));
  return path;
}

describe('spring', () => {
  it('settles on its target without overshoot when critically damped', () => {
    const path = run({ x: 600, v: 0 }, 0);
    expect(Math.min(...path.map((s) => s.x))).toBeGreaterThan(-0.5);
    expect(isSettled(path.at(-1)!, 0)).toBe(true);
  });

  it('overshoots when under-damped, and still settles', () => {
    const path = run({ x: 600, v: 0 }, 0, MOMENTUM, 3);
    expect(Math.min(...path.map((s) => s.x))).toBeLessThan(-5);
    expect(isSettled(path.at(-1)!, 0)).toBe(true);
  });

  it('carries the velocity it is handed: a spring let go while moving keeps moving the same way first', () => {
    const [, next] = run({ x: 300, v: 2000 }, 0, SMOOTH, 1);
    expect(next.x).toBeGreaterThan(300);
    // Handed no velocity it would already be heading for the target.
    expect(run({ x: 300, v: 0 }, 0)[1].x).toBeLessThan(300);
  });

  it('starts from where it is, so grabbing it mid-flight does not jump', () => {
    const mid = run({ x: 600, v: 0 }, 0)[10];
    expect(run(mid, 600)[0].x).toBe(mid.x);
  });

  it('reaches the same place at any frame rate', () => {
    const a = run({ x: 600, v: 0 }, 0, SMOOTH, 0.3, 30).at(-1)!;
    const b = run({ x: 600, v: 0 }, 0, SMOOTH, 0.3, 120).at(-1)!;
    expect(Math.abs(a.x - b.x)).toBeLessThan(1);
  });

  it('is faster with a lower response time', () => {
    const at = (response: number) => run({ x: 600, v: 0 }, 0, { response, damping: 1 }, 0.2)[12].x;
    expect(at(0.2)).toBeLessThan(at(0.6));
  });
});

describe('momentum projection', () => {
  it('uses the exponential decay form: 1000 px/s lands about 500 px on', () => {
    expect(projectMomentum(1000)).toBeCloseTo(499, 0);
    expect(projectMomentum(-1000)).toBeCloseTo(-499, 0);
    expect(projectMomentum(0)).toBe(0);
  });

  it('throws further with a lower deceleration rate being faster to stop', () => {
    expect(projectMomentum(1000, 0.99)).toBeLessThan(projectMomentum(1000, 0.998));
  });
});

describe('rubber-banding', () => {
  it('follows less the further it is pulled, and never reaches the dimension', () => {
    const near = rubberband(50, 600) / 50;
    const far = rubberband(500, 600) / 500;
    expect(near).toBeLessThan(1);
    expect(far).toBeLessThan(near);
    expect(rubberband(1e6, 600)).toBeLessThan(600);
  });

  it('has no resistance inside the bounds', () => {
    expect(rubberband(0, 600)).toBe(0);
    expect(rubberband(-20, 600)).toBe(0);
  });
});

describe('release velocity', () => {
  it('measures over the last moments of the drag', () => {
    const samples = [
      { t: 0, y: 0 },
      { t: 50, y: 5 },
      { t: 150, y: 20 },
      { t: 200, y: 120 },
      { t: 250, y: 220 },
    ];
    // Last 100 ms: 120 -> 220 px over 50 ms plus 20 -> ... the window starts at t=150.
    expect(velocityFrom(samples)).toBeCloseTo(((220 - 20) / 100) * 1000, 0);
    expect(velocityFrom([{ t: 0, y: 0 }])).toBe(0);
    expect(velocityFrom([])).toBe(0);
  });
});

describe('dismissing a sheet', () => {
  it('lets a quick flick close it from a short distance, and a slow pull need to pass the middle', () => {
    expect(shouldDismiss(80, 1800, 600)).toBe(true);
    expect(shouldDismiss(80, 0, 600)).toBe(false);
    expect(shouldDismiss(320, 0, 600)).toBe(true);
    expect(shouldDismiss(250, 0, 600)).toBe(false);
  });

  it('keeps it open when flicked back up, even from low down', () => {
    expect(shouldDismiss(300, -2500, 600)).toBe(false);
  });
});

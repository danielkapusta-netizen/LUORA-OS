import type { Transition } from 'framer-motion'

/**
 * Motion vocabulary.
 *
 * Every animation in the product comes from this file, so timing is a decision
 * made once rather than re-invented per component.
 *
 * We think in Apple's two parameters rather than the physics triplet:
 *
 *   - **Damping ratio** — how much it overshoots. 1.0 is critically damped:
 *     it settles without a bounce. Below 1.0 it oscillates.
 *   - **Response** — how quickly the value reaches its target, in seconds.
 *     This is not a duration; a spring has no fixed end, its settle time
 *     emerges from the parameters.
 *
 * Framer Motion expresses the same pair as `bounce` (0 = critically damped)
 * and `visualDuration` (the perceived time to arrive — Apple's response).
 *
 * The default everywhere is critically damped. Bounce is reserved for motion
 * that a gesture actually threw: overshoot on a card you flicked feels right,
 * overshoot on a menu that merely appeared feels like a toy.
 *
 * Springs matter beyond their look — they are interruptible by construction.
 * A spring re-targeted mid-flight continues from its current position and
 * velocity, which is exactly what is needed when someone changes their mind
 * halfway through a transition.
 */

/** Critically damped, standard pace. The house default. */
export const spring: Transition = { type: 'spring', bounce: 0, visualDuration: 0.4 }

/** Critically damped, quicker — for small elements and immediate feedback. */
export const springSnappy: Transition = { type: 'spring', bounce: 0, visualDuration: 0.3 }

/** Slower settle for large surfaces, which read as heavier. */
export const springSoft: Transition = { type: 'spring', bounce: 0, visualDuration: 0.55 }

/**
 * Sheets and drawers. These are dragged in the physical sense, so a little
 * overshoot is honest — Apple ships damping 0.8 / response 0.3 here.
 */
export const springDrawer: Transition = { type: 'spring', bounce: 0.2, visualDuration: 0.3 }

/** Momentum: something released with velocity behind it. */
export const springMomentum: Transition = { type: 'spring', bounce: 0.2, visualDuration: 0.4 }

/**
 * Cross-fades and other pure-opacity changes, where a spring would be
 * imperceptible and a plain tween is cheaper.
 */
export const fade: Transition = { duration: 0.22, ease: [0.16, 1, 0.3, 1] }

/**
 * Entrance for a list of peers.
 *
 * A stagger reads as the page composing itself; too much of one reads as the
 * page being slow. Cap the delay so a long list never keeps the reader waiting
 * on its last item.
 */
export function stagger(index: number, step = 0.04, max = 0.24): number {
  return Math.min(index * step, max)
}

/** The standard way an element arrives: a short lift, sprung into place. */
export function rise(index = 0): {
  initial: { opacity: number; y: number }
  animate: { opacity: number; y: number }
  transition: Transition
} {
  return {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { ...spring, delay: stagger(index) },
  }
}

/**
 * How a translucent surface arrives.
 *
 * Glass should *materialise* rather than fade: blur and scale move together so
 * it reads as a real material condensing into place, not a picture of one
 * being turned up in opacity. Scale starts near 1 because a big jump would
 * read as a zoom rather than a material forming.
 */
export const materialize = {
  initial: { opacity: 0, scale: 0.97, filter: 'blur(6px)' },
  animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
  exit: { opacity: 0, scale: 0.97, filter: 'blur(6px)' },
  transition: springSnappy,
} as const

/**
 * Disclosure: a row opening to show its detail.
 *
 * Height springs so the rows below are pushed rather than snapped, and the
 * content fades on a shorter clock than the height so it is never legible
 * while the container is still the wrong size.
 */
export const disclosure = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: {
    height: spring,
    opacity: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  },
} as const

'use client';

import { X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { isSettled, MOMENTUM, rubberband, shouldDismiss, SMOOTH, stepSpring, velocityFrom, type Sample, type SpringConfig } from '@/lib/spring';
import { cn } from '@/lib/utils';

/** Re-renders when a media query starts or stops matching. */
export function useMedia(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => serverValue);
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

/**
 * A bottom sheet that behaves like a physical object:
 * - It follows the finger 1:1 (grab the handle or the title), and resists past its top edge like a rubber band.
 * - On release the finger's velocity is handed to a spring, and where the throw would land decides whether
 *   it closes: a quick flick dismisses from a short distance, a slow pull has to pass the middle.
 * - It is interruptible: grabbing it mid-flight starts from its live position, never from where it was heading.
 * - Reduced motion swaps the slide for a short cross-fade.
 * With `staticFromXl` the same markup is ordinary page content from the xl breakpoint on (a side panel),
 * so a page renders its details once and they are a sheet on a phone and a panel on a desktop.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  staticFromXl = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  staticFromXl?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const offset = useRef(0); // px below fully open; the live, on-screen value
  const velocity = useRef(0); // px/s handed from a release to the closing spring
  const frame = useRef(0);
  const closing = useRef(false); // a closing animation is in flight, however it started
  const drag = useRef<{ startY: number; startOffset: number } | null>(null);
  const samples = useRef<Sample[]>([]);
  const [shown, setShown] = useState(open);
  // Visible from the moment it opens until the closing animation has finished.
  if (open && !shown) setShown(true);
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  const wide = useMedia('(min-width: 1280px)');
  const isStatic = staticFromXl && wide;

  const height = () => panel.current?.offsetHeight || 1;

  const apply = useCallback((value: number) => {
    offset.current = value;
    const p = panel.current;
    if (!p) return;
    p.style.transform = `translate3d(0, ${value}px, 0)`;
    if (scrim.current) scrim.current.style.opacity = String(Math.min(1, Math.max(0, 1 - Math.max(value, 0) / (p.offsetHeight || 1))));
  }, []);

  const animate = useCallback(
    (target: number, from: number, cfg: SpringConfig, done?: () => void, closingNow = false) => {
      cancelAnimationFrame(frame.current);
      // Whatever animation takes over, the sheet is only "closing" if this one is.
      closing.current = closingNow;
      let state = { x: offset.current, v: from };
      let last = performance.now();
      const tick = (now: number) => {
        state = stepSpring(state, target, cfg, Math.min((now - last) / 1000, 1 / 20));
        last = now;
        apply(state.x);
        if (isSettled(state, target)) {
          apply(target);
          done?.();
          return;
        }
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    },
    [apply],
  );

  // Closing is the sheet's own business: the page's `open` may already be false (grabbed again mid-flight),
  // so a dismissal must never wait for the parent to re-render.
  const runClose = useCallback(
    (from: number) => {
      const p = panel.current;
      // A finger on the sheet decides; and a close already under way is left to finish.
      if (!p || closing.current || drag.current) return;
      closing.current = true;
      const finish = () => {
        if (!closing.current) return; // reopened meanwhile
        closing.current = false;
        setShown(false);
      };
      if (reduced) {
        p.style.opacity = '0';
        if (scrim.current) scrim.current.style.opacity = '0';
        window.setTimeout(finish, 170);
      } else {
        animate(p.offsetHeight || 1, from, SMOOTH, finish, true);
      }
    },
    [animate, reduced],
  );
  const dismiss = useCallback(
    (from = 0) => {
      runClose(from);
      onClose();
    },
    [runClose, onClose],
  );

  // Open and close. Both start from wherever the sheet is right now.
  useLayoutEffect(() => {
    const p = panel.current;
    if (!p || isStatic) return;
    if (open) {
      closing.current = false;
      if (reduced) {
        p.style.transition = 'opacity 160ms ease';
        p.style.opacity = '1';
        if (scrim.current) scrim.current.style.transition = 'opacity 160ms ease';
        apply(0);
      } else {
        p.style.transition = '';
        p.style.opacity = '';
        if (scrim.current) scrim.current.style.transition = '';
        if (!drag.current && offset.current === 0 && !p.dataset.opened) apply(height());
        animate(0, velocity.current, SMOOTH);
      }
      p.dataset.opened = '1';
    } else if (p.dataset.opened) {
      runClose(velocity.current);
    }
    velocity.current = 0;
  }, [open, isStatic, reduced, animate, apply, runClose]);

  // Only on unmount: a re-render (the page learning it was dismissed) must not cut the closing animation short.
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // Start closed and off-screen, so the first open slides in.
  useLayoutEffect(() => {
    if (!isStatic && !open && !panel.current?.dataset.opened) apply(height());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);

  // While it is on screen: Escape closes, Tab stays inside, the page behind does not scroll, focus returns afterwards.
  useEffect(() => {
    if (!shown || isStatic) return;
    const before = document.activeElement as HTMLElement | null;
    const scrollLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const [first, last] = [items[0], items[items.length - 1]];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = scrollLock;
      before?.focus?.({ preventScroll: true });
    };
  }, [shown, isStatic, dismiss]);

  // Dragging by the handle and title. The content below keeps its own scrolling.
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // keeps tracking when the finger leaves the handle
    } catch {
      // A pointer that is already gone cannot be captured; the drag still works inside the handle.
    }
    cancelAnimationFrame(frame.current); // grabbing mid-flight: continue from the live position
    closing.current = false; // a closing animation that was running is abandoned
    drag.current = { startY: e.clientY, startOffset: offset.current };
    samples.current = [{ t: e.timeStamp, y: offset.current }];
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const raw = d.startOffset + (e.clientY - d.startY);
    const value = raw < 0 ? -rubberband(-raw, height()) : raw;
    apply(value);
    samples.current.push({ t: e.timeStamp, y: value });
    if (samples.current.length > 24) samples.current.shift();
  };
  const up = () => {
    if (!drag.current) return;
    drag.current = null;
    const v = velocityFrom(samples.current);
    if (shouldDismiss(Math.max(offset.current, 0), v, height())) {
      dismiss(v); // the closing spring starts at the speed of the finger
    } else {
      // Bounce only when the release carried momentum.
      animate(0, v, Math.abs(v) > 300 ? MOMENTUM : SMOOTH);
    }
  };

  return (
    <>
      <div
        ref={scrim}
        aria-hidden
        onClick={() => dismiss()}
        style={{ opacity: 0 }}
        className={cn('fixed inset-0 z-40 bg-slate-900/45', staticFromXl && 'xl:hidden', !shown && 'pointer-events-none invisible')}
      />
      <div
        ref={panel}
        role={isStatic ? undefined : 'dialog'}
        aria-modal={isStatic ? undefined : true}
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'material-sheet fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90dvh] w-full max-w-[34rem] flex-col rounded-t-[28px] border-t border-white/70 shadow-[0_-10px_40px_rgba(15,23,42,0.18)] outline-none',
          !shown && 'invisible',
          staticFromXl && 'xl:visible! xl:static xl:z-auto xl:mx-0 xl:max-h-none xl:max-w-none xl:transform-none! xl:rounded-none xl:border-0 xl:bg-transparent xl:opacity-100! xl:shadow-none xl:backdrop-blur-none',
        )}
      >
        <div
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          className={cn('shrink-0 cursor-grab touch-none select-none active:cursor-grabbing', staticFromXl && 'xl:hidden')}
        >
          <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-slate-300" />
          <div className="flex items-center justify-between gap-3 px-5 pt-2 pb-2">
            <h2 className="truncate text-lg font-semibold tracking-tight">{title}</h2>
            <button
              type="button"
              onClick={() => dismiss()}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Close"
              className="press flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-900/8 text-slate-600"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </div>
        <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]', staticFromXl && 'xl:overflow-visible xl:p-0')}>{children}</div>
      </div>
    </>
  );
}

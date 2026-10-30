'use client';

import { AnimatePresence, type HTMLMotionProps, motion, useReducedMotion } from 'motion/react';
import { forwardRef, type Key, type ReactNode, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type DynamicButtonVariant = 'primary' | 'secondary' | 'success';

const uiEaseOut = [0.23, 1, 0.32, 1] as const;

export type DynamicButtonProps = Omit<HTMLMotionProps<'button'>, 'animate' | 'children' | 'initial' | 'ref' | 'transition'> & {
  children: string;
  icon?: ReactNode;
  stateKey?: Key;
  variant?: DynamicButtonVariant;
  width?: 'content' | 'full';
};

const buttonClasses: Record<DynamicButtonVariant, string> = {
  primary: 'border-ink bg-ink text-white hover:bg-ink-soft',
  secondary: 'border-black/[0.1] bg-white text-ink hover:border-black/20 hover:bg-sidebar',
  success: 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700',
};

/**
 * A button whose label and icon change in place: the width springs to fit the new label, the old content
 * slides up and out as the new slides in from below. Reduced motion keeps only a short cross-fade.
 */
export const DynamicButton = forwardRef<HTMLButtonElement, DynamicButtonProps>(function DynamicButton(
  { children, className, icon, stateKey, type = 'button', variant = 'primary', width = 'content', ...props },
  forwardedRef,
) {
  const shouldReduceMotion = useReducedMotion();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const measurementSignatureRef = useRef('');
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const iconKey = stateKey ?? children;
  const measurementSignature = [children, className, icon ? 'icon' : 'no-icon', stateKey, variant].join('\0');
  const shouldMeasureWidth = width === 'content';
  const widthTransition = shouldReduceMotion ? { duration: 0 } : { bounce: 0, duration: 0.26, type: 'spring' as const };
  const contentTransition = { duration: shouldReduceMotion ? 0.16 : 0.18, ease: uiEaseOut };
  const contentVisible = { opacity: 1, transform: 'translateY(0px)' };
  const contentInitial = shouldReduceMotion ? { opacity: 0, transform: 'translateY(0px)' } : { opacity: 0, transform: 'translateY(8px)' };
  const contentExit = shouldReduceMotion ? { opacity: 0, transform: 'translateY(0px)' } : { opacity: 0, transform: 'translateY(-8px)' };

  useImperativeHandle(forwardedRef, () => buttonRef.current as HTMLButtonElement);

  const syncWidth = useCallback(() => {
    const button = buttonRef.current;
    const measure = measureRef.current;
    if (!button || !measure || !shouldMeasureWidth) return;
    const styles = window.getComputedStyle(button);
    const horizontalPadding =
      Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight) + Number.parseFloat(styles.borderLeftWidth) + Number.parseFloat(styles.borderRightWidth);
    const nextWidth = Math.ceil(measure.scrollWidth + horizontalPadding);
    setMeasuredWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
  }, [shouldMeasureWidth]);

  useLayoutEffect(() => {
    const measure = measureRef.current;
    if (!measure || !shouldMeasureWidth) {
      setMeasuredWidth(null);
      return;
    }
    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    observer.observe(measure);
    window.addEventListener('resize', syncWidth);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncWidth);
    };
  }, [shouldMeasureWidth, syncWidth]);

  useLayoutEffect(() => {
    if (measurementSignatureRef.current === measurementSignature) return;
    measurementSignatureRef.current = measurementSignature;
    syncWidth();
  }, [measurementSignature, syncWidth]);

  return (
    <motion.button
      {...props}
      animate={width === 'content' ? { width: measuredWidth ?? 'auto' } : undefined}
      className={cn(
        // A 40 px target (44 on phones) suits a tablet; the original was 28 px.
        'relative inline-flex h-10 cursor-pointer items-center justify-center gap-1.5 overflow-hidden rounded-full border px-3.5 text-sm font-medium whitespace-nowrap max-md:h-11',
        'transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] disabled:cursor-wait',
        buttonClasses[variant],
        width === 'full' && 'w-full',
        className,
      )}
      initial={false}
      ref={buttonRef}
      transition={width === 'content' ? { width: widthTransition } : undefined}
      type={type}
    >
      <span className="relative inline-flex items-center gap-1.5">
        {icon ? (
          <span className="relative inline-grid size-[15px] shrink-0 overflow-hidden">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                animate={contentVisible}
                className="col-start-1 row-start-1 flex size-[15px] items-center justify-center"
                exit={contentExit}
                initial={contentInitial}
                key={iconKey}
                transition={contentTransition}
              >
                {icon}
              </motion.span>
            </AnimatePresence>
          </span>
        ) : null}
        <span className="relative inline-grid overflow-hidden">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span animate={contentVisible} className="col-start-1 row-start-1 block" exit={contentExit} initial={contentInitial} key={children} transition={contentTransition}>
              {children}
            </motion.span>
          </AnimatePresence>
        </span>
      </span>
      {/* An invisible copy of the content, measured to know how wide the button should become. */}
      <span aria-hidden="true" className="pointer-events-none absolute inline-flex items-center gap-1.5 opacity-0" ref={measureRef}>
        {icon ? <span className="flex size-[15px] shrink-0 items-center justify-center">{icon}</span> : null}
        <span>{children}</span>
      </span>
    </motion.button>
  );
});

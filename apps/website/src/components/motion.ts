import { useEffect, useState, type RefObject } from "react";

/** True when the user asked for reduced motion or the platform cannot answer (tests, old browsers). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function supportsIntersectionObserver(): boolean {
  return typeof IntersectionObserver !== "undefined";
}

/**
 * Marks every `[data-reveal]` element with `is-in` once it scrolls into view.
 * Elements are revealed immediately where IntersectionObserver is unavailable.
 */
export function useRevealOnScroll(dependency: unknown): void {
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (!supportsIntersectionObserver() || prefersReducedMotion()) {
      for (const target of targets) target.classList.add("is-in");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 },
    );
    for (const target of targets) {
      if (target.classList.contains("is-in")) continue;
      observer.observe(target);
    }
    return () => observer.disconnect();
  }, [dependency]);
}

/** Resolves to true the first time the referenced element is on screen. */
export function useInView(ref: RefObject<Element | null>): boolean {
  const [inView, setInView] = useState(() => !supportsIntersectionObserver());

  useEffect(() => {
    const element = ref.current;
    if (inView || element === null || !supportsIntersectionObserver()) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setInView(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [inView, ref]);

  return inView;
}

/** Eases an integer from 0 to `value` once `active` turns true; jumps straight there under reduced motion. */
export function useCountUp(value: number, active: boolean, durationMs = 1100): number {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!active) return;
    if (prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
      setCurrent(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(Math.round(value * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, durationMs, value]);

  return active ? current : 0;
}

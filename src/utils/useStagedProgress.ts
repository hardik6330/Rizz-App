import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The "thinking" stage ticker the three AI tools show while a generation runs.
 *
 * All three had their own copy: a `stage` state, a `stageTimer` ref, an interval
 * that walks the stage index up and clamps at the last one, a `clearInterval` in
 * a `finally`, and an unmount effect to clear it again. Five moving parts each,
 * and the failure mode is invisible — a timer that outlives the screen keeps
 * calling `setState` on an unmounted component, so it costs nothing until it
 * costs a leak nobody can reproduce.
 *
 * Deliberately NOT a whole run-the-analysis hook. The three screens genuinely
 * differ in what a run means — the Lab charges once per screenshot and keeps the
 * report up when a reroll fails, Profile Scan can come back "not a profile" and
 * must refund rather than count — and folding those into one hook means a hook
 * with a flag per screen. This owns the timer and nothing else.
 *
 * `start()` is idempotent: calling it again restarts from stage 0 rather than
 * running two intervals, which is what a double-tap used to do.
 */
export function useStagedProgress(stageCount: number, intervalMs: number) {
  const [stage, setStage] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  /**
   * `count` overrides the default for this run. Profile Scan needs it: its stage
   * copy is per-mode (`PROFILE_STAGES[mode]`) and a capture from the bubble can
   * set the mode for that one run, so the length is not known at render time.
   * Passing the count in beats assuming both modes will always have equal stages.
   */
  const start = useCallback(
    (count = stageCount) => {
      stop();
      setStage(0);
      timer.current = setInterval(() => {
        // Clamp at the last stage: the copy runs out long before a slow request does.
        setStage((current) => Math.min(current + 1, count - 1));
      }, intervalMs);
    },
    [stageCount, intervalMs, stop],
  );

  // The one that was easy to forget, because nothing visible breaks without it.
  useEffect(() => stop, [stop]);

  return { stage, start, stop };
}

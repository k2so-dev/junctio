import { useIntervalFn } from "@vueuse/core";

export function usePolling(fn: () => unknown, intervalMs: number) {
  return useIntervalFn(
    () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void fn();
    },
    intervalMs,
    { immediate: true, immediateCallback: true }
  );
}

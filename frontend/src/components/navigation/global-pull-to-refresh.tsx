import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Deliberate edge gesture only: ordinary upward scrolling must never refresh.
const START_ZONE = 88;
const ARM_DISTANCE = 28;
const TRIGGER_DISTANCE = 112;
const MAX_DISTANCE = 132;

/** Refreshes active server data without losing the current route or form state. */
export function GlobalPullToRefresh() {
  const queryClient = useQueryClient();
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    const atTop = () => window.scrollY <= 0 && (document.scrollingElement?.scrollTop ?? 0) <= 0;
    const isInteractive = (target: EventTarget | null) => target instanceof Element
      && Boolean(target.closest("input, textarea, select, button, a, [contenteditable='true'], [role='dialog']"));
    const reset = () => { startY.current = null; setDistance(0); };

    const onStart = (event: TouchEvent) => {
      if (refreshing || event.touches.length !== 1 || !atTop() || isInteractive(event.target)
          || event.touches[0].clientY > START_ZONE) return;
      startY.current = event.touches[0].clientY;
    };
    const onMove = (event: TouchEvent) => {
      if (startY.current === null || event.touches.length !== 1) return;
      if (!atTop()) { reset(); return; }
      const pulled = event.touches[0].clientY - startY.current;
      if (pulled <= 0) { setDistance(0); return; }
      // Until the motion is clearly an intentional pull, preserve native scrolling.
      if (pulled < ARM_DISTANCE) return;
      event.preventDefault();
      setDistance(Math.min(MAX_DISTANCE, (pulled - ARM_DISTANCE) * 0.45));
    };
    const onEnd = async () => {
      const shouldRefresh = distance >= TRIGGER_DISTANCE;
      reset();
      if (!shouldRefresh || refreshing) return;
      setRefreshing(true);
      try { await queryClient.invalidateQueries({ refetchType: "active" }); }
      finally { setRefreshing(false); }
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", reset);
    };
  }, [distance, queryClient, refreshing]);

  const visible = refreshing || distance > 0;
  return <div className="global-pull-refresh" aria-live="polite" aria-hidden={!visible} data-visible={visible || undefined} style={{ transform: `translate(-50%, ${refreshing ? 10 : Math.min(10, distance - 82)}px)` }}>
    <RefreshCw className={refreshing ? "is-spinning" : undefined} aria-hidden="true" />
    <span>{refreshing ? "Refreshing…" : distance >= TRIGGER_DISTANCE ? "Release to refresh" : "Pull to refresh"}</span>
  </div>;
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { VariantQueue } from "../../shared/variants.js";
import { variantRequest } from "../api/client.js";

export function useVariantQueue(workspace: string) {
  const [queue, setQueue] = useState<VariantQueue | null>(null);
  const [error, setError] = useState("");
  const latest = useRef(0);
  const paused = useRef(false);

  const reload = useCallback(async () => {
    const request = ++latest.current;
    const next = await variantRequest<VariantQueue>("queue", workspace);
    // A slower older read must not replace the result of a decision made after it started.
    if (request === latest.current) setQueue(next);
    return next;
  }, [workspace]);

  useEffect(() => {
    if (!workspace) return;
    void reload().catch((e: unknown) => setError(e instanceof Error ? e.message : "读取版本队列失败。"));
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/events");
    const changed = (event: MessageEvent<string>) => {
      let payload: { workspacePath?: string };
      try { payload = JSON.parse(event.data) as { workspacePath?: string }; } catch { return; }
      if (payload.workspacePath !== workspace || paused.current) return;
      void reload().catch(() => undefined);
    };
    source.addEventListener("variants-changed", changed);
    source.addEventListener("bank-changed", changed);
    return () => source.close();
  }, [workspace, reload]);

  const pause = useCallback((value: boolean) => { paused.current = value; }, []);
  return { queue, error, reload, pause };
}

import { useEffect, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { localDateKey } from "./planner";

/** This is the screen clock. Android owns all background reminder scheduling. */
export function useLocalDay() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    function update() {
      if (disposed) return;
      const current = new Date();
      setNow(current);
      clearTimeout(timer);
      const midnight = new Date(current);
      midnight.setHours(24, 0, 0, 0);
      timer = setTimeout(update, Math.min(60_000, Math.max(100, midnight.getTime() - current.getTime() + 50)));
    }
    const visible = () => { if (document.visibilityState === "visible") update(); };
    update();
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", visible);
    const listener = Capacitor.isNativePlatform()
      ? App.addListener("appStateChange", ({ isActive }) => { if (isActive) update(); })
      : null;
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", visible);
      if (listener) void listener.then((handle) => handle.remove());
    };
  }, []);
  return { today: now ? localDateKey(now) : null, now };
}

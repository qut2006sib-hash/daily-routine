import { useCallback, useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { usePlannerStore } from './planner-store.ts';
import type { ReminderStatus } from './planner-types.ts';
import { createReminderCoordinator } from './reminders-engine.ts';
import { getReminderStatus, isAndroidReminderDevice, nativeReminders } from './reminders.ts';
const coordinator = createReminderCoordinator({ bridge: nativeReminders, snapshot: () => usePlannerStore.getState(), complete: (snapshot, generation) => usePlannerStore.getState().importNativeCompletion(snapshot, generation) });
export function useReminders(): { status: ReminderStatus | null; error: string | null; refresh: () => Promise<void> } {
  const [status, setStatus] = useState<ReminderStatus | null>(null), [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { const next = await getReminderStatus(); setStatus(next); if (next.supported) await coordinator.request(true); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update phone reminders.'); }
  }, []);
  useEffect(() => {
    let alive = true;
    const request = () => { if (isAndroidReminderDevice()) void coordinator.request().then(() => { if (alive) setError(null); }, e => { if (alive) setError(e instanceof Error ? e.message : 'Could not update phone reminders.'); }); };
    void refresh();
    const unsubscribe = usePlannerStore.subscribe(request);
    const foreground = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', foreground); document.addEventListener('visibilitychange', foreground);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') request(); }, 5000);
    const nativeListener = isAndroidReminderDevice() ? App.addListener('appStateChange', ({ isActive }) => { if (isActive) void refresh(); }) : null;
    return () => { alive = false; unsubscribe(); clearInterval(timer); window.removeEventListener('focus', foreground); document.removeEventListener('visibilitychange', foreground); if (nativeListener) void nativeListener.then(handle => handle.remove()); };
  }, [refresh]);
  return { status, error, refresh };
}

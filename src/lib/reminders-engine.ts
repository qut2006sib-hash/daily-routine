import type { Completion, PlannerData } from './planner-types.ts';

export type NativeReminderAction = Completion & { id: string; generation: string; type: 'done'; completedAt: string };
export type NativeReminderMirror = { generation: string; tasks: PlannerData['tasks']; completions: Record<string, boolean>; settings: { remindersEnabled: boolean } };
export interface ReminderBridge {
  configure(options: { data: NativeReminderMirror }): Promise<void>;
  pendingActions(): Promise<{ actions: unknown[] }>;
  acknowledge(options: { ids: string[] }): Promise<void>;
}
export type ReminderSnapshot = { data: PlannerData; hydrated: boolean; storageError: string | null };
export function nativeReminderMirror(data: PlannerData): NativeReminderMirror {
  return { generation: data.generation, tasks: data.tasks, completions: Object.fromEntries(Object.keys(data.completions).map(key => [key, true])), settings: { remindersEnabled: data.settings.remindersEnabled } };
}
export function readNativeAction(value: unknown): NativeReminderAction | null {
  if (!value || typeof value !== 'object') return null;
  const a = value as Record<string, unknown>;
  for (const key of ['id', 'generation', 'taskId', 'title']) if (typeof a[key] !== 'string' || !a[key] || (a[key] as string).length > 300) return null;
  if (a.type !== 'done' || typeof a.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(a.date) ||
    typeof a.scheduledTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(a.scheduledTime) ||
    typeof a.completedAt !== 'string' || !Number.isFinite(Date.parse(a.completedAt))) return null;
  // Java Instant may contain nanoseconds; persisted JS records use canonical milliseconds.
  return { ...a, completedAt: new Date(a.completedAt).toISOString() } as NativeReminderAction;
}
/** Mutations are serialized; every awaited handoff re-checks the durable dataset identity. */
export function createReminderCoordinator(options: { bridge: ReminderBridge; snapshot: () => ReminderSnapshot; complete: (snapshot: Completion, generation: string) => void }) {
  let queue = Promise.resolve();
  let lastMirror = '';
  let lastGeneration = '';
  async function synchronize(force: boolean) {
    for (let attempt = 0; attempt < 8; attempt++) {
      let state = options.snapshot();
      if (!state.hydrated || state.storageError) return;
      const generation = state.data.generation;
      if (generation !== lastGeneration) {
        const initial = nativeReminderMirror(state.data);
        await options.bridge.configure({ data: initial });
        lastMirror = JSON.stringify(initial); lastGeneration = generation;
        if (options.snapshot().data.generation !== generation) continue;
      }
      const response = await options.bridge.pendingActions();
      state = options.snapshot();
      if (!state.hydrated || state.storageError) return;
      if (state.data.generation !== generation) continue;
      const ack: string[] = [];
      for (const raw of response.actions) {
        const action = readNativeAction(raw);
        if (!action) throw new Error('A phone reminder action could not be read. Your saved data was kept.');
        if (options.snapshot().data.generation !== generation) break;
        if (action.generation !== generation) { ack.push(action.id); continue; }
        const { taskId, date, title, scheduledTime, completedAt } = action;
        options.complete({ taskId, date, title, scheduledTime, completedAt }, generation);
        state = options.snapshot();
        if (state.storageError) throw new Error('Could not save the completed task. Its phone action will be retried.');
        if (state.data.generation !== generation) break;
        if (!state.data.completions[`${taskId}@${date}`]) throw new Error('The phone completion has not been saved. It will be retried.');
        ack.push(action.id);
      }
      state = options.snapshot();
      if (!state.hydrated || state.storageError) return;
      if (state.data.generation !== generation) continue;
      const mirror = nativeReminderMirror(state.data), signature = JSON.stringify(mirror);
      if (force || ack.length || signature !== lastMirror) {
        await options.bridge.configure({ data: mirror });
        lastMirror = signature;
      }
      if (options.snapshot().data.generation !== generation) continue;
      if (ack.length) await options.bridge.acknowledge({ ids: ack });
      return;
    }
    throw new Error('Your planner changed during reminder setup. Open Settings and refresh reminders.');
  }
  return { request(force = false): Promise<void> { const result = queue.then(() => synchronize(force)); queue = result.catch(() => undefined); return result; } };
}

import { Capacitor, registerPlugin } from '@capacitor/core';
import type { ReminderStatus } from './planner-types.ts';
import type { ReminderBridge } from './reminders-engine.ts';
interface DaylineRemindersPlugin extends ReminderBridge { getStatus(): Promise<ReminderStatus>; enable(): Promise<ReminderStatus>; openExactSettings(): Promise<void>; sendTest(): Promise<void> }
export const nativeReminders = registerPlugin<DaylineRemindersPlugin>('DaylineReminders');
export const isAndroidReminderDevice = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
const WEB: ReminderStatus = { supported: false, permission: 'unavailable', exact: false, message: 'Phone reminders work in the installed Android app. This browser can organize your day and export a backup.' };
export async function getReminderStatus(): Promise<ReminderStatus> { return isAndroidReminderDevice() ? nativeReminders.getStatus() : WEB; }
export async function enableReminders(): Promise<ReminderStatus> { return isAndroidReminderDevice() ? nativeReminders.enable() : WEB; }
export async function openExactAlarmSettings(): Promise<void> { if (!isAndroidReminderDevice()) throw new Error('Alarms & reminders settings are available in the Android app.'); await nativeReminders.openExactSettings(); }
export async function sendTestReminder(): Promise<void> { if (!isAndroidReminderDevice()) throw new Error('Install the Android app to test a phone reminder.'); await nativeReminders.sendTest(); }

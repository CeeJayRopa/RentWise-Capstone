import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firestore";

// Mirrors functions/src/reminderScheduler.ts's DEFAULT_REMINDER_HOUR/MINUTE --
// what the scheduler falls back to if this doc has never been written.
export const DEFAULT_REMINDER_HOUR = 14;
export const DEFAULT_REMINDER_MINUTE = 30;

export type ReminderSchedule = {
  hour: number; // 0-23, Asia/Manila
  minute: 0 | 30;
};

export function normalizeReminderSchedule(hourValue: unknown, minuteValue: unknown): ReminderSchedule {
  let hour = Number.isInteger(Number(hourValue)) ? Number(hourValue) : DEFAULT_REMINDER_HOUR;
  const minute = Number.isFinite(Number(minuteValue)) ? Number(minuteValue) : DEFAULT_REMINDER_MINUTE;
  hour = ((hour % 24) + 24) % 24;
  if (minute >= 45) {
    hour = (hour + 1) % 24;
    return {hour, minute: 0};
  }
  return {hour, minute: minute >= 15 ? 30 : 0};
}

export async function getReminderSchedule(): Promise<ReminderSchedule> {
  const snap = await getDoc(doc(db, "settings", "reminderSchedule"));
  const data = snap.data();
  return normalizeReminderSchedule(data?.hour, data?.minute);
}

export async function setReminderSchedule(schedule: ReminderSchedule): Promise<void> {
  if (!Number.isInteger(schedule.hour) || schedule.hour < 0 || schedule.hour > 23 || ![0, 30].includes(schedule.minute)) {
    throw new Error("Reminder time must use a 30-minute interval.");
  }
  await setDoc(doc(db, "settings", "reminderSchedule"), {
    hour: schedule.hour,
    minute: schedule.minute,
    updatedAt: serverTimestamp(),
  });
}

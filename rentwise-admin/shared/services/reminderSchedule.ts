import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firestore";

// Mirrors functions/src/reminderScheduler.ts's DEFAULT_REMINDER_HOUR/MINUTE --
// what the scheduler falls back to if this doc has never been written.
export const DEFAULT_REMINDER_HOUR = 14;
export const DEFAULT_REMINDER_MINUTE = 30;

export type ReminderSchedule = {
  hour: number; // 0-23, Asia/Manila
  minute: number; // 0-59
};

export async function getReminderSchedule(): Promise<ReminderSchedule> {
  const snap = await getDoc(doc(db, "settings", "reminderSchedule"));
  const data = snap.data();
  return {
    hour: data?.hour ?? DEFAULT_REMINDER_HOUR,
    minute: data?.minute ?? DEFAULT_REMINDER_MINUTE,
  };
}

export async function setReminderSchedule(schedule: ReminderSchedule): Promise<void> {
  await setDoc(doc(db, "settings", "reminderSchedule"), {
    hour: schedule.hour,
    minute: schedule.minute,
    updatedAt: serverTimestamp(),
  });
}

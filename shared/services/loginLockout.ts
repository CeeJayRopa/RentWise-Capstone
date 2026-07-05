import AsyncStorage from "@react-native-async-storage/async-storage";

// Escalating lockout after repeated failed login attempts, keyed per
// email/username so locking one account doesn't block others on the same
// device. Persisted to AsyncStorage (not just component state) so closing
// and reopening the app doesn't reset the timer.
//
// Schedule: 5 failed attempts triggers a lockout. Each time a *new* lockout
// is triggered (after the previous one has already expired and the user
// fails 5 more times), the duration escalates: 1 min -> 5 min -> 30 min,
// then stays at 30 min for every subsequent lockout.
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATIONS_MS = [60_000, 5 * 60_000, 30 * 60_000];

type LockoutState = {
  failCount: number;
  lockoutLevel: number;
  lockoutUntil: number | null;
};

function storageKey(identifier: string): string {
  return `loginLockout:${identifier.trim().toLowerCase()}`;
}

function durationForLevel(level: number): number {
  const idx = Math.min(level, LOCKOUT_DURATIONS_MS.length) - 1;
  return LOCKOUT_DURATIONS_MS[idx];
}

async function readState(identifier: string): Promise<LockoutState> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(identifier));
    if (!raw) return { failCount: 0, lockoutLevel: 0, lockoutUntil: null };
    return JSON.parse(raw) as LockoutState;
  } catch {
    return { failCount: 0, lockoutLevel: 0, lockoutUntil: null };
  }
}

async function writeState(identifier: string, state: LockoutState): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(identifier), JSON.stringify(state));
  } catch {
    // Non-fatal — worst case the lockout doesn't persist across restarts.
  }
}

// Returns the timestamp (ms) the current lockout ends, or null if not
// locked out. Never mutates state — safe to call on screen focus/mount.
export async function checkLockout(identifier: string): Promise<number | null> {
  if (!identifier) return null;
  const state = await readState(identifier);
  if (state.lockoutUntil && state.lockoutUntil > Date.now()) {
    return state.lockoutUntil;
  }
  return null;
}

// Call after a failed login. Returns the lockout end timestamp if this
// attempt just triggered a new lockout, or null if the user still has
// attempts remaining. Also returns how many attempts are left before the
// next lockout, for optional inline messaging.
export async function recordFailedAttempt(
  identifier: string,
): Promise<{ lockoutUntil: number | null; remainingAttempts: number; lockoutLevel: number }> {
  if (!identifier) return { lockoutUntil: null, remainingAttempts: MAX_ATTEMPTS, lockoutLevel: 0 };

  const state = await readState(identifier);

  // Already locked out — don't count this as a new attempt.
  if (state.lockoutUntil && state.lockoutUntil > Date.now()) {
    return { lockoutUntil: state.lockoutUntil, remainingAttempts: 0, lockoutLevel: state.lockoutLevel };
  }

  const failCount = state.failCount + 1;

  if (failCount >= MAX_ATTEMPTS) {
    const lockoutLevel = state.lockoutLevel + 1;
    const lockoutUntil = Date.now() + durationForLevel(lockoutLevel);
    await writeState(identifier, { failCount: 0, lockoutLevel, lockoutUntil });
    return { lockoutUntil, remainingAttempts: 0, lockoutLevel };
  }

  await writeState(identifier, { ...state, failCount });
  return { lockoutUntil: null, remainingAttempts: MAX_ATTEMPTS - failCount, lockoutLevel: state.lockoutLevel };
}

// Call after a successful login — clears the fail count and lockout level
// entirely so the next lockout (if any) starts back at 1 minute.
export async function resetLockout(identifier: string): Promise<void> {
  if (!identifier) return;
  try {
    await AsyncStorage.removeItem(storageKey(identifier));
  } catch {
    // Non-fatal.
  }
}

// Formats milliseconds remaining as "M:SS" for a countdown display.
export function formatLockoutRemaining(untilMs: number): string {
  const remainingSec = Math.max(0, Math.ceil((untilMs - Date.now()) / 1000));
  const minutes = Math.floor(remainingSec / 60);
  const seconds = remainingSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

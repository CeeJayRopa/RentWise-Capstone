import AsyncStorage from "@react-native-async-storage/async-storage";

// Opt-in per-device flag: when set, the entrance screen skips quick-unlock's
// password re-entry entirely and goes straight to the dashboard, as long as
// the underlying Firebase session is still valid. Off by default — this is
// a deliberate choice the user makes at login, not a forced behavior.
const REMEMBER_ME_KEY = "rentwise:rememberMe";

export async function getRememberMe(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(REMEMBER_ME_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function setRememberMe(value: boolean): Promise<void> {
  try {
    if (value) {
      await AsyncStorage.setItem(REMEMBER_ME_KEY, "true");
    } else {
      await AsyncStorage.removeItem(REMEMBER_ME_KEY);
    }
  } catch {
    // Non-fatal — worst case it just doesn't persist across restarts.
  }
}

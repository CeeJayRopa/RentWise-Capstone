import NetInfo, {NetInfoState} from "@react-native-community/netinfo";
import {Alert} from "react-native";

export type NetworkStatus = "online" | "offline" | "unknown";

let currentStatus: NetworkStatus = "unknown";
let initialized = false;
const listeners = new Set<(status: NetworkStatus) => void>();

function statusFromState(state: NetInfoState): NetworkStatus {
  if (state.isConnected === false || state.isInternetReachable === false) return "offline";
  if (state.isConnected === true) return "online";
  return "unknown";
}

function initialize(): void {
  if (initialized) return;
  initialized = true;
  NetInfo.addEventListener((state) => {
    currentStatus = statusFromState(state);
    listeners.forEach((listener) => listener(currentStatus));
  });
}

export function subscribeNetworkStatus(listener: (status: NetworkStatus) => void): () => void {
  initialize();
  listeners.add(listener);
  listener(currentStatus);
  return () => listeners.delete(listener);
}

export async function isOnlineNow(): Promise<boolean> {
  initialize();
  const state = await NetInfo.fetch();
  currentStatus = statusFromState(state);
  listeners.forEach((listener) => listener(currentStatus));
  return currentStatus !== "offline";
}

export async function requireOnlineAction(action = "This action"): Promise<boolean> {
  if (await isOnlineNow()) return true;
  Alert.alert(
    "Internet connection required",
    `${action} needs an internet connection. Your saved data is still available while offline.`,
  );
  return false;
}

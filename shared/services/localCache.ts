import {Platform} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import * as SQLite from "expo-sqlite";

const DATABASE_NAME = "rentwise-cache.db";
const WEB_CACHE_PREFIX = "rentwise_sqlite_fallback:";

let databasePromise: ReturnType<typeof SQLite.openDatabaseAsync> | null = null;
let networkListenerInitialized = false;
let wasOnline: boolean | null = null;
const onlineSyncTasks = new Set<() => void | Promise<void>>();

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && typeof item.toDate === "function") {
      return {__rentwiseTimestamp: item.toDate().getTime()};
    }
    if (item instanceof Date) return {__rentwiseDate: item.getTime()};
    return item;
  });
}

function deserialize<T>(value: string): T {
  return JSON.parse(value, (_key, item) => {
    if (item && typeof item === "object" && typeof item.__rentwiseTimestamp === "number") {
      const milliseconds = item.__rentwiseTimestamp;
      return {toDate: () => new Date(milliseconds), seconds: Math.floor(milliseconds / 1000)};
    }
    if (item && typeof item === "object" && typeof item.__rentwiseDate === "number") {
      return new Date(item.__rentwiseDate);
    }
    if (
      item
      && typeof item === "object"
      && typeof item.seconds === "number"
      && typeof item.nanoseconds === "number"
    ) {
      const milliseconds = item.seconds * 1000 + Math.floor(item.nanoseconds / 1_000_000);
      return {...item, toDate: () => new Date(milliseconds), toMillis: () => milliseconds};
    }
    return item;
  }) as T;
}

async function getDatabase() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME).then(async (database) => {
      await database.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS cache_entries (
          cache_key TEXT PRIMARY KEY NOT NULL,
          payload TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
      return database;
    });
  }
  return databasePromise;
}

export async function initializeLocalCache(): Promise<void> {
  if (Platform.OS !== "web") await getDatabase();
  if (!networkListenerInitialized) {
    networkListenerInitialized = true;
    NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      const reconnected = wasOnline === false && online;
      wasOnline = online;
      if (reconnected) {
        onlineSyncTasks.forEach((task) => void Promise.resolve(task()).catch(() => {}));
      }
    });
  }
}

export function registerOnlineSync(task: () => void | Promise<void>): () => void {
  onlineSyncTasks.add(task);
  return () => onlineSyncTasks.delete(task);
}

export async function saveLocalCache<T>(cacheKey: string, value: T): Promise<void> {
  const payload = serialize(value);
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(`${WEB_CACHE_PREFIX}${cacheKey}`, payload);
    return;
  }
  const database = await getDatabase();
  await database.runAsync(
    `INSERT INTO cache_entries (cache_key, payload, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    cacheKey,
    payload,
    Date.now(),
  );
}

export async function readLocalCache<T>(cacheKey: string): Promise<T | null> {
  if (Platform.OS === "web") {
    const payload = await AsyncStorage.getItem(`${WEB_CACHE_PREFIX}${cacheKey}`);
    return payload ? deserialize<T>(payload) : null;
  }
  const database = await getDatabase();
  const row = await database.getFirstAsync<{payload: string}>(
    "SELECT payload FROM cache_entries WHERE cache_key = ?",
    cacheKey,
  );
  return row?.payload ? deserialize<T>(row.payload) : null;
}

export async function removeLocalCache(cacheKey: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(`${WEB_CACHE_PREFIX}${cacheKey}`);
    return;
  }
  const database = await getDatabase();
  await database.runAsync("DELETE FROM cache_entries WHERE cache_key = ?", cacheKey);
}

export async function clearLocalCache(): Promise<void> {
  if (Platform.OS === "web") return;
  const database = await getDatabase();
  await database.runAsync("DELETE FROM cache_entries");
}

import { httpsCallable } from "firebase/functions";
import { doc, onSnapshot, type Unsubscribe } from "firebase/firestore";

import { db, functions } from "../shared/firebaseConfig";


type PublicStall = {
  id: string; name?: string; spaceId?: string; status?: string;
  buildingNumber?: string; category?: string; marketType?: string;
  width?: number; length?: number; price?: number; spaceDimension?: string;
};

const fetchPublicStalls = httpsCallable<void, PublicStall[]>(functions, "getPublicStalls");
const publicStallsCacheRef = doc(db, "publicApiCache", "stalls");

type StallSubscriber = {
  onData: (stalls: PublicStall[]) => void;
  onError?: (error: Error) => void;
};

const subscribers = new Set<StallSubscriber>();
let cachedStalls: PublicStall[] | null = null;
let realtimeUnsubscribe: Unsubscribe | null = null;
let visibilityListenerAttached = false;
let seedingCache = false;

export async function getStalls(){
  const response = await fetchPublicStalls();
  return response.data;

}

function publish(stalls: PublicStall[]) {
  cachedStalls = stalls;
  subscribers.forEach(({onData}) => onData(stalls));
}

function publishError(error: unknown) {
  const normalized = error instanceof Error ? error : new Error("Unable to load stalls.");
  subscribers.forEach(({onError}) => onError?.(normalized));
}

async function seedPublicCache() {
  if (seedingCache) return;
  seedingCache = true;
  try {
    publish(await getStalls());
  } catch (error) {
    publishError(error);
  } finally {
    seedingCache = false;
  }
}

function startRealtimeListener() {
  if (realtimeUnsubscribe || subscribers.size === 0) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;

  realtimeUnsubscribe = onSnapshot(
    publicStallsCacheRef,
    (snapshot) => {
      const stalls = snapshot.data()?.stalls;
      if (Array.isArray(stalls)) {
        publish(stalls as PublicStall[]);
      } else {
        void seedPublicCache();
      }
    },
    (error) => {
      realtimeUnsubscribe = null;
      publishError(error);
      if (!cachedStalls) void seedPublicCache();
    },
  );
}

function stopRealtimeListener() {
  realtimeUnsubscribe?.();
  realtimeUnsubscribe = null;
}

function handleVisibilityChange() {
  if (document.visibilityState === "visible") {
    startRealtimeListener();
  } else {
    stopRealtimeListener();
  }
}

export function subscribeToStalls(
  onData: (stalls: PublicStall[]) => void,
  onError?: (error: Error) => void,
) {
  const subscriber = {onData, onError};
  subscribers.add(subscriber);
  if (cachedStalls) onData(cachedStalls);

  if (typeof document !== "undefined" && !visibilityListenerAttached) {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    visibilityListenerAttached = true;
  }
  startRealtimeListener();

  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      stopRealtimeListener();
    }
    if (subscribers.size === 0 && typeof document !== "undefined" && visibilityListenerAttached) {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      visibilityListenerAttached = false;
    }
  };
}

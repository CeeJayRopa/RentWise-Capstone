import { httpsCallable } from "firebase/functions";

import { functions } from "../shared/firebaseConfig";


type PublicStall = {
  id: string; name?: string; spaceId?: string; status?: string;
  buildingNumber?: string; category?: string; marketType?: string;
  width?: number; length?: number; price?: number; spaceDimension?: string;
};

const fetchPublicStalls = httpsCallable<void, PublicStall[]>(functions, "getPublicStalls");

export async function getStalls(){
  const response = await fetchPublicStalls();
  return response.data;

}

export function subscribeToStalls(
  onData: (stalls: PublicStall[]) => void,
  onError?: (error: Error) => void,
) {
  let active = true;
  let refreshing = false;

  const refresh = async () => {
    if (!active || refreshing) return;
    refreshing = true;
    try {
      const stalls = await getStalls();
      if (active) onData(stalls);
    } catch (error) {
      if (active && onError) onError(error instanceof Error ? error : new Error("Unable to load stalls."));
    } finally {
      refreshing = false;
    }
  };

  void refresh();
  const timer = setInterval(() => {
    if (typeof document === "undefined" || document.visibilityState === "visible") {
      void refresh();
    }
  }, 5 * 60 * 1000);

  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") void refresh();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  return () => {
    active = false;
    clearInterval(timer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    }
  };
}

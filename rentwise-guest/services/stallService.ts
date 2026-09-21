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
  const refresh = async () => {
    try {
      const stalls = await getStalls();
      if (active) onData(stalls);
    } catch (error) {
      if (active && onError) onError(error instanceof Error ? error : new Error("Unable to load stalls."));
    }
  };
  void refresh();
  const timer = setInterval(refresh, 15000);
  return () => { active = false; clearInterval(timer); };
}

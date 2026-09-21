import { collection, getDocs, onSnapshot } from "firebase/firestore";

import { db } from "../shared/firebaseConfig";


function toPublicStall(doc: any) {
  const data = doc.data() as Record<string, any>;

  const numericPrice = Number(data.price);
  const buildingMatch = String(data.buildingNumber ?? data.name ?? "").match(
    /(?:^|\b)B(?:uilding)?\s*[- ]?\s*(\d+)/i,
  );
  const buildingNo = buildingMatch ? Number(buildingMatch[1]) : null;

  return {
    id: doc.id,
    name: data.name,
    spaceId: data.spaceId,
    status: data.status,
    buildingNumber: data.buildingNumber,
    category: data.category,
    marketType:
      data.marketType ??
      data.market ??
      (buildingNo === 1 ? "Wet Market" : buildingNo === 2 ? "Dry Market" : undefined),
    width: data.width,
    length: data.length,
    price: Number.isFinite(numericPrice) ? numericPrice : undefined,
    spaceDimension:
      data.spaceDimension ??
      (data.width != null && data.length != null ? `${data.width} x ${data.length}` : undefined),
  };
}

export async function getStalls(){

    const snapshot = await getDocs(
        collection(db,"stalls")
    );

  const stalls = snapshot.docs.map(toPublicStall);


  return stalls;

}

export function subscribeToStalls(
  onData: (stalls: ReturnType<typeof toPublicStall>[]) => void,
  onError?: (error: Error) => void,
) {
  return onSnapshot(
    collection(db, "stalls"),
    (snapshot) => onData(snapshot.docs.map(toPublicStall)),
    onError,
  );
}

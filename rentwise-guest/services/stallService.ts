import { collection, getDocs  } from "firebase/firestore";

import { db } from "../shared/firebaseConfig";


export async function getStalls(){

    const snapshot = await getDocs(
        collection(db,"stalls")
    );

  const stalls = snapshot.docs.map((doc)=>{
    const data = doc.data() as Record<string, any>;

    // Only pass through the fields the public guest site actually displays
    // (see StallPopup.tsx / stall-details.tsx / MarketMapEmbed.tsx) --
    // stall docs also carry internal fields (tenantId, paymentSchedule,
    // stallId, etc.) that have no reason to go out in a response any
    // anonymous browser can inspect via devtools.
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
  });


  return stalls;

}

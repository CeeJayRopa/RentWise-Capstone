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
    return {
      id: doc.id,
      name: data.name,
      status: data.status,
      buildingNumber: data.buildingNumber,
      category: data.category,
      width: data.width,
      length: data.length,
      price: data.price,
      spaceDimension:
        data.spaceDimension ??
        (data.width != null && data.length != null ? `${data.width} x ${data.length}` : undefined),
    };
  });


  return stalls;

}
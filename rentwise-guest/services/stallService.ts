import { collection, getDocs  } from "firebase/firestore";

import { db } from "../shared/firebaseConfig";


export async function getStalls(){

    const snapshot = await getDocs(
        collection(db,"stalls")
    );

  const stalls = snapshot.docs.map((doc)=>{
    const data = doc.data() as Record<string, any>;

    return {
      id: doc.id,
      ...data,
      spaceDimension:
        data.spaceDimension ??
        (data.width != null && data.length != null ? `${data.width} x ${data.length}` : undefined),
    };
  });


  return stalls;

}
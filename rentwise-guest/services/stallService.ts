import { collection, getDocs  } from "firebase/firestore";

import { db } from "../shared/firebaseConfig";


export async function getStalls(){

    const snapshot = await getDocs(
        collection(db,"stalls")
    );

  const stalls = snapshot.docs.map((doc)=>({

    id: doc.id,

    ...doc.data()

  }));


  return stalls;

}
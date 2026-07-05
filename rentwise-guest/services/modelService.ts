import { collection, getDocs } from "firebase/firestore";
import { ref, getDownloadURL } from "firebase/storage";

import { db } from "../shared/firebaseConfig";
import { storage } from "../shared/services/storage";
import type { ARObject } from "../shared/types/arObject";

export async function getARObjects(): Promise<ARObject[]> {
  const snapshot = await getDocs(collection(db, "arObjects"));

  const objects = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  return objects as ARObject[];
}

export async function getModelDownloadUrl(storagePath: string): Promise<string> {
  return getDownloadURL(ref(storage, storagePath));
}

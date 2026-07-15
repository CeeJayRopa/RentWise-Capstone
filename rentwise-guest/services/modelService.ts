import { addDoc, collection, getDocs, serverTimestamp } from "firebase/firestore";
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

// Every AR placement is a real buying-intent signal that today just gets thrown away when
// the session ends. Logging it (anonymously — this is a public guest app, no auth) gives
// admin/owner real data on what's actually generating interest. Deliberately non-fatal: a
// failed write here must never disrupt the actual AR placement the tenant is doing.
export async function logArPlacement(objectId: string, objectName: string, category: string): Promise<void> {
  try {
    await addDoc(collection(db, "arPlacementEvents"), {
      objectId,
      objectName,
      category,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error("[AR] failed to log placement event:", err);
  }
}

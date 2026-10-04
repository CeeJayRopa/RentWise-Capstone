import { collection, getDocs } from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";

import { db, storage } from "../shared/firebaseConfig";
import { readLocalCache, saveLocalCache } from "../shared/services/localCache";

export interface ARCatalogObject {
  id: string;
  name: string;
  category: string;
  modelStoragePath: string;
  thumbnailStoragePath: string;
}

export interface ResolvedARCatalogObject extends ARCatalogObject {
  modelUrl: string;
  thumbnailUrl: string;
}

const CATALOG_CACHE_KEY = "tenant:ar-catalog:v1";

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function resolveStorageUrl(path: string) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await getDownloadURL(ref(storage, path));
    } catch (error) {
      lastError = error;
      if (attempt < 3) await wait(500 * 2 ** attempt);
    }
  }

  throw lastError;
}

export async function getTenantARCatalog(): Promise<ResolvedARCatalogObject[]> {
  const cached = await readLocalCache<ResolvedARCatalogObject[]>(CATALOG_CACHE_KEY) ?? [];
  let objects: ARCatalogObject[];
  try {
    const snapshot = await getDocs(collection(db, "arObjects"));
    objects = snapshot.docs.map((item) => ({id: item.id, ...item.data()})) as ARCatalogObject[];
  } catch (error) {
    if (cached.length > 0) return cached;
    throw error;
  }
  const cachedById = new Map(cached.map((item) => [item.id, item]));
  const resolved: ResolvedARCatalogObject[] = [];

  for (const item of objects) {
    try {
      resolved.push({
        ...item,
        modelUrl: await resolveStorageUrl(item.modelStoragePath),
        thumbnailUrl: await resolveStorageUrl(item.thumbnailStoragePath),
      });
    } catch {
      const fallback = cachedById.get(item.id);
      if (
        fallback
        && fallback.modelStoragePath === item.modelStoragePath
        && fallback.thumbnailStoragePath === item.thumbnailStoragePath
      ) {
        resolved.push(fallback);
      }
    }
  }

  if (resolved.length === 0) throw new Error("No AR catalog objects could be loaded");

  await saveLocalCache(CATALOG_CACHE_KEY, resolved);
  return resolved;
}

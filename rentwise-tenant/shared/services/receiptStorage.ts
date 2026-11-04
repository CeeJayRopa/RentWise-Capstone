import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

const DIRECTORY_URI_KEY = "receiptDownloadDirectoryUri";

export async function requestReceiptDirectoryAccess(): Promise<string | null> {
  if (Platform.OS !== "android") return null;
  const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return null;
  await AsyncStorage.setItem(DIRECTORY_URI_KEY, permission.directoryUri);
  return permission.directoryUri;
}

export async function getSavedReceiptDirectory(): Promise<string | null> {
  if (Platform.OS !== "android") return null;
  return AsyncStorage.getItem(DIRECTORY_URI_KEY);
}

export async function saveBase64PdfToReceiptDirectory(base64: string, fileName: string): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const directoryUri = await getSavedReceiptDirectory();
  if (!directoryUri) return false;

  try {
    const destination = await FileSystem.StorageAccessFramework.createFileAsync(directoryUri, fileName, "application/pdf");
    await FileSystem.writeAsStringAsync(destination, base64, { encoding: FileSystem.EncodingType.Base64 });
    return true;
  } catch {
    // Android can revoke a persisted SAF grant when a folder is removed or
    // storage is reset. Clear it so the next Download tap shows RentWise's
    // explanation again before Android opens the folder picker.
    await AsyncStorage.removeItem(DIRECTORY_URI_KEY);
    return false;
  }
}

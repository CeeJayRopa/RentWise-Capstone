import { Platform } from "react-native";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "./firestore";

export function configurePushNotifications() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications = require("expo-notifications");
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    console.log("[PUSH] expo-notifications unavailable — use a development build");
  }
}

export async function registerForPushNotificationsAsync(
  userId: string,
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Device = require("expo-device");
    if (!Device.isDevice) {
      console.log("[PUSH] Physical device required for push notifications");
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Notifications = require("expo-notifications");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require("expo-constants").default;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "RentWise",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#F5C518",
        sound: "default",
      });
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;

    if (existing !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      console.log("[PUSH] Permission not granted");
      return;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenData.data;

    await updateDoc(doc(db, "users", userId), { expoPushToken: token });
    console.log("[PUSH] Token registered:", token);
  } catch (err) {
    console.log("[PUSH] Not available — use a development build:", err);
  }
}

import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import { useEffect } from "react";
import { Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  Poppins_800ExtraBold,
} from "@expo-google-fonts/poppins";

export default function Layout() {
  const [fontsLoaded] = useFonts({
    ...Ionicons.font,
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
  });

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;

    const styleId = "rentwise-guest-poppins";
    const existing = document.getElementById(styleId);
    if (existing) return;

    const style = document.createElement("style");
    style.id = styleId;
    // Let text inherit Poppins from the app root. Do not force it onto every
    // descendant: icon components rely on their own glyph font on web.
    style.textContent = "#root { font-family: Poppins_400Regular, sans-serif; }";
    document.head.appendChild(style);

    return () => style.remove();
  }, []);

  // Renders a beat of blank screen rather than the browser's default
  // sans-serif for the numbering/headline serif — on a scroll-driven,
  // no-nav site a flash of the wrong typeface reads as more "broken"
  // than a brief blank frame.
  if (!fontsLoaded) return null;

  return <Stack screenOptions={{ headerShown: false }} />;
}

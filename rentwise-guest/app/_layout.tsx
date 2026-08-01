import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import {
  PlayfairDisplay_400Regular,
  PlayfairDisplay_400Regular_Italic,
  PlayfairDisplay_600SemiBold,
  PlayfairDisplay_700Bold,
  PlayfairDisplay_700Bold_Italic,
} from "@expo-google-fonts/playfair-display";
import { Inter_600SemiBold, Inter_800ExtraBold } from "@expo-google-fonts/inter";

export default function Layout() {
  const [fontsLoaded] = useFonts({
    PlayfairDisplay_400Regular,
    PlayfairDisplay_400Regular_Italic,
    PlayfairDisplay_600SemiBold,
    PlayfairDisplay_700Bold,
    PlayfairDisplay_700Bold_Italic,
    Inter_600SemiBold,
    Inter_800ExtraBold,
  });

  // Renders a beat of blank screen rather than the browser's default
  // sans-serif for the numbering/headline serif — on a scroll-driven,
  // no-nav site a flash of the wrong typeface reads as more "broken"
  // than a brief blank frame.
  if (!fontsLoaded) return null;

  return <Stack screenOptions={{ headerShown: false }} />;
}

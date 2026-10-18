import { Tabs } from "expo-router/js-tabs";

import CustomTabBar from "../components/BottomNavBar";
import { colors } from "../../shared/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.parchment },
      }}
      tabBar={(props) => <CustomTabBar {...props} />}
    />
  );
}

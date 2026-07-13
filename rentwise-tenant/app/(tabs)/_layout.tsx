import { Tabs } from "expo-router/js-tabs";

import CustomTabBar from "../components/BottomNavBar";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <CustomTabBar {...props} />}
    />
  );
}

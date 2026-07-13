import { Tabs } from "expo-router/js-tabs";

import CustomTabBar from "../components/BottomNav";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <CustomTabBar {...props} />}
    />
  );
}

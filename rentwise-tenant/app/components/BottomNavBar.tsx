import { useEffect, useRef } from "react";
import { View, Text, Pressable, StyleSheet, Animated, LayoutChangeEvent } from "react-native";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { House, Wallet, User } from "lucide-react-native";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";
import { bottomNavRefs } from "./bottomNavRefs";

type NavKey = keyof typeof bottomNavRefs;

const PILL_WIDTH = 58;
const PILL_HEIGHT = 30;

const TAB_CONFIG: { routeName: string; key: NavKey; label: string; Icon: typeof House }[] = [
  { routeName: "dashboard", key: "home", label: "Home", Icon: House },
  { routeName: "payments", key: "payments", label: "Payments", Icon: Wallet },
  { routeName: "profile", key: "profile", label: "Profile", Icon: User },
];

// This is the (tabs) layout's custom tabBar renderer — a single instance
// stays mounted across every tab switch (unlike the old per-page
// BottomNavBar), so the active-tab pill can genuinely slide from one tab's
// position to another instead of just appearing already-switched.
export default function BottomNavBar({ state, navigation, insets }: BottomTabBarProps) {
  const pillX = useRef(new Animated.Value(0)).current;
  const pillOpacity = useRef(new Animated.Value(0)).current;
  const centersRef = useRef<Record<string, number>>({});
  // Idempotency guard: which activeRouteName has already been reacted to.
  // positionPill() can be invoked from two places (the effect below, and
  // onItemLayout's bootstrap retry) — without this, both could fire for
  // the same transition and stomp on each other.
  const positionedForRouteRef = useRef<string | undefined>(undefined);
  // The route the pill was actually positioned at last time — the single
  // source of truth for "should this transition slide or pop".
  const prevRouteNameRef = useRef<string | undefined>(undefined);

  const activeRouteName = state.routes[state.index]?.name;
  const isKnownTab = TAB_CONFIG.some((t) => t.routeName === activeRouteName);

  const positionPill = () => {
    if (positionedForRouteRef.current === activeRouteName) return;

    if (!isKnownTab) {
      const hadPill = prevRouteNameRef.current !== undefined;
      positionedForRouteRef.current = activeRouteName;
      prevRouteNameRef.current = activeRouteName;
      Animated.timing(pillOpacity, { toValue: 0, duration: hadPill ? 150 : 0, useNativeDriver: true }).start();
      return;
    }

    const centerX = centersRef.current[activeRouteName];
    // Not measured yet (e.g. very first render, before any onLayout has
    // fired) — onItemLayout will call this again once it has a value.
    if (centerX == null) return;

    const target = centerX - PILL_WIDTH / 2;
    const prevWasKnownTab =
      prevRouteNameRef.current != null && TAB_CONFIG.some((t) => t.routeName === prevRouteNameRef.current);

    positionedForRouteRef.current = activeRouteName;
    prevRouteNameRef.current = activeRouteName;

    if (!prevWasKnownTab) {
      pillX.setValue(target);
      Animated.timing(pillOpacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
      return;
    }
    Animated.parallel([
      Animated.timing(pillX, { toValue: target, duration: 220, useNativeDriver: true }),
      Animated.timing(pillOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  };

  const onItemLayout = (routeName: string, e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    centersRef.current[routeName] = x + width / 2;
    if (routeName === activeRouteName) {
      positionPill();
    }
  };

  useEffect(() => {
    positionPill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRouteName]);

  return (
    <View style={styles.barBackdrop}>
      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom - 10, 6) }]}>
        <Animated.View
          pointerEvents="none"
          style={[styles.pill, { opacity: pillOpacity, transform: [{ translateX: pillX }] }]}
        />
        {TAB_CONFIG.map((tab) => {
          const routeIndex = state.routes.findIndex((r) => r.name === tab.routeName);
          const route = state.routes[routeIndex];
          const isFocused = routeIndex !== -1 && state.index === routeIndex;

          return (
            <NavItem
              key={tab.key}
              itemRef={bottomNavRefs[tab.key]}
              label={tab.label}
              Icon={tab.Icon}
              active={isFocused}
              onPress={() => {
                if (!route || isFocused) return;
                navigation.navigate(route.name);
              }}
              onLayout={(e) => onItemLayout(tab.routeName, e)}
            />
          );
        })}
      </View>
    </View>
  );
}

function NavItem({
  label,
  Icon,
  active,
  onPress,
  onLayout,
  itemRef,
}: {
  label: string;
  Icon: typeof House;
  active: boolean;
  onPress: () => void;
  onLayout: (e: LayoutChangeEvent) => void;
  itemRef?: React.RefObject<View | null>;
}) {
  return (
    <View ref={itemRef} collapsable={false} style={styles.item} onLayout={onLayout}>
      <Pressable style={styles.itemPressable} onPress={onPress} hitSlop={8}>
        <View style={styles.iconWrap}>
          <Icon size={19} color={active ? colors.ink : "#9CB0A8"} strokeWidth={active ? 2.25 : 1.8} />
        </View>
        <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  barBackdrop: {
    backgroundColor: colors.parchment,
  },

  bar: {
    flexDirection: "row",
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: "rgba(14, 107, 84, 0.12)",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 2,
    paddingHorizontal: spacing.xxl,
    shadowColor: "#0B2B22",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },

  pill: {
    position: "absolute",
    top: 2,
    left: 0,
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: "#BFEBDD",
  },

  item: {
    flex: 1,
  },

  itemPressable: {
    alignItems: "center",
    gap: 2,
  },

  iconWrap: {
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },

  label: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.medium,
    color: "#9CB0A8",
  },

  labelActive: {
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },
});

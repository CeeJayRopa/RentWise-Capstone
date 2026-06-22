import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  Dimensions,
  StyleSheet,
  Easing,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { auth, logoutUser } from "../../shared/services/auth";
import { getUserById } from "../../shared/services/userServices";
import { Colors } from "../../shared/constants/color";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const PANEL_WIDTH = Math.round(SCREEN_WIDTH * 0.72);

type Props = {
  visible: boolean;
  onClose: () => void;
};

export default function Sidebar({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(-PANEL_WIDTH)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const [rendered, setRendered] = useState(false);
  const [adminName, setAdminName] = useState("Admin");

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    getUserById(user.uid).then((userData) => {
      if (userData) {
        setAdminName(`${userData.firstName} ${userData.lastName}`);
      }
    });
  }, []);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 260,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (rendered) {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -PANEL_WIDTH,
          duration: 200,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setRendered(false);
      });
    }
    // `rendered` is intentionally read from closure; effect re-runs only on `visible` change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const navigate = (path: string) => {
    router.replace(path as any);
    onClose();
  };

  const handleLogout = async () => {
    await logoutUser();
    router.replace("/");
  };

  if (!rendered) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Backdrop */}
      <Animated.View
        style={[styles.backdrop, { opacity: backdropAnim }]}
        pointerEvents={visible ? "auto" : "none"}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          activeOpacity={1}
        />
      </Animated.View>

      {/* Panel */}
      <Animated.View
        style={[styles.panel, { transform: [{ translateX: slideAnim }] }]}
      >
        {/* Profile section */}
        <View style={[styles.profileSection, { paddingTop: insets.top + 28 }]}>
          <View style={styles.avatar}>
            <View style={styles.avatarHead} />
            <View style={styles.avatarBody} />
          </View>
          <Text style={styles.adminName}>{adminName}</Text>
          <Text style={styles.adminRole}>Administrator</Text>
          <TouchableOpacity
            style={styles.infoChangeBtn}
            onPress={() => navigate("/admin-profile")}
            activeOpacity={0.7}
          >
            <Text style={styles.infoChangeBtnText}>Edit Info</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        {/* Nav items */}
        <View style={styles.menu}>
          <MenuItem label="Home" onPress={() => navigate("/dashboard")} />
          <MenuItem
            label="Financials"
            onPress={() => navigate("/financials")}
          />
          <MenuItem
            label="Building Management"
            onPress={() => navigate("/building")}
          />
          <MenuItem
            label="Account Archives"
            onPress={() => navigate("/archives")}
          />
        </View>

        <View style={styles.divider} />

        {/* Logout */}
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={handleLogout}
          activeOpacity={0.7}
        >
          <Text style={styles.logoutText}>Log Out Account</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

function MenuItem({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={styles.menuItem}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={styles.menuItemText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  panel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: PANEL_WIDTH,
    backgroundColor: Colors.sidebar,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 16,
  },
  profileSection: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    alignItems: "center",
    justifyContent: "flex-end",
    overflow: "hidden",
    marginBottom: 12,
  },
  avatarHead: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#FFFFFF",
    position: "absolute",
    top: 10,
  },
  avatarBody: {
    width: 50,
    height: 36,
    borderRadius: 25,
    backgroundColor: "#FFFFFF",
    marginBottom: -8,
  },
  adminName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
    textAlign: "center",
    marginBottom: 2,
  },
  adminRole: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.7)",
  },
  infoChangeBtn: {
    marginTop: 12,
    paddingVertical: 6,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.5)",
  },
  infoChangeBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    marginHorizontal: 16,
    marginVertical: 4,
  },
  menu: {
    paddingVertical: 8,
  },
  menuItem: {
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  menuItemText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#FFFFFF",
  },
  logoutBtn: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginTop: 4,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#FF9E9E",
  },
});

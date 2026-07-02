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
import {
  ShieldCheck,
  Home,
  Wallet,
  Building2,
  Users,
  Archive,
  LogOut,
} from "lucide-react-native";

import { auth, logoutUser } from "../../shared/services/auth";
import { getUserById } from "../../shared/services/userServices";

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
    getUserById(user.uid).then((data) => {
      if (data) setAdminName(`${data.firstName ?? ""} ${data.lastName ?? ""}`.trim());
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
    <View style={[StyleSheet.absoluteFill, { zIndex: 999, elevation: 999 }]} pointerEvents="box-none">
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

      <Animated.View
        style={[styles.panel, { transform: [{ translateX: slideAnim }] }]}
      >
        {/* Profile section */}
        <View style={[styles.profileSection, { paddingTop: insets.top + 28 }]}>
          <View style={styles.avatar}>
            <ShieldCheck size={32} color="#E6F1FB" />
          </View>
          <Text style={styles.adminName}>{adminName}</Text>
          <Text style={styles.adminRole}>Administrator</Text>
          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => navigate("/admin-profile")}
            activeOpacity={0.7}
          >
            <Text style={styles.editBtnText}>Edit Info</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        {/* Menu items */}
        <View style={styles.menu}>
          <MenuItem Icon={Home}      label="Home"                onPress={() => navigate("/dashboard")} />
          <MenuItem Icon={Wallet}    label="Financials"          onPress={() => navigate("/financials")} />
          <MenuItem Icon={Building2} label="Building Management" onPress={() => navigate("/building")} />
          <MenuItem Icon={Users}     label="Tenant Management"   onPress={() => navigate("/tenant-management")} />
          <MenuItem Icon={Archive}   label="Account Archives"    onPress={() => navigate("/archives")} />
        </View>

        <View style={styles.divider} />

        {/* Logout */}
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.7}>
          <LogOut size={18} color="#F09595" style={{ marginRight: 10 }} />
          <Text style={styles.logoutText}>Logout Account</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

function MenuItem({ Icon, label, onPress }: { Icon: any; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.7}>
      <Icon size={18} color="#B5D4F4" style={{ marginRight: 12 }} />
      <Text style={styles.menuItemText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.45)",
  },

  panel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: PANEL_WIDTH,
    backgroundColor: "#0C2D6B",
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
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
    backgroundColor: "#1A4DA0",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },

  adminName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
    textAlign: "center",
    marginBottom: 2,
  },

  adminRole: {
    fontSize: 12,
    color: "#B5D4F4",
  },

  editBtn: {
    marginTop: 12,
    paddingVertical: 6,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },

  editBtnText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#E6F1FB",
  },

  divider: {
    height: 0.5,
    backgroundColor: "rgba(255,255,255,0.15)",
    marginHorizontal: 16,
    marginVertical: 6,
  },

  menu: {
    paddingVertical: 8,
  },

  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 24,
  },

  menuItemText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#E6F1FB",
  },

  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginTop: 4,
  },

  logoutText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#F09595",
  },
});

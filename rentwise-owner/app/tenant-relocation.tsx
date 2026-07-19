import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, HelpCircle, Check } from "lucide-react-native";

import { db } from "../shared/services/firestore";
import { restoreTenantToNewStall } from "../shared/services/accountServices";
import HelpTour, { HelpStep } from "./components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../shared/services/onboardingTour";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";

type StallOption = {
  id: string;
  buildingNumber: string;
  spaceId: string;
  name: string;
  price: number;
  paymentSchedule: string;
};

export default function TenantRelocation() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    uid: string;
    firstName: string;
    lastName: string;
    email: string;
    buildingNumber: string;
    spaceId: string;
    stallId: string;
  }>();

  const { uid, firstName, lastName, email, buildingNumber, spaceId } = params;
  const fullName = `${firstName} ${lastName}`.trim();

  const [stalls, setStalls] = useState<StallOption[]>([]);
  const [selectedStall, setSelectedStall] = useState<StallOption | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [tourVisible, setTourVisible] = useState(false);
  const stallListRef = useRef<View>(null);
  const restoreBtnRef = useRef<View>(null);

  const tourSteps: HelpStep[] = [
    { key: "stalls", ref: stallListRef, title: "Available stalls", description: "Pick which unoccupied stall to move this archived tenant into.", edgeInset: "top" },
    { key: "restore", ref: restoreBtnRef, title: "Restore account", description: "Restores the tenant's account and assigns them to the stall you selected above.", edgeInset: "top" },
  ];

  useEffect(() => {
    fetchUnoccupiedStalls();
  }, []);

  // Auto-opens the guided tour the first time the owner ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    if (loading) return;
    (async () => {
      const seen = await hasSeenPageTour("owner-tenant-relocation");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("owner-tenant-relocation");
      }
    })();
  }, [loading]);

  const fetchUnoccupiedStalls = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "stalls"), where("status", "==", "unoccupied")),
      );
      const list: StallOption[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          buildingNumber: String(data.buildingNumber ?? ""),
          spaceId: String(data.spaceId ?? ""),
          name: String(data.name ?? ""),
          price: Number(data.price ?? 0),
          paymentSchedule: String(data.paymentSchedule ?? ""),
        };
      });
      list.sort((a, b) => {
        const bn = a.buildingNumber.localeCompare(b.buildingNumber);
        if (bn !== 0) return bn;
        return a.spaceId.localeCompare(b.spaceId);
      });
      setStalls(list);
    } catch (err) {
      console.log("RELOCATION FETCH ERROR:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!selectedStall) {
      Alert.alert("No Stall Selected", "Please select an available stall first.");
      return;
    }
    setRestoring(true);
    try {
      await restoreTenantToNewStall(uid, selectedStall.id);
      Alert.alert(
        "Account Restored",
        `${fullName} has been assigned to Building ${selectedStall.buildingNumber} · Space ${selectedStall.spaceId}.`,
        [{ text: "OK", onPress: () => router.replace("/archives") }],
      );
    } catch (err: any) {
      const msg =
        err?.message === "Selected stall is no longer available."
          ? "That stall was just taken. Please choose another."
          : "Failed to restore tenant. Please try again.";
      Alert.alert("Error", msg);
      fetchUnoccupiedStalls();
      setSelectedStall(null);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <View style={styles.screen}>
      {/* HEADER */}
      <LinearGradient
        colors={[colors.emerald, colors.ink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            activeOpacity={0.7}
            disabled={restoring}
            style={styles.headerIconBtn}
          >
            <ArrowLeft size={22} color={colors.emeraldSoft} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Tenant Relocation</Text>
          <TouchableOpacity onPress={() => setTourVisible(true)} activeOpacity={0.7} disabled={restoring} style={styles.headerIconBtn}>
            <HelpCircle size={22} color={colors.emeraldSoft} />
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {/* SCROLLABLE BODY */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ARCHIVED TENANT CARD */}
        <View style={styles.infoCard}>
          <Text style={styles.cardLabel}>Archived tenant</Text>
          <Text style={styles.infoName}>{fullName}</Text>
          <Text style={styles.infoUsername}>{email}</Text>
          <View style={styles.noticeBox}>
            <Text style={styles.infoNotice}>
              Previous stall{" "}
              <Text style={styles.infoBold}>
                Building {buildingNumber} {"·"} Space {spaceId}
              </Text>
              {" "}is currently occupied. Select a new available stall below.
            </Text>
          </View>
        </View>

        {/* AVAILABLE STALLS */}
        <View ref={stallListRef} collapsable={false}>
        <Text style={styles.sectionLabel}>Available stalls</Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.emerald} size="large" />
          </View>
        ) : stalls.length === 0 ? (
          <Text style={styles.emptyText}>No available stalls at the moment.</Text>
        ) : (
          stalls.map((item) => {
            const selected = selectedStall?.id === item.id;
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.stallCard, selected && styles.stallCardSelected]}
                onPress={() => setSelectedStall(item)}
                activeOpacity={0.75}
                disabled={restoring}
              >
                <View style={styles.stallInfo}>
                  <Text style={styles.stallTitle}>
                    Building {item.buildingNumber} {"·"} Space {item.spaceId}
                  </Text>
                  <Text style={styles.stallSub}>
                    ₱{item.price.toLocaleString()} {"·"} {item.paymentSchedule}
                  </Text>
                </View>
                <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                  {selected && <Check size={14} color={colors.white} />}
                </View>
              </TouchableOpacity>
            );
          })
        )}
        </View>
      </ScrollView>

      {/* FOOTER — RESTORE BUTTON */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 28 }]}>
        <Pressable
          ref={restoreBtnRef}
          style={({ pressed }) => [
            styles.restoreBtn,
            (!selectedStall || restoring) && styles.restoreBtnDisabled,
            pressed && !!selectedStall && !restoring && styles.restoreBtnPressed,
          ]}
          onPress={handleRestore}
          disabled={!selectedStall || restoring}
        >
          {restoring ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <Text style={styles.restoreBtnText}>Restore account</Text>
          )}
        </Pressable>
      </View>
      <HelpTour visible={tourVisible} steps={tourSteps} onClose={() => setTourVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.parchment,
  },

  // ── Header ────────────────────────────────────────────────────────────────────

  headerGradient: {
    borderBottomLeftRadius: radius.xl + 4,
    borderBottomRightRadius: radius.xl + 4,
    overflow: "hidden",
  },

  header: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md + 2,
    flexDirection: "row",
    alignItems: "center",
  },

  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },

  headerTitle: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    flex: 1,
    textAlign: "center",
  },

  // ── Body ─────────────────────────────────────────────────────────────────────

  body: {
    flex: 1,
  },

  bodyContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },

  // ── Archived tenant card ──────────────────────────────────────────────────────

  infoCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg + 2,
    marginBottom: spacing.xxl,
    ...shadow.card,
  },

  cardLabel: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.emeraldBright,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
  },

  infoName: {
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  infoUsername: {
    fontSize: fontSize.base,
    color: colors.emeraldBright,
    fontFamily: fontFamily.medium,
    marginTop: 2,
  },

  noticeBox: {
    backgroundColor: colors.mist,
    borderRadius: radius.md,
    padding: spacing.md + 2,
    marginTop: spacing.md + 2,
  },

  infoNotice: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontFamily: fontFamily.regular,
    lineHeight: 20,
  },

  infoBold: {
    fontFamily: fontFamily.semibold,
    color: colors.ink,
  },

  // ── Section label ─────────────────────────────────────────────────────────────

  sectionLabel: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.emeraldBright,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: spacing.md,
  },

  // ── Stall option card ─────────────────────────────────────────────────────────

  stallCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.emeraldSoft,
    marginBottom: spacing.sm + 2,
    flexDirection: "row",
    alignItems: "center",
  },

  stallCardSelected: {
    borderWidth: 2,
    borderColor: colors.ink,
  },

  stallInfo: {
    flex: 1,
  },

  stallTitle: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
  },

  stallSub: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    fontFamily: fontFamily.regular,
    marginTop: 4,
  },

  // ── Radio button ──────────────────────────────────────────────────────────────

  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.emeraldSoft,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },

  radioOuterSelected: {
    borderColor: colors.ink,
    backgroundColor: colors.ink,
  },

  // ── Empty / loading ───────────────────────────────────────────────────────────

  center: {
    alignItems: "center",
    paddingTop: 40,
  },

  emptyText: {
    fontSize: fontSize.base,
    color: colors.textSecondary,
    fontFamily: fontFamily.regular,
    textAlign: "center",
    marginTop: spacing.xl,
  },

  // ── Footer restore button ─────────────────────────────────────────────────────

  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.parchment,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md + 2,
  },

  restoreBtn: {
    width: "100%",
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ scale: 1 }],
    ...shadow.button,
  },

  restoreBtnPressed: {
    backgroundColor: colors.emerald,
    transform: [{ scale: 0.97 }],
  },

  restoreBtnDisabled: {
    backgroundColor: colors.emeraldSoft,
  },

  restoreBtnText: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.semibold,
    color: colors.white,
    textAlign: "center",
  },
});

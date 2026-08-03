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
  Modal,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronLeft, HelpCircle, Building2, Check } from "lucide-react-native";

import { db } from "../shared/services/firestore";
import { restoreTenantToNewStall, relocateActiveTenant } from "../shared/services/accountServices";
import HelpTour, { HelpStep } from "./components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../shared/services/onboardingTour";
import { Card, Button, EmptyState } from "../shared/components/ui";
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
    mode?: string;
  }>();

  const { uid, firstName, lastName, email, buildingNumber, spaceId, stallId, mode } = params;
  const isMove = mode === "move";
  const fullName = `${firstName} ${lastName}`.trim();

  const [stalls, setStalls] = useState<StallOption[]>([]);
  const [selectedStall, setSelectedStall] = useState<StallOption | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [showTransferConfirm, setShowTransferConfirm] = useState(false);
  const [tourVisible, setTourVisible] = useState(false);
  const stallListRef = useRef<View>(null);
  const restoreBtnRef = useRef<View>(null);

  const tourSteps: HelpStep[] = [
    { key: "stalls", ref: stallListRef, title: "Available stalls", description: "Pick which unoccupied stall to move this tenant into.", edgeInset: "top" },
    { key: "restore", ref: restoreBtnRef, title: isMove ? "Move Tenant" : "Restore account", description: isMove ? "Moves the tenant into the stall you selected above." : "Restores the tenant's account and assigns them to the stall you selected above.", edgeInset: "top" },
  ];

  useEffect(() => {
    fetchUnoccupiedStalls();
  }, []);

  // Auto-opens the guided tour the first time the admin ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    if (loading) return;
    (async () => {
      const seen = await hasSeenPageTour("tenant-relocation");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("tenant-relocation");
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

  const handleConfirmPress = () => {
    if (!selectedStall) {
      Alert.alert("No Stall Selected", "Please select an available stall first.");
      return;
    }
    setShowTransferConfirm(true);
  };

  const performRelocation = async (transferPreviousInfo: boolean) => {
    if (!selectedStall) return;
    setShowTransferConfirm(false);
    setRestoring(true);
    try {
      if (isMove) {
        await relocateActiveTenant(uid, stallId, selectedStall.id, transferPreviousInfo);
        Alert.alert(
          "Tenant Moved",
          `${fullName} has been moved to Building ${selectedStall.buildingNumber} · Space ${selectedStall.spaceId}.`,
          [{ text: "OK", onPress: () => router.replace("/building") }],
        );
      } else {
        await restoreTenantToNewStall(uid, selectedStall.id, transferPreviousInfo);
        Alert.alert(
          "Account Restored",
          `${fullName} has been assigned to Building ${selectedStall.buildingNumber} · Space ${selectedStall.spaceId}.`,
          [{ text: "OK", onPress: () => router.replace("/archives") }],
        );
      }
    } catch (err: any) {
      const msg =
        err?.message === "Selected stall is no longer available."
          ? "That stall was just taken. Please choose another."
          : `Failed to ${isMove ? "move" : "restore"} tenant. Please try again.`;
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
        style={[styles.header, { paddingTop: insets.top + 14 }]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.7}
          disabled={restoring}
          hitSlop={10}
        >
          <ChevronLeft size={24} color={colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isMove ? "Move Tenant" : "Tenant Relocation"}</Text>
        <TouchableOpacity
          onPress={() => setTourVisible(true)}
          activeOpacity={0.7}
          disabled={restoring}
          hitSlop={10}
        >
          <HelpCircle size={22} color={colors.white} />
        </TouchableOpacity>
      </LinearGradient>

      {/* SCROLLABLE BODY */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        {/* TENANT CARD */}
        <Card style={styles.infoCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardLabel}>{isMove ? "Current tenant" : "Archived tenant"}</Text>
            <Text style={styles.infoName}>{fullName}</Text>
            <Text style={styles.infoUsername}>{email}</Text>
            <View style={styles.noticeBox}>
              <Text style={styles.infoNotice}>
                {isMove ? (
                  <>
                    Currently at{" "}
                    <Text style={styles.infoBold}>
                      Building {buildingNumber} {"·"} Space {spaceId}
                    </Text>
                    {"."} Select a new stall below.
                  </>
                ) : (
                  <>
                    Previous stall{" "}
                    <Text style={styles.infoBold}>
                      Building {buildingNumber} {"·"} Space {spaceId}
                    </Text>
                    {" "}is currently occupied. Select a new available stall below.
                  </>
                )}
              </Text>
            </View>
          </View>
        </Card>

        {/* AVAILABLE STALLS */}
        <View ref={stallListRef} collapsable={false}>
        <Text style={styles.sectionLabel}>Available stalls</Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.emerald} size="large" />
          </View>
        ) : stalls.length === 0 ? (
          <EmptyState
            icon={<Building2 size={26} color={colors.textMuted} />}
            title="No available stalls"
            subtitle="There are no available stalls at the moment."
          />
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
                <View style={[styles.stallIconWrap, selected && styles.stallIconWrapSelected]}>
                  <Building2 size={18} color={selected ? colors.emerald : colors.textMuted} />
                </View>
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
        <View ref={restoreBtnRef} collapsable={false}>
        <Button
          label={isMove ? "Move Tenant" : "Restore account"}
          onPress={handleConfirmPress}
          disabled={!selectedStall || restoring}
          loading={restoring}
          style={styles.moveBtn}
        />
        </View>
      </View>

      {/* TRANSFER PREVIOUS RENTAL INFO CONFIRMATION */}
      <Modal
        visible={showTransferConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!restoring) setShowTransferConfirm(false); }}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => { if (!restoring) setShowTransferConfirm(false); }}
          />
          <View style={styles.modalCard}>
            <View style={styles.modalTitleBar}>
              <Text style={styles.modalTitle}>Transfer previous rental info?</Text>
            </View>
            <View style={styles.modalBody}>
              <Text style={styles.modalMessage}>
                Would you like to transfer the previous rental info (Market Category and
                Payment Schedule) to the new stall?
              </Text>
              <View style={styles.modalBtns}>
                <Pressable
                  style={({ pressed }) => [styles.modalBtn, styles.modalBtnOutline, pressed && styles.modalBtnOutlinePressed]}
                  onPress={() => performRelocation(false)}
                  disabled={restoring}
                >
                  {({ pressed }) => (
                    <Text style={[styles.modalBtnOutlineText, pressed && styles.modalBtnOutlineTextPressed]}>No</Text>
                  )}
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.modalBtn,
                    styles.modalBtnPrimary,
                    restoring && styles.modalBtnDisabled,
                    pressed && !restoring && styles.modalBtnPrimaryPressed,
                  ]}
                  onPress={() => performRelocation(true)}
                  disabled={restoring}
                >
                  {({ pressed }) =>
                    restoring ? (
                      <ActivityIndicator color={colors.white} size="small" />
                    ) : (
                      <Text style={[styles.modalBtnPrimaryText, pressed && styles.modalBtnPrimaryTextPressed]}>Yes</Text>
                    )
                  }
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>

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

  header: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
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
    paddingBottom: 100,
  },

  // ── Archived tenant card ──────────────────────────────────────────────────────

  infoCard: {
    marginBottom: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.border,
  },

  cardLabel: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
  },

  infoName: {
    fontSize: fontSize.lg,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
  },

  infoUsername: {
    fontSize: fontSize.base,
    color: colors.textSecondary,
    fontFamily: fontFamily.regular,
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
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
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
    color: colors.emerald,
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
    borderColor: colors.border,
    marginBottom: spacing.sm + 2,
    flexDirection: "row",
    alignItems: "center",
    ...shadow.card,
  },

  stallCardSelected: {
    borderWidth: 2,
    borderColor: colors.ink,
  },

  stallIconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.mist,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },

  stallIconWrapSelected: {
    backgroundColor: colors.emeraldSoft,
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
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    marginTop: 4,
  },

  // ── Radio button ──────────────────────────────────────────────────────────────

  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
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

  // ── Footer restore button ─────────────────────────────────────────────────────

  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.parchment,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },

  moveBtn: {
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
  },

  // ── Transfer-info confirmation modal ─────────────────────────────────────────

  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xxl,
  },

  modalCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    width: "100%",
    overflow: "hidden",
    ...shadow.raised,
  },

  modalTitleBar: {
    backgroundColor: colors.emeraldSoft,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },

  modalTitle: {
    fontSize: fontSize.lg - 1,
    fontFamily: fontFamily.bold,
    color: colors.emerald,
  },

  modalBody: {
    padding: spacing.xl,
  },

  modalMessage: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    lineHeight: 22,
    marginBottom: spacing.xl,
  },

  modalBtns: {
    flexDirection: "row",
    gap: spacing.sm + 2,
  },

  modalBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },

  modalBtnOutline: {
    borderWidth: 1.5,
    borderColor: colors.emerald,
  },
  modalBtnOutlinePressed: {
    backgroundColor: colors.emerald,
  },

  modalBtnOutlineText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },
  modalBtnOutlineTextPressed: {
    color: colors.white,
  },

  modalBtnPrimary: {
    backgroundColor: colors.emerald,
    ...shadow.button,
  },
  modalBtnPrimaryPressed: {
    backgroundColor: colors.white,
  },

  modalBtnPrimaryText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.white,
  },
  modalBtnPrimaryTextPressed: {
    color: colors.emerald,
  },

  modalBtnDisabled: {
    opacity: 0.5,
  },
});

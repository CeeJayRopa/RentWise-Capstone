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
import { ChevronLeft, HelpCircle, Building2, Check, Phone, Store, ArrowRight, Info, CheckCircle2 } from "lucide-react-native";
import { rentWiseUsernameBase } from "../../shared/utils/username";

import { db } from "../shared/services/firestore";
import { restoreTenantToNewStall, relocateActiveTenant } from "../shared/services/accountServices";
import HelpTour, { HelpStep } from "./components/HelpTour";
import HelpSupportModal from "./components/HelpSupportModal";
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
  category: string;
};

export default function TenantRelocation() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    uid: string;
    firstName: string;
    middleName?: string;
    lastName: string;
    email: string;
    buildingNumber: string;
    spaceId: string;
    stallId: string;
    mode?: string;
    contactNo?: string;
  }>();

  const { uid, firstName, middleName, lastName, email, buildingNumber, spaceId, stallId, mode, contactNo } = params;
  const isMove = mode === "move";
  const fullName = [firstName, middleName, lastName].filter(Boolean).join(" ");

  const [stalls, setStalls] = useState<StallOption[]>([]);
  const [selectedStall, setSelectedStall] = useState<StallOption | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [showTransferConfirm, setShowTransferConfirm] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [tourVisible, setTourVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);
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
          category: String(data.category ?? "Market Sector"),
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

  const showRelocationSuccess = (..._legacyAlertArgs: unknown[]) => {
    setShowSuccess(true);
  };

  const performRelocation = async (transferPreviousInfo: boolean) => {
    if (!selectedStall) return;
    setShowTransferConfirm(false);
    setRestoring(true);
    try {
      if (isMove) {
        await relocateActiveTenant(uid, stallId, selectedStall.id, transferPreviousInfo);
        showRelocationSuccess(
          "Tenant Moved",
          `${fullName} has been moved to Building ${selectedStall.buildingNumber} · Space ${selectedStall.spaceId}.`,
          [{ text: "OK", onPress: () => router.replace("/building") }],
        );
      } else {
        await restoreTenantToNewStall(uid, selectedStall.id, transferPreviousInfo);
        showRelocationSuccess(
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
          onPress={() => setHelpSupportVisible(true)}
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
        <Card style={isMove ? styles.hiddenCard : styles.infoCard}>
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

        {isMove && (
          <>
            <View style={styles.currentTenantCard}>
              <View style={styles.currentTenantTopRow}><Text style={styles.microLabel}>CURRENT TENANT</Text><Text style={styles.leasePill}>Active Lease</Text></View>
              <View style={styles.currentTenantIdentity}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.currentTenantName}>{fullName}</Text>
                  <View style={styles.currentTenantMeta}><Text style={styles.usernamePill}>@{rentWiseUsernameBase(firstName)}</Text><Phone size={10} color={colors.textMuted} /><Text style={styles.currentTenantPhone}>+63 {contactNo || "—"}</Text></View>
                </View>
                <View style={styles.currentTenantAvatar}><Text style={styles.currentTenantAvatarText}>{`${firstName?.charAt(0) || ""}${lastName?.charAt(0) || ""}`.toUpperCase()}</Text></View>
              </View>
              <View style={styles.tenantRule} />
              <Text style={styles.microLabel}>CURRENTLY ASSIGNED</Text>
              <View style={styles.assignedRow}><View style={styles.assignedTitleRow}><Store size={12} color={colors.emerald} /><Text style={styles.assignedText}>Building {buildingNumber} · Space {spaceId}</Text></View><View style={styles.occupiedPill}><View style={styles.occupiedDot} /><Text style={styles.occupiedPillText}>Occupied</Text></View></View>
            </View>

            <View style={styles.transferSummaryCard}>
              <View style={styles.transferBoxes}>
                <View style={styles.transferBox}><Text style={styles.microLabel}>CURRENT SPACE</Text><Text style={styles.transferSpace}>Space {spaceId}</Text><Text style={styles.transferSub}>Bldg {buildingNumber} (Dry Market)</Text></View>
                <View style={styles.transferArrow}><ArrowRight size={14} color={colors.ink} /></View>
                <View style={[styles.transferBox, selectedStall ? styles.transferBoxSelected : styles.transferBoxEmpty]}>
                  <Text style={styles.microLabel}>NEW DESTINATION</Text>
                  {selectedStall ? <><Text style={styles.transferSpace}>Space {selectedStall.spaceId}</Text><Text style={styles.transferSub}>Bldg {selectedStall.buildingNumber} · ₱{selectedStall.price.toLocaleString()}/day</Text><CheckCircle2 size={13} color={colors.emerald} style={styles.destinationCheck} /></> : <Text style={styles.selectDestinationText}>Select an available stall</Text>}
                </View>
              </View>
              <View style={styles.transferNoteRow}><Info size={11} color={selectedStall ? colors.emerald : colors.textMuted} /><Text style={styles.transferNote}>{selectedStall ? `Tenant ${fullName} will be reassigned from Space ${spaceId} to Space ${selectedStall.spaceId} upon confirmation.` : "Select an unoccupied space from the directory below to initiate assignment transfer."}</Text></View>
            </View>
          </>
        )}

        {/* AVAILABLE STALLS */}
        <View ref={stallListRef} collapsable={false}>
        <View style={styles.availableHeadingRow}><Text style={styles.sectionLabel}>Available Destinations</Text><Text style={styles.availableCount}>{stalls.length} {stalls.length === 1 ? "Stall" : "Stalls"} Available</Text></View>
        {isMove ? <Text style={styles.availableSubtitle}>Choose a target commercial unit within Ka Domeng Talipapa directory.</Text> : null}

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
                <View style={styles.legacyHidden}>
                  <Building2 size={18} color={selected ? colors.emerald : colors.textMuted} />
                </View>
                <View style={styles.legacyHidden}>
                  <Text style={styles.stallTitle}>
                    Building {item.buildingNumber} {"·"} Space {item.spaceId}
                  </Text>
                  <Text style={styles.stallSub}>
                    ₱{item.price.toLocaleString()} {"·"} every {item.paymentSchedule === "daily" ? 1 : item.paymentSchedule === "weekly" ? 7 : item.paymentSchedule === "semi-monthly" ? 15 : 30} days
                  </Text>
                </View>
                <View style={styles.legacyHidden}>
                  {selected && <Check size={14} color={colors.white} />}
                </View>
                <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>{selected && <View style={styles.radioInner} />}</View>
                <View style={styles.stallInfo}>
                  <View style={styles.stallTitleRow}><Text style={styles.spaceIdBadge}>[{item.spaceId}]</Text>{selected ? <Text style={styles.selectedBadge}>Selected Destination</Text> : <Text style={styles.vacantBadge}>Vacant</Text>}</View>
                  <Text style={styles.stallSub}>Building {item.buildingNumber} · {item.category}{item.category.toLowerCase().endsWith("sector") ? "" : " Sector"}</Text>
                  <Text style={styles.stallPrice}>₱{item.price.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / day</Text>
                  <Text style={styles.monthlyEquivalent}>(Monthly equivalent ₱{(item.price * 30).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</Text>
                </View>
                {selected ? <View style={styles.selectedCheck}><Check size={13} color={colors.ink} /></View> : <ChevronLeft size={16} color={colors.textMuted} style={{ transform: [{ rotate: "180deg" }] }} />}
              </TouchableOpacity>
            );
          })
        )}
        </View>
      </ScrollView>

      {/* FOOTER — RESTORE BUTTON */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 28 }]}>
        {isMove && !selectedStall ? <View style={styles.footerHintRow}><Info size={10} color={colors.textMuted} /><Text style={styles.footerHint}>Select a destination stall to enable relocation.</Text></View> : null}
        {isMove && selectedStall ? <View style={styles.footerHintRow}><CheckCircle2 size={10} color={colors.emerald} /><Text style={styles.footerConfirmed}>Transfer target: Building {selectedStall.buildingNumber} · Space {selectedStall.spaceId} confirmed.</Text></View> : null}
        <View ref={restoreBtnRef} collapsable={false}>
        <Button
          label={isMove ? "Move Tenant" : "Restore account"}
          onPress={handleConfirmPress}
          disabled={!selectedStall || restoring}
          loading={restoring}
          style={styles.moveBtn}
          icon={isMove ? <ArrowRight size={14} color={colors.white} /> : undefined}
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

      <Modal
        visible={showSuccess}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {
          setShowSuccess(false);
          router.replace(isMove ? "/building" : "/archives");
        }}
      >
        <View style={styles.successOverlay}>
          <View style={styles.successModalCard}>
            <View style={styles.successIconWrap}><Check size={24} color={colors.white} /></View>
            <Text style={styles.successModalEyebrow}>TRANSFER COMPLETE</Text>
            <Text style={styles.successModalTitle}>{isMove ? "Tenant Moved" : "Account Restored"}</Text>
            <Text style={styles.successModalMessage}>{fullName} has been successfully {isMove ? "moved" : "assigned"} to the selected destination.</Text>
            <View style={styles.successDestinationCard}>
              <View><Text style={styles.successDestinationLabel}>NEW ASSIGNMENT</Text><Text style={styles.successDestinationSpace}>Space {selectedStall?.spaceId}</Text><Text style={styles.successDestinationBuilding}>Building {selectedStall?.buildingNumber}</Text></View>
              <View style={styles.successDestinationCheck}><CheckCircle2 size={20} color={colors.emerald} /></View>
            </View>
            <Pressable
              style={({ pressed }) => [styles.successDoneBtn, pressed && styles.successDoneBtnPressed]}
              onPress={() => {
                setShowSuccess(false);
                router.replace(isMove ? "/building" : "/archives");
              }}
            >
              <Text style={styles.successDoneText}>Done</Text>
              <ArrowRight size={15} color={colors.white} />
            </Pressable>
          </View>
        </View>
      </Modal>

      <HelpTour visible={tourVisible} steps={tourSteps} onClose={() => setTourVisible(false)} />
      <HelpSupportModal visible={helpSupportVisible} steps={tourSteps} onClose={() => setHelpSupportVisible(false)} onReplayTour={() => setTourVisible(true)} />
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
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 120,
  },

  hiddenCard: { display: "none" },
  currentTenantCard: { backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: "#EEF0ED", padding: 13, marginBottom: 10 },
  currentTenantTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  microLabel: { fontSize: 8, fontFamily: fontFamily.medium, color: colors.textSecondary },
  leasePill: { fontSize: 8, fontFamily: fontFamily.medium, color: colors.ink, backgroundColor: colors.mist, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  currentTenantIdentity: { flexDirection: "row", alignItems: "center", marginTop: 7 },
  currentTenantName: { fontSize: 15, fontFamily: fontFamily.bold, color: colors.ink },
  currentTenantMeta: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  usernamePill: { fontSize: 8, fontFamily: fontFamily.semibold, color: colors.ink, backgroundColor: "#DDF8EE", borderRadius: 999, paddingHorizontal: 5, paddingVertical: 2 },
  currentTenantPhone: { fontSize: 8, fontFamily: fontFamily.regular, color: colors.textMuted },
  currentTenantAvatar: { width: 33, height: 33, borderRadius: 17, backgroundColor: colors.mist, alignItems: "center", justifyContent: "center" },
  currentTenantAvatarText: { fontSize: 12, fontFamily: fontFamily.semibold, color: colors.ink },
  tenantRule: { height: 1, backgroundColor: "#E8EAE8", marginVertical: 9 },
  assignedRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  assignedTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  assignedText: { fontSize: 11, fontFamily: fontFamily.semibold, color: colors.ink },
  occupiedPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.mist, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  occupiedDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.emerald },
  occupiedPillText: { fontSize: 8, fontFamily: fontFamily.medium, color: colors.ink },
  transferSummaryCard: { backgroundColor: colors.white, borderRadius: 10, borderWidth: 1, borderColor: "#EEF0ED", padding: 12, marginBottom: 11 },
  transferBoxes: { flexDirection: "row", alignItems: "center", gap: 7 },
  transferBox: { flex: 1, minHeight: 64, borderRadius: 7, padding: 9, backgroundColor: colors.mist },
  transferBoxEmpty: { backgroundColor: "#ECEEEC" },
  transferBoxSelected: { backgroundColor: "#DDF8EE" },
  transferArrow: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#55E5B3", alignItems: "center", justifyContent: "center" },
  transferSpace: { fontSize: 13, fontFamily: fontFamily.bold, color: colors.ink, marginTop: 3 },
  transferSub: { fontSize: 8, fontFamily: fontFamily.regular, color: colors.textSecondary, marginTop: 1 },
  selectDestinationText: { fontSize: 10, lineHeight: 12, fontFamily: fontFamily.regular, fontStyle: "italic", color: colors.textSecondary, marginTop: 3 },
  destinationCheck: { position: "absolute", right: 6, top: 6 },
  transferNoteRow: { flexDirection: "row", alignItems: "flex-start", gap: 5, marginTop: 9 },
  transferNote: { flex: 1, fontSize: 8, lineHeight: 11, fontFamily: fontFamily.regular, color: colors.textSecondary },

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
    fontSize: 11,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
    letterSpacing: 0,
    textTransform: "uppercase",
    marginBottom: 0,
  },

  availableHeadingRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  availableCount: { fontSize: 8, fontFamily: fontFamily.semibold, color: colors.emerald, backgroundColor: "#79EDC4", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  availableSubtitle: { fontSize: 8, fontFamily: fontFamily.regular, color: colors.textSecondary, marginTop: 2, marginBottom: 8 },

  // ── Stall option card ─────────────────────────────────────────────────────────

  stallCard: {
    backgroundColor: colors.white,
    borderRadius: 9,
    padding: 11,
    borderWidth: 1,
    borderColor: "#EEF0ED",
    marginBottom: 7,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 92,
  },

  stallCardSelected: {
    borderWidth: 0,
    backgroundColor: "#C8EFE2",
  },

  legacyHidden: { display: "none" },

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
    marginLeft: 8,
  },

  stallTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  spaceIdBadge: { fontSize: 12, fontFamily: fontFamily.bold, color: colors.ink, backgroundColor: "#ECEEEC", borderRadius: 3, paddingHorizontal: 4, paddingVertical: 2 },
  selectedBadge: { fontSize: 7, fontFamily: fontFamily.semibold, color: colors.white, backgroundColor: colors.emerald, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 2 },
  vacantBadge: { fontSize: 7, fontFamily: fontFamily.medium, color: colors.textSecondary, backgroundColor: colors.mist, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 2 },

  stallTitle: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
  },

  stallSub: {
    fontSize: 9,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    marginTop: 3,
  },

  stallPrice: { fontSize: 11, fontFamily: fontFamily.bold, color: colors.ink, marginTop: 6 },
  monthlyEquivalent: { fontSize: 8, fontFamily: fontFamily.regular, color: colors.textSecondary, marginTop: 2 },
  selectedCheck: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#65EFC0", alignItems: "center", justifyContent: "center", alignSelf: "flex-start" },

  // ── Radio button ──────────────────────────────────────────────────────────────

  radioOuter: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: colors.border,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    marginTop: 2,
  },

  radioOuterSelected: {
    borderColor: colors.emerald,
    backgroundColor: colors.white,
  },
  radioInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.emerald },

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
    paddingTop: 5,
  },

  moveBtn: {
    minHeight: 40,
    borderRadius: 8,
    backgroundColor: colors.ink,
  },
  footerHintRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, marginBottom: 5 },
  footerHint: { fontSize: 8, fontFamily: fontFamily.regular, color: colors.textMuted },
  footerConfirmed: { fontSize: 8, fontFamily: fontFamily.medium, color: colors.emerald },

  successOverlay: {
    flex: 1,
    backgroundColor: "rgba(7, 35, 28, 0.62)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  successModalCard: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: colors.white,
    borderRadius: 18,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 18,
    alignItems: "center",
    ...shadow.raised,
  },
  successIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.emerald,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  successModalEyebrow: {
    fontSize: 8,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
    letterSpacing: 1.1,
  },
  successModalTitle: {
    fontSize: 21,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginTop: 4,
  },
  successModalMessage: {
    maxWidth: 260,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: 6,
    marginBottom: 16,
  },
  successDestinationCard: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#DDF8EE",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  successDestinationLabel: { fontSize: 8, fontFamily: fontFamily.semibold, color: colors.emerald },
  successDestinationSpace: { fontSize: 16, fontFamily: fontFamily.bold, color: colors.ink, marginTop: 2 },
  successDestinationBuilding: { fontSize: 9, fontFamily: fontFamily.regular, color: colors.textSecondary, marginTop: 1 },
  successDestinationCheck: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  successDoneBtn: {
    width: "100%",
    minHeight: 43,
    borderRadius: 9,
    backgroundColor: colors.ink,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  successDoneBtnPressed: { backgroundColor: colors.emerald, transform: [{ scale: 0.98 }] },
  successDoneText: { fontSize: 12, fontFamily: fontFamily.semibold, color: colors.white },

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

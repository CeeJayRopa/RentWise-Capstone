import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  TextInput,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { ArrowLeft, HelpCircle, KeyRound, Bell, ChevronDown, Check, Store, SlidersHorizontal, CheckCheck, Trash2, WalletCards, ContactRound, ArrowRight, Search, X } from "lucide-react-native";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { firebaseApp } from "../shared/firebaseConfig";
import HelpTour, { HelpStep } from "./components/HelpTour";
import HelpSupportModal from "./components/HelpSupportModal";
import { hasSeenPageTour, markPageTourSeen } from "../shared/services/onboardingTour";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";

type OwnerNotification = {
  id: string;
  userId: string;
  message: string;
  title?: string;
  status?: string;
  read: boolean;
  createdAt?: any;
  updateId?: string;
  reportCategory?: ReportCategory;
  reportData?: Record<string, any>;
};

type ReportCategory = "finance" | "building" | "archive";
type CategoryFilter = "all" | ReportCategory;
const cloudFunctions = getFunctions(firebaseApp);

const CATEGORY_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: "all", label: "All Categories" },
  { value: "finance", label: "Payment" },
  { value: "building", label: "Stalls" },
  { value: "archive", label: "Tenant & Archive" },
];

function resolveReportCategory(data: Record<string, any>): ReportCategory {
  if (data.module === "Building Management" || data.module === "Stall Management" || data.category === "building") return "building";
  if (data.module === "Financials" || data.category === "finance") return "finance";
  return "archive";
}

type AdminPasswordReset = {
  id: string;
  tenantName?: string; // admin's name — field reused from the shared passwordResetRequests schema
  email?: string;
  createdAt?: any;
};

function relativeTime(ts: any): string {
  if (!ts) return "";
  const d: Date = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

function categoryLabel(cat: string): string {
  if (cat === "building") return "Stall";
  if (cat === "finance") return "Payment";
  return "Account";
}

function categoryColor(cat?: ReportCategory): string {
  if (cat === "finance") return colors.emerald;
  if (cat === "building") return colors.gold;
  return colors.warning;
}

// Legacy pending and rejected records remain reviewable under the two-state flow.
function isPendingStatus(status?: string): boolean {
  return status === "To be Acknowledged" || status === "To be Approved" || status === "Rejected" || status === "Pending";
}

// Displays legacy "Approved" / "To be Approved" statuses under the new wording
// without needing to rewrite the old Firestore records.
function displayStatus(status?: string): string {
  if (isPendingStatus(status)) return "Pending";
  if (status === "Approved" || status === "Acknowledged") return "Acknowledged";
  return status ?? "";
}

export default function Notifications() {
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<OwnerNotification[]>([]);
  const [adminResets, setAdminResets] = useState<AdminPasswordReset[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [acknowledgeModalVisible, setAcknowledgeModalVisible] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(50);
  const [showAllNotifications, setShowAllNotifications] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);
  const [tourVisible, setTourVisible] = useState(false);
  const [helpSupportVisible, setHelpSupportVisible] = useState(false);
  const actionRowRef = useRef<View>(null);
  const cardRef = useRef<View>(null);
  const checkReportRef = useRef<View>(null);
  const categoryRef = useRef<View>(null);

  const categoryFilteredNotifications = categoryFilter === "all"
    ? notifications
    : notifications.filter((notification) => notification.reportCategory === categoryFilter);
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredNotifications = normalizedSearch
    ? categoryFilteredNotifications.filter((notification) => {
        const report = notification.reportData ?? {};
        const searchableText = [
          notification.title,
          notification.message,
          notification.status,
          categoryLabel(notification.reportCategory ?? "archive"),
          ...Object.values(report).map((value) => String(value ?? "")),
        ].join(" ").toLowerCase();
        return searchableText.includes(normalizedSearch);
      })
    : categoryFilteredNotifications;
  const visibleNotifications = showAllNotifications
    ? filteredNotifications
    : filteredNotifications.slice(0, 10);
  const firstPendingIndex = filteredNotifications.findIndex((n) => isPendingStatus(n.status) && n.updateId);

  useEffect(() => {
    setShowAllNotifications(false);
  }, [categoryFilter, searchQuery]);

  const tourSteps: HelpStep[] = [
    { key: "actions", ref: actionRowRef, title: "Acknowledge All / Clear All", description: "Acknowledge All records that you reviewed every pending report. Clear All removes reports already acknowledged.", edgeInset: "top" },
    { key: "category", ref: categoryRef, title: "Category filter", description: "Show all reports or narrow them to payments, stalls, or accounts.", edgeInset: "top" },
    { key: "card", ref: cardRef, title: "Automatic report", description: "Shows the Admin action, category, time, summary, and acknowledgment status.", edgeInset: "top" },
    ...(firstPendingIndex !== -1
      ? [{ key: "checkreport", ref: checkReportRef, title: "Check Report", description: "Opens the full details of a pending update so you can review it before acknowledging.", edgeInset: "top" as const }]
      : []),
  ];

  const fetchAdminResets = useCallback(async () => {
    try {
      const snap = await getDocs(
        query(
          collection(db, "passwordResetRequests"),
          where("requestedRole", "==", "admin"),
          where("status", "==", "pending"),
        ),
      );
      setAdminResets(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
      );
    } catch (err) {
      console.log("ADMIN RESET FETCH ERROR:", err);
    }
  }, []);

  const goResetAdminPassword = () => {
    router.push("/manage-admin");
  };

  const subscribe = useCallback(() => {
    const user = auth.currentUser;
    if (!user) return;

    const q = query(
      collection(db, "notifications"),
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc"),
      limit(displayLimit),
    );

    const unsub = onSnapshot(q, async (snap) => {
      try {
        const rows = await Promise.all(
          snap.docs.map(async (notificationDoc) => {
            const notification = {
              id: notificationDoc.id,
              ...(notificationDoc.data() as Omit<OwnerNotification, "id">),
            };
            if (!notification.updateId || notification.reportCategory) return notification;

            const updateSnap = await getDoc(doc(db, "updates", notification.updateId));
            return {
              ...notification,
              reportCategory: updateSnap.exists() ? resolveReportCategory(updateSnap.data()) : undefined,
              reportData: updateSnap.exists() ? updateSnap.data() : undefined,
            };
          }),
        );
        setNotifications(rows);
      } catch (err) {
        console.error("NOTIFICATION CATEGORY ERROR:", err);
      } finally {
        setLoading(false);
      }
    }, (error) => {
      if (!auth.currentUser) return;
      console.error("OWNER NOTIFICATIONS LISTENER ERROR:", error);
      setLoading(false);
    });

    unsubRef.current = unsub;
  }, [displayLimit]);

  useFocusEffect(
    useCallback(() => {
      subscribe();
      fetchAdminResets();
      return () => {
        unsubRef.current?.();
        unsubRef.current = null;
      };
    }, [subscribe, fetchAdminResets]),
  );

  // Auto-opens the guided tour the first time the owner ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    if (loading) return;
    (async () => {
      const seen = await hasSeenPageTour("owner-notifications");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("owner-notifications");
      }
    })();
  }, [loading]);

  const markRead = async (item: OwnerNotification) => {
    if (item.read) return;
    try {
      await updateDoc(doc(db, "notifications", item.id), { read: true });
    } catch (err) {
      console.log(err);
    }
  };

  const handleCheckReport = (item: OwnerNotification) => {
    router.push({
      pathname: "/update-confirmation",
      params: { id: item.updateId, source: "notifications" },
    } as any);
    // Reading the notification is secondary to opening the report. Let the
    // navigation transition start immediately instead of blocking it on a
    // Firestore round trip.
    void markRead(item);
  };

  const doApproveAll = async (pending: OwnerNotification[]) => {
    setApproving(true);
    try {
      const updateIds = [...new Set(pending.map((item) => item.updateId).filter((id): id is string => !!id))];
      const acknowledge = httpsCallable(cloudFunctions, "ownerAcknowledgeUpdates");
      for (let index = 0; index < updateIds.length; index += 50) {
        await acknowledge({updateIds: updateIds.slice(index, index + 50)});
      }
    } catch (err) {
      console.error("approveAll error:", err);
      Alert.alert("Error", "Failed to acknowledge all. Please try again.");
    } finally {
      setApproving(false);
    }
  };

  const doClearAll = async (items: OwnerNotification[]) => {
    setClearing(true);
    try {
      for (let index = 0; index < items.length; index += 400) {
        const batch = writeBatch(db);
        for (const item of items.slice(index, index + 400)) {
          batch.delete(doc(db, "notifications", item.id));
        }
        await batch.commit();
      }
    } catch (err) {
      console.error("clearAll error:", err);
      Alert.alert("Error", "Failed to clear notifications. Please try again.");
    } finally {
      setClearing(false);
    }
  };

  const handleApproveAll = () => {
    const pending = filteredNotifications.filter((n) => isPendingStatus(n.status));
    if (pending.length === 0) {
      Alert.alert("Nothing Pending", "There are no pending notifications to acknowledge.");
      return;
    }
    setAcknowledgeModalVisible(true);
  };

  const handleClearAll = () => {
    if (filteredNotifications.length === 0) return;
    if (pendingCount > 0) return;
    Alert.alert(
      "Clear Notifications",
      "Remove all notifications from your list?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: () => doClearAll(filteredNotifications),
        },
      ],
    );
  };

  const pendingCount = filteredNotifications.filter((n) =>
    isPendingStatus(n.status),
  ).length;
  const selectedCategoryLabel = CATEGORY_OPTIONS.find((option) => option.value === categoryFilter)?.label ?? "All Categories";
  const busy = approving || clearing;

  if (loading) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator size="large" color={colors.emerald} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Header */}
      <LinearGradient
        colors={[colors.emerald, colors.ink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            activeOpacity={0.7}
          >
            <ArrowLeft size={22} color={colors.emeraldSoft} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Notifications</Text>
          <TouchableOpacity onPress={() => setHelpSupportVisible(true)} style={styles.backBtn} activeOpacity={0.7}>
            <HelpCircle size={22} color={colors.emeraldSoft} />
          </TouchableOpacity>
        </View>

      </LinearGradient>

      <ScrollView
        style={styles.body}
        contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: insets.bottom + 24 }}
      >
        {/* Admin password reset requests */}
        {adminResets.length > 0 && (
          <View style={{ marginBottom: spacing.md + 2 }}>
            <Text style={styles.sectionTitle}>Admin Password Resets</Text>
            {adminResets.map((item) => (
              <View key={item.id} style={styles.card}>
                <View style={styles.cardRow}>
                  <View style={styles.bellCircle}>
                    <KeyRound size={20} color={colors.emerald} />
                  </View>
                  <View style={styles.cardContent}>
                    <Text style={styles.senderName}>
                      {item.tenantName || "Admin"}
                    </Text>
                    <Text style={styles.messageText}>{item.email}</Text>
                    <Text style={styles.timeText}>
                      {relativeTime(item.createdAt)}
                    </Text>
                  </View>
                </View>
                <View style={styles.resetActionsRow}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.checkReportBtn,
                      styles.resetActionBtn,
                      styles.resetPrimaryActionBtn,
                      pressed && styles.checkReportBtnPressed,
                    ]}
                    onPress={goResetAdminPassword}
                  >
                    {({ pressed }) => (
                      <Text
                        numberOfLines={1}
                        style={[styles.checkReportText, pressed && styles.checkReportTextPressed]}
                      >
                        Reset in Manage Admin
                      </Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {notifications.length > 0 && (
          <View style={styles.searchBox}>
            <Search size={19} color={colors.textSecondary} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search notifications"
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search notifications"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearchQuery("")}
                style={styles.searchClearButton}
                accessibilityRole="button"
                accessibilityLabel="Clear notification search"
              >
                <X size={17} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {notifications.length > 0 && (
          <View ref={categoryRef} collapsable={false} style={styles.categorySection}>
            <Pressable
              style={({ pressed }) => [styles.categorySelect, pressed && styles.categorySelectPressed]}
              onPress={() => setCategoryMenuOpen((open) => !open)}
            >
              <View style={styles.categorySelectLabelRow}>
                <SlidersHorizontal size={18} color={colors.ink} />
                <Text style={styles.categorySelectText}>{selectedCategoryLabel}</Text>
              </View>
              <View style={styles.categorySelectRight}>
                <Text style={styles.categoryCount}>{filteredNotifications.length}</Text>
                <ChevronDown
                  size={18}
                  color={colors.emerald}
                  style={{ transform: [{ rotate: categoryMenuOpen ? "180deg" : "0deg" }] }}
                />
              </View>
            </Pressable>

            {categoryMenuOpen && (
              <View style={styles.categoryMenu}>
                {CATEGORY_OPTIONS.map((option, index) => {
                  const selected = option.value === categoryFilter;
                  const count = option.value === "all"
                    ? notifications.length
                    : notifications.filter((notification) => notification.reportCategory === option.value).length;
                  return (
                    <Pressable
                      key={option.value}
                      style={({ pressed }) => [
                        styles.categoryOption,
                        index < CATEGORY_OPTIONS.length - 1 && styles.categoryOptionBorder,
                        selected && styles.categoryOptionSelected,
                        pressed && styles.categoryOptionPressed,
                      ]}
                      onPress={() => {
                        setCategoryFilter(option.value);
                        setCategoryMenuOpen(false);
                      }}
                    >
                      <View style={styles.categoryOptionCheck}>
                        {selected && <Check size={15} color={colors.emerald} />}
                      </View>
                      <Text style={[styles.categoryOptionText, selected && styles.categoryOptionTextSelected]}>{option.label}</Text>
                      <Text style={styles.categoryOptionCount}>{count}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Action buttons */}
        {filteredNotifications.length > 0 && (
          <View style={styles.actionRow} ref={actionRowRef} collapsable={false}>
            {pendingCount > 0 && (
              <Pressable
                style={({ pressed }) => [styles.approveAllBtn, busy && styles.btnDisabled, pressed && !busy && styles.approveAllBtnPressed]}
                onPress={handleApproveAll}
                disabled={busy}
              >
                {({ pressed }) =>
                  approving ? (
                    <ActivityIndicator color={colors.white} size="small" />
                  ) : (
                    <View style={styles.approveAllContent}>
                      <CheckCheck size={18} color={pressed ? colors.emerald : colors.white} />
                      <Text style={[styles.approveAllText, pressed && styles.approveAllTextPressed]}>Acknowledge All</Text>
                      <View style={styles.pendingCountBadge}>
                        <Text style={styles.pendingCountBadgeText}>{pendingCount}</Text>
                      </View>
                    </View>
                  )
                }
              </Pressable>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.clearBtn,
                (busy || pendingCount > 0) && styles.btnDisabled,
                pressed && !(busy || pendingCount > 0) && styles.clearBtnPressed,
              ]}
              onPress={handleClearAll}
              disabled={busy || pendingCount > 0}
            >
              {({ pressed }) =>
                clearing ? (
                  <ActivityIndicator color={colors.error} size="small" />
                ) : (
                  <View style={styles.clearContent}>
                    <Trash2 size={16} color={pressed ? colors.white : colors.error} />
                    <Text style={[styles.clearText, pressed && styles.clearTextPressed]}>Clear All</Text>
                  </View>
                )
              }
            </Pressable>
          </View>
        )}

        {filteredNotifications.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {notifications.length === 0
                ? "No notifications yet."
                : normalizedSearch
                  ? "No notifications match your search."
                  : `No ${selectedCategoryLabel} reports found.`}
            </Text>
          </View>
        ) : (
          visibleNotifications.map((item, index) => {
            const isPending = isPendingStatus(item.status);
            const category = item.reportCategory ?? "archive";
            const report = item.reportData ?? {};
            const title = report.type || item.title || `${categoryLabel(category)} Update`;
            const messageAmountMatch = item.message.match(/₱\s*([\d,]+(?:\.\d+)?)/);
            const messageTenantMatch = item.message.match(/:\s*(.*?)\s*(?:·|•|-|\.)\s*₱/);
            const tenantName = String(report.tenantName || messageTenantMatch?.[1] || "Tenant").trim();
            const amount = Number(
              report.paymentAmount ?? messageAmountMatch?.[1]?.replace(/,/g, "") ?? 0,
            );
            const amountText = `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            return (
              <View
                key={item.id}
                ref={index === 0 ? cardRef : undefined}
                collapsable={false}
                style={[styles.card, isPending ? styles.cardPending : styles.cardAcknowledged]}
              >
                <View style={styles.cardRow}>
                  <View style={[styles.reportIconBox, category === "finance" && styles.reportIconBoxPayment]}>
                    {category === "finance" ? (
                      <WalletCards size={18} color={colors.emerald} />
                    ) : category === "building" ? (
                      <Store size={18} color={colors.ink} />
                    ) : category === "archive" ? (
                      <ContactRound size={18} color={colors.ink} />
                    ) : (
                      <Bell size={20} color={colors.emerald} />
                    )}
                  </View>

                  <View style={styles.cardContent}>
                    <View style={styles.topRow}>
                      <View style={styles.reportMetaRow}>
                        <View style={[styles.categoryPill, category === "finance" && styles.categoryPillPayment]}>
                          <Text style={styles.categoryPillText}>{categoryLabel(category)}</Text>
                        </View>
                        <Text style={styles.metaDot}>•</Text>
                        <Text style={styles.timeText}>{relativeTime(item.createdAt)}</Text>
                      </View>
                      <View style={[styles.statusPill, isPending ? styles.statusPillPending : styles.statusPillAcknowledged]}>
                        {!isPending && <Check size={11} color={colors.emerald} />}
                        <Text style={[styles.statusPillText, !isPending && styles.statusPillTextAcknowledged]}>
                          {displayStatus(item.status)}
                        </Text>
                      </View>
                    </View>
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.88} style={styles.reportTitle}>
                      {title}
                    </Text>
                  </View>
                </View>

                {category === "finance" ? (
                  <View style={styles.paymentDetailsBox}>
                    <View style={styles.paymentDetailColumn}>
                      <Text style={styles.paymentDetailLabel}>Tenant</Text>
                      <Text style={styles.paymentDetailValue}>{tenantName}</Text>
                    </View>
                    <View style={[styles.paymentDetailColumn, styles.paymentAmountColumn]}>
                      <Text style={styles.paymentDetailLabel}>{String(report.paymentMethod ?? "").toLowerCase() === "online" ? "Settled Amount" : "Amount Received"}</Text>
                      <Text style={styles.paymentAmountValue}>{amountText}</Text>
                    </View>
                  </View>
                ) : (
                  <View style={styles.updateMessageBox}>
                    <Text style={styles.updateMessageText}>{item.message}</Text>
                  </View>
                )}

                {isPending && item.updateId ? (
                  <Pressable
                    ref={index === firstPendingIndex ? checkReportRef : undefined}
                    style={({ pressed }) => [
                      styles.checkReportBtn,
                      styles.checkReportBtnCentered,
                      pressed && styles.checkReportBtnPressed,
                    ]}
                    onPress={() => handleCheckReport(item)}
                  >
                    {({ pressed }) => (
                      <View style={styles.viewDetailsContent}>
                        <Text style={[styles.checkReportText, pressed && styles.checkReportTextPressed]}>View Details</Text>
                        <ArrowRight size={14} color={pressed ? colors.emerald : colors.white} />
                      </View>
                    )}
                  </Pressable>
                ) : null}
              </View>
            );
          })
        )}

        {!showAllNotifications && filteredNotifications.length > 10 && (
          <Pressable
            style={({ pressed }) => [styles.viewAllButton, pressed && styles.viewAllButtonPressed]}
            onPress={() => setShowAllNotifications(true)}
            accessibilityRole="button"
            accessibilityLabel={`View all ${filteredNotifications.length} notifications`}
          >
            <Text style={styles.viewAllButtonText}>View all</Text>
          </Pressable>
        )}

        {showAllNotifications && notifications.length >= displayLimit && (
          <Pressable
            style={({pressed}) => [styles.checkReportBtn, styles.checkReportBtnCentered, styles.loadOlderButton, pressed && styles.checkReportBtnPressed]}
            onPress={() => setDisplayLimit((value) => value + 50)}
          >
            <Text style={styles.checkReportText}>Load older notifications</Text>
          </Pressable>
        )}
      </ScrollView>

      <Modal
        visible={acknowledgeModalVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => !approving && setAcknowledgeModalVisible(false)}
      >
        <Pressable
          style={styles.confirmOverlay}
          onPress={() => !approving && setAcknowledgeModalVisible(false)}
        >
          <Pressable style={styles.confirmCard} onPress={(event) => event.stopPropagation()}>
            <View style={styles.confirmIcon}>
              <CheckCheck size={25} color={colors.emerald} strokeWidth={2.4} />
            </View>
            <Text style={styles.confirmTitle}>Acknowledge All</Text>
            <Text style={styles.confirmMessage}>
              Confirm that you reviewed all {pendingCount} pending update{pendingCount !== 1 ? "s" : ""}.
            </Text>

            <View style={styles.confirmActions}>
              <Pressable
                style={({ pressed }) => [styles.confirmCancelBtn, pressed && styles.confirmCancelBtnPressed]}
                onPress={() => setAcknowledgeModalVisible(false)}
                disabled={approving}
              >
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.confirmPrimaryBtn, pressed && styles.confirmPrimaryBtnPressed]}
                onPress={async () => {
                  const pending = filteredNotifications.filter((notification) => isPendingStatus(notification.status));
                  await doApproveAll(pending);
                  setAcknowledgeModalVisible(false);
                }}
                disabled={approving}
              >
                {approving ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Text style={styles.confirmPrimaryText}>Acknowledge All</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <HelpTour visible={tourVisible} steps={tourSteps} onClose={() => setTourVisible(false)} />
      <HelpSupportModal visible={helpSupportVisible} steps={tourSteps} onClose={() => setHelpSupportVisible(false)} onReplayTour={() => setTourVisible(true)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.parchment },

  loadingBox: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.parchment,
  },

  headerGradient: {
    borderBottomLeftRadius: radius.xl + 4,
    borderBottomRightRadius: radius.xl + 4,
    overflow: "hidden",
  },

  header: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: colors.white,
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
  },

  body: { flex: 1 },

  searchBox: {
    minHeight: 48,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    ...shadow.card,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.ink,
  },
  searchClearButton: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: colors.mist,
  },

  categorySection: {
    marginBottom: spacing.sm,
    zIndex: 20,
  },
  categorySelect: {
    minHeight: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    ...shadow.card,
  },
  categorySelectPressed: { opacity: 0.78 },
  categorySelectLabelRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  categorySelectText: { fontSize: fontSize.md, fontFamily: fontFamily.semibold, color: colors.ink },
  categorySelectRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  categoryCount: {
    minWidth: 24,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    color: colors.white,
    fontSize: fontSize.xs,
    fontFamily: fontFamily.bold,
    textAlign: "center",
  },
  categoryMenu: {
    position: "absolute",
    top: 54,
    left: 0,
    right: 0,
    zIndex: 30,
    elevation: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    overflow: "hidden",
    ...shadow.card,
  },
  categoryOption: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
  },
  categoryOptionBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  categoryOptionSelected: { backgroundColor: colors.emeraldSoft },
  categoryOptionPressed: { opacity: 0.72 },
  categoryOptionCheck: { width: 24, alignItems: "flex-start" },
  categoryOptionText: { flex: 1, fontSize: fontSize.sm, fontFamily: fontFamily.medium, color: colors.textPrimary },
  categoryOptionTextSelected: { fontFamily: fontFamily.bold, color: colors.emerald },
  categoryOptionCount: { fontSize: fontSize.xs, fontFamily: fontFamily.semibold, color: colors.textMuted },

  actionRow: {
    flexDirection: "row",
    gap: spacing.sm + 2,
    marginBottom: spacing.lg,
  },
  approveAllBtn: {
    flex: 2.35,
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
    ...shadow.button,
  },
  approveAllBtnPressed: {
    backgroundColor: colors.white,
  },
  approveAllContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  approveAllText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.white,
  },
  approveAllTextPressed: {
    color: colors.ink,
  },
  pendingCountBadge: {
    minWidth: 19,
    height: 19,
    paddingHorizontal: 4,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#75F1C5",
  },
  pendingCountBadgeText: {
    fontSize: 10,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },
  clearBtn: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    minHeight: 42,
  },
  clearBtnPressed: {
    backgroundColor: colors.error,
  },
  clearText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.error,
  },
  clearTextPressed: {
    color: colors.white,
  },
  clearContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  btnDisabled: { opacity: 0.5 },

  viewAllButton: {
    minHeight: 46,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.emerald,
    borderRadius: radius.md,
    backgroundColor: colors.white,
  },
  viewAllButtonPressed: { backgroundColor: colors.emeraldSoft, opacity: 0.82 },
  viewAllButtonText: { fontSize: fontSize.sm, fontFamily: fontFamily.bold, color: colors.emerald },

  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 5,
    padding: spacing.md,
    marginBottom: spacing.sm,
    // Android elevation can render a rectangular layer behind rounded
    // corners. Keep the soft shadow on iOS and use the clean border on
    // Android so the card silhouette stays properly rounded.
    ...(Platform.OS === "ios" ? shadow.card : {}),
  },
  cardPending: { borderLeftColor: "#D8DFDC" },
  cardAcknowledged: { borderLeftColor: colors.emerald },

  cardRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
  },

  reportIconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: "#E9ECEA",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  reportIconBoxPayment: { backgroundColor: "#CFF9EA" },
  bellCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  cardContent: { flex: 1 },

  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 4,
    gap: 5,
  },
  titleBlock: { flex: 1 },
  reportMetaRow: { flexDirection: "row", alignItems: "center", gap: 3, marginBottom: 2 },
  categoryPill: {
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: "#E7E9E8",
  },
  categoryPillPayment: { backgroundColor: "#BDF5DE" },
  categoryPillText: {
    fontSize: 8,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  metaDot: { fontSize: 10, color: colors.textSecondary },
  reportTitle: { fontSize: fontSize.sm, fontFamily: fontFamily.bold, color: colors.ink, lineHeight: 17 },
  categoryText: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  senderName: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.ink },
  timeText: { fontSize: 9, color: colors.textSecondary, fontFamily: fontFamily.regular },

  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.pill,
    flexShrink: 0,
  },
  statusPillPending: { backgroundColor: "#E4E6E5" },
  statusPillAcknowledged: { backgroundColor: "#CFF7E8" },
  statusPillText: { fontSize: 9, fontFamily: fontFamily.medium, color: colors.ink },
  statusPillTextAcknowledged: { color: colors.emerald },

  paymentDetailsBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
    backgroundColor: colors.mist,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    marginTop: 5,
  },
  paymentDetailColumn: { flex: 1 },
  paymentAmountColumn: { alignItems: "flex-end" },
  paymentDetailLabel: { fontSize: 8, fontFamily: fontFamily.regular, color: colors.textPrimary },
  paymentDetailValue: { fontSize: fontSize.xs, fontFamily: fontFamily.semibold, color: colors.ink, marginTop: 1 },
  paymentAmountValue: { fontSize: fontSize.md, fontFamily: fontFamily.extrabold, color: colors.emerald, marginTop: 1 },

  updateMessageBox: {
    backgroundColor: colors.mist,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    marginTop: 5,
  },
  updateMessageText: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
    color: colors.ink,
    lineHeight: 16,
  },

  messageText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    fontFamily: fontFamily.regular,
    lineHeight: 16,
    marginTop: 6,
  },

  statusLine: { fontSize: fontSize.sm, marginBottom: spacing.sm },
  statusLabel: { fontFamily: fontFamily.semibold, color: colors.ink },
  statusValue: { fontFamily: fontFamily.semibold },
  statusPending: { color: colors.warning },
  statusApproved: { color: colors.emerald },

  checkReportBtn: {
    alignSelf: "flex-end",
    backgroundColor: colors.ink,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "transparent",
  },
  checkReportBtnCentered: {
    alignSelf: "flex-end",
    marginTop: spacing.sm,
  },
  loadOlderButton: { alignSelf: "center" },
  checkReportBtnPressed: {
    backgroundColor: colors.white,
    borderColor: colors.emerald,
  },
  checkReportText: { fontSize: fontSize.xs, fontFamily: fontFamily.semibold, color: colors.white },
  checkReportTextPressed: { color: colors.emerald },
  viewDetailsContent: { flexDirection: "row", alignItems: "center", gap: spacing.sm },

  sectionTitle: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  resetActionsRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.sm,
    marginTop: 6,
  },
  resetActionBtn: {
    alignSelf: "stretch",
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: spacing.sm,
  },
  resetPrimaryActionBtn: {
    flex: 1.45,
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: "rgba(2, 31, 24, 0.58)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  confirmCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.white,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: "center",
    ...shadow.card,
  },
  confirmIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  confirmTitle: {
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    textAlign: "center",
  },
  confirmMessage: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    lineHeight: 20,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  confirmActions: {
    width: "100%",
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  confirmCancelBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: radius.md,
    backgroundColor: colors.mist,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmCancelBtnPressed: { opacity: 0.7 },
  confirmCancelText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
  },
  confirmPrimaryBtn: {
    flex: 1.55,
    minHeight: 46,
    borderRadius: radius.md,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmPrimaryBtnPressed: { opacity: 0.82 },
  confirmPrimaryText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.white,
  },
  resolveResetBtn: {
    alignSelf: "flex-start",
    backgroundColor: colors.mist,
    borderWidth: 1,
    borderColor: colors.emeraldSoft,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  resolveResetBtnPressed: {
    backgroundColor: colors.emerald,
    borderColor: colors.emerald,
  },
  resolveResetBtnText: { fontSize: fontSize.xs + 1, fontFamily: fontFamily.semibold, color: colors.emerald },
  resolveResetBtnTextPressed: { color: colors.white },

  empty: { alignItems: "center", paddingTop: 80 },
  emptyText: { fontSize: fontSize.base, color: colors.textSecondary, fontFamily: fontFamily.regular },
});

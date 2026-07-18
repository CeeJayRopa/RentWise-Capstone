import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  ScrollView,
  Image,
  TextInput,
  Animated,
  Easing,
  Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useEffect, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { ArrowLeft, ChevronDown, FileText, Search, X, HelpCircle } from "lucide-react-native";

import { db } from "../shared/services/firestore";
import { auth } from "../shared/firebaseConfig";
import { getTenantData } from "../services/tenantService";
import { MONTHS } from "../services/billingSchedule";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";
import ReceiptCardContent from "./components/ReceiptCardContent";
import HelpTour, { HelpStep } from "./components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../shared/services/onboardingTour";

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

export default function PaymentHistoryScreen() {
  const insets = useSafeAreaInsets();

  const [stall, setStall] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedMonth, setSelectedMonth] = useState(MONTHS[new Date().getMonth()]);
  const monthScrollRef = useRef<ScrollView>(null);
  const hasScrolledToMonth = useRef(false);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [showYearPicker, setShowYearPicker] = useState(false);
  const yearPillRef = useRef<View>(null);
  const [yearDropdownPos, setYearDropdownPos] = useState({ top: 0, right: 0, width: 0 });
  const YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const [focusTick, setFocusTick] = useState(0);

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<any>(null);

  const [tourVisible, setTourVisible] = useState(false);
  const helpRef = useRef<View>(null);
  const summaryRef = useRef<View>(null);
  const pickerRef = useRef<View>(null);
  const listRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Scrolls a given section into view and gives the ScrollView time to
  // settle before HelpTour measures it — otherwise a section below the
  // fold would measure to its stale, off-screen position, and its
  // spotlight would bleed past the visible screen edge.
  const scrollSectionIntoView = (targetRef: React.RefObject<View | null>) =>
    new Promise<void>((resolve) => {
      const scrollNode = scrollRef.current?.getNativeScrollRef?.();
      if (!scrollNode || !targetRef.current) { resolve(); return; }
      targetRef.current.measureLayout(
        scrollNode as any,
        (_x: number, y: number) => {
          scrollRef.current?.scrollTo({ y: Math.max(0, y - 100), animated: true });
          setTimeout(resolve, 400);
        },
        () => resolve(),
      );
    });

  const tourSteps: HelpStep[] = [
    { key: "help", ref: helpRef, title: "Help", description: "Come back here anytime for a guided tour of this page.", offsetY: 41, round: true },
    { key: "summary", ref: summaryRef, title: "Monthly total", description: "How much you've paid this month, and your progress toward the full month's charge.", offsetY: 41 },
    { key: "picker", ref: pickerRef, title: "Month & year", description: "Switch to a different month or year to see that period's transactions.", offsetY: 41, onBeforeMeasure: () => scrollSectionIntoView(pickerRef) },
    { key: "list", ref: listRef, title: "Transactions", description: "Every payment for the selected period. Tap a card with a receipt to view it.", offsetY: 41, onBeforeMeasure: () => scrollSectionIntoView(listRef), clipBottom: 40 },
  ];

  useFocusEffect(
    useCallback(() => {
      const user = auth.currentUser;
      if (!user) return;

      (async () => {
        const tenantData = await getTenantData(user.uid);
        if (tenantData?.stallId) {
          const stallSnap = await getDoc(doc(db, "stalls", tenantData.stallId));
          if (stallSnap.exists()) {
            setStall({ id: stallSnap.id, ...stallSnap.data() });
          }
        }
      })();

      const q = query(collection(db, "payments"), where("userId", "==", user.uid));
      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          setPayments(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
          setLoading(false);
        },
        (error) => {
          console.log("PAYMENTS LISTENER ERROR:", error);
          setLoading(false);
        },
      );

      // Bumps on every focus (fresh page open and every navigate-back-to
      // alike) so the progress-bar animation below replays each time, not
      // just the first time real data arrives.
      setFocusTick((t) => t + 1);

      return unsubscribe;
    }, [])
  );

  // Auto-opens the guided tour the first time the tenant ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    if (loading) return;
    (async () => {
      const seen = await hasSeenPageTour("tenant-payment-history");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("tenant-payment-history");
      }
    })();
  }, [loading]);

  function formatDate(date: any) {
    if (!date) return "-";
    const d = date.toDate ? date.toDate() : new Date(date);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  }

  function formatDateShort(date: any) {
    if (!date) return "-";
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }

  function openReceipt(payment: any) {
    setSelectedPayment(payment);
    setShowReceiptModal(true);
  }

  function openYearPicker() {
    yearPillRef.current?.measure((_x, _y, width, height, pageX, pageY) => {
      const screenWidth = Dimensions.get("window").width;
      setYearDropdownPos({ top: pageY + height + 6, right: screenWidth - (pageX + width), width });
      setShowYearPicker(true);
    });
  }

  const searching = searchQuery.trim().length > 0;

  const history = payments
    .filter((p) => p.status === "approved" || p.status === "pending")
    .filter((p) => {
      // Search looks across every month/year for this tenant; otherwise the
      // list stays scoped to whichever month + year is picked above.
      if (searching) return true;
      if (!p.date) return false;
      const d = p.date.toDate ? p.date.toDate() : new Date(p.date);
      return MONTHS[d.getMonth()] === selectedMonth && d.getFullYear() === selectedYear;
    })
    .filter((p) => {
      if (!searching) return true;
      const q = searchQuery.trim().toLowerCase();
      return (
        String(p.amount ?? "").includes(q) ||
        formatDate(p.date).toLowerCase().includes(q) ||
        String(p.paymentMethod ?? "").toLowerCase().includes(q)
      );
    })
    .sort(
      (a, b) =>
        new Date(b.date?.toDate ? b.date.toDate() : b.date).getTime() -
        new Date(a.date?.toDate ? a.date.toDate() : a.date).getTime(),
    );

  // Only confirmed payments count toward "Total paid" and the progress bar —
  // a pending payment isn't actually money received yet from the admin's
  // perspective, even though it already shows up in the list below.
  const totalAmount = history
    .filter((p) => p.status === "approved")
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  // "of ₱X" reference figure for the progress bar — the selected month's
  // full charge at the stall's current daily rate (pricing isn't tracked
  // historically, so this is always today's rate applied to that month's
  // day count).
  const periodRate = Number(stall?.price || 0);
  const monthIndex = MONTHS.indexOf(selectedMonth);
  const daysInSelectedMonth = new Date(selectedYear, monthIndex + 1, 0).getDate();
  const monthTotalCharge = periodRate * daysInSelectedMonth;
  const targetPercent =
    monthTotalCharge > 0 ? Math.max(0, Math.min(100, (totalAmount / monthTotalCharge) * 100)) : 0;

  // Resets to 0 and animates back up whenever the selected month/year (or
  // the underlying totals) change, instead of the fill just snapping
  // straight to the new percentage.
  useEffect(() => {
    Animated.sequence([
      Animated.timing(progressAnim, {
        toValue: 0,
        duration: 250,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(progressAnim, {
        toValue: targetPercent,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();
  }, [selectedMonth, selectedYear, targetPercent, focusTick]);

  function methodLabel(item: any): string {
    const m = String(item.paymentMethod ?? "");
    if (m.toLowerCase().includes("gcash") && !m.toLowerCase().includes("maya")) return "GCash";
    if (m.toLowerCase().includes("maya")) return "Maya";
    if (item.method === "online") return "Online";
    return "Cash";
  }

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[colors.emerald, colors.ink]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.headerGradient}
      >
        <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
          <View style={styles.headerLeftAnchor}>
            <TouchableOpacity style={styles.headerIconBtn} onPress={() => router.back()} hitSlop={8}>
              <ArrowLeft size={20} color={colors.white} />
            </TouchableOpacity>
          </View>
          <Text style={styles.headerTitle}>Payment History</Text>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => {
                setShowSearch((v) => !v);
                if (showSearch) setSearchQuery("");
              }}
              hitSlop={8}
            >
              {showSearch ? <X size={20} color={colors.white} /> : <Search size={20} color={colors.white} />}
            </TouchableOpacity>
            <View ref={helpRef} collapsable={false}>
              <TouchableOpacity style={styles.headerIconBtn} onPress={() => setTourVisible(true)} hitSlop={8}>
                <HelpCircle size={20} color={colors.white} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {showSearch ? (
          <View style={styles.searchRow}>
            <Search size={16} color={colors.emeraldSoft} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search by amount, date, or method"
              placeholderTextColor={colors.emeraldSoft}
              autoFocus
            />
          </View>
        ) : (
          <View style={styles.summaryBlock} ref={summaryRef} collapsable={false}>
            <Text style={styles.summaryLabel}>Total paid in {selectedMonth} {selectedYear}</Text>
            <Text style={styles.summaryAmount}>₱{totalAmount.toLocaleString()}</Text>

            <Text style={styles.summaryCount}>
              {monthTotalCharge > 0 ? `of ₱${monthTotalCharge.toLocaleString()} goal · ` : ""}
              {history.length} transaction{history.length !== 1 ? "s" : ""}
            </Text>

            {monthTotalCharge > 0 && (
              <>
                <View style={styles.progressTrack}>
                  <AnimatedLinearGradient
                    colors={[colors.goldSoft, colors.gold]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[
                      styles.progressFill,
                      {
                        width: progressAnim.interpolate({
                          inputRange: [0, 100],
                          outputRange: ["0%", "100%"],
                        }),
                      },
                    ]}
                  />
                </View>

                <View style={styles.progressLabelsRow}>
                  <Text style={[styles.progressLabelText, styles.progressLabelLeft]}>0</Text>
                  <Text style={[styles.progressLabelText, styles.progressLabelCenter]}>
                    {Math.round(targetPercent)}%
                  </Text>
                  <Text style={[styles.progressLabelText, styles.progressLabelRight]} numberOfLines={1}>
                    ₱{monthTotalCharge.toLocaleString()}
                  </Text>
                </View>
              </>
            )}
          </View>
        )}
      </LinearGradient>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.emerald} />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.body}
          contentContainerStyle={[styles.bodyContent, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          {!searching && (
            <View style={styles.pickerRow} ref={pickerRef} collapsable={false}>
              <View style={styles.monthScrollWrapper}>
                <ScrollView
                  ref={monthScrollRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.monthScrollContent}
                >
                  {MONTHS.map((m) => (
                    <TouchableOpacity
                      key={m}
                      style={[styles.monthChip, m === selectedMonth && styles.monthChipActive]}
                      onPress={() => setSelectedMonth(m)}
                      onLayout={(e) => {
                        // Scrolls the currently-selected month into view once,
                        // right after mount — otherwise the row always opens
                        // pinned to January regardless of which month is
                        // actually selected.
                        if (m === selectedMonth && !hasScrolledToMonth.current) {
                          hasScrolledToMonth.current = true;
                          const x = e.nativeEvent.layout.x;
                          monthScrollRef.current?.scrollTo({ x: Math.max(0, x - 110), animated: false });
                        }
                      }}
                    >
                      <Text style={[styles.monthChipText, m === selectedMonth && styles.monthChipTextActive]}>
                        {m.slice(0, 3)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View ref={yearPillRef} collapsable={false}>
                <TouchableOpacity
                  style={[styles.yearPill, showYearPicker && styles.yearPillOpen]}
                  onPress={openYearPicker}
                >
                  <Text style={styles.yearPillText}>{selectedYear}</Text>
                  <ChevronDown size={14} color={colors.emerald} />
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View ref={listRef} collapsable={false}>
          <Text style={styles.sectionHeaderTitle}>Transactions</Text>

          {history.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>
                {searching ? "No matching transactions" : `No payments for ${selectedMonth} ${selectedYear}`}
              </Text>
            </View>
          ) : (
            <>
              {history.map((item) => {
                const hasReceipt = !!(item.receiptData || item.receipt);
                const Row = hasReceipt ? TouchableOpacity : View;
                return (
                  <Row
                    key={item.id}
                    style={styles.txCard}
                    {...(hasReceipt ? { onPress: () => openReceipt(item), activeOpacity: 0.7 } : {})}
                  >
                    <View style={styles.rowIconCircle}>
                      <FileText size={18} color={colors.emerald} />
                    </View>

                    <View style={styles.rowInfo}>
                      <Text style={styles.rowAmount}>₱{Number(item.amount || 0).toLocaleString()}</Text>
                      <Text style={styles.rowDate}>
                        {formatDateShort(item.date)}
                        {item.receiptNo ? ` · #${item.receiptNo}` : ""}
                      </Text>
                    </View>

                    <View style={styles.rowRight}>
                      <View
                        style={[
                          styles.statusBadge,
                          item.status === "pending" ? styles.badgePending : styles.badgeApproved,
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusBadgeText,
                            item.status === "pending" ? styles.textPending : styles.textApproved,
                          ]}
                        >
                          {item.status === "pending" ? "PENDING" : "PAID"}
                        </Text>
                      </View>
                      <Text style={styles.rowMethod}>via {methodLabel(item)}</Text>
                    </View>
                  </Row>
                );
              })}

              {!searching && (
                <Text style={styles.endOfListText}>End of {selectedMonth} history</Text>
              )}
            </>
          )}
          </View>
        </ScrollView>
      )}

      {/* YEAR DROPDOWN */}
      <Modal visible={showYearPicker} transparent animationType="fade" statusBarTranslucent>
        <TouchableOpacity
          style={styles.yearOverlay}
          activeOpacity={1}
          onPress={() => setShowYearPicker(false)}
        >
          <View
            style={[
              styles.yearDropdown,
              { top: yearDropdownPos.top, right: yearDropdownPos.right, width: yearDropdownPos.width },
            ]}
          >
            {YEARS.map((y) => (
              <TouchableOpacity
                key={y}
                style={[styles.pickerItem, y === selectedYear && styles.pickerItemActive]}
                onPress={() => {
                  setSelectedYear(y);
                  setShowYearPicker(false);
                }}
              >
                <Text style={[styles.pickerItemText, y === selectedYear && styles.pickerItemTextActive]}>
                  {y}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* RECEIPT PREVIEW MODAL */}
      <Modal visible={showReceiptModal} transparent animationType="fade">
        <View style={styles.receiptOverlay}>
          <View style={styles.receiptPreviewCard}>
            <TouchableOpacity
              style={styles.receiptCloseX}
              onPress={() => {
                setShowReceiptModal(false);
                setSelectedPayment(null);
              }}
              hitSlop={8}
            >
              <X size={18} color={colors.textSecondary} />
            </TouchableOpacity>

            <ScrollView style={styles.receiptScrollArea} showsVerticalScrollIndicator={false}>
              {selectedPayment?.receiptData ? (
                <ReceiptCardContent data={selectedPayment.receiptData} stall={stall} />
              ) : selectedPayment?.receipt ? (
                <Image source={{ uri: selectedPayment.receipt }} style={styles.receiptImage} />
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <HelpTour
        visible={tourVisible}
        steps={tourSteps}
        onClose={() => {
          setTourVisible(false);
          // The tour auto-scrolls down to reach later steps — scroll back
          // to the top once it's done so the tenant isn't left mid-page.
          scrollRef.current?.scrollTo({ y: 0, animated: true });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.parchment,
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  headerGradient: {
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: "hidden",
    paddingBottom: spacing.xl,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },

  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },

  // Matches headerActions' rendered width (2 headerIconBtn + gap) so the
  // centered headerTitle balances against two equal-width anchors instead
  // of drifting toward whichever side is narrower.
  headerLeftAnchor: {
    width: 84,
  },

  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.14)",
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

  // ── Summary ──────────────────────────────────────
  summaryBlock: {
    paddingHorizontal: spacing.xl,
  },

  summaryLabel: {
    color: colors.emeraldSoft,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
  },

  summaryAmount: {
    color: colors.white,
    fontSize: fontSize.display,
    fontFamily: fontFamily.extrabold,
    marginTop: 2,
  },

  progressTrack: {
    alignSelf: "stretch",
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.2)",
    overflow: "hidden",
    marginTop: spacing.md,
  },

  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
  },

  progressLabelsRow: {
    flexDirection: "row",
    marginTop: spacing.xs + 2,
  },

  progressLabelText: {
    flex: 1,
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.emeraldSoft,
  },

  progressLabelLeft: {
    textAlign: "left",
  },

  progressLabelCenter: {
    textAlign: "center",
  },

  progressLabelRight: {
    textAlign: "right",
  },

  summaryCount: {
    color: colors.emeraldSoft,
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.regular,
    marginTop: spacing.sm,
  },

  // ── Search ───────────────────────────────────────
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },

  searchInput: {
    flex: 1,
    color: colors.white,
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    padding: 0,
  },

  // ── Body ─────────────────────────────────────────
  body: {
    flex: 1,
  },

  bodyContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },

  // ── Month / Year picker row ───────────────────────
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },

  monthScrollWrapper: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.xs + 2,
    ...shadow.card,
  },

  monthScrollContent: {
    gap: spacing.xs,
  },

  monthChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
  },

  monthChipActive: {
    backgroundColor: colors.emerald,
  },

  monthChipText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.textSecondary,
  },

  monthChipTextActive: {
    color: colors.white,
  },

  yearPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 2,
    ...shadow.card,
  },

  yearPillOpen: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },

  yearPillText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
  },

  yearOverlay: {
    flex: 1,
    backgroundColor: "transparent",
  },

  yearDropdown: {
    position: "absolute",
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    overflow: "hidden",
    ...shadow.raised,
  },

  // ── Section header ─────────────────────────────────
  sectionHeaderTitle: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginBottom: spacing.md,
  },

  // ── Transaction card ───────────────────────────────
  txCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    marginBottom: spacing.md,
    ...shadow.card,
  },

  rowIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },

  rowInfo: {
    flex: 1,
  },

  rowAmount: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  rowDate: {
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    marginTop: 2,
  },

  rowRight: {
    alignItems: "flex-end",
  },

  statusBadge: {
    alignSelf: "flex-end",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },

  badgeApproved: { backgroundColor: colors.successSoft },
  badgePending: { backgroundColor: colors.warningSoft },

  statusBadgeText: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
  },

  textApproved: { color: colors.emerald },
  textPending: { color: colors.warning },

  rowMethod: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
    color: colors.textMuted,
    marginTop: 4,
  },

  endOfListText: {
    textAlign: "center",
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.regular,
    color: colors.textMuted,
    marginTop: spacing.lg,
  },

  emptyRow: {
    paddingVertical: spacing.xxl,
    alignItems: "center",
  },

  emptyText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
  },

  // ── Year dropdown items ────────────────────────────
  pickerItem: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },

  pickerItemActive: {
    backgroundColor: colors.emeraldSoft,
  },

  pickerItemText: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.regular,
    color: colors.ink,
  },

  pickerItemTextActive: {
    color: colors.emerald,
    fontFamily: fontFamily.semibold,
  },

  // ── Receipt modal ────────────────────────────────
  receiptOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    padding: spacing.xxl + 1,
  },

  receiptPreviewCard: {
    backgroundColor: colors.white,
    padding: spacing.xl,
    paddingTop: spacing.xxl + 4,
    borderRadius: radius.lg,
    ...shadow.raised,
  },

  receiptCloseX: {
    position: "absolute",
    top: spacing.md,
    right: spacing.md,
    zIndex: 1,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.mist,
    alignItems: "center",
    justifyContent: "center",
  },

  receiptScrollArea: {
    maxHeight: 480,
  },

  receiptImage: {
    width: "100%",
    height: 350,
    resizeMode: "contain",
  },
});

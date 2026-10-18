import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Modal,
  ScrollView,
  FlatList,
  Image,
  TextInput,
  Animated,
  Easing,
  StatusBar,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { ArrowLeft, Search, X, HelpCircle, CalendarDays, Banknote } from "lucide-react-native";

import { db } from "../shared/services/firestore";
import { auth } from "../shared/firebaseConfig";
import { getTenantData } from "../services/tenantService";
import { MONTHS } from "../services/billingSchedule";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../shared/theme";
import ReceiptCardContent, { ReceiptActionsBar } from "./components/ReceiptCardContent";
import HelpTour, { HelpStep } from "./components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../shared/services/onboardingTour";

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);
const YEAR_ROW_HEIGHT = 30;
const YEAR_WHEEL_HEIGHT = 150;
const YEAR_CENTER_PADDING = (YEAR_WHEEL_HEIGHT - YEAR_ROW_HEIGHT) / 2;
const EARLIEST_YEAR = 1900;

export default function PaymentHistoryScreen() {
  const insets = useSafeAreaInsets();

  // The TENANT's own billing terms (price/paymentSchedule) -- these travel
  // with the tenant if they relocate, unlike the stall doc they used to be
  // read from (which stayed with whoever's occupying that physical space).
  const [billing, setBilling] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedMonth, setSelectedMonth] = useState(MONTHS[new Date().getMonth()]);
  const monthScrollRef = useRef<ScrollView>(null);
  const hasScrolledToMonth = useRef(false);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [draftYear, setDraftYear] = useState(new Date().getFullYear());
  const [showYearPicker, setShowYearPicker] = useState(false);
  const currentYear = new Date().getFullYear();
  const latestYear = currentYear + 20;
  const YEARS = Array.from({ length: latestYear - EARLIEST_YEAR + 1 }, (_, i) => latestYear - i);
  const yearListRef = useRef<FlatList<number>>(null);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const [focusTick, setFocusTick] = useState(0);

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<any>(null);

  const [tourVisible, setTourVisible] = useState(false);
  const helpRef = useRef<View>(null);
  const searchRef = useRef<View>(null);
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
    { key: "search", ref: searchRef, title: "Search", description: "Find a transaction by amount, date, or payment method.", edgeInset: "top", round: true },
    { key: "summary", ref: summaryRef, title: "Monthly total", description: "How much you've paid this month, and your progress toward the full month's charge.", edgeInset: "top", insetXPercent: 0.045 },
    { key: "picker", ref: pickerRef, title: "Month & year", description: "Switch to a different month or year to see that period's transactions.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(pickerRef) },
    { key: "list", ref: listRef, title: "Transactions", description: "Every payment for the selected period. Tap a card with a receipt to view it.", edgeInset: "top", onBeforeMeasure: () => scrollSectionIntoView(listRef), clipBottom: -25 },
  ];

  useFocusEffect(
    useCallback(() => {
      const user = auth.currentUser;
      if (!user) return;

      (async () => {
        const tenantData = await getTenantData(user.uid);
        if (tenantData) {
          setBilling({ price: (tenantData as any).price, paymentSchedule: (tenantData as any).paymentSchedule });
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
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }

  function openReceipt(payment: any) {
    setSelectedPayment(payment);
    setShowReceiptModal(true);
  }

  function openYearPicker() {
    setDraftYear(selectedYear);
    setShowYearPicker(true);
  }

  function centerYearInWheel(year: number, animated: boolean) {
    const index = YEARS.indexOf(year);
    if (index < 0) return;
    yearListRef.current?.scrollToOffset({ offset: index * YEAR_ROW_HEIGHT, animated });
  }

  const searching = searchQuery.trim().length > 0;

  const history = payments
    .filter((p) => p.status === "approved" || p.status === "pending")
    .filter((p) => {
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

  const selectedMonthHistory = history.filter((p) => {
    if (!p.date) return false;
    const d = p.date.toDate ? p.date.toDate() : new Date(p.date);
    return MONTHS[d.getMonth()] === selectedMonth && d.getFullYear() === selectedYear;
  });

  // Only confirmed payments count toward "Total paid" and the progress bar —
  // a pending payment isn't actually money received yet from the admin's
  // perspective, even though it already shows up in the list below.
  const totalAmount = selectedMonthHistory
    .filter((p) => p.status === "approved")
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  // "of ₱X" reference figure for the progress bar — the selected month's
  // full charge at the tenant's current daily rate (pricing isn't tracked
  // historically, so this is always today's rate applied to that month's
  // day count).
  const periodRate = Number(billing?.price || 0);
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
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
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
            <View ref={searchRef} collapsable={false}>
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
            </View>
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
        ) : null}
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
            <View ref={pickerRef} collapsable={false}>
              <View style={styles.archiveTopRow}>
                <View collapsable={false}>
                  <TouchableOpacity
                    style={[styles.yearPill, showYearPicker && styles.yearPillActive]}
                    onPress={openYearPicker}
                    activeOpacity={0.7}
                  >
                    <CalendarDays size={14} color={colors.emerald} />
                    <Text style={styles.yearPillText}>{selectedYear}</Text>
                  </TouchableOpacity>
                </View>
              </View>

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

              <View style={styles.summaryBlock} ref={summaryRef} collapsable={false}>
                <View style={styles.summaryHeadingRow}>
                  <Text style={styles.summaryLabel}>Total paid in {selectedMonth} {selectedYear}</Text>
                  <View style={styles.transactionCountBadge}>
                    <Text style={styles.transactionCountText}>
                      {selectedMonthHistory.length} transaction{selectedMonthHistory.length !== 1 ? "s" : ""}
                    </Text>
                  </View>
                </View>
                <Text style={styles.summaryAmount}>₱{totalAmount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>

                {monthTotalCharge > 0 && (
                  <>
                    <View style={styles.progressTrack}>
                      <AnimatedLinearGradient
                        colors={[colors.emeraldBright, colors.emerald]}
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
                    <View style={styles.progressSummaryRow}>
                      <Text style={styles.progressSettledText}>{Math.round(targetPercent)}% settled</Text>
                      <Text style={styles.progressTargetText}>Target: ₱{monthTotalCharge.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                    </View>
                  </>
                )}
              </View>
            </View>
          )}

          <View ref={listRef} collapsable={false}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeaderTitle}>Transactions</Text>
            <View style={styles.entriesBadge}>
              <Text style={styles.entriesBadgeText}>{history.length} entries recorded</Text>
            </View>
          </View>

          {history.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>
                {searching ? "No matching transactions" : `No payments for ${selectedMonth} ${selectedYear}`}
              </Text>
            </View>
          ) : (
            <>
              {history.map((item, index) => {
                const hasReceipt = !!(item.receiptData || item.receipt);
                const Row = hasReceipt ? TouchableOpacity : View;
                const itemDate = item.date?.toDate ? item.date.toDate() : new Date(item.date);
                const previous = index > 0 ? history[index - 1] : null;
                const previousDate = previous
                  ? (previous.date?.toDate ? previous.date.toDate() : new Date(previous.date))
                  : null;
                const startsMonth = !previousDate
                  || itemDate.getMonth() !== previousDate.getMonth()
                  || itemDate.getFullYear() !== previousDate.getFullYear();
                const monthPaymentCount = startsMonth
                  ? history.filter((payment) => {
                      const date = payment.date?.toDate ? payment.date.toDate() : new Date(payment.date);
                      return date.getMonth() === itemDate.getMonth() && date.getFullYear() === itemDate.getFullYear();
                    }).length
                  : 0;

                return (
                  <Fragment key={item.id}>
                    {startsMonth && (
                      <View style={styles.periodHeadingRow}>
                        <View style={styles.periodDot} />
                        <Text style={styles.periodHeadingText}>
                          {MONTHS[itemDate.getMonth()].toUpperCase()} {itemDate.getFullYear()}
                        </Text>
                        <Text style={styles.periodPaymentCount}>
                          · {monthPaymentCount} payment{monthPaymentCount !== 1 ? "s" : ""}
                        </Text>
                      </View>
                    )}
                    <Row
                      style={styles.txCard}
                      {...(hasReceipt ? { onPress: () => openReceipt(item), activeOpacity: 0.7 } : {})}
                    >
                      <View style={styles.txMainRow}>
                        <View style={[styles.rowIconCircle, methodLabel(item) === "Cash" && styles.cashIconCircle]}>
                          {methodLabel(item) === "GCash" ? (
                            <Image source={require("../assets/gcash.png")} style={styles.methodIconImage} resizeMode="cover" />
                          ) : methodLabel(item) === "Maya" ? (
                            <Image source={require("../assets/maya-icon.png")} style={styles.methodIconImage} resizeMode="contain" />
                          ) : (
                            <Banknote size={18} color={colors.emerald} />
                          )}
                        </View>
                        <View style={styles.rowInfo}>
                          <Text style={styles.rowMethodName}>{methodLabel(item)}</Text>
                          <Text style={styles.rowDate}>{formatDateShort(item.date)}</Text>
                        </View>
                        <View style={styles.rowRight}>
                          <Text style={styles.rowAmount}>₱{Number(item.amount || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
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
                        </View>
                      </View>
                      <View style={styles.referenceStrip}>
                        <Text style={styles.referenceText} numberOfLines={1}>
                          REF #{item.receiptNo || String(item.id).slice(-12).toUpperCase()}
                        </Text>
                        {hasReceipt && (
                          <View style={styles.copyBadge}>
                            <Text style={styles.copyBadgeText}>View receipt</Text>
                          </View>
                        )}
                      </View>
                    </Row>
                  </Fragment>
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
      <Modal
        visible={showYearPicker}
        transparent
        animationType="fade"
        statusBarTranslucent
        onShow={() => requestAnimationFrame(() => centerYearInWheel(selectedYear, false))}
      >
        <Pressable
          style={styles.yearOverlay}
          onPress={() => setShowYearPicker(false)}
        >
          <Pressable
            style={[styles.yearDropdown, { paddingBottom: Math.max(insets.bottom, 12) }]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.yearModalHeader}>
              <Text style={styles.yearModalTitle}>Select Year</Text>
              <TouchableOpacity
                style={styles.yearDoneButton}
                onPress={() => {
                  setSelectedYear(draftYear);
                  setShowYearPicker(false);
                }}
              >
                <Text style={styles.yearDoneText}>Done</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.yearWheelViewport}>
              <View pointerEvents="none" style={styles.yearSelectionHighlight} />
              <FlatList
                ref={yearListRef}
                data={YEARS}
                keyExtractor={(year) => String(year)}
                style={styles.yearList}
                showsVerticalScrollIndicator={false}
                snapToInterval={YEAR_ROW_HEIGHT}
                snapToAlignment="start"
                decelerationRate="fast"
                contentContainerStyle={styles.yearListContent}
                getItemLayout={(_data, index) => ({ length: YEAR_ROW_HEIGHT, offset: YEAR_ROW_HEIGHT * index, index })}
                onMomentumScrollEnd={(event) => {
                  const index = Math.max(0, Math.min(YEARS.length - 1, Math.round(event.nativeEvent.contentOffset.y / YEAR_ROW_HEIGHT)));
                  setDraftYear(YEARS[index]);
                }}
                renderItem={({ item: y }) => {
                  const distance = Math.abs(y - draftYear);
                  return (
                    <TouchableOpacity
                      style={styles.pickerItem}
                      onPress={() => {
                        setDraftYear(y);
                        centerYearInWheel(y, true);
                      }}
                    >
                      <Text
                        style={[
                          styles.pickerItemText,
                          y === draftYear && styles.pickerItemTextActive,
                          y !== draftYear && { opacity: distance === 1 ? 0.76 : distance === 2 ? 0.52 : 0.32 },
                        ]}
                      >
                        {y}
                      </Text>
                    </TouchableOpacity>
                  );
                }}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* RECEIPT PREVIEW MODAL */}
      <Modal visible={showReceiptModal} transparent animationType="fade">
        <View style={styles.receiptOverlay}>
          <View style={styles.receiptPreviewCard}>
            <ScrollView style={styles.receiptScrollArea} showsVerticalScrollIndicator={false}>
              {selectedPayment?.receiptData ? (
                <ReceiptCardContent data={selectedPayment.receiptData} billing={billing} showActions={false} />
              ) : selectedPayment?.receipt ? (
                <>
                  <Image source={{ uri: selectedPayment.receipt }} style={styles.receiptImage} />
                  <Pressable
                    style={({ pressed }) => [
                      styles.legacyReceiptCloseBtn,
                      pressed && styles.legacyReceiptCloseBtnPressed,
                    ]}
                    onPress={() => {
                      setShowReceiptModal(false);
                      setSelectedPayment(null);
                    }}
                  >
                    {({ pressed }) => (
                      <Text
                        style={[
                          styles.legacyReceiptCloseBtnText,
                          pressed && styles.legacyReceiptCloseBtnTextPressed,
                        ]}
                      >
                        Close
                      </Text>
                    )}
                  </Pressable>
                </>
              ) : null}
            </ScrollView>

            {/* Fixed footer -- outside the ScrollView so it stays visible
                at the bottom of the modal instead of scrolling away with
                the receipt content. */}
            {selectedPayment?.receiptData && (
              <ReceiptActionsBar
                data={selectedPayment.receiptData}
                billing={billing}
                onClose={() => {
                  setShowReceiptModal(false);
                  setSelectedPayment(null);
                }}
              />
            )}
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
    paddingBottom: spacing.sm,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    overflow: "hidden",
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
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
    width: 38,
  },

  headerIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },

  headerTitle: {
    flex: 1,
    textAlign: "left",
    color: colors.white,
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
  },

  // ── Summary ──────────────────────────────────────
  summaryBlock: {
    marginTop: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },

  summaryHeadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  summaryLabel: {
    color: colors.ink,
    fontSize: 10,
    fontFamily: fontFamily.semibold,
    textTransform: "uppercase",
    letterSpacing: 0.35,
  },

  summaryAmount: {
    color: colors.ink,
    fontSize: 28,
    fontFamily: fontFamily.extrabold,
    marginTop: 2,
  },

  progressTrack: {
    alignSelf: "stretch",
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: "#DCE6E1",
    overflow: "hidden",
    marginTop: spacing.md,
  },

  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
  },

  progressSummaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },

  progressSettledText: {
    color: colors.emerald,
    fontSize: fontSize.xs,
    fontFamily: fontFamily.bold,
  },

  progressTargetText: {
    color: colors.textSecondary,
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
  },

  transactionCountBadge: {
    backgroundColor: colors.mist,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },

  transactionCountText: {
    color: colors.ink,
    fontSize: 9,
    fontFamily: fontFamily.medium,
  },

  // ── Search ───────────────────────────────────────
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },

  searchInput: {
    flex: 1,
    color: colors.ink,
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
    paddingTop: spacing.md,
  },

  // ── Month / Year picker row ───────────────────────
  archiveTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    marginBottom: spacing.md,
  },

  monthScrollWrapper: {
    marginBottom: spacing.sm,
  },

  monthScrollContent: {
    flexGrow: 1,
    justifyContent: "space-between",
  },

  monthChip: {
    minWidth: 45,
    alignItems: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },

  monthChipActive: {
    backgroundColor: colors.emerald,
  },

  monthChipText: {
    fontSize: 10,
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
    backgroundColor: colors.mist,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "transparent",
  },

  // Shown while the dropdown is open -- gives the pill a "clicked in"
  // look (tinted fill + emerald border) instead of changing its shape.
  yearPillActive: {
    backgroundColor: colors.emeraldSoft,
    borderColor: colors.emerald,
  },

  yearPillText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
  },

  yearOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "flex-end",
  },

  yearDropdown: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 6,
    paddingHorizontal: spacing.md,
    overflow: "hidden",
    ...shadow.raised,
  },

  yearModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
    marginBottom: 2,
  },

  yearModalTitle: {
    color: colors.ink,
    fontSize: 20,
    fontFamily: fontFamily.extrabold,
  },

  yearDoneButton: {
    minWidth: 72,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.emerald,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.button,
  },

  yearDoneText: {
    color: colors.white,
    fontSize: fontSize.xs + 1,
    fontFamily: fontFamily.bold,
  },

  yearWheelViewport: {
    height: YEAR_WHEEL_HEIGHT,
    position: "relative",
    overflow: "hidden",
  },

  yearSelectionHighlight: {
    position: "absolute",
    zIndex: 0,
    top: YEAR_CENTER_PADDING,
    left: 0,
    right: 0,
    height: YEAR_ROW_HEIGHT,
    borderRadius: radius.md,
    backgroundColor: "#DCEFE7",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.emeraldBright,
  },

  yearList: {
    height: YEAR_WHEEL_HEIGHT,
    zIndex: 1,
  },

  yearListContent: {
    paddingVertical: YEAR_CENTER_PADDING,
  },

  // ── Section header ─────────────────────────────────
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },

  sectionHeaderTitle: {
    fontSize: fontSize.md,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  entriesBadge: {
    backgroundColor: colors.mist,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },

  entriesBadgeText: {
    color: colors.ink,
    fontSize: 9,
    fontFamily: fontFamily.medium,
  },

  periodHeadingRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },

  periodDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.emeraldBright,
    marginRight: 6,
  },

  periodHeadingText: {
    color: colors.ink,
    fontSize: 9,
    fontFamily: fontFamily.bold,
  },

  periodPaymentCount: {
    color: colors.textSecondary,
    fontSize: 9,
    fontFamily: fontFamily.regular,
  },

  // ── Transaction card ───────────────────────────────
  txCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: "rgba(15, 125, 91, 0.08)",
  },

  txMainRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
  },

  rowIconCircle: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.ink,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm + 2,
    overflow: "hidden",
  },

  cashIconCircle: {
    backgroundColor: colors.emeraldSoft,
  },

  methodIconImage: {
    width: "100%",
    height: "100%",
  },

  rowInfo: {
    flex: 1,
  },

  rowAmount: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  rowMethodName: {
    fontSize: fontSize.sm,
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
    paddingVertical: 2,
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

  referenceStrip: {
    flexBasis: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.mist,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    marginTop: spacing.sm,
  },

  referenceText: {
    flex: 1,
    color: colors.ink,
    fontSize: 8,
    fontFamily: fontFamily.semibold,
    letterSpacing: 0.3,
  },

  copyBadge: {
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },

  copyBadgeText: {
    color: colors.emerald,
    fontSize: 9,
    fontFamily: fontFamily.semibold,
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
    height: YEAR_ROW_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },

  pickerItemText: {
    fontSize: 15,
    fontFamily: fontFamily.regular,
    color: "#66756F",
  },

  pickerItemTextActive: {
    color: "#0B2B22",
    fontSize: 20,
    fontFamily: fontFamily.bold,
    opacity: 1,
  },

  // ── Receipt modal ────────────────────────────────
  receiptOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    padding: spacing.md,
  },

  receiptPreviewCard: {
    backgroundColor: colors.white,
    padding: spacing.md,
    paddingTop: spacing.lg,
    borderRadius: radius.lg,
    ...shadow.raised,
  },

  receiptScrollArea: {
    maxHeight: 560,
  },

  legacyReceiptCloseBtn: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    marginTop: spacing.xl,
  },

  legacyReceiptCloseBtnPressed: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },

  legacyReceiptCloseBtnText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.textSecondary,
  },

  legacyReceiptCloseBtnTextPressed: {
    color: colors.white,
  },

  receiptImage: {
    width: "100%",
    height: 350,
    resizeMode: "contain",
  },
});

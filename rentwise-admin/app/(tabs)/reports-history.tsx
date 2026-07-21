import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { House, HelpCircle, FileText } from "lucide-react-native";

import { auth } from "../../shared/services/auth";
import { db } from "../../shared/services/firestore";
import HelpTour, { HelpStep } from "../components/HelpTour";
import { hasSeenPageTour, markPageTourSeen } from "../../shared/services/onboardingTour";
import { Card, Badge, EmptyState } from "../../shared/components/ui";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";

type ReportDoc = {
  id: string;
  module?: string;
  type?: string;
  fieldChanged?: string;
  oldValue?: string;
  newValue?: string;
  spaceNo?: string;
  buildingNo?: string;
  tenantName?: string;
  approvalStatus?: string;
  createdAt?: any;
};

function reportTitle(r: ReportDoc): string {
  return r.type || r.module || "Report";
}

function reportDesc(r: ReportDoc): string {
  const detail =
    r.oldValue && r.newValue ? `${r.fieldChanged ? r.fieldChanged + ": " : ""}${r.oldValue} → ${r.newValue}` : (r.fieldChanged ?? null);
  const detailStr = detail && detail !== "undefined" ? detail : "—";
  if (r.spaceNo) return `Space ${r.spaceNo} — ${detailStr}`;
  if (r.tenantName) return `${r.tenantName} — ${detailStr}`;
  return detailStr;
}

function formatDate(ts: any): string {
  if (!ts) return "—";
  const d: Date = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });
}

function groupByDate(reports: ReportDoc[]): { date: string; items: ReportDoc[] }[] {
  const map = new Map<string, ReportDoc[]>();
  for (const r of reports) {
    const key = formatDate(r.createdAt);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return Array.from(map.entries()).map(([date, items]) => ({ date, items }));
}

function statusLabel(status?: string): string {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return "Pending";
}

function statusTone(status: string): "success" | "error" | "warning" {
  if (status === "Approved") return "success";
  if (status === "Rejected") return "error";
  return "warning";
}

export default function ReportsHistory() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reports, setReports] = useState<ReportDoc[]>([]);
  const [tourVisible, setTourVisible] = useState(false);
  const hasLoadedOnceRef = useRef(false);

  const homeRef = useRef<View>(null);
  const helpRef = useRef<View>(null);
  const summaryRef = useRef<View>(null);
  const listRef = useRef<View>(null);

  const fetchData = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    if (!hasLoadedOnceRef.current) setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "updates"), where("changedBy", "==", uid)),
      );
      const docs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as ReportDoc))
        .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      setReports(docs);
    } catch (err) {
      console.error("REPORTS HISTORY ERROR:", err);
    } finally {
      setLoading(false);
      hasLoadedOnceRef.current = true;
    }
  };

  useFocusEffect(
    useCallback(() => {
      const unsub = onAuthStateChanged(auth, (user) => {
        if (!user) {
          router.replace("/");
          return;
        }
        setChecking(false);
        fetchData();
      });
      return unsub;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // Auto-opens the guided tour the first time the admin ever lands on this
  // page — never again after that, since it flips a persisted per-device
  // flag. Can still be replayed anytime via the Help button.
  useEffect(() => {
    if (checking) return;
    (async () => {
      const seen = await hasSeenPageTour("reports-history");
      if (!seen) {
        setTourVisible(true);
        await markPageTourSeen("reports-history");
      }
    })();
  }, [checking]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  if (checking) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator color={colors.emerald} size="large" />
      </View>
    );
  }

  const groups = groupByDate(reports);

  const pendingCount = reports.filter((r) => statusLabel(r.approvalStatus) === "Pending").length;
  const weekAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const approvedThisWeekCount = reports.filter((r) => {
    if (statusLabel(r.approvalStatus) !== "Approved") return false;
    const ms = r.createdAt?.toDate?.()?.getTime?.();
    return typeof ms === "number" && ms >= weekAgoMs;
  }).length;

  const tourSteps: HelpStep[] = [
    { key: "home", ref: homeRef, title: "Home", description: "Takes you back to the dashboard.", edgeInset: "top", round: true },
    { key: "summary", ref: summaryRef, title: "Pending / Approved", description: "How many of your submitted reports are still pending the owner's review, and how many were approved this week.", edgeInset: "top", insetXPercent: 0.03, heightTrimPercent: 0.108, nudgeYPercent: 0.018 },
    { key: "list", ref: listRef, title: "Report history", description: "Every update report you've submitted to the owner, grouped by date, with its current approval status.", edgeInset: "top", clipBottom: 15, nudgeYPercent: 0.05 },
  ];

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
          <View ref={homeRef} collapsable={false}>
            <TouchableOpacity onPress={() => router.push("/dashboard")} activeOpacity={0.7} style={styles.headerIconBtn}>
              <House size={24} color={colors.emeraldSoft} />
            </TouchableOpacity>
          </View>
          <Text style={styles.headerTitle}>RentWise</Text>
          <View ref={helpRef} collapsable={false}>
            <TouchableOpacity onPress={() => setTourVisible(true)} activeOpacity={0.7} style={styles.headerIconBtn}>
              <HelpCircle size={22} color={colors.emeraldSoft} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Sub-header */}
        <View style={styles.subHeader}>
          <Text style={styles.pageTitle}>Reports History</Text>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{reports.length} Reports</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.summaryRow} ref={summaryRef} collapsable={false}>
        <View style={[styles.summaryCard, styles.summaryCardPending]}>
          <Text style={styles.summaryLabelPending}>Pending</Text>
          <Text style={styles.summaryValuePending}>{pendingCount}</Text>
        </View>
        <View style={[styles.summaryCard, styles.summaryCardApproved]}>
          <Text style={styles.summaryLabelApproved}>Approved this week</Text>
          <Text style={styles.summaryValueApproved}>{approvedThisWeekCount}</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.emerald} size="large" style={styles.loader} />
      ) : reports.length === 0 ? (
        <EmptyState
          icon={<FileText size={28} color={colors.textMuted} />}
          title="No reports sent yet."
        />
      ) : (
        <View style={{ flex: 1 }} ref={listRef} collapsable={false}>
        <FlatList
          data={groups}
          keyExtractor={(item) => item.date}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.emerald} />}
          renderItem={({ item: group }) => (
            <View>
              <Text style={styles.groupDate}>{group.date}</Text>
              {group.items.map((r) => {
                const status = statusLabel(r.approvalStatus);
                return (
                  <Card key={r.id} style={styles.reportCard}>
                    <View style={styles.reportRow}>
                      <View style={styles.cardIcon}>
                        <FileText size={16} color={colors.emerald} />
                      </View>
                      <Text style={styles.reportTitle} numberOfLines={1}>
                        {reportTitle(r)}
                      </Text>
                      <Badge label={status} tone={statusTone(status)} />
                    </View>
                    <Text style={styles.reportDesc} numberOfLines={1}>
                      {reportDesc(r)}
                    </Text>
                  </Card>
                );
              })}
            </View>
          )}
        />
        </View>
      )}

      <HelpTour visible={tourVisible} steps={tourSteps} onClose={() => setTourVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.parchment },
  fullCenter: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.parchment },

  headerGradient: {
    borderBottomLeftRadius: radius.xl + 4,
    borderBottomRightRadius: radius.xl + 4,
    overflow: "hidden",
  },

  header: {
    paddingBottom: spacing.md + 2,
    paddingHorizontal: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.lg,
    fontFamily: fontFamily.bold,
    color: colors.white,
    textAlign: "center",
  },
  subHeader: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pageTitle: { fontSize: fontSize.md, fontFamily: fontFamily.semibold, color: colors.white },
  countPill: {
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  countPillText: { fontSize: fontSize.xs + 1, fontFamily: fontFamily.semibold, color: colors.emeraldSoft },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
  },

  loader: { marginTop: 60 },

  list: { paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: 20 },

  summaryRow: {
    flexDirection: "row",
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  summaryCard: {
    flex: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg - 2,
  },
  summaryCardPending: { backgroundColor: colors.emerald },
  summaryCardApproved: { backgroundColor: colors.emeraldSoft },
  summaryLabelPending: {
    fontSize: fontSize.xs - 1,
    fontFamily: fontFamily.semibold,
    color: colors.emeraldSoft,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryLabelApproved: {
    fontSize: fontSize.xs - 1,
    fontFamily: fontFamily.semibold,
    color: colors.emerald,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryValuePending: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.extrabold,
    color: colors.white,
    marginTop: 2,
  },
  summaryValueApproved: {
    fontSize: fontSize.xl,
    fontFamily: fontFamily.extrabold,
    color: colors.emerald,
    marginTop: 2,
  },

  groupDate: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },

  reportCard: {
    marginBottom: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reportRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
  },
  cardIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.emeraldSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  reportTitle: { flex: 1, fontSize: fontSize.sm, fontFamily: fontFamily.semibold, color: colors.textPrimary },
  reportDesc: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginLeft: 34 + spacing.sm + 2,
    fontFamily: fontFamily.regular,
  },
});

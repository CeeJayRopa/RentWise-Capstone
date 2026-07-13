import { View, Text, Image, StyleSheet, TouchableOpacity, Share, Alert } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Check, Clock, XCircle, Share2, Download } from "lucide-react-native";
import { computePeriodCharge, consecutivePeriodsEnding, periodLabel } from "../../services/billingSchedule";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";

type BreakdownLine = { label: string; amount: number };

function statusInfo(rawStatus: string) {
  const s = String(rawStatus || "").toLowerCase();
  if (s === "approved" || s === "paid") {
    return {
      kind: "approved" as const,
      icon: Check,
      iconColor: colors.emerald,
      iconBg: colors.emeraldSoft,
      totalLabel: "TOTAL PAID",
      pillLabel: "TRANSACTION SUCCESSFUL",
      pillBg: colors.successSoft,
      pillColor: colors.emerald,
      statusText: "PAID",
    };
  }
  if (s === "rejected") {
    return {
      kind: "rejected" as const,
      icon: XCircle,
      iconColor: colors.error,
      iconBg: colors.errorSoft,
      totalLabel: "AMOUNT REJECTED",
      pillLabel: "TRANSACTION REJECTED",
      pillBg: colors.errorSoft,
      pillColor: colors.error,
      statusText: "REJECTED",
    };
  }
  return {
    kind: "pending" as const,
    icon: Clock,
    iconColor: colors.warning,
    iconBg: colors.warningSoft,
    totalLabel: "AMOUNT PENDING",
    pillLabel: "TRANSACTION PENDING",
    pillBg: colors.warningSoft,
    pillColor: colors.warning,
    statusText: "PENDING",
  };
}

type MethodBadge =
  | { image: number; dark?: boolean }
  | { initial: string; color: string };

function methodBadge(method: string): MethodBadge {
  const m = String(method || "").toLowerCase();
  if (m.includes("gcash")) return { image: require("../../assets/gcash.png") };
  if (m.includes("maya")) return { image: require("../../assets/maya-icon.png"), dark: true };
  return { initial: "C", color: colors.textMuted };
}

// Older receipts (and admin-recorded cash payments) never got a `breakdown`
// array — they only stored the lump `rentAmount`. Reconstructs the same
// itemized, date-listed breakdown for those by working out how many
// consecutive periods that lump sum actually represents (rentAmount ÷ one
// period's charge) and listing each one ending on the receipt's date.
function synthesizeBreakdown(data: any, stall: any): BreakdownLine[] {
  const schedule = stall?.paymentSchedule;
  const dailyRate = Number(stall?.price || 0);
  const rentAmount = Number(data.rentAmount || 0);
  if (!schedule || dailyRate <= 0 || rentAmount <= 0) return [];

  const receiptDate = data.date ? new Date(data.date) : new Date();
  const onePeriodCharge = computePeriodCharge(dailyRate, schedule, receiptDate);
  if (onePeriodCharge <= 0) return [];

  const periodsCount = Math.max(1, Math.round(rentAmount / onePeriodCharge));
  return consecutivePeriodsEnding(dailyRate, schedule, receiptDate, periodsCount).map((p) => ({
    label: periodLabel(schedule, p.date),
    amount: p.amount,
  }));
}

function buildShareText(data: any, breakdown: BreakdownLine[], amountPaid: number) {
  const lines = [
    "RentWise Payment Receipt",
    `Reference ID: #${data.receiptNo ?? ""}`,
    `Date: ${data.date ? new Date(data.date).toLocaleString() : ""}`,
    `Method: ${data.paymentMethod ?? ""}`,
    `Status: ${data.status ?? ""}`,
    "",
  ];
  if (breakdown.length > 0) {
    lines.push("Breakdown:");
    breakdown.forEach((b) => lines.push(`  ${b.label} — ₱${b.amount.toLocaleString()}`));
    lines.push("");
  }
  lines.push(`Total: ₱${amountPaid.toLocaleString()}`);
  if (data.change > 0) {
    lines.push(`Cash Tendered: ₱${Number(data.payment ?? 0).toLocaleString()}`);
    lines.push(`Change: ₱${Number(data.change).toLocaleString()}`);
  }
  return lines.join("\n");
}

function buildReceiptHtml(data: any, breakdown: BreakdownLine[], amountPaid: number) {
  const rows = breakdown
    .map(
      (b) =>
        `<tr><td style="padding:4px 0;color:#5B6B63;">${b.label}</td><td style="padding:4px 0;text-align:right;">₱${b.amount.toLocaleString()}</td></tr>`,
    )
    .join("");
  return `
    <html>
      <body style="font-family:Arial;padding:32px;color:#0B2B22;">
        <h1 style="text-align:center;margin-bottom:0;">RentWise</h1>
        <p style="text-align:center;color:#5B6B63;margin-top:4px;">Payment Receipt</p>
        <hr />
        <p><b>Reference ID:</b> #${data.receiptNo ?? ""}</p>
        <p><b>Tenant Name:</b> ${data.tenantName ?? ""}</p>
        <p><b>Building No.:</b> ${data.buildingNumber ?? ""}</p>
        <p><b>Space ID:</b> ${data.spaceId ?? ""}</p>
        <p><b>Payment Date:</b> ${data.date ? new Date(data.date).toLocaleString() : ""}</p>
        <p><b>Payment Method:</b> ${data.paymentMethod ?? ""}</p>
        <p><b>Status:</b> ${data.status ?? ""}</p>
        ${
          data.change > 0
            ? `<p><b>Cash Tendered:</b> ₱${Number(data.payment ?? 0).toLocaleString()}</p><p><b>Change:</b> ₱${Number(data.change).toLocaleString()}</p>`
            : ""
        }
        <hr />
        ${
          breakdown.length > 0
            ? `<h3>Breakdown</h3><table style="width:100%;border-collapse:collapse;">${rows}</table><hr />`
            : ""
        }
        <p style="font-size:18px;"><b>Total Paid: ₱${amountPaid.toLocaleString()}</b></p>
      </body>
    </html>
  `;
}

export default function ReceiptCardContent({
  data,
  stall,
  showActions = true,
}: {
  data: any;
  stall?: any;
  showActions?: boolean;
}) {
  const receiptDate = data.date ? new Date(data.date) : new Date();

  const breakdown: BreakdownLine[] =
    Array.isArray(data.breakdown) && data.breakdown.length > 0
      ? data.breakdown
      : synthesizeBreakdown(data, stall);

  const info = statusInfo(data.status);
  const Icon = info.icon;
  const badge = methodBadge(data.paymentMethod);

  // For cash payments, `data.payment` is what the tenant physically handed
  // over — it includes change owed back, which was never actually applied
  // toward rent. The real amount paid is that minus the change.
  const amountPaid = Number(data.payment ?? 0) - Number(data.change ?? 0);

  async function handleShare() {
    try {
      await Share.share({ message: buildShareText(data, breakdown, amountPaid) });
    } catch (err) {
      console.log("[receipt share] error:", err);
    }
  }

  async function handleDownloadPdf() {
    try {
      const { uri } = await Print.printToFileAsync({ html: buildReceiptHtml(data, breakdown, amountPaid) });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: "application/pdf",
          dialogTitle: "RentWise Receipt",
        });
      } else {
        Alert.alert("Saved", "PDF generated, but sharing isn't available on this device.");
      }
    } catch (err) {
      console.log("[receipt pdf] error:", err);
      Alert.alert("Error", "Couldn't generate the PDF. Please try again.");
    }
  }

  return (
    <View style={styles.root}>
      <View style={[styles.statusIconCircle, { backgroundColor: info.iconBg }]}>
        <Icon size={26} color={info.iconColor} />
      </View>

      <Text style={styles.totalLabel}>{info.totalLabel}</Text>
      <Text style={styles.totalAmount}>₱{amountPaid.toLocaleString()}.00</Text>

      <View style={[styles.pill, { backgroundColor: info.pillBg }]}>
        <Text style={[styles.pillText, { color: info.pillColor }]}>{info.pillLabel}</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.detailRows}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Reference ID</Text>
          <Text style={styles.detailValue}>#{data.receiptNo}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Payment Date</Text>
          <Text style={[styles.detailValue, styles.detailValueAccent]}>
            {receiptDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            {" • "}
            {receiptDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Payment Method</Text>
          <View style={styles.methodValueRow}>
            <View
              style={[
                styles.methodBadge,
                "image" in badge ? (badge.dark ? styles.methodBadgeDark : null) : { backgroundColor: badge.color },
              ]}
            >
              {"image" in badge ? (
                <Image
                  source={badge.image}
                  style={styles.methodBadgeImage}
                  resizeMode={badge.dark ? "contain" : "cover"}
                />
              ) : (
                <Text style={styles.methodBadgeText}>{badge.initial}</Text>
              )}
            </View>
            <Text style={styles.detailValue}>{data.paymentMethod || "—"}</Text>
          </View>
        </View>
        <View style={data.change > 0 ? styles.detailRow : [styles.detailRow, { borderBottomWidth: 0 }]}>
          <Text style={styles.detailLabel}>Status</Text>
          <Text style={[styles.detailValue, { color: info.pillColor }]}>{info.statusText}</Text>
        </View>
        {data.change > 0 && (
          <>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Cash Tendered</Text>
              <Text style={styles.detailValue}>₱{Number(data.payment ?? 0).toLocaleString()}</Text>
            </View>
            <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.detailLabel}>Change</Text>
              <Text style={styles.detailValue}>₱{Number(data.change).toLocaleString()}</Text>
            </View>
          </>
        )}
      </View>

      {breakdown.length > 0 && (
        <>
          <View style={styles.divider} />
          <View style={styles.breakdownSection}>
            <Text style={styles.breakdownTitle}>Breakdown</Text>

            {breakdown.map((line, i) => (
              <View key={i} style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>{line.label}</Text>
                <Text style={styles.breakdownValue}>₱{line.amount.toLocaleString()}</Text>
              </View>
            ))}

            <View style={styles.breakdownDivider} />

            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownTotalLabel}>Total</Text>
              <Text style={styles.breakdownTotalValue}>₱{amountPaid.toLocaleString()}</Text>
            </View>
          </View>
        </>
      )}

      {showActions && (
        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.7}>
            <Share2 size={16} color={colors.textSecondary} />
            <Text style={styles.shareBtnText}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.pdfBtn} onPress={handleDownloadPdf} activeOpacity={0.7}>
            <Download size={16} color={colors.white} />
            <Text style={styles.pdfBtnText}>PDF</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: "100%",
    alignItems: "center",
  },

  statusIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },

  totalLabel: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.6,
  },

  totalAmount: {
    fontSize: fontSize.display,
    fontFamily: fontFamily.extrabold,
    color: colors.ink,
    marginTop: 4,
  },

  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    marginTop: spacing.sm,
  },

  pillText: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.bold,
    letterSpacing: 0.3,
  },

  divider: {
    width: "100%",
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.lg,
  },

  detailRows: {
    width: "100%",
  },

  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },

  detailLabel: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
  },

  detailValue: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
    flexShrink: 1,
    textAlign: "right",
  },

  detailValueAccent: {
    color: colors.warning,
  },

  methodValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  methodBadge: {
    width: 18,
    height: 18,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },

  methodBadgeDark: {
    backgroundColor: "#000000",
  },

  methodBadgeImage: {
    width: "100%",
    height: "100%",
  },

  methodBadgeText: {
    color: colors.white,
    fontSize: 10,
    fontFamily: fontFamily.extrabold,
  },

  breakdownSection: {
    width: "100%",
  },

  breakdownTitle: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
    marginBottom: spacing.sm,
  },

  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
  },

  breakdownLabel: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.medium,
    color: colors.emeraldBright,
    flexShrink: 1,
    paddingRight: spacing.sm,
  },

  breakdownValue: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.emeraldBright,
  },

  breakdownDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },

  breakdownTotalLabel: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.ink,
  },

  breakdownTotalValue: {
    fontSize: fontSize.base,
    fontFamily: fontFamily.bold,
    color: colors.emerald,
  },

  actionsRow: {
    flexDirection: "row",
    width: "100%",
    gap: spacing.md,
    marginTop: spacing.xl,
  },

  shareBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: spacing.md,
  },

  shareBtnText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.textSecondary,
  },

  pdfBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.emerald,
    paddingVertical: spacing.md,
    ...shadow.button,
  },

  pdfBtnText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.bold,
    color: colors.white,
  },
});

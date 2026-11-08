import { View, Text, Image, StyleSheet, Pressable, Alert, Platform } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import { Check, Clock, XCircle, Download, Copy } from "lucide-react-native";
import { colors, fontFamily, fontSize, radius, spacing, shadow } from "../../shared/theme";
import {
  getSavedReceiptDirectory,
  requestReceiptDirectoryAccess,
  saveBase64PdfToReceiptDirectory,
} from "../../shared/services/receiptStorage";

type BreakdownLine = { label: string; amount: number };

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function statusInfo(rawStatus: string) {
  const s = String(rawStatus || "").toLowerCase();
  if (s === "approved" || s === "paid") {
    return {
      kind: "approved" as const,
      icon: Check,
      iconColor: colors.emerald,
      iconBg: colors.emeraldSoft,
      totalLabel: "TOTAL PAID",
      pillLabel: "Transaction Successful",
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
      pillLabel: "Transaction Rejected",
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
    pillLabel: "Transaction Pending",
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
  if (m.includes("qrph") || m.includes("qr ph")) return { initial: "QR", color: colors.emerald };
  if (m.includes("gcash")) return { image: require("../../assets/gcash.png") };
  if (m.includes("maya")) return { image: require("../../assets/maya-icon.png"), dark: true };
  return { initial: "C", color: colors.textMuted };
}

function finiteMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

// New cash receipts store the rent applied in `payment` and the cash handed
// over in `cashReceived`. Legacy admin receipts stored tendered cash in
// `payment`. Supporting both shapes also keeps historical receipts correct.
function getReceiptAmounts(data: any): { amountPaid: number; cashTendered: number | null; change: number } {
  const change = Math.max(0, finiteMoney(data?.change) ?? 0);
  const explicitPaid = finiteMoney(data?.amountPaid ?? data?.amount);
  const payment = finiteMoney(data?.payment);
  const explicitTendered = finiteMoney(data?.cashTendered ?? data?.cashReceived);

  if (explicitTendered !== null) {
    return {
      amountPaid: Math.max(0, finiteMoney(data?.amountPaid) ?? explicitTendered - change),
      cashTendered: explicitTendered,
      change,
    };
  }
  if (change > 0 && payment !== null && payment > change) {
    return { amountPaid: Math.max(0, payment - change), cashTendered: payment, change };
  }
  return {
    amountPaid: Math.max(0, explicitPaid ?? payment ?? finiteMoney(data?.rentAmount) ?? 0),
    cashTendered: null,
    change,
  };
}

// Older receipts (and admin-recorded cash payments) never got a `breakdown`
// array — they only stored the lump `rentAmount`. Reconstructs the same
// itemized, date-listed breakdown for those by working out how many
// consecutive periods that lump sum actually represents (rentAmount ÷ one
// period's charge) and listing each one ending on the receipt's date.
function synthesizeBreakdown(data: any, _billing: any): BreakdownLine[] {
  const { amountPaid } = getReceiptAmounts(data);
  if (!Number.isFinite(amountPaid) || amountPaid <= 0) return [];
  return [{
    label: "Legacy payment — itemized coverage unavailable",
    amount: amountPaid,
  }];
}

function completeBreakdown(data: any, billing: any, amountPaid: number): BreakdownLine[] {
  const stored: BreakdownLine[] = Array.isArray(data?.breakdown)
    ? data.breakdown.filter((line: any) => line && typeof line.label === "string" && Number.isFinite(Number(line.amount)))
      .map((line: any) => ({label: line.label, amount: Math.max(0, Number(line.amount))}))
    : [];
  const storedTotal = stored.reduce((sum, line) => sum + line.amount, 0);
  if (stored.length > 0 && Math.abs(storedTotal - amountPaid) < 0.01) return stored;

  const periods = Math.max(0, Math.round(Number(data?.periodsCovered ?? 0)));
  const schedule = String(data?.paymentSchedule ?? billing?.paymentSchedule ?? "daily").toLowerCase();
  if (periods > 0 && amountPaid > 0) {
    const perPeriod = amountPaid / periods;
    if (Number.isFinite(perPeriod) && perPeriod > 0) {
      const label = schedule === "daily" ? "Daily rent coverage" : `${schedule} rent coverage`;
      return Array.from({length: periods}, (_, index) => ({
        label: periods === 1 ? label : `${label} ${index + 1} of ${periods}`,
        amount: perPeriod,
      }));
    }
  }
  if (stored.length > 0 && amountPaid > storedTotal) {
    return [...stored, {label: "Additional rent coverage", amount: amountPaid - storedTotal}];
  }
  return synthesizeBreakdown(data, billing);
}

function buildReceiptHtml(data: any, breakdown: BreakdownLine[], amountPaid: number) {
  const { cashTendered, change } = getReceiptAmounts(data);
  const stalls = Array.isArray(data.stalls) && data.stalls.length > 0 ? data.stalls : [];
  const premises = stalls.length > 0
    ? stalls.map((item: any) => `Building ${escapeHtml(item.buildingNumber)} · Space ${escapeHtml(item.spaceId)}`).join("<br/>")
    : `Building ${escapeHtml(data.buildingNumber)} · Space ${escapeHtml(data.spaceId)}`;
  const rows = breakdown
    .map(
      (b) =>
        `<tr><td style="padding:4px 0;color:#5B6B63;">${escapeHtml(b.label)}</td><td style="padding:4px 0;text-align:right;">₱${b.amount.toLocaleString()}</td></tr>`,
    )
    .join("");
  return `
    <html>
      <body style="font-family:Arial;padding:32px;color:#0B2B22;">
        <h1 style="text-align:center;margin-bottom:0;">RentWise</h1>
        <p style="text-align:center;color:#5B6B63;margin-top:4px;">Payment Receipt</p>
        <hr />
        <p><b>Reference ID:</b> #${escapeHtml(data.receiptNo)}</p>
        <p><b>Tenant Name:</b> ${escapeHtml(data.tenantName)}</p>
        <p><b>Stalls Covered:</b><br/>${premises}</p>
        <p><b>Payment Date:</b> ${escapeHtml(data.date ? new Date(data.date).toLocaleString() : "")}</p>
        <p><b>Payment Method:</b> ${escapeHtml(data.paymentMethod)}</p>
        <p><b>Status:</b> ${escapeHtml(data.status)}</p>
        ${
          change > 0 && cashTendered !== null
            ? `<p><b>Cash Tendered:</b> ₱${cashTendered.toLocaleString()}</p><p><b>Change:</b> ₱${change.toLocaleString()}</p>`
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

async function downloadPdfOnAndroid(sourceUri: string, fileName: string) {
  const base64 = await FileSystem.readAsStringAsync(sourceUri, { encoding: FileSystem.EncodingType.Base64 });
  const saved = await saveBase64PdfToReceiptDirectory(base64, fileName);
  if (!saved) {
    Alert.alert("Folder needed", "Choose a folder to save receipt soft copies.");
    return;
  }

  Alert.alert("Downloaded", "Receipt saved to your chosen folder.");
}

async function confirmReceiptFolderAccess(): Promise<boolean> {
  if (await getSavedReceiptDirectory()) return true;

  const allowed = await new Promise<boolean>((resolve) => {
    Alert.alert(
      "Allow receipt storage?",
      "RentWise needs access to a folder you choose so it can save your receipt soft copies. RentWise can only access the folder you select.",
      [
        { text: "Not now", style: "cancel", onPress: () => resolve(false) },
        { text: "Choose folder", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
  if (!allowed) return false;

  return Boolean(await requestReceiptDirectoryAccess());
}

// Shared by the receipt content and the standalone action bar below, so a
// caller can render the buttons OUTSIDE a ScrollView (fixed at the bottom
// of a modal) while the content itself scrolls independently.
function useReceiptDerived(data: any, billing: any) {
  const { amountPaid } = getReceiptAmounts(data);
  const breakdown = completeBreakdown(data, billing, amountPaid);

  async function handleDownloadPdf() {
    try {
      if (Platform.OS === "android" && !(await confirmReceiptFolderAccess())) return;

      const receiptData = Array.isArray(data.stalls) && data.stalls.length > 0
        ? data
        : {...data, stalls: Array.isArray(billing?.stalls) ? billing.stalls : []};
      const { uri } = await Print.printToFileAsync({ html: buildReceiptHtml(receiptData, breakdown, amountPaid) });
      const safeReceiptNo = String(data.receiptNo ?? Date.now()).replace(/[^a-zA-Z0-9_-]/g, "-");
      const fileName = `RentWise-Receipt-${safeReceiptNo}.pdf`;

      if (Platform.OS === "android") {
        // Android has no "Downloads" folder write access without the user
        // picking a directory via the Storage Access Framework -- this
        // actually writes the PDF to disk (a real download), instead of
        // just handing the file off to another app via the share sheet.
        await downloadPdfOnAndroid(uri, fileName);
      } else {
        // iOS has no equivalent direct-write API for a user-visible folder;
        // the share sheet's "Save to Files" is the standard way to save a
        // document to the device there.
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            mimeType: "application/pdf",
            dialogTitle: "RentWise Receipt",
          });
        } else {
          Alert.alert("Saved", "PDF generated, but sharing isn't available on this device.");
        }
      }
    } catch (err) {
      console.log("[receipt pdf] error:", err);
      Alert.alert("Error", "Couldn't generate the PDF. Please try again.");
    }
  }

  return { breakdown, amountPaid, handleDownloadPdf };
}

// Standalone Close/PDF action bar -- render this as a sibling AFTER a
// ScrollView wrapping <ReceiptCardContent showActions={false} .../> so the
// buttons stay fixed at the bottom of the modal instead of scrolling away
// with the receipt content.
export function ReceiptActionsBar({
  data,
  billing,
  onClose,
}: {
  data: any;
  billing?: any;
  onClose?: () => void;
}) {
  const { handleDownloadPdf } = useReceiptDerived(data, billing);

  return (
    <View style={styles.actionsRow}>
      <Pressable
        style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
        onPress={onClose}
      >
        {({ pressed }) => (
          <Text style={[styles.closeBtnText, pressed && styles.closeBtnTextPressed]}>Close</Text>
        )}
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.pdfBtn, pressed && styles.pdfBtnPressed]}
        onPress={handleDownloadPdf}
      >
        {({ pressed }) => (
          <>
            <Download size={16} color={pressed ? colors.emerald : colors.white} />
            <Text style={[styles.pdfBtnText, pressed && styles.pdfBtnTextPressed]}>Download PDF</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

export default function ReceiptCardContent({
  data,
  billing,
  showActions = true,
  onClose,
}: {
  data: any;
  billing?: any;
  showActions?: boolean;
  onClose?: () => void;
}) {
  const receiptDate = data.date ? new Date(data.date) : new Date();

  const { breakdown, amountPaid, handleDownloadPdf } = useReceiptDerived(data, billing);
  const { cashTendered, change } = getReceiptAmounts(data);

  const info = statusInfo(data.status);
  const Icon = info.icon;
  const badge = methodBadge(data.paymentMethod);
  const receiptStalls = Array.isArray(data.stalls) && data.stalls.length > 0
    ? data.stalls
    : Array.isArray(billing?.stalls) ? billing.stalls : [];
  const premises = receiptStalls.length > 0
    ? receiptStalls.map((item: any) => `Building ${item.buildingNumber} · Space ${item.spaceId}`).join("\n")
    : `Building ${data.buildingNumber ?? ""} · Space ${data.spaceId ?? ""}`;

  return (
    <View style={styles.root}>
      <View style={[styles.statusIconCircle, { backgroundColor: info.iconBg }]}>
        <Icon size={26} color={info.iconColor} />
      </View>

      <Text style={[styles.transactionStatusText, { color: info.pillColor }]}>{info.pillLabel}</Text>
      <Text style={styles.totalLabel}>{info.totalLabel}</Text>
      <Text style={styles.totalAmount}>₱{amountPaid.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>

      <View style={styles.detailRows}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Reference ID</Text>
          <View style={styles.referenceValueRow}>
            <Text style={styles.detailValue}>#{data.receiptNo}</Text>
            <Copy size={12} color={colors.ink} />
          </View>
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
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Stalls Covered</Text>
          <Text style={styles.detailValue}>{premises}</Text>
        </View>
        <View style={change > 0 && cashTendered !== null ? styles.detailRow : [styles.detailRow, { borderBottomWidth: 0 }]}>
          <Text style={styles.detailLabel}>Status</Text>
          <View style={[styles.statusDetailBadge, { backgroundColor: info.pillBg }]}>
            <Text style={[styles.statusDetailText, { color: info.pillColor }]}>{info.statusText}</Text>
          </View>
        </View>
        {change > 0 && cashTendered !== null && (
          <>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Cash Tendered</Text>
              <Text style={styles.detailValue}>₱{cashTendered.toLocaleString()}</Text>
            </View>
            <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.detailLabel}>Change</Text>
              <Text style={styles.detailValue}>₱{change.toLocaleString()}</Text>
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
          <Pressable
            style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
            onPress={onClose}
          >
            {({ pressed }) => (
              <Text style={[styles.closeBtnText, pressed && styles.closeBtnTextPressed]}>Close</Text>
            )}
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.pdfBtn, pressed && styles.pdfBtnPressed]}
            onPress={handleDownloadPdf}
          >
            {({ pressed }) => (
              <>
                <Download size={16} color={pressed ? colors.emerald : colors.white} />
                <Text style={[styles.pdfBtnText, pressed && styles.pdfBtnTextPressed]}>Download PDF</Text>
              </>
            )}
          </Pressable>
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
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },

  transactionStatusText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    marginBottom: 4,
  },

  totalLabel: {
    fontSize: 9,
    fontFamily: fontFamily.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.6,
  },

  totalAmount: {
    fontSize: 28,
    fontFamily: fontFamily.extrabold,
    color: colors.ink,
    marginTop: 4,
  },

  divider: {
    width: "100%",
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.lg,
  },

  detailRows: {
    width: "100%",
    backgroundColor: colors.mist,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.lg,
  },

  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },

  detailLabel: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
  },

  detailValue: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
    flexShrink: 1,
    textAlign: "right",
  },

  detailValueAccent: {
    color: colors.ink,
  },

  referenceValueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
  },

  statusDetailBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },

  statusDetailText: {
    fontSize: 9,
    fontFamily: fontFamily.bold,
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
    fontSize: fontSize.xs,
    fontFamily: fontFamily.regular,
    color: colors.textSecondary,
    flexShrink: 1,
    paddingRight: spacing.sm,
  },

  breakdownValue: {
    fontSize: fontSize.xs,
    fontFamily: fontFamily.semibold,
    color: colors.ink,
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

  closeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: radius.sm,
    borderWidth: 0,
    backgroundColor: colors.mist,
    paddingVertical: spacing.md,
  },

  closeBtnPressed: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },

  closeBtnText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.semibold,
    color: colors.textSecondary,
  },

  closeBtnTextPressed: {
    color: colors.white,
  },

  pdfBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.ink,
    paddingVertical: spacing.md,
    borderWidth: 1.5,
    borderColor: "transparent",
    ...shadow.button,
  },

  pdfBtnPressed: {
    backgroundColor: colors.white,
    borderColor: colors.ink,
  },

  pdfBtnText: {
    fontSize: fontSize.sm,
    fontFamily: fontFamily.bold,
    color: colors.white,
  },

  pdfBtnTextPressed: {
    color: colors.ink,
  },
});

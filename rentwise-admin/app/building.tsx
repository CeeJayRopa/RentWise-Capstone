import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";

import { router, useFocusEffect } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { auth } from "../shared/services/auth";
import { db } from "../shared/services/firestore";
import { Colors } from "../shared/constants/color";
import Sidebar from "./components/Sidebar";
import UpdatesReportFAB from "./components/UpdatesReportFAB";

type StallDoc = {
  id: string;
  buildingNumber: number;
  spaceId: string;
  name: string;
  tenantName?: string;
  price: number;
  paymentSchedule: string;
  status: "occupied" | "unoccupied" | "maintenance";
  tenantId: string | null;
};

type TenantInfo = {
  firstName: string;
  lastName: string;
};

export default function Building() {
  const insets = useSafeAreaInsets();

  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);

  const [allStalls, setAllStalls] = useState<StallDoc[]>([]);

  const [tenantMap, setTenantMap] = useState<Map<string, TenantInfo>>(
    new Map(),
  );

  const [selectedBuilding, setSelectedBuilding] = useState<number | null>(null);

  const [filter, setFilter] = useState<"All" | "Unoccupied" | "Occupied">(
    "All",
  );

  const [sidebarVisible, setSidebarVisible] = useState(false);

  const [sheetVisible, setSheetVisible] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        router.replace("/");
        return;
      }

      setChecking(false);
      fetchData();
    });

    return unsubscribe;
  }, []);

  const fetchData = async () => {
    setLoading(true);

    try {
      const [stallsSnap, usersSnap] = await Promise.all([
        getDocs(collection(db, "stalls")),

        getDocs(query(collection(db, "users"), where("role", "==", "tenant"))),
      ]);

      const stalls: StallDoc[] = stallsSnap.docs.map((doc) => {
        const data = doc.data();

        return {
          id: doc.id,

          buildingNumber: Number(data.buildingNumber ?? 0),

          spaceId: data.spaceId ?? "",

          name: data.name ?? "",

          price: Number(data.price ?? 0),

          paymentSchedule: data.paymentSchedule ?? "",

          status: data.status ?? "unoccupied",

          tenantId: data.tenantId ?? null,
        };
      });

      setAllStalls(stalls);

      const buildings = [...new Set(stalls.map((s) => s.buildingNumber))].sort(
        (a, b) => a - b,
      );

      if (buildings.length > 0) {
        setSelectedBuilding((prev) => (prev !== null ? prev : buildings[0]));
      }

      const map = new Map<string, TenantInfo>();

      usersSnap.docs.forEach((doc) => {
        const data = doc.data();

        map.set(doc.id, {
          firstName: data.firstName ?? "",

          lastName: data.lastName ?? "",
        });
      });

      setTenantMap(map);
    } catch (error) {
      console.log("BUILDING ERROR:", error);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (!checking) {
        fetchData();
      }
    }, [checking]),
  );

  const buildingNumbers = [
    ...new Set(allStalls.map((s) => s.buildingNumber)),
  ].sort((a, b) => a - b);

  const displayedStalls = allStalls

    .filter(
      (stall) =>
        selectedBuilding === null || stall.buildingNumber === selectedBuilding,
    )

    .filter((stall) => {
      if (filter === "All") return true;

      if (filter === "Occupied") return stall.status === "occupied";

      return stall.status === "unoccupied";
    })

    .sort((a, b) => {
      if (a.buildingNumber !== b.buildingNumber)
        return a.buildingNumber - b.buildingNumber;
      const numA = Number(a.spaceId.split("-")[1] ?? 0);
      const numB = Number(b.spaceId.split("-")[1] ?? 0);
      return numA - numB;
    });

  if (checking) {
    return (
      <View style={styles.fullCenter}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 8,
          },
        ]}
      >
        <TouchableOpacity
          style={styles.menuBtn}
          onPress={() => setSidebarVisible(true)}
        >
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Building Management</Text>

        <View style={styles.menuBtn} />
      </View>

      <View style={styles.banner}>
        <Text style={styles.bannerText}>
          Ka Domeng Talipapa Wet and Dry Market
        </Text>
      </View>

      <View style={[styles.controls, sheetVisible && { zIndex: 150 }]}>
        <View style={styles.dropdownWrapper}>
          <TouchableOpacity
            style={styles.dropdownTrigger}
            onPress={() => setSheetVisible((v) => !v)}
            activeOpacity={0.8}
          >
            <Text style={styles.dropdownTriggerText}>
              {selectedBuilding !== null
                ? `Building ${selectedBuilding}`
                : "Select Building"}
            </Text>
            <Text style={styles.dropdownArrow}> ▽</Text>
          </TouchableOpacity>

          {sheetVisible && (
            <View style={styles.dropdown}>
              {buildingNumbers.map((num) => (
                <TouchableOpacity
                  key={num}
                  style={[
                    styles.dropdownItem,
                    selectedBuilding === num && styles.dropdownItemActive,
                  ]}
                  onPress={() => {
                    setSelectedBuilding(num);
                    setSheetVisible(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.dropdownItemText,
                      selectedBuilding === num && styles.dropdownItemTextActive,
                    ]}
                  >
                    Building {num}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <View style={styles.filterRow}>
          {(["All", "Unoccupied", "Occupied"] as const).map((item) => (
            <TouchableOpacity
              key={item}
              style={[
                styles.filterTab,
                filter === item && styles.filterTabActive,
              ]}
              onPress={() => setFilter(item)}
            >
              <Text>{item}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {loading ? (
        <View style={styles.fullCenter}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={displayedStalls}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <StallRow stall={item} tenantMap={tenantMap} />
          )}
        />
      )}

      {sheetVisible && (
        <TouchableOpacity
          style={[StyleSheet.absoluteFill, styles.dropdownBackdrop]}
          onPress={() => setSheetVisible(false)}
          activeOpacity={1}
        />
      )}

      <Sidebar
        visible={sidebarVisible}
        onClose={() => setSidebarVisible(false)}
      />

      <UpdatesReportFAB />
    </View>
  );
}

function StallRow({
  stall,
  tenantMap,
}: {
  stall: StallDoc;
  tenantMap: Map<string, TenantInfo>;
}) {
  const tenant =
    stall.status === "occupied" && stall.tenantId
      ? tenantMap.get(stall.tenantId)
      : null;

  return (
    <View style={styles.row}>
      <View style={styles.rowInfo}>
        <Text>Building: {stall.buildingNumber}</Text>

        <Text>Space: {stall.spaceId}</Text>

        {stall.tenantName && <Text>{stall.tenantName}</Text>}
      </View>

      <View style={styles.rowDividerVertical} />

      <View style={styles.stallBtns}>
        {/* UNOCCUPIED */}
        {stall.status === "unoccupied" && (
          <TouchableOpacity
            style={styles.button}
            onPress={() =>
              router.push({
                pathname: "/account",
                params: {
                  mode: "create",
                  stallId: stall.id,
                },
              } as any)
            }
          >
            <Text style={styles.buttonText}>Register</Text>
          </TouchableOpacity>
        )}

        {/* OCCUPIED */}
        {stall.status === "occupied" && (
          <>
            {/* MANAGE ACCOUNT */}
            <TouchableOpacity
              style={styles.button}
              onPress={() =>
                router.push({
                  pathname: "/account",
                  params: {
                    mode: "manage",
                    stallId: stall.id,
                  },
                } as any)
              }
            >
              <Text style={styles.buttonText}>Manage</Text>
            </TouchableOpacity>

            {/* EDIT RENTAL INFO */}
            <TouchableOpacity
              style={styles.button}
              onPress={() =>
                router.push({
                  pathname: "/edit-rental-info",
                  params: {
                    stallId: stall.id,
                  },
                } as any)
              }
            >
              <Text style={styles.buttonText}>Edit Rental</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  fullCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },

  header: {
    backgroundColor: Colors.primary,
    paddingBottom: 15,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },

  menuBtn: {
    width: 40,
  },

  menuIcon: {
    color: "#fff",
    fontSize: 24,
  },

  headerTitle: {
    color: "#fff",
    fontWeight: "700",
  },

  banner: {
    backgroundColor: Colors.primaryDark,
    padding: 10,
  },

  bannerText: {
    color: "#fff",
    textAlign: "center",
  },

  controls: {
    padding: 15,
  },

  dropdownWrapper: {
    position: "relative",
  },

  dropdownTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderWidth: 1,
    borderColor: "#AAAAAA",
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
  },

  dropdownTriggerText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1A1A1A",
  },

  dropdownArrow: {
    fontSize: 12,
    color: "#555555",
  },

  dropdown: {
    position: "absolute",
    top: 46,
    left: 0,
    right: 0,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#AAAAAA",
    borderRadius: 8,
    zIndex: 200,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },

  dropdownItem: {
    paddingVertical: 12,
    paddingHorizontal: 14,
  },

  dropdownItemActive: {
    backgroundColor: "#F0F0F0",
  },

  dropdownItemText: {
    fontSize: 13,
    color: "#1A1A1A",
  },

  dropdownItemTextActive: {
    fontWeight: "700",
    color: Colors.primary,
  },

  dropdownBackdrop: {
    zIndex: 100,
  },

  filterRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },

  filterTab: {
    padding: 10,
    borderWidth: 1,
  },

  filterTabActive: {
    backgroundColor: Colors.primary,
  },

  row: {
    paddingVertical: 14,
    paddingHorizontal: 15,
    backgroundColor: "#fff",
    marginVertical: 5,
    flexDirection: "row",
    alignItems: "center",
  },

  rowInfo: {
    flex: 1,
  },

  rowDividerVertical: {
    width: 1,
    backgroundColor: "#E0E0E0",
    alignSelf: "stretch",
    marginHorizontal: 12,
  },

  stallBtns: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 6,
    width: 110,
  },

  button: {
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 6,
    alignItems: "center",
  },

  buttonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },

});

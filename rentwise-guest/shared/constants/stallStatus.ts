export type StallStatusMeta = {
  label: "Available" | "Occupied" | "Reserved" | "Unavailable";
  color: string;
  soft: string;
};

export function statusMeta(status?: string): StallStatusMeta {
  const normalized = String(status ?? "available").trim().toLowerCase();
  if (normalized === "occupied") {
    return {label: "Occupied", color: "#D95F61", soft: "#FBE0E1"};
  }
  if (normalized === "reserved" || normalized === "pending") {
    return {label: "Reserved", color: "#D49B15", soft: "#FFF0BD"};
  }
  if (
    normalized === "unavailable" ||
    normalized === "disabled" ||
    normalized === "unknown"
  ) {
    return {label: "Unavailable", color: "#87939A", soft: "#E8ECEE"};
  }
  return {label: "Available", color: "#16845F", soft: "#D9F4E9"};
}

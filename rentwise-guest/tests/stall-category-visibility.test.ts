// @ts-expect-error The dependency-free Node test runner is intentionally outside the Expo app types.
import { readFileSync } from "node:fs";

// @ts-expect-error Node's type-stripping test runner requires the runtime .ts extension.
import { isOccupiedStallStatus, shouldShowMarketRental } from "../shared/constants/stallStatus.ts";

const cases: Array<{status: string | undefined; expected: boolean}> = [
  {status: "occupied", expected: true},
  {status: " OCCUPIED ", expected: true},
  {status: "unoccupied", expected: false},
  {status: "available", expected: false},
  {status: "reserved", expected: false},
  {status: "pending", expected: false},
  {status: "maintenance", expected: false},
  {status: "unknown", expected: false},
  {status: "unexpected-state", expected: false},
  {status: undefined, expected: false},
];

for (const testCase of cases) {
  const actual = isOccupiedStallStatus(testCase.status);
  if (actual !== testCase.expected) {
    throw new Error(
      `Expected ${JSON.stringify(testCase.status)} to return ${testCase.expected}, received ${actual}.`,
    );
  }

  const actualRentalVisibility = shouldShowMarketRental(testCase.status);
  if (actualRentalVisibility !== !testCase.expected) {
    throw new Error(
      `Expected Market Rental visibility for ${JSON.stringify(testCase.status)} to be ${!testCase.expected}, received ${actualRentalVisibility}.`,
    );
  }
}

const sharedPopupSource = readFileSync(
  new URL("../shared/components/StallPopup.tsx", import.meta.url),
  "utf8",
);
const mobilePopupSource = readFileSync(
  new URL("../app/market-map.tsx", import.meta.url),
  "utf8",
);

for (const required of ["Market rental", "rentBox", "formattedPrice", "showMarketRental && ("]) {
  if (!sharedPopupSource.includes(required)) {
    throw new Error(`Expected the shared stall popup to include ${JSON.stringify(required)}.`);
  }
}

const occupiedCategoryIndex = sharedPopupSource.indexOf("{isOccupied && (");
const vacantRentalIndex = sharedPopupSource.indexOf("{showMarketRental && (");
if (occupiedCategoryIndex < 0 || vacantRentalIndex < 0 || occupiedCategoryIndex === vacantRentalIndex) {
  throw new Error("Expected category and Market Rental to use separate occupied/non-occupied visibility gates.");
}

for (const forbidden of ["Daily rent:", "daily rental rate", ">Rent rate<"]) {
  if (mobilePopupSource.includes(forbidden)) {
    throw new Error(`Expected the mobile stall popup to omit ${JSON.stringify(forbidden)}.`);
  }
}

console.log(`stall popup visibility: ${cases.length} status cases and occupied/non-occupied rental checks passed`);

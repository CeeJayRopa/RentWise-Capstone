import { isOccupiedStallStatus } from "../shared/constants/stallStatus.ts";

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
}

console.log(`stall category visibility: ${cases.length} status cases passed`);

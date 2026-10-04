# RentWise: Relevant Source Code for the Capstone Paper

## Listing 1. AR-Based Stall Layout Visualization and Planning

```typescript
private placeArmedAtReticle() {
  if (!this.armedModel || !this.armedObjectId) return;

  const group = cloneWithOwnMaterials(this.armedModel);
  const floorY = this.reticlePosition.y;
  group.position.setFromMatrixPosition(this.reticle.matrix);
  this.orientTowardCamera(group);
  group.scale.set(1, 1, 1);
  this.snapToFloor(group, floorY, this.armedObjectId);

  const placedObject: PlacedObject = {
    id: `placed-${this.nextInstanceId++}`,
    objectId: this.armedObjectId,
    group,
    scale: { x: 1, y: 1, z: 1 },
    userYawDeg: 0,
  };

  this.placedGroup.add(group);
  this.placed.push(placedObject);
  this.selected = placedObject;
  this.history.push({ type: "place", object: placedObject });
  this.notifyPlacedChange();
}

rotateSelected(deltaDeg: number) {
  if (!this.selected || !Number.isFinite(deltaDeg)) return;
  this.recordTransformBeforeChange();
  this.selected.group.rotateY(THREE.MathUtils.degToRad(deltaDeg));
  this.selected.userYawDeg += deltaDeg;
}

scaleSelectedAxis(axis: ScaleAxis, factor: number) {
  if (!this.selected) return;
  this.setAxisScale(axis, this.selected.scale[axis] * factor);
}

moveSelectedToReticle() {
  if (!this.selected || !this.reticle.visible) return;
  this.recordTransformBeforeChange();
  const floorY = this.reticlePosition.y;
  this.selected.group.position.setFromMatrixPosition(this.reticle.matrix);
  this.orientTowardCamera(this.selected.group);
  this.snapToFloor(this.selected.group, floorY, this.selected.objectId);
}
```

## Listing 2. Interactive Market Blueprint with Real-Time Stall Availability

```typescript
const stallsByName = matchMapStalls(stalls, MARKET_LAYOUT);

const occupiedCount = stalls.filter(
  (stall) => stall.status?.toLowerCase() === "occupied",
).length;

const vacantCount = stalls.length - occupiedCount;

const stallHotspots = MARKET_LAYOUT.map((hotspot, index) => {
  const stall = stallsByName.get(hotspot.name);
  const isVacant = stall
    ? stall.status?.toLowerCase() !== "occupied"
    : null;

  return (
    <TouchableOpacity
      key={`${hotspot.name}-${index}`}
      style={[
        styles.hotspot,
        {
          left: `${hotspot.xPct}%`,
          top: `${hotspot.yPct}%`,
          width: `${hotspot.widthPct}%`,
          height: `${hotspot.heightPct}%`,
          backgroundColor:
            isVacant === false
              ? "rgba(76,175,80,0.3)"
              : "rgba(120,120,120,0.15)",
        },
      ]}
      onPress={() =>
        setSelectedStall(
          stall ?? {
            id: hotspot.name,
            name: hotspot.name,
            status: "Unknown",
          },
        )
      }
    />
  );
});
```

## Listing 3. Centralized Multi-Role Rental Management

```javascript
function isSignedIn() {
  return request.auth != null;
}

function myRole() {
  return get(
    /databases/$(database)/documents/users/$(request.auth.uid)
  ).data.role;
}

function isAdmin() { return isSignedIn() && myRole() == "admin"; }
function isOwner() { return isSignedIn() && myRole() == "owner"; }
function isTenant() { return isSignedIn() && myRole() == "tenant"; }
function isStaff() { return isAdmin() || isOwner(); }

match /users/{userId} {
  allow get: if isSignedIn()
    && (isStaff() || request.auth.uid == userId);
  allow list: if isStaff();

  allow create: if isAdmin()
    && request.resource.data.role == "tenant";

  allow update: if
    (isOwner()
      && resource.data.role in ["admin", "tenant"]
      && request.resource.data.role == resource.data.role)
    || (isAdmin()
      && resource.data.role == "tenant"
      && request.resource.data.role == "tenant")
    || (isSignedIn()
      && request.auth.uid == userId
      && request.resource.data.diff(resource.data)
        .affectedKeys().hasOnly([
          "firstName", "lastName", "contactNo", "username",
          "category", "mustChangePassword", "expoPushToken",
          "emailVerified"
        ]));
}
```

## Listing 4. Automated Update Reporting and Owner Approval

```typescript
const pendingUpdates = updates.filter(
  (update) => update.approvalStatus !== "approved",
);

const owners = await getDocs(
  query(collection(db, "users"), where("role", "==", "owner")),
);

const batch = writeBatch(db);
for (const update of pendingUpdates) {
  for (const owner of owners.docs) {
    const notificationId = `notif_${update.id}_${owner.id}`;

    batch.set(
      doc(db, "notifications", notificationId),
      {
        userId: owner.id,
        status: "To be Acknowledged",
        read: false,
        updateId: update.id,
        createdAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  batch.update(doc(db, "updates", update.id), {
    notifiedAt: serverTimestamp(),
  });
}

await batch.commit();

await updateDoc(doc(db, "updates", update.id), {
  approvalStatus: "approved",
});

await addDoc(collection(db, "dailyReports"), {
  type: update.type ?? update.module ?? "Update",
  updateId: update.id,
  spaceNo: update.spaceNo ?? null,
  tenantName: update.tenantName ?? null,
  approvedBy: "Owner",
  createdAt: serverTimestamp(),
});
```

## Listing 5. Tenant Relocation and Stall Assignment Management

```typescript
export const relocateActiveTenant = async (
  uid: string,
  oldStallId: string,
  newStallId: string,
): Promise<void> => {
  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) throw new Error("User not found.");

  const newStallSnap = await getDoc(doc(db, "stalls", newStallId));
  if (!newStallSnap.exists()) {
    throw new Error("Selected stall not found.");
  }

  const newStall = newStallSnap.data();
  if (newStall.status !== "unoccupied") {
    throw new Error("Selected stall is no longer available.");
  }

  const batch = writeBatch(db);

  batch.update(doc(db, "users", uid), {
    stallId: newStallId,
    price: Number(newStall.price ?? 0),
    paymentSchedule: newStall.paymentSchedule ?? "monthly",
    category: newStall.category ?? "",
  });

  batch.update(doc(db, "stalls", newStallId), {
    tenantId: uid,
    tenantName: `${userSnap.data().firstName} ${userSnap.data().lastName}`,
    status: "occupied",
  });

  if (oldStallId) {
    batch.update(doc(db, "stalls", oldStallId), {
      status: "unoccupied",
      tenantId: null,
      tenantName: null,
    });
  }

  await batch.commit();
};
```

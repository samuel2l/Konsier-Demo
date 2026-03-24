import type { Pickup } from "./types";

const pickups: Pickup[] = [];
let nextPickupId = 1;

export function listPickups(): Pickup[] {
  return pickups.slice().sort((a, b) => b.id - a.id);
}

export function getPickup(id: number): Pickup | null {
  return pickups.find((p) => p.id === id) || null;
}

export function createPickup(input: {
  studentName: string;
  fromLocation: string;
  toLocation: string;
  notes?: string;
  scheduledAt?: string;
  konsierUserId?: string;
  konsierConversationId?: string | number;
  attachments?: Pickup["attachments"];
  location?: Pickup["location"];
  feeGhs?: number;
}): Pickup {
  const feeGhs = input.feeGhs ?? 25;
  const pickup: Pickup = {
    id: nextPickupId++,
    studentName: input.studentName,
    fromLocation: input.fromLocation,
    toLocation: input.toLocation,
    feeGhs,
    status: "pending",
  };

  if (input.konsierUserId) pickup.konsierUserId = input.konsierUserId;
  if (input.konsierConversationId !== undefined)
    pickup.konsierConversationId = input.konsierConversationId;
  if (input.notes) pickup.notes = input.notes;
  if (input.scheduledAt) pickup.scheduledAt = input.scheduledAt;
  if (input.attachments && input.attachments.length > 0)
    pickup.attachments = input.attachments;
  if (input.location) pickup.location = input.location;

  pickups.push(pickup);
  return pickup;
}

export function advancePickupStatus(id: number): { pickup: Pickup | null; error?: string } {
  const pickup = getPickup(id);
  if (!pickup) return { pickup: null, error: "Pickup not found" };
  if (pickup.status === "completed") return { pickup, error: "Pickup already completed" };

  if (pickup.status === "pending") pickup.status = "in_progress";
  else if (pickup.status === "in_progress") pickup.status = "completed";

  return { pickup };
}

export function setPickupStatus(id: number, status: Pickup["status"]): { pickup: Pickup | null; error?: string } {
  const pickup = getPickup(id);
  if (!pickup) return { pickup: null, error: "Pickup not found" };
  pickup.status = status;
  return { pickup };
}


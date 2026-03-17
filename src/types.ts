export type PickupStatus = "pending" | "in_progress" | "completed";

export interface Pickup {
  id: number;
  studentName: string;
  fromLocation: string;
  toLocation: string;
  notes?: string;
  scheduledAt?: string;
  feeGhs: number;
  status: PickupStatus;
  konsierUserId?: string;
  konsierConversationId?: string | number;
}


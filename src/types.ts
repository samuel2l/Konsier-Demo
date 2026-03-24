export type PickupStatus = "pending" | "in_progress" | "completed";

export type SupportedAttachmentType = "image" | "video" | "file";

export type MediaAttachment = {
  type: SupportedAttachmentType;
  url: string;
  name?: string | undefined;
};

export type LocationPayload = {
  latitude: number;
  longitude: number;
  label?: string | undefined;
};

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
  attachments?: MediaAttachment[];
  location?: LocationPayload;
}

export type Complaint = {
  id: number;
  pickupId?: number;
  message: string;
  status: "open" | "resolved";
  konsierUserId?: string;
  konsierConversationId?: string | number;
  attachments?: MediaAttachment[];
  location?: LocationPayload;
  createdAt: number;
};

export type Review = {
  id: number;
  pickupId?: number;
  rating: 1 | 2 | 3 | 4 | 5;
  text?: string;
  konsierUserId?: string;
  konsierConversationId?: string | number;
  attachments?: MediaAttachment[];
  location?: LocationPayload;
  createdAt: number;
};


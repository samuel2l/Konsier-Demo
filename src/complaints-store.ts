import type { Complaint } from "./types";

const complaints: Complaint[] = [];
let nextComplaintId = 1;

export function listComplaints() {
  return complaints.slice().sort((a, b) => b.createdAt - a.createdAt);
}

export function createComplaint(input: {
  pickupId?: number;
  message: string;
  konsierUserId?: string;
  konsierConversationId?: string | number;
  attachments?: Complaint["attachments"];
  location?: Complaint["location"];
}) {
  const complaint: Complaint = {
    id: nextComplaintId++,
    message: input.message,
    status: "open",
    createdAt: Date.now(),
  };

  if (input.pickupId !== undefined) complaint.pickupId = input.pickupId;
  if (input.konsierUserId) complaint.konsierUserId = input.konsierUserId;
  if (input.konsierConversationId !== undefined)
    complaint.konsierConversationId = input.konsierConversationId;
  if (input.attachments && input.attachments.length > 0)
    complaint.attachments = input.attachments;
  if (input.location) complaint.location = input.location;

  complaints.push(complaint);
  return complaint;
}


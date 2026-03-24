import type { Express, Request, Response, NextFunction } from "express";
import { Konsier } from "konsier";
import { z } from "zod";
import { LocationPayload, MediaAttachment, Pickup } from "./types";
import { listPickups, setPickupStatus } from "./pickups-store";
import { createComplaint, listComplaints } from "./complaints-store";
import { createReview, listReviews } from "./reviews-store";

async function callApi<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const axios = (await import("axios")).default;
  const url = `http://localhost:${process.env.PORT || 4000}${path}`;
  if (method === "GET") {
    const response = await axios.get(url);
    return response.data as T;
  }
  const response = await axios.post(url, body ?? {});
  return response.data as T;
}

const endpointUrl = process.env.KONSIER_ENDPOINT_URL || "";

const KONSIER_API_KEY =
  process.env.KONSIER_API_KEY || "REPLACE_WITH_REAL_API_KEY";

function summarizeRichContent(options?: {
  attachments?: MediaAttachment[];
  location?: LocationPayload;
}) {
  const attachments = options?.attachments ?? [];
  const byType = attachments.reduce(
    (acc, item) => {
      acc[item.type] += 1;
      return acc;
    },
    { image: 0, video: 0, file: 0 } as Record<"image" | "video" | "file", number>,
  );
  return {
    attachments_total: attachments.length,
    attachments_by_type: byType,
    has_location: Boolean(options?.location),
  };
}

const mediaAttachmentSchema = z.union([
  Konsier.attachment.image(),
  Konsier.attachment.video(),
  Konsier.attachment.file(),
]);

const locationAttachmentSchema = Konsier.attachment.location();

const createPickupTool = Konsier.tool({
  name: "pickup_create_from_description",
  description:
    "Create a new campus pickup when the student has clearly provided their name, where items are picked up from, where they should go, and roughly when.",
  input: z.object({
    student_name: z.string().describe("Student's full name"),
    from_location: z
      .string()
      .describe("Pickup location on campus"),
    to_location: z
      .string()
      .describe("Drop-off location on campus"),
    notes: z
      .string()
      .optional()
      .describe("Extra notes about items"),
    scheduled_at: z
      .string()
      .optional()
      .describe("Optional scheduled time"),
    attachments: z
      .array(mediaAttachmentSchema)
      .max(10)
      .optional()
      .describe("Optional supporting image/video/file uploads"),
    location: locationAttachmentSchema
      .optional()
      .describe("Optional GPS pin to help runner locate the user or item"),
  }),
  handler: async (input, ctx) => {
    const normalizedAttachments = input.attachments?.map((item) => ({
      type: item.type,
      url: item.url,
      ...(item.name ? { name: item.name } : {}),
    }));
    const normalizedLocation = input.location
      ? {
          latitude: input.location.latitude,
          longitude: input.location.longitude,
          ...(input.location.address ? { label: input.location.address } : {}),
        }
      : undefined;

    const body = {
      studentName: input.student_name,
      fromLocation: input.from_location,
      toLocation: input.to_location,
      notes: input.notes,
      scheduledAt: input.scheduled_at,
      ...(normalizedAttachments ? { attachments: normalizedAttachments } : {}),
      ...(normalizedLocation ? { location: normalizedLocation } : {}),
      konsierUserId: ctx.user?.id,
      konsierConversationId: ctx.conversation?.id,
    };
    console.log("[KONSIER][pickup_create_from_description] normalized payload", {
      user_id: ctx.user?.id ?? null,
      conversation_id: ctx.conversation?.id ?? null,
      ...summarizeRichContent({
        ...(normalizedAttachments ? { attachments: normalizedAttachments } : {}),
        ...(normalizedLocation ? { location: normalizedLocation } : {}),
      }),
    });

    const result = await callApi<{
      pickup_id: number;
      fee_ghs: number;
      status: string;
    }>("POST", "/api/pickups", body);

    return {
      message: `Created pickup #${result.pickup_id} for ${result.fee_ghs} GHS.`,
      pickup_id: result.pickup_id,
      fee_ghs: result.fee_ghs,
      status: result.status,
    };
  },
});

const listPickupsTool = Konsier.tool({
  name: "pickup_list_for_student",
  description:
    "List recent pickups for the student so they can choose which one to ask about.",
  input: z.object({}),
  handler: async () => {
    const result = await callApi<{ pickups: Pickup[] }>("GET", "/api/pickups");
    return {
      count: result.pickups.length,
      pickups: result.pickups.map((p) => ({
        id: p.id,
        from: p.fromLocation,
        to: p.toLocation,
        status: p.status,
        fee_ghs: p.feeGhs,
        scheduled_at: p.scheduledAt ?? null,
      })),
    };
  },
});

const getPickupDetailsTool = Konsier.tool({
  name: "pickup_get_details_by_id",
  description:
    "Get detailed information about one pickup by ID, including status and fee.",
  input: z.object({
    pickup_id: z.number().int().describe("The pickup ID to look up"),
  }),
  handler: async (input) => {
    const pickup = await callApi<Pickup>(
      "GET",
      `/api/pickups/${input.pickup_id}`,
    );
    return {
      id: pickup.id,
      student_name: pickup.studentName,
      from: pickup.fromLocation,
      to: pickup.toLocation,
      status: pickup.status,
      fee_ghs: pickup.feeGhs,
      notes: pickup.notes ?? null,
      scheduled_at: pickup.scheduledAt ?? null,
    };
  },
});

const checkInPickupTool = Konsier.tool({
  name: "pickup_check_in_next_step",
  description:
    "Advance the status of a pickup (pending, in_progress, completed).",
  input: z.object({
    pickup_id: z.number().int().describe("The pickup ID to advance"),
  }),
  handler: async (input) => {
    const result = await callApi<{ pickup: Pickup }>(
      "POST",
      `/api/pickups/${input.pickup_id}/check-in`,
    );
    return {
      message: `Pickup #${result.pickup.id} is now ${result.pickup.status}.`,
      pickup: {
        id: result.pickup.id,
        student_name: result.pickup.studentName,
        from: result.pickup.fromLocation,
        to: result.pickup.toLocation,
        status: result.pickup.status,
        fee_ghs: result.pickup.feeGhs,
        notes: result.pickup.notes ?? null,
        scheduled_at: result.pickup.scheduledAt ?? null,
      },
    };
  },
});

const createPaystackLinkTool = Konsier.tool({
  name: "pickup_payment_instructions",
  description:
    "Provide payment instructions for a pickup (MOMO number or paying the rider directly).",
  input: z.object({
    pickup_id: z.number().int().describe("The pickup ID to pay for"),
  }),
  handler: async (input) => {
    return {
      pickup_id: input.pickup_id,
      payment_instructions:
        "Pay our MOMO number 0551642130 (or pay the rider directly when they arrive). Share the receipt with the runner.",
    };
  },
});

const complaintCreateTool = Konsier.tool({
  name: "complaint_create",
  description: "Submit a complaint about a pickup or rider experience.",
  input: z.object({
    pickup_id: z.number().int().optional().describe("Pickup ID (if known)"),
    message: z.string().min(5).describe("Complaint details"),
    attachments: z
      .array(mediaAttachmentSchema)
      .max(10)
      .optional()
      .describe("Optional proof like screenshots, video, or documents"),
    location: locationAttachmentSchema
      .optional()
      .describe("Optional location where the issue happened"),
  }),
  handler: async (input, ctx) => {
    const normalizedAttachments = input.attachments?.map((item) => ({
      type: item.type,
      url: item.url,
      ...(item.name ? { name: item.name } : {}),
    }));
    const normalizedLocation = input.location
      ? {
          latitude: input.location.latitude,
          longitude: input.location.longitude,
          ...(input.location.address ? { label: input.location.address } : {}),
        }
      : undefined;

    const complaint = createComplaint({
      ...(input.pickup_id !== undefined ? { pickupId: input.pickup_id } : {}),
      message: input.message,
      ...(normalizedAttachments ? { attachments: normalizedAttachments } : {}),
      ...(normalizedLocation ? { location: normalizedLocation } : {}),
      konsierUserId: ctx.user?.id,
      konsierConversationId: ctx.conversation?.id,
    });

    await notifyKonsierUser(
      {
        ...(complaint.konsierUserId ? { konsierUserId: complaint.konsierUserId } : {}),
        ...(complaint.konsierConversationId !== undefined
          ? { konsierConversationId: complaint.konsierConversationId }
          : {}),
      },
      `Thanks—your complaint has been submitted. Reference: #${complaint.id}.`,
    );

    return {
      complaint_id: complaint.id,
      status: complaint.status,
    };
  },
});

const reviewCreateTool = Konsier.tool({
  name: "review_create",
  description: "Leave a review for a pickup.",
  input: z.object({
    pickup_id: z.number().int().optional().describe("Pickup ID (if known)"),
    rating: z.number().int().min(1).max(5).describe("Rating 1 to 5"),
    text: z.string().optional().describe("Short review text"),
    attachments: z
      .array(mediaAttachmentSchema)
      .max(10)
      .optional()
      .describe("Optional media/files related to the feedback"),
    location: locationAttachmentSchema
      .optional()
      .describe("Optional location where the pickup was completed"),
  }),
  handler: async (input, ctx) => {
    const normalizedAttachments = input.attachments?.map((item) => ({
      type: item.type,
      url: item.url,
      ...(item.name ? { name: item.name } : {}),
    }));
    const normalizedLocation = input.location
      ? {
          latitude: input.location.latitude,
          longitude: input.location.longitude,
          ...(input.location.address ? { label: input.location.address } : {}),
        }
      : undefined;

    const review = createReview({
      ...(input.pickup_id !== undefined ? { pickupId: input.pickup_id } : {}),
      rating: input.rating as 1 | 2 | 3 | 4 | 5,
      ...(input.text ? { text: input.text } : {}),
      ...(normalizedAttachments ? { attachments: normalizedAttachments } : {}),
      ...(normalizedLocation ? { location: normalizedLocation } : {}),
      konsierUserId: ctx.user?.id,
      konsierConversationId: ctx.conversation?.id,
    });

    await notifyKonsierUser(
      {
        ...(review.konsierUserId ? { konsierUserId: review.konsierUserId } : {}),
        ...(review.konsierConversationId !== undefined
          ? { konsierConversationId: review.konsierConversationId }
          : {}),
      },
      `Thanks for the feedback! Your review was saved (rating: ${review.rating}).`,
    );

    return {
      review_id: review.id,
      rating: review.rating,
    };
  },
});

const adminListPickupsTool = Konsier.tool({
  name: "admin_list_pickups",
  description: "List all pickups (admin only).",
  input: z.object({}),
  handler: async () => {
    const pickups = listPickups().map((p) => ({
      id: p.id,
      student_name: p.studentName,
      from: p.fromLocation,
      to: p.toLocation,
      status: p.status,
      fee_ghs: p.feeGhs,
      scheduled_at: p.scheduledAt ?? null,
    }));
    return { count: pickups.length, pickups };
  },
});

const adminSetPickupStatusTool = Konsier.tool({
  name: "admin_set_pickup_status",
  description: "Set a pickup status (admin only).",
  input: z.object({
    pickup_id: z.number().int(),
    status: z.enum(["pending", "in_progress", "completed"]),
  }),
  handler: async (input) => {
    const result = setPickupStatus(input.pickup_id, input.status);
    if (!result.pickup) return { error: "Pickup not found" };
    if (result.error) return { error: result.error };
    return {
      message: `Pickup #${result.pickup.id} set to ${result.pickup.status}.`,
      pickup_id: result.pickup.id,
      status: result.pickup.status,
    };
  },
});

const adminListComplaintsTool = Konsier.tool({
  name: "admin_list_complaints",
  description: "List complaints submitted by users (admin only).",
  input: z.object({}),
  handler: async () => {
    const items = listComplaints().map((c) => ({
      id: c.id,
      pickup_id: c.pickupId ?? null,
      message: c.message,
      status: c.status,
      created_at: c.createdAt,
    }));
    return { count: items.length, complaints: items };
  },
});

const adminListReviewsTool = Konsier.tool({
  name: "admin_list_reviews",
  description: "List reviews submitted by users (admin only).",
  input: z.object({}),
  handler: async () => {
    const items = listReviews().map((r) => ({
      id: r.id,
      pickup_id: r.pickupId ?? null,
      rating: r.rating,
      text: r.text ?? null,
      created_at: r.createdAt,
    }));
    return { count: items.length, reviews: items };
  },
});

let konsierInstance: Konsier | null = null;

export async function notifyKonsierUser(
  ids: { konsierUserId?: string; konsierConversationId?: string | number },
  text: string,
  options?: { attachments?: MediaAttachment[]; location?: LocationPayload },
): Promise<void> {
  if (!konsierInstance) return;
  if (!ids.konsierUserId && !ids.konsierConversationId) return;

  try {
    const summary = summarizeRichContent(options);
    console.log("[KONSIER][sendMessage] dispatching", {
      user_id: ids.konsierUserId ?? null,
      conversation_id: ids.konsierConversationId ?? null,
      ...summary,
    });

    const payload = {
      ...(ids.konsierUserId ? { userId: ids.konsierUserId } : {}),
      ...(ids.konsierConversationId
        ? { conversationId: ids.konsierConversationId }
        : {}),
      html: `<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;line-height:1.35"><b>Campus Runner</b><br/>${text}</div>`,
      attachments: options?.attachments ?? [
        {
          type: "image",
          url: "https://placehold.co/640x360/png?text=Campus+Runner",
          name: "campus-runner.png",
        },
      ],
      ...(options?.location ? { location: options.location } : {}),
    };
    await konsierInstance.sendMessage(payload as any);
    console.log("[KONSIER][sendMessage] delivered", {
      user_id: ids.konsierUserId ?? null,
      conversation_id: ids.konsierConversationId ?? null,
      ...summary,
    });
  } catch {
    console.error("[KONSIER][sendMessage] failed");
  }
}

export async function notifyPickupUser(
  pickup: Pickup,
  text: string,
): Promise<void> {
  if (!konsierInstance) return;
  await notifyKonsierUser(
    {
      ...(pickup.konsierUserId ? { konsierUserId: pickup.konsierUserId } : {}),
      ...(pickup.konsierConversationId !== undefined
        ? { konsierConversationId: pickup.konsierConversationId }
        : {}),
    },
    text,
    {
      ...(pickup.attachments ? { attachments: pickup.attachments } : {}),
      ...(pickup.location ? { location: pickup.location } : {}),
    },
  );
}

export function initKonsier(app: Express): Konsier | null {
  if (KONSIER_API_KEY === "REPLACE_WITH_REAL_API_KEY") {
    return null;
  }

  if (!endpointUrl) {
    return null;
  }

  const konsier = new Konsier({
    apiKey: KONSIER_API_KEY,
    endpointUrl,
    debug: true,
    agents: {
      campus_runner: {
        name: "Campus Runner",
        description: "Helps students schedule and track item pickups on campus.",
        systemPrompt: [
          "You are Campus Runner, an assistant that helps students move items around campus.",
          "",
          "You can:",
          "- Create new pickup requests from a student's natural description.",
          "- List their recent pickups.",
          "- Show the status of a specific pickup.",
          "- Provide payment instructions when they are ready to pay the fee.",
          "- Collect supporting image/video/file evidence and optional location pins.",
          "",
          "Always confirm key details (from where, to where, roughly when) before creating a pickup.",
          "When the user uploads media or shares a location, include them in tool arguments as attachments/location fields.",
          "Use tools to fetch fresh status instead of guessing.",
        ].join("\n"),
        tools: [
          createPickupTool,
          listPickupsTool,
          getPickupDetailsTool,
          checkInPickupTool,
          createPaystackLinkTool,
          complaintCreateTool,
          reviewCreateTool,
        ],
      },
    },
    internal: {
      tools: [
        adminListPickupsTool,
        adminSetPickupStatusTool,
        adminListComplaintsTool,
        adminListReviewsTool,
      ],
      pages: [
        {
          name: "Pickups",
          path: "/admin/pickups",
        },
      ],
    },
  });

  konsierInstance = konsier;

  const handler = konsier.webhookHandler();
  const webhookPath = konsier.webhookPath();
  app.post(
    webhookPath,
    (req: Request, res: Response, next: NextFunction) => {
      handler(req as any, res as any, next as any);
    },
  );

  konsier
    .sync()
    .then(() => {
      console.log("[KONSIER] Synced configuration successfully");
    })
    .catch((err: unknown) => {
      console.error(
        "[KONSIER] Sync failed",
        err instanceof Error ? err.message : err,
      );
    });

  return konsier;
}


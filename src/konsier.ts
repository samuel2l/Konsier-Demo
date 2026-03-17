import type { Express, Request, Response, NextFunction } from "express";
import { Konsier } from "konsier";
import { z } from "zod";
import { Pickup } from "./types";

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
  }),
  handler: async (input, ctx) => {
    const body = {
      studentName: input.student_name,
      fromLocation: input.from_location,
      toLocation: input.to_location,
      notes: input.notes,
      scheduledAt: input.scheduled_at,
      konsierUserId: ctx.user?.id,
      konsierConversationId: ctx.conversation?.id,
    };

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
  name: "pickup_create_paystack_link",
  description:
    "Create a Paystack payment link for a pickup so the student can pay the campus delivery fee.",
  input: z.object({
    pickup_id: z.number().int().describe("The pickup ID to pay for"),
  }),
  handler: async (input) => {
    const result = await callApi<{
      authorization_url: string;
      reference: string;
    }>("POST", `/api/pickups/${input.pickup_id}/paystack-link`);

    return {
      authorization_url: result.authorization_url,
      reference: result.reference,
    };
  },
});

let konsierInstance: Konsier | null = null;

export async function notifyPickupUser(
  pickup: Pickup,
  text: string,
): Promise<void> {
  if (!konsierInstance) return;
  if (!pickup.konsierUserId && !pickup.konsierConversationId) return;

  try {
    await konsierInstance.sendMessage({
      ...(pickup.konsierUserId ? { userId: pickup.konsierUserId } : {}),
      ...(pickup.konsierConversationId
        ? { conversationId: pickup.konsierConversationId }
        : {}),
      text,
    });
  } catch {
    /* ignore in demo */
  }
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
          "- Generate a Paystack payment link when they are ready to pay the fee.",
          "",
          "Always confirm key details (from where, to where, roughly when) before creating a pickup.",
          "Use tools to fetch fresh status instead of guessing.",
        ].join("\n"),
        tools: [
          createPickupTool,
          listPickupsTool,
          getPickupDetailsTool,
          checkInPickupTool,
          createPaystackLinkTool,
        ],
      },
    },
    internal: {
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


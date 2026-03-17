import express from "express";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import { Konsier } from "konsier";
import { z } from "zod";

// Simple in-memory storage for demo purposes
type PickupStatus = "pending" | "in_progress" | "completed";

interface Pickup {
  id: number;
  studentName: string;
  fromLocation: string;
  toLocation: string;
  notes?: string;
  scheduledAt?: string;
  feeGhs: number;
  status: PickupStatus;
  // Konsier linkage so we can message the right person
  konsierUserId?: string;
  konsierConversationId?: string | number;
}

const pickups: Pickup[] = [];
let nextPickupId = 1;

const PAYSTACK_SECRET = "sk_test_ea66bd6f97f876c5d229c53e273ea5c2ef831ef0";
const PAYSTACK_BASE = "https://api.paystack.co";

const app = express();
app.use(cors());
app.use(express.json());

// Small helper for calling our own HTTP API from tools
async function callApi<T>(
  method: "GET" | "POST",
  path: string,
  body?: any,
): Promise<T> {
  const axios = (await import("axios")).default;
  const url = `http://localhost:${process.env.PORT || 4000}${path}`;
  const config: any = {};
  if (method === "GET") {
    const response = await axios.get(url, config);
    return response.data as T;
  }
  const response = await axios.post(url, body ?? {}, config);
  return response.data as T;
}

// --- Core HTTP endpoints (these are what tools will call) ---

app.post("/api/pickups", async (req: Request, res: Response) => {
  const schema = z.object({
    studentName: z.string(),
    fromLocation: z.string(),
    toLocation: z.string(),
    notes: z.string().optional(),
    scheduledAt: z.string().optional(),
    konsierUserId: z.string().optional(),
    konsierConversationId: z.union([z.string(), z.number()]).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.format() });
  }

  const feeGhs = 25; // flat demo fee

  const pickup: Pickup = {
    id: nextPickupId++,
    studentName: parsed.data.studentName,
    fromLocation: parsed.data.fromLocation,
    toLocation: parsed.data.toLocation,
    feeGhs,
    status: "pending",
  };

  if (parsed.data.konsierUserId) {
    pickup.konsierUserId = parsed.data.konsierUserId;
  }
  if (parsed.data.konsierConversationId !== undefined) {
    pickup.konsierConversationId = parsed.data.konsierConversationId;
  }
  if (parsed.data.notes) {
    pickup.notes = parsed.data.notes;
  }
  if (parsed.data.scheduledAt) {
    pickup.scheduledAt = parsed.data.scheduledAt;
  }

  pickups.push(pickup);

  return res.json({
    pickup_id: pickup.id,
    fee_ghs: pickup.feeGhs,
    status: pickup.status,
  });
});

app.get("/api/pickups/:id", (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const pickup = pickups.find((p) => p.id === id);
  if (!pickup) return res.status(404).json({ error: "Pickup not found" });
  return res.json(pickup);
});

app.get("/api/pickups", (req: Request, res: Response) => {
  // In a real app you'd filter by authenticated user; here we just return all for demo
  return res.json({ pickups });
});

app.post("/api/pickups/:id/check-in", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const pickup = pickups.find((p) => p.id === id);
  if (!pickup) return res.status(404).json({ error: "Pickup not found" });

  if (pickup.status === "completed") {
    return res.status(400).json({ error: "Pickup already completed" });
  }

  if (pickup.status === "pending") {
    pickup.status = "in_progress";
    await notifyPickupUser(
      pickup,
      `Your pickup #${pickup.id} is now in progress. The runner has started the job from ${pickup.fromLocation}.`,
    );
  } else if (pickup.status === "in_progress") {
    pickup.status = "completed";
    await notifyPickupUser(
      pickup,
      `Your pickup #${pickup.id} has been completed. Items have arrived at ${pickup.toLocation}.`,
    );
  }

  return res.json({ pickup });
});

app.post("/api/pickups/:id/paystack-link", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const pickup = pickups.find((p) => p.id === id);
  if (!pickup) return res.status(404).json({ error: "Pickup not found" });

  // For demo we always allow payment, even if completed
  const axios = (await import("axios")).default;

  const amountKobo = Math.round(pickup.feeGhs * 100);

  try {
    const response = await axios.post(
      `${PAYSTACK_BASE}/transaction/initialize`,
      {
        amount: amountKobo,
        email: "demo@student.example.com",
        metadata: {
          pickup_id: pickup.id,
          student_name: pickup.studentName,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          "Content-Type": "application/json",
        },
      },
    );

    const payload = {
      authorization_url: response.data.data.authorization_url,
      reference: response.data.data.reference,
    };

    await notifyPickupUser(
      pickup,
      `Here is your payment link for pickup #${pickup.id}: ${payload.authorization_url}`,
    );

    return res.json(payload);
  } catch (err: any) {
    console.error("[PAYSTACK] Error initializing transaction:", err.message);
    return res.status(500).json({ error: "Failed to create Paystack link" });
  }
});

// --- Konsier setup ---

const endpointUrl =
  "https://perpetually-geomorphological-alan.ngrok-free.dev/konsier";

// Use an env var for the real API key in practice.
const KONSIER_API_KEY =
  process.env.KONSIER_API_KEY || "REPLACE_WITH_REAL_API_KEY";

// Tools definitions
const createPickupTool = Konsier.tool({
  name: "pickup_create_from_description",
  description:
    "Create a new campus pickup when the student has clearly provided: their name, where items are picked up from, where they should go, and roughly when.",
  input: z.object({
    student_name: z.string().describe("Student's full name"),
    from_location: z
      .string()
      .describe("Pickup location on campus (e.g. 'Hall A, Room 203')"),
    to_location: z
      .string()
      .describe("Drop-off location on campus (e.g. 'Hall B, Reception')"),
    notes: z
      .string()
      .optional()
      .describe("Extra notes about items (e.g. '2 suitcases and a box')"),
    scheduled_at: z
      .string()
      .optional()
      .describe("Optional scheduled time, e.g. 'tomorrow 9am' or ISO string"),
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
    "List recent pickups for the student so they can choose which one to ask about. Use this when they say things like 'my last pickup' or 'the one from yesterday'.",
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
    "Get detailed information about ONE pickup by ID, including status and fee. Use this whenever the student asks about a specific pickup.",
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
    "Advance the status of a pickup (pending → in_progress → completed). Use this when the runner has arrived or finished, and the student requests an update.",
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

// Helper to send proactive messages back to the pickup owner
async function notifyPickupUser(pickup: Pickup, text: string): Promise<void> {
  if (!konsier) return;
  if (!pickup.konsierUserId && !pickup.konsierConversationId) return;

  try {
    await konsier.sendMessage({
      ...(pickup.konsierUserId ? { userId: pickup.konsierUserId } : {}),
      ...(pickup.konsierConversationId
        ? { conversationId: pickup.konsierConversationId }
        : {}),
      text,
    });
    // eslint-disable-next-line no-console
    console.log("[KONSIER] Notification sent for pickup", pickup.id);
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error(
      "[KONSIER] Failed to send notification:",
      err?.message ?? err,
    );
  }
}

const konsier =
  KONSIER_API_KEY === "REPLACE_WITH_REAL_API_KEY"
    ? null
    : new Konsier({
        apiKey: KONSIER_API_KEY,
        endpointUrl,
        debug: true,
        agents: {
          campus_runner: {
            name: "Campus Runner",
            description:
              "Helps students schedule and track item pickups on campus.",
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
      });

if (!konsier) {
  // eslint-disable-next-line no-console
  console.warn(
    "[KONSIER] No KONSIER_API_KEY set. The HTTP API will run, but Konsier will not be connected.",
  );
} else {
  // Mount Konsier webhook at /konsier (matches the configured endpoint URL path)
  const handler = konsier.webhookHandler();
  const webhookPath = konsier.webhookPath();
  app.post(
    webhookPath,
    (req: Request, res: Response, next: NextFunction) => {
      handler(req as any, res as any, next as any);
    },
  );
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Campus demo server listening on port ${PORT}`);
});


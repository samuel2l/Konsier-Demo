import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import { z } from "zod";
import { initKonsier, notifyPickupUser } from "./konsier";
import { advancePickupStatus, createPickup, getPickup, listPickups } from "./pickups-store";

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET ?? "";
const PAYSTACK_BASE = "https://api.paystack.co";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/admin/pickups", (_req: Request, res: Response) => {
  const rows = listPickups()
    .map(
      (p) => `
        <tr>
          <td>${p.id}</td>
          <td>${p.studentName}</td>
          <td>${p.fromLocation}</td>
          <td>${p.toLocation}</td>
          <td>${p.status}</td>
          <td>${p.feeGhs}</td>
          <td>
            <button data-id="${p.id}" class="checkin-btn"${
              p.status === "completed" ? " disabled" : ""
            }>
              ${
                p.status === "pending"
                  ? "Mark in progress"
                  : p.status === "in_progress"
                    ? "Mark completed"
                    : "Completed"
              }
            </button>
          </td>
        </tr>
      `,
    )
    .join("");

  const html = `<!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>Campus Runner Pickups</title>
      <style>
        body { font-family: system-ui, sans-serif; padding: 1.5rem; background: #fafafa; }
        table { border-collapse: collapse; width: 100%; background: #fff; }
        th, td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #eee; font-size: 14px; }
        th { text-align: left; background: #f0f2f5; }
        button { padding: 0.25rem 0.75rem; font-size: 12px; cursor: pointer; }
        button[disabled] { opacity: 0.5; cursor: default; }
        .toast { position: fixed; bottom: 1rem; right: 1rem; background: #111; color: #fff; padding: 0.5rem 0.75rem; border-radius: 4px; font-size: 12px; display: none; }
      </style>
    </head>
    <body>
      <h1>Campus Runner Pickups</h1>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Student</th>
            <th>From</th>
            <th>To</th>
            <th>Status</th>
            <th>Fee (GHS)</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="7">No pickups yet. Create one via the bot.</td></tr>'}
        </tbody>
      </table>
      <div id="toast" class="toast"></div>
      <script>
        function showToast(msg) {
          var el = document.getElementById('toast');
          el.textContent = msg;
          el.style.display = 'block';
          setTimeout(function () { el.style.display = 'none'; }, 2500);
        }
        document.addEventListener('click', function (e) {
          var btn = e.target.closest('.checkin-btn');
          if (!btn) return;
          var id = btn.getAttribute('data-id');
          if (!id) return;
          btn.disabled = true;
          fetch('/api/pickups/' + id + '/check-in', { method: 'POST' })
            .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
            .then(function (result) {
              if (!result.ok || result.data.error) {
                throw new Error(result.data.error || 'Failed to check in');
              }
              showToast('Updated pickup #' + id + ' to ' + result.data.pickup.status);
              setTimeout(function () { window.location.reload(); }, 700);
            })
            .catch(function (err) {
              showToast(err.message || 'Failed to check in');
              btn.disabled = false;
            });
        });
      </script>
    </body>
  </html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

app.post("/api/pickups", async (req: Request, res: Response) => {
  const attachmentSchema = z.object({
    type: z.enum(["image", "video", "file"]),
    url: z.string().url(),
    name: z.string().optional(),
  });

  const locationSchema = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    label: z.string().optional(),
  });

  const schema = z.object({
    studentName: z.string(),
    fromLocation: z.string(),
    toLocation: z.string(),
    notes: z.string().optional(),
    scheduledAt: z.string().optional(),
    attachments: z.array(attachmentSchema).max(10).optional(),
    location: locationSchema.optional(),
    konsierUserId: z.string().optional(),
    konsierConversationId: z.union([z.string(), z.number()]).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.format() });
  }

  const normalizedAttachments = parsed.data.attachments?.map((item) => ({
    type: item.type,
    url: item.url,
    ...(item.name ? { name: item.name } : {}),
  }));
  const normalizedLocation = parsed.data.location
    ? {
        latitude: parsed.data.location.latitude,
        longitude: parsed.data.location.longitude,
        ...(parsed.data.location.label ? { label: parsed.data.location.label } : {}),
      }
    : undefined;

  const pickup = createPickup({
    studentName: parsed.data.studentName,
    fromLocation: parsed.data.fromLocation,
    toLocation: parsed.data.toLocation,
    ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
    ...(parsed.data.scheduledAt ? { scheduledAt: parsed.data.scheduledAt } : {}),
    ...(normalizedAttachments ? { attachments: normalizedAttachments } : {}),
    ...(normalizedLocation ? { location: normalizedLocation } : {}),
    ...(parsed.data.konsierUserId ? { konsierUserId: parsed.data.konsierUserId } : {}),
    ...(parsed.data.konsierConversationId !== undefined
      ? { konsierConversationId: parsed.data.konsierConversationId }
      : {}),
  });

  const attachmentSummary = (pickup.attachments ?? []).reduce(
    (acc, item) => {
      acc[item.type] += 1;
      return acc;
    },
    { image: 0, video: 0, file: 0 } as Record<"image" | "video" | "file", number>,
  );
  console.log("[API][pickups.create] stored", {
    pickup_id: pickup.id,
    konsier_user_id: pickup.konsierUserId ?? null,
    konsier_conversation_id: pickup.konsierConversationId ?? null,
    attachments_total: (pickup.attachments ?? []).length,
    attachments_by_type: attachmentSummary,
    has_location: Boolean(pickup.location),
  });

  return res.json({
    pickup_id: pickup.id,
    fee_ghs: pickup.feeGhs,
    status: pickup.status,
  });
});

app.get("/api/pickups/:id", (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const pickup = getPickup(id);
  if (!pickup) return res.status(404).json({ error: "Pickup not found" });
  return res.json(pickup);
});

app.get("/api/pickups", (req: Request, res: Response) => {
  return res.json({ pickups: listPickups() });
});

app.post("/api/pickups/:id/check-in", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const result = advancePickupStatus(id);
  if (!result.pickup) return res.status(404).json({ error: "Pickup not found" });
  if (result.error) return res.status(400).json({ error: result.error });

  if (result.pickup.status === "in_progress") {
    console.log("[API][pickups.check-in] notifying in_progress", {
      pickup_id: result.pickup.id,
      attachments_total: (result.pickup.attachments ?? []).length,
      has_location: Boolean(result.pickup.location),
    });
    await notifyPickupUser(
      result.pickup,
      `Your pickup #${result.pickup.id} is now in progress. The runner has started the job from ${result.pickup.fromLocation}.`,
    );
  } else if (result.pickup.status === "completed") {
    console.log("[API][pickups.check-in] notifying completed", {
      pickup_id: result.pickup.id,
      attachments_total: (result.pickup.attachments ?? []).length,
      has_location: Boolean(result.pickup.location),
    });
    await notifyPickupUser(
      result.pickup,
      `Your pickup #${result.pickup.id} has been completed. Items have arrived at ${result.pickup.toLocation}.`,
    );
  }

  return res.json({ pickup: result.pickup });
});

app.post("/api/pickups/:id/paystack-link", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const pickup = getPickup(id);
  if (!pickup) return res.status(404).json({ error: "Pickup not found" });

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

    return res.json(payload);
  } catch (err: any) {
    console.error("[PAYSTACK] Error initializing transaction:", err.message);
    return res.status(500).json({ error: "Failed to create Paystack link" });
  }
});

initKonsier(app);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Campus demo server listening on port ${PORT}`);
});


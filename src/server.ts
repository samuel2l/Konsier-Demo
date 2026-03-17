import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import cors from "cors";
import { z } from "zod";
import { Pickup } from "./types";
import { initKonsier, notifyPickupUser } from "./konsier";

const pickups: Pickup[] = [];
let nextPickupId = 1;

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET ?? "";
const PAYSTACK_BASE = "https://api.paystack.co";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/admin/pickups", (_req: Request, res: Response) => {
  const rows = pickups
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

  const feeGhs = 25;

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


## Campus Runner – Konsier Demo

Campus Runner is a small demo project that showcases **Konsier** as the brain on top of a simple logistics workflow for a university campus.

It is intentionally built with:

- No database (in-memory storage only)
- A minimal Express backend
- Konsier as the “front-end” via channels the student already uses (Telegram, etc.)

### Scenario

- Students chat with a Konsier-powered bot (e.g. on Telegram) and say things like:
  - “Help me move my boxes from Hall A to Hall B tomorrow morning”
  - “What’s the status of my last pickup?”
  - “I’m ready to pay for the pickup”
- The bot uses **tools** to talk to this backend and manages:
  - Pickup creation
  - Listing and tracking
  - Check-ins
  - Payment link generation via **Paystack**

Everything is intentionally kept in **in-memory storage** so the demo is lightweight and easy to reset. No database setup is required.

### Why a campus logistics assistant makes sense

On most campuses, it is easy to imagine a student or benefactor saying:

> “I wish there was a simple way to get a rider to move my boxes across campus.”

The idea is good, but the typical next steps are heavy:

- Design and build a **mobile app** or web app
- Convince students to **install yet another app**
- Maintain iOS/Android/web codebases, deployments, and authentication

In practice, many people never download the app:

- Industry data shows that users install **very few new apps per month**, and most installs are abandoned quickly.
- App stores are crowded; small utilities struggle to get past this adoption barrier.

Campus Runner instead leans on Konsier so that:

- Students never download anything new – they just talk to a bot on channels they already use daily.
- The “app” is effectively a chat + a small backend, not a full-blown UI project.

### How the backend is structured

- `src/server.ts`:
  - Small **Express** API exposing JSON endpoints under `/api/*`
  - In-memory array of `pickups` storing:
    - `id`, `studentName`, `fromLocation`, `toLocation`, `notes`, `scheduledAt`
    - `feeGhs`
    - `status` (`pending` → `in_progress` → `completed`)
    - `konsierUserId` and `konsierConversationId` for sending messages back
  - Paystack integration:
    - `POST /api/pickups/:id/paystack-link` initializes a transaction and returns an `authorization_url`
- `src/konsier.ts`:
  - Konsier client and agent configuration
  - Tool definitions that wrap the HTTP endpoints
  - Registration of an **internal page**:
    - Name: `Pickups`
    - Path: `/admin/pickups`
  - `initKonsier(app)`:
    - Mounts the Konsier webhook on the Express app
    - Calls `konsier.sync()` and logs whether sync succeeded

### Where Konsier shines in this demo

1. **Natural language → structured actions**
   - Students talk in free text (“move my stuff from A to B tomorrow 9am”).
   - The Konsier agent uses tools (backed by these API endpoints) to:
     - Create a pickup (`/api/pickups`)
     - List their pickups (`/api/pickups`)
     - Get details (`/api/pickups/:id`)
     - Generate Paystack links (`/api/pickups/:id/paystack-link`)

2. **Channel-agnostic messaging**
   - Each pickup stores the **Konsier user ID** and **conversation ID**.
   - Whenever something important happens (e.g. driver checks in, pickup complete), the backend can call:
     - `konsier.sendMessage({ userId, conversationId, text })`
   - This lets the backend proactively **push updates to the same conversation** the user started on (Telegram / other channels) without needing to know channel-specific details.

3. **Simple, stateless backend**
   - Because Konsier handles:
     - User identity (IDs, metadata)
     - Conversations
     - Routing across channels
   - The backend can stay very small:
     - Just in-memory storage
     - A few endpoints
   - In a real project, you could swap the in-memory store for Postgres or any DB without changing the Konsier integration patterns.

4. **Tooling + internal HTTP API separation**
   - The backend **does not depend on Konsier** to function:
     - You can cURL the `/api/*` endpoints directly.
   - Konsier just becomes:
     - A smart “front-end brain” that orchestrates these endpoints via tools.
   - This clean separation makes it easy to:
     - Reuse the same backend for other UIs (web, mobile) or automations.

5. **No traditional frontend required**
   - There is no React/Next.js/mobile app here.
   - Konsier connects this backend directly to:
     - Telegram (and other supported channels)
     - The Konsier “internal page” model (the `/admin/pickups` UI)
   - This eliminates:
     - App store distribution
     - Frontend hosting/CI/CD
     - Separate session/auth layers for web/mobile

6. **Payments without a heavy checkout UI**
   - Because Konsier tools can call the backend, which then calls Paystack, the conversation itself can:
     - Offer to pay
     - Generate a secure payment link
     - Send that link back on the same channel
   - As soon as payment is “activated on your end” (Paystack keys in env), you can take payments with almost no extra code.

### Running the demo

1. Install dependencies (already set up in `package.json`):

   ```bash
   cd konsier-campus-demo
   npm install
   ```

2. Copy `.env.example` to `.env` and set values:

   ```bash
   KONSIER_API_KEY=sk_your_konsier_project_key
   KONSIER_ENDPOINT_URL=https://your-ngrok-or-domain.ngrok-free.dev/konsier
   PAYSTACK_SECRET=sk_test_paystack_secret_key_here
   ```

3. Start the dev server:

   ```bash
   npm run dev
   ```

4. In Konsier Cloud:
   - Point the project’s endpoint URL to:
     - `https://perpetually-geomorphological-alan.ngrok-free.dev/konsier`
   - Link your Telegram bot / other channel to this project.

5. Talk to the bot:
   - Place a pickup
   - Ask for status
   - Request a payment link
   - Open the **Pickups** page inside Konsier and advance check-ins

### Advantages of using Konsier for this kind of campus assistant

- **Fast iteration**:
  - You can change the agent’s system prompt and tools without redeploying the backend.
- **Multi-channel out of the box**:
  - Same logic works for Telegram, Slack, or other supported channels.
- **Tool orchestration handled by the LLM**:
  - You don’t need to hand-code conversational flows like “if user says X then call Y API”.
  - Just describe tools and behavior; Konsier + the LLM decide when to use them.
- **Proactive messaging**:
  - Because the backend stores Konsier identifiers, it can push:
    - “Pickup created”
    - “Runner is on the way”
    - “Pickup completed”
    - “Here’s your payment link”
  - This makes the experience feel live and event-driven, not just Q&A.

- **Lower barrier to launch**:
  - A student or benefactor can go from idea → working campus assistant with:
    - A single small TypeScript backend
    - A Konsier project and a connected channel (e.g. Telegram)
    - Some environment variables for Konsier + Paystack
  - No separate frontend team, no app store, no extra hosting layers.



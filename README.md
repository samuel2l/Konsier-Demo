## Campus Runner – Konsier Demo

Campus Runner is a small demo project that showcases **Konsier** as the brain on top of a simple logistics workflow for a university campus.

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

### How the backend is structured

- `src/server.ts`:
  - Small **Express** API exposing JSON endpoints under `/api/*`
  - In-memory array of `pickups` storing:
    - `id`, `studentName`, `fromLocation`, `toLocation`, `notes`, `scheduledAt`
    - `feeGhs`
    - `status` (`pending` → `in_progress` → `completed`)
    - `konsierUserId` and `konsierConversationId` for sending messages back
  - **Paystack** integration:
    - Uses the provided test secret key
    - `POST /api/pickups/:id/paystack-link` initializes a transaction and returns an `authorization_url`
  - **Konsier** setup:
    - Creates a `Konsier` client with:
      - `endpointUrl` set to `https://perpetually-geomorphological-alan.ngrok-free.dev/konsier`
      - A single agent called `campus_runner`
    - The agent’s `systemPrompt` explains:
      - What it can do (create pickups, list, show status, create payment links)
      - When to use tools vs. normal conversation

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

### Running the demo

1. Install dependencies (already set up in `package.json`):

   ```bash
   cd konsier-campus-demo
   npm install
   ```

2. Set your Konsier API key:

   ```bash
   export KONSIER_API_KEY=sk_your_konsier_project_key
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


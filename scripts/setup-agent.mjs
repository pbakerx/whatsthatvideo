// Creates (or updates) the ElevenLabs voice agent and the client tools the
// browser implements in app/finder.tsx. Safe to re-run.
//
//   npm run setup:agent
//
// Reads ELEVENLABS_API_KEY from .env.local. Set ELEVENLABS_AGENT_ID to update
// an existing agent instead of creating a new one.

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("Set ELEVENLABS_API_KEY in .env.local first.");
  process.exit(1);
}

const elevenlabs = new ElevenLabsClient({ apiKey });
const ai = elevenlabs.conversationalAi;

const AGENT_NAME = "What Was That Video?";

const intFromEnv = (name, fallback) => Number.parseInt(process.env[name] ?? "", 10) || fallback;

// Names and parameters must match the useConversationClientTool handlers.
const TOOLS = [
  {
    type: "client",
    name: "search_videos",
    description:
      "Search for the video the user half-remembers. Call it as soon as they describe anything, however vague. Returns the videos now on their screen.",
    expectsResponse: true,
    responseTimeoutSecs: 20,
    parameters: {
      type: "object",
      required: ["description"],
      properties: {
        description: {
          type: "string",
          description: "Everything the user remembers about the video, in their own words.",
        },
      },
    },
  },
  {
    type: "client",
    name: "refine_search",
    description:
      'Search again after the user reacts to the results, e.g. "closer", "number two is close", "no, it was a cat".',
    expectsResponse: true,
    responseTimeoutSecs: 20,
    parameters: {
      type: "object",
      required: ["feedback"],
      properties: {
        feedback: {
          type: "string",
          description: "What the user said is different or wrong, in their words. Empty if they only picked a closer result.",
        },
        closer_to: {
          type: "integer",
          description: "The on-screen number (1-4) of the result they said was close. Omit if they didn't point at one.",
        },
      },
    },
  },
  {
    type: "client",
    name: "show_video",
    description: "Play a result on screen when the user says it's the one.",
    expectsResponse: false,
    parameters: {
      type: "object",
      required: ["number"],
      properties: {
        number: { type: "integer", description: "The on-screen number (1-4) of the video." },
      },
    },
  },
];

const PROMPT = `You are "What Was That Video?", a voice sidekick that finds online videos people half-remember. You're friendly, slightly cheeky and confident.

How a session goes:
- You've already asked "What do you remember?". As soon as they describe anything, however vague, call search_videos with their words. Don't ask follow-up questions first.
- The results appear on their screen. After a search, say one short line of under 15 words: name your best guess or react to it, and invite them to say "closer" or correct you.
- When they correct a detail or say one is close, call refine_search with their words. If they point at a result ("the second one"), pass its number as closer_to.
- When they say one is it, call show_video with its number and celebrate in a few words.
- If a tool says you're out of guesses or searches, say so briefly and suggest starting fresh.

Keep every turn short. Never read out lists, links or descriptions; they're on screen. Only mention videos the tools returned, and never invent titles. If nothing matches, ask for one more detail, like where they saw it or how it ended.`;

async function upsertTool(toolConfig) {
  const { tools } = await ai.tools.list({ search: toolConfig.name });
  const existing = tools.find((tool) => tool.toolConfig.type === "client" && tool.toolConfig.name === toolConfig.name);
  if (existing) {
    await ai.tools.update(existing.id, { toolConfig });
    console.log(`Updated tool ${toolConfig.name} (${existing.id})`);
    return existing.id;
  }
  const created = await ai.tools.create({ toolConfig });
  console.log(`Created tool ${toolConfig.name} (${created.id})`);
  return created.id;
}

const toolIds = [];
for (const tool of TOOLS) toolIds.push(await upsertTool(tool));

const conversationConfig = {
  agent: {
    firstMessage: "What do you remember?",
    language: "en",
    maxConversationDurationMessage: "That's time! Hope we found it.",
    prompt: {
      prompt: PROMPT,
      // Fast and cheap; the agent only chats and calls tools.
      llm: process.env.ELEVENLABS_AGENT_LLM ?? "claude-haiku-5-5",
      toolIds,
    },
  },
  ...(process.env.ELEVENLABS_VOICE_ID && { tts: { voiceId: process.env.ELEVENLABS_VOICE_ID } }),
  conversation: {
    // Voice minutes are the main cost, so sessions are short by design.
    maxDurationSeconds: intFromEnv("VOICE_MAX_SECONDS", 180),
    // Listing client events replaces the defaults; without "audio" the agent
    // never streams speech back to the browser.
    clientEvents: [
      "conversation_initiation_metadata",
      "asr_initiation_metadata",
      "ping",
      "audio",
      "interruption",
      "user_transcript",
      "agent_response",
      "agent_response_correction",
      "client_tool_call",
    ],
  },
};

const platformSettings = {
  // Only our server can start conversations (via /api/voice-token).
  auth: { enableAuth: true },
  callLimits: {
    dailyLimit: intFromEnv("VOICE_DAILY_LIMIT", 100),
    agentConcurrencyLimit: intFromEnv("VOICE_CONCURRENCY_LIMIT", 5),
  },
};

const agentId = process.env.ELEVENLABS_AGENT_ID;
if (agentId) {
  await ai.agents.update(agentId, { name: AGENT_NAME, conversationConfig, platformSettings });
  console.log(`Updated agent ${agentId}`);
} else {
  const created = await ai.agents.create({ name: AGENT_NAME, conversationConfig, platformSettings });
  console.log(`Created agent. Add this to .env.local and to Vercel:\n\nELEVENLABS_AGENT_ID=${created.agentId}`);
}

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { connection } from "next/server";

// The agent has auth enabled, so the browser needs a short-lived token minted
// with our API key. The key itself never leaves the server.
export async function GET(): Promise<Response> {
  await connection();

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!apiKey || !agentId) {
    return Response.json(
      { error: "config", message: "Voice isn't set up here yet. Type it instead!" },
      { status: 503 },
    );
  }

  try {
    const elevenlabs = new ElevenLabsClient({ apiKey });
    const { token } = await elevenlabs.conversationalAi.conversations.getWebrtcToken({ agentId });
    return Response.json({ token }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("ElevenLabs token request failed", error);
    return Response.json(
      { error: "upstream", message: "Couldn't wake the voice up. Type it instead?" },
      { status: 502 },
    );
  }
}

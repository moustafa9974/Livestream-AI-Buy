import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { runAssistant } from "@/lib/assistant/run";
import { getCurrentCreator } from "@/lib/session";

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(20),
});

/** Creator assistant. Tools are scoped to the signed-in creator server-side. */
export async function POST(req: Request) {
  try {
    const creator = await getCurrentCreator();
    if (!creator) return Response.json({ error: "Not signed in" }, { status: 401 });
    const { messages } = Body.parse(await req.json());
    return Response.json(await runAssistant(creator, messages));
  } catch (err) {
    return errorResponse(err);
  }
}

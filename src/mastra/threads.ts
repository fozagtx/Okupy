import type { NeonQueryFunction } from "@neondatabase/serverless";
import { getDb } from "./db.js";

type NeonClient = NeonQueryFunction<false, false>;

export type ThreadEntry = {
  role: "user" | "assistant";
  content: string;
  at: string;
};

const MAX_MESSAGES = 30;

export class ThreadStore {
  constructor(private readonly sql: NeonClient = getDb() as NeonClient) {}

  async append(userId: string, entry: ThreadEntry): Promise<void> {
    const rows = await this.sql`SELECT messages FROM agent_threads WHERE user_id = ${userId} LIMIT 1`;
    const existing = parseMessages((rows as { messages: unknown }[])[0]?.messages);
    const next = [...existing, entry].slice(-MAX_MESSAGES);
    await this.sql`
      INSERT INTO agent_threads (user_id, messages, updated_at)
      VALUES (${userId}, ${JSON.stringify(next)}::jsonb, now())
      ON CONFLICT (user_id) DO UPDATE SET
        messages = EXCLUDED.messages,
        updated_at = now()
    `;
  }

  async list(userId: string): Promise<ThreadEntry[]> {
    const rows = await this.sql`SELECT messages FROM agent_threads WHERE user_id = ${userId} LIMIT 1`;
    return parseMessages((rows as { messages: unknown }[])[0]?.messages);
  }

  async clear(userId: string): Promise<void> {
    await this.sql`
      INSERT INTO agent_threads (user_id, messages, updated_at)
      VALUES (${userId}, '[]'::jsonb, now())
      ON CONFLICT (user_id) DO UPDATE SET
        messages = '[]'::jsonb,
        updated_at = now()
    `;
  }
}

function parseMessages(value: unknown): ThreadEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): ThreadEntry | null => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Record<string, unknown>;
      if ((candidate.role !== "user" && candidate.role !== "assistant") || typeof candidate.content !== "string") {
        return null;
      }
      return {
        role: candidate.role,
        content: candidate.content.slice(0, 2_000),
        at: typeof candidate.at === "string" ? candidate.at : new Date().toISOString(),
      };
    })
    .filter((entry): entry is ThreadEntry => entry !== null);
}

export const threadStore = new Proxy({} as ThreadStore, {
  get(_target, prop, receiver) {
    const globalScope = globalThis as { __okupyThreadStore?: ThreadStore };
    if (!globalScope.__okupyThreadStore) {
      globalScope.__okupyThreadStore = new ThreadStore(getDb() as NeonClient);
    }
    return Reflect.get(globalScope.__okupyThreadStore, prop, receiver);
  },
});
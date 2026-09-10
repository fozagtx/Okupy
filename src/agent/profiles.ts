import type { NeonQueryFunction } from "@neondatabase/serverless";
import { z } from "zod";
import { getDb } from "./db.js";

export const builderProfileInputSchema = z.object({
  userId: z.string().trim().min(1).max(256),
  name: z.string().trim().max(120).default(""),
  project: z.string().trim().min(2).max(2_000),
  projectStage: z.string().trim().min(1).max(120).default("building"),
  goals: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  interests: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  location: z.string().trim().min(2).max(240),
  radiusMiles: z.number().int().min(1).max(250).default(25),
});

export type BuilderProfileInput = z.input<typeof builderProfileInputSchema>;
export type BuilderProfile = z.output<typeof builderProfileInputSchema> & { updatedAt: string };

type OnboardingDraft = {
  step: "project" | "location" | "goals";
  project?: string;
  location?: string;
};

export type OnboardingResult = {
  complete: boolean;
  profile?: BuilderProfile;
  reply: string;
};

export class ProfileStore {
  constructor(private readonly sql: NeonQueryFunction<false, false> = getDb()) {}

  private async readProfile(userId: string): Promise<BuilderProfile | null> {
    const rows = await this.sql`
      SELECT user_id, name, project, project_stage, goals, interests, location, radius_miles, updated_at
      FROM profiles
      WHERE user_id = ${userId}
      LIMIT 1
    `;
    const row = (rows as Record<string, unknown>[])[0];
    return row ? rowToProfile(row) : null;
  }

  private async readDraft(userId: string): Promise<OnboardingDraft | null> {
    const rows = await this.sql`
      SELECT step, project, location FROM onboarding_drafts WHERE user_id = ${userId} LIMIT 1
    `;
    const row = (rows as Record<string, unknown>[])[0];
    if (!row) return null;
    return {
      step: row.step as OnboardingDraft["step"],
      project: (row.project as string | null) ?? undefined,
      location: (row.location as string | null) ?? undefined,
    };
  }

  async getProfile(userId: string): Promise<BuilderProfile | null> {
    return this.readProfile(userId);
  }

  async saveProfile(input: BuilderProfileInput): Promise<BuilderProfile> {
    const parsed = builderProfileInputSchema.parse(input);
    const goalsJson = JSON.stringify(parsed.goals);
    const interestsJson = JSON.stringify(parsed.interests);
    await this.sql`
      INSERT INTO profiles (user_id, name, project, project_stage, goals, interests, location, radius_miles, updated_at)
      VALUES (${parsed.userId}, ${parsed.name}, ${parsed.project}, ${parsed.projectStage},
              ${goalsJson}::jsonb, ${interestsJson}::jsonb, ${parsed.location}, ${parsed.radiusMiles}, now())
      ON CONFLICT (user_id) DO UPDATE SET
        name = EXCLUDED.name,
        project = EXCLUDED.project,
        project_stage = EXCLUDED.project_stage,
        goals = EXCLUDED.goals,
        interests = EXCLUDED.interests,
        location = EXCLUDED.location,
        radius_miles = EXCLUDED.radius_miles,
        updated_at = now()
    `;
    await this.sql`DELETE FROM onboarding_drafts WHERE user_id = ${parsed.userId}`;
    const profile = await this.readProfile(parsed.userId);
    if (!profile) throw new Error("Profile write did not persist.");
    return profile;
  }

  async hasOnboarding(userId: string): Promise<boolean> {
    const draft = await this.readDraft(userId);
    return draft !== null;
  }

  async beginOnboarding(userId: string): Promise<string> {
    await this.sql`
      INSERT INTO onboarding_drafts (user_id, step) VALUES (${userId}, 'project')
      ON CONFLICT (user_id) DO NOTHING
    `;
    return "First, what are you building?";
  }

  async advanceOnboarding(userId: string, message: string): Promise<OnboardingResult> {
    const value = message.trim();
    if (value.length < 2) {
      return { complete: false, reply: "Please add a little more detail so I can remember it." };
    }
    const draft = (await this.readDraft(userId)) ?? { step: "project" as const };

    if (draft.step === "project") {
      await this.upsertDraft(userId, { step: "location", project: value.slice(0, 2_000), location: draft.location });
      return { complete: false, reply: "Got it. What city or area should I search near?" };
    }

    if (draft.step === "location") {
      await this.upsertDraft(userId, { step: "goals", project: draft.project, location: value.slice(0, 240) });
      return { complete: false, reply: "Last one: who or what do you need—cofounders, customers, feedback, credits, or something else?" };
    }

    const goals = value.split(/,|\band\b/i).map(goal => goal.trim()).filter(Boolean).slice(0, 20);
    if (!draft.project || !draft.location) {
      return { complete: false, reply: "Something went off track. Tell me again what you're building." };
    }
    const profile = await this.saveProfile({
      userId,
      project: draft.project,
      location: draft.location,
      goals,
      interests: [],
    });
    return { complete: true, profile, reply: "You're set. What kind of event should I find for you?" };
  }

  private async upsertDraft(userId: string, draft: OnboardingDraft): Promise<void> {
    await this.sql`
      INSERT INTO onboarding_drafts (user_id, step, project, location, updated_at)
      VALUES (${userId}, ${draft.step}, ${draft.project ?? null}, ${draft.location ?? null}, now())
      ON CONFLICT (user_id) DO UPDATE SET
        step = EXCLUDED.step,
        project = EXCLUDED.project,
        location = EXCLUDED.location,
        updated_at = now()
    `;
  }
}

function rowToProfile(row: Record<string, unknown>): BuilderProfile {
  return {
    userId: row.user_id as string,
    name: (row.name as string | null) ?? "",
    project: row.project as string,
    projectStage: (row.project_stage as string | null) ?? "building",
    goals: parseJsonArray(row.goals),
    interests: parseJsonArray(row.interests),
    location: row.location as string,
    radiusMiles: (row.radius_miles as number | null) ?? 25,
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export const profileStore = new Proxy({} as ProfileStore, {
  get(_target, prop, receiver) {
    const instance = defaultInstance();
    return Reflect.get(instance, prop, receiver);
  },
});

function defaultInstance(): ProfileStore {
  const globalScope = globalThis as { __okupyProfileStore?: ProfileStore };
  if (!globalScope.__okupyProfileStore) {
    globalScope.__okupyProfileStore = new ProfileStore(getDb());
  }
  return globalScope.__okupyProfileStore;
}

export const getProfile = (userId: string) => defaultInstance().getProfile(userId);
export const saveProfile = (profile: BuilderProfileInput) => defaultInstance().saveProfile(profile);
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { config } from "./config.js";

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

type StoreState = {
  version: 1;
  profiles: Record<string, BuilderProfile>;
  onboarding: Record<string, OnboardingDraft>;
};

function dictionary<T>(value?: unknown): Record<string, T> {
  const result = Object.create(null) as Record<string, T>;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, entry] of Object.entries(value)) result[key] = entry as T;
  }
  return result;
}

const emptyState = (): StoreState => ({ version: 1, profiles: dictionary(), onboarding: dictionary() });

export type OnboardingResult = {
  complete: boolean;
  profile?: BuilderProfile;
  reply: string;
};

export class ProfileStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  private async readState(): Promise<StoreState> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Partial<StoreState>;
      if (parsed.version === 1 && parsed.profiles && parsed.onboarding) {
        return {
          version: 1,
          profiles: dictionary<BuilderProfile>(parsed.profiles),
          onboarding: dictionary<OnboardingDraft>(parsed.onboarding),
        };
      }

      // Migrate the original flat profile document written by PR #4.
      return { version: 1, profiles: dictionary<BuilderProfile>(parsed), onboarding: dictionary() };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
      throw error;
    }
  }

  private async writeState(state: StoreState): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  getProfile(userId: string): Promise<BuilderProfile | null> {
    return this.exclusive(async () => {
      const profiles = (await this.readState()).profiles;
      return Object.hasOwn(profiles, userId) ? profiles[userId] : null;
    });
  }

  saveProfile(input: BuilderProfileInput): Promise<BuilderProfile> {
    return this.exclusive(async () => {
      const state = await this.readState();
      const profile = { ...builderProfileInputSchema.parse(input), updatedAt: new Date().toISOString() };
      state.profiles[profile.userId] = profile;
      delete state.onboarding[profile.userId];
      await this.writeState(state);
      return profile;
    });
  }

  beginOnboarding(userId: string): Promise<string> {
    return this.exclusive(async () => {
      const state = await this.readState();
      state.onboarding[userId] ??= { step: "project" };
      await this.writeState(state);
      return "First, what are you building?";
    });
  }

  advanceOnboarding(userId: string, message: string): Promise<OnboardingResult> {
    return this.exclusive(async () => {
      const value = message.trim();
      const state = await this.readState();
      const draft = state.onboarding[userId] ?? { step: "project" as const };

      if (value.length < 2) {
        return { complete: false, reply: "Please add a little more detail so I can remember it." };
      }

      if (draft.step === "project") {
        state.onboarding[userId] = { step: "location", project: value.slice(0, 2_000) };
        await this.writeState(state);
        return { complete: false, reply: "Got it. What city or area should I search near?" };
      }

      if (draft.step === "location") {
        state.onboarding[userId] = { ...draft, step: "goals", location: value.slice(0, 240) };
        await this.writeState(state);
        return { complete: false, reply: "Last one: who or what do you need—cofounders, customers, feedback, credits, or something else?" };
      }

      const goals = value.split(/,|\band\b/i).map(goal => goal.trim()).filter(Boolean).slice(0, 20);
      const profile = {
        ...builderProfileInputSchema.parse({
          userId,
          project: draft.project,
          location: draft.location,
          goals,
          interests: [],
        }),
        updatedAt: new Date().toISOString(),
      };
      state.profiles[userId] = profile;
      delete state.onboarding[userId];
      await this.writeState(state);
      return { complete: true, profile, reply: "You're set. What kind of event should I find for you?" };
    });
  }

  hasOnboarding(userId: string): Promise<boolean> {
    return this.exclusive(async () => Boolean((await this.readState()).onboarding[userId]));
  }
}

export const profileStore = new ProfileStore(config.profileFile);

export const getProfile = (userId: string) => profileStore.getProfile(userId);
export const saveProfile = (profile: BuilderProfileInput) => profileStore.saveProfile(profile);

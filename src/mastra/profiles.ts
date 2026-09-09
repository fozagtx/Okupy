import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { config } from "./config.js";

export type BuilderProfile = {
  userId: string;
  project: string;
  location: string;
  goals: string[];
  interests: string[];
};

async function all(): Promise<Record<string, BuilderProfile>> {
  try {
    return JSON.parse(await readFile(config.dataFile, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function getProfile(userId: string) {
  return (await all())[userId] ?? null;
}

export async function saveProfile(profile: BuilderProfile) {
  const profiles = await all();
  profiles[profile.userId] = profile;
  await mkdir(dirname(config.dataFile), { recursive: true });
  const temporary = `${config.dataFile}.tmp`;
  await writeFile(temporary, JSON.stringify(profiles, null, 2));
  await rename(temporary, config.dataFile);
  return profile;
}

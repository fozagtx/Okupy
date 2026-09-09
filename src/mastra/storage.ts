import { LibSQLStore } from "@mastra/libsql";
import { config } from "./config.js";

export const storage = new LibSQLStore({
  id: "okupy-storage",
  url: config.memoryDatabaseUrl,
});

import { integer, pgTable, serial, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const runScoresTable = pgTable("run_scores", {
  id: serial("id").primaryKey(),
  runId: uuid("run_id").notNull().unique(),
  name: varchar("name", { length: 24 }).notNull(),
  score: integer("score").notNull(),
  levelReached: integer("level_reached").notNull(),
  bossLevelReached: integer("boss_level_reached"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRunScoreSchema = createInsertSchema(runScoresTable).omit({
  id: true,
  createdAt: true,
});
export type InsertRunScore = z.infer<typeof insertRunScoreSchema>;
export type RunScore = typeof runScoresTable.$inferSelect;
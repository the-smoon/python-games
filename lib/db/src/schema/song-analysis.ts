import { pgTable, text, integer, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const songAnalysisTable = pgTable("song_analysis", {
  hash: text("hash").notNull(),
  version: integer("version").notNull(),
  document: jsonb("document").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.hash, table.version] })]);
export const insertSongAnalysisSchema = createInsertSchema(songAnalysisTable).omit({ createdAt: true });
export type InsertSongAnalysis = z.infer<typeof insertSongAnalysisSchema>;
export type SongAnalysis = typeof songAnalysisTable.$inferSelect;
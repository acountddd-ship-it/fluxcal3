import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { randomUUID } from "crypto";

// Session storage table for Replit Auth
export const sessions = sqliteTable(
  "sessions",
  {
    sid: text("sid").primaryKey(),
    sess: text("sess").notNull(), // JSON stored as text in SQLite
    expire: integer("expire", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Users table - stores user biometric data and Replit Auth info
export const users = sqliteTable("users", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  email: text("email").unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  profileImageUrl: text("profile_image_url"),
  // Biometric data
  weight: real("weight"),
  height: integer("height"),
  age: integer("age"),
  gender: text("gender"),
  activityLevel: text("activity_level"),
  // Goal tracking fields
  goalWeight: real("goal_weight"),
  goalDays: integer("goal_days"),
  goalStartDate: integer("goal_start_date", { mode: "timestamp" }),
  dailyGoalCalories: integer("daily_goal_calories"),
  dailyDeficit: integer("daily_deficit"),
  // Persistent energy balance tracking
  cumulativeNetCalories: real("cumulative_net_calories").default(0),
  lastBalanceUpdateDate: integer("last_balance_update_date", { mode: "timestamp" }),
  // Fasting tracking start date - used to avoid autophagy skew for new users
  fastingTrackingStartDate: integer("fasting_tracking_start_date", { mode: "timestamp" }),
  // Buffer system - unused calories from previous day (single-use, non-stacking)
  bufferAmount: integer("buffer_amount"),
  bufferForDate: text("buffer_for_date"), // SQLite doesn't have native date type
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Food items table - stores logged meals
export const foodItems = sqliteTable("food_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").references(() => users.id).notNull(),
  name: text("name").notNull(),
  calories: real("calories").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
  mealType: text("meal_type"),
  protein: real("protein"),
  carbs: real("carbs"),
  fat: real("fat"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Fasting state summaries - daily aggregates of time spent in each fasting state
export const fastingStateSummaries = sqliteTable("fasting_state_summaries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").references(() => users.id).notNull(),
  date: text("date").notNull(), // YYYY-MM-DD format
  fedSeconds: integer("fed_seconds").default(0).notNull(),
  postAbsorptiveSeconds: integer("post_absorptive_seconds").default(0).notNull(),
  fatBurningSeconds: integer("fat_burning_seconds").default(0).notNull(),
  deepKetosisSeconds: integer("deep_ketosis_seconds").default(0).notNull(),
  autophagySeconds: integer("autophagy_seconds").default(0).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => [
  index("idx_fasting_user_date").on(table.userId, table.date),
]);

// Replit Auth types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  createdAt: true,
  updatedAt: true,
});

export const insertFoodItemSchema = createInsertSchema(foodItems).omit({
  id: true,
  createdAt: true,
});

export const insertFastingStateSummarySchema = createInsertSchema(fastingStateSummaries).omit({
  id: true,
  updatedAt: true,
});

// Type exports
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertFoodItem = z.infer<typeof insertFoodItemSchema>;
export type FoodItem = typeof foodItems.$inferSelect;
export type InsertFastingStateSummary = z.infer<typeof insertFastingStateSummarySchema>;
export type FastingStateSummary = typeof fastingStateSummaries.$inferSelect;

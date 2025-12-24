import { db } from "./db";
import { users, foodItems, fastingStateSummaries, type User, type UpsertUser, type FoodItem, type InsertFoodItem, type FastingStateSummary, type InsertFastingStateSummary } from "@shared/schema";
import { eq, and, gte, lt, lte, desc } from "drizzle-orm";

export interface IStorage {
  // Replit Auth user operations
  getUser(id: string): Promise<User | undefined>;
  upsertUser(userData: UpsertUser): Promise<User>;
  updateUser(userId: string, data: Partial<UpsertUser>): Promise<User>;
  updateUserGoals(userId: string, goals: { goalWeight: number; goalDays: number; dailyGoalCalories: number; dailyDeficit: number }): Promise<User>;
  updateCumulativeBalance(userId: string, dailyNetCalories: number): Promise<User>;
  updateEnergyReserve(userId: string, deltaCalories: number, tdee: number): Promise<User>;
  initializeEnergyReserve(userId: string, tdee: number): Promise<User>;
  
  // Food operations
  addFoodItem(item: InsertFoodItem): Promise<FoodItem>;
  getFoodItemsByUserAndDay(userId: string, date: Date): Promise<FoodItem[]>;
  getFoodItemsInRange(userId: string, startDate: Date, endDate: Date): Promise<FoodItem[]>;
  updateFoodItem(id: number, userId: string, data: { name?: string; calories?: string; timestamp?: Date }): Promise<FoodItem | null>;
  deleteFoodItem(id: number, userId: string): Promise<boolean>;
  deleteAllFoodItems(userId: string): Promise<number>;
  getEarliestFoodItem(userId: string): Promise<FoodItem | null>;
  getMostRecentFoodItem(userId: string): Promise<FoodItem | null>;
  countFoodItems(userId: string): Promise<number>;
  
  // Fasting summary operations
  upsertFastingSummary(data: InsertFastingStateSummary): Promise<FastingStateSummary>;
  getFastingSummaries(userId: string, days: number): Promise<FastingStateSummary[]>;
  deleteFastingSummariesBefore(userId: string, cutoffDate: Date): Promise<number>;
  deleteAllFastingSummaries(userId: string): Promise<number>;
  
  // Buffer operations
  setBuffer(userId: string, amount: number, forDate: string): Promise<User>;
  clearBuffer(userId: string): Promise<User>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async updateUser(userId: string, data: Partial<UpsertUser>): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async updateUserGoals(userId: string, goals: { goalWeight: number; goalDays: number; dailyGoalCalories: number; dailyDeficit: number }): Promise<User> {
    const [user] = await db
      .update(users)
      .set({
        goalWeight: goals.goalWeight,
        goalDays: goals.goalDays,
        goalStartDate: new Date(),
        dailyGoalCalories: goals.dailyGoalCalories,
        dailyDeficit: goals.dailyDeficit,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async updateCumulativeBalance(userId: string, dailyNetCalories: number): Promise<User> {
    const user = await this.getUser(userId);
    if (!user) throw new Error("User not found");
    
    // Handle both string and number types (SQLite returns numbers, but be safe)
    const currentCumulative = typeof user.cumulativeNetCalories === "string" 
      ? parseFloat(user.cumulativeNetCalories || "0")
      : (user.cumulativeNetCalories || 0);
    const newCumulative = currentCumulative + dailyNetCalories;
    
    const [updatedUser] = await db
      .update(users)
      .set({
        cumulativeNetCalories: newCumulative, // SQLite real type accepts numbers
        lastBalanceUpdateDate: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser;
  }

  // Update energy balance with burn catch-up
  // New model: energy balance = deficit (positive = burned more than eaten)
  // 1. Read current balance and lastUpdateTime
  // 2. Calculate burn since last update (ADDS to balance)
  // 3. Subtract delta calories (food SUBTRACTS from balance)
  // 4. Cap at daily goal (or TDEE) to prevent "banking" beyond one day's worth
  // 5. Persist new values
  async updateEnergyReserve(userId: string, deltaCalories: number, tdee: number): Promise<User> {
    const user = await this.getUser(userId);
    if (!user) throw new Error("User not found");
    
    const now = new Date();
    // Handle both string and number types (SQLite returns numbers, but be safe)
    const currentBalance = typeof user.cumulativeNetCalories === "string"
      ? parseFloat(user.cumulativeNetCalories || "0")
      : (user.cumulativeNetCalories || 0);
    const lastUpdate = user.lastBalanceUpdateDate ? new Date(user.lastBalanceUpdateDate) : now;
    
    // Calculate burn since last update (burn ADDS to deficit)
    const secondsSinceLastUpdate = Math.max(0, (now.getTime() - lastUpdate.getTime()) / 1000);
    const burnRatePerSecond = tdee / 86400;
    const burnSinceLastUpdate = secondsSinceLastUpdate * burnRatePerSecond;
    
    // Apply burn (adds to deficit), subtract food (reduces deficit)
    // deltaCalories is positive when food is added, so we subtract it
    let newBalance = currentBalance + burnSinceLastUpdate - deltaCalories;
    
    // Cap balance at daily goal (or TDEE if no goal) to prevent "banking" calories
    const maxBalance = user.dailyGoalCalories || tdee;
    newBalance = Math.min(newBalance, maxBalance);
    
    const [updatedUser] = await db
      .update(users)
      .set({
        cumulativeNetCalories: newBalance, // SQLite real type accepts numbers
        lastBalanceUpdateDate: now,
        updatedAt: now,
      })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser;
  }

  // Initialize energy reserve for new users
  // Simple model: starts at 0 from midnight today
  // Burn will accumulate from midnight, food subtracts when logged
  async initializeEnergyReserve(userId: string, tdee: number): Promise<User> {
    const user = await this.getUser(userId);
    if (!user) throw new Error("User not found");
    
    // Start tracking from midnight today (stored in fastingTrackingStartDate)
    const startDate = user.fastingTrackingStartDate 
      ? new Date(user.fastingTrackingStartDate) 
      : new Date();
    
    // Set lastBalanceUpdateDate to start date (midnight)
    // This means the client will calculate burn from midnight to now
    const [updatedUser] = await db
      .update(users)
      .set({
        cumulativeNetCalories: 0, // SQLite real type accepts numbers
        lastBalanceUpdateDate: startDate,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser;
  }

  async addFoodItem(item: InsertFoodItem): Promise<FoodItem> {
    const [result] = await db.insert(foodItems).values(item).returning();
    return result;
  }

  async getFoodItemsByUserAndDay(userId: string, date: Date): Promise<FoodItem[]> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return await db
      .select()
      .from(foodItems)
      .where(
        and(
          eq(foodItems.userId, userId),
          gte(foodItems.timestamp, startOfDay),
          lt(foodItems.timestamp, endOfDay)
        )
      )
      .orderBy(foodItems.timestamp);
  }

  async updateFoodItem(id: number, userId: string, data: { name?: string; calories?: string; timestamp?: Date }): Promise<FoodItem | null> {
    const [result] = await db
      .update(foodItems)
      .set(data)
      .where(and(eq(foodItems.id, id), eq(foodItems.userId, userId)))
      .returning();
    return result || null;
  }

  async deleteFoodItem(id: number, userId: string): Promise<boolean> {
    const result = await db
      .delete(foodItems)
      .where(and(eq(foodItems.id, id), eq(foodItems.userId, userId)))
      .returning();
    return result.length > 0;
  }

  async deleteAllFoodItems(userId: string): Promise<number> {
    const result = await db
      .delete(foodItems)
      .where(eq(foodItems.userId, userId))
      .returning();
    return result.length;
  }

  async getEarliestFoodItem(userId: string): Promise<FoodItem | null> {
    const [result] = await db
      .select()
      .from(foodItems)
      .where(eq(foodItems.userId, userId))
      .orderBy(foodItems.timestamp)
      .limit(1);
    return result || null;
  }

  async getMostRecentFoodItem(userId: string): Promise<FoodItem | null> {
    const [result] = await db
      .select()
      .from(foodItems)
      .where(eq(foodItems.userId, userId))
      .orderBy(desc(foodItems.timestamp))
      .limit(1);
    return result || null;
  }

  async countFoodItems(userId: string): Promise<number> {
    const result = await db
      .select()
      .from(foodItems)
      .where(eq(foodItems.userId, userId));
    return result.length;
  }

  async getFoodItemsInRange(userId: string, startDate: Date, endDate: Date): Promise<FoodItem[]> {
    return await db
      .select()
      .from(foodItems)
      .where(
        and(
          eq(foodItems.userId, userId),
          gte(foodItems.timestamp, startDate),
          lt(foodItems.timestamp, endDate)
        )
      )
      .orderBy(foodItems.timestamp);
  }

  async upsertFastingSummary(data: InsertFastingStateSummary): Promise<FastingStateSummary> {
    const existing = await db
      .select()
      .from(fastingStateSummaries)
      .where(
        and(
          eq(fastingStateSummaries.userId, data.userId),
          eq(fastingStateSummaries.date, data.date)
        )
      );
    
    if (existing.length > 0) {
      const [result] = await db
        .update(fastingStateSummaries)
        .set({
          fedSeconds: data.fedSeconds,
          postAbsorptiveSeconds: data.postAbsorptiveSeconds,
          fatBurningSeconds: data.fatBurningSeconds,
          deepKetosisSeconds: data.deepKetosisSeconds,
          autophagySeconds: data.autophagySeconds,
          updatedAt: new Date(),
        })
        .where(eq(fastingStateSummaries.id, existing[0].id))
        .returning();
      return result;
    } else {
      const [result] = await db
        .insert(fastingStateSummaries)
        .values(data)
        .returning();
      return result;
    }
  }

  async getFastingSummaries(userId: string, days: number): Promise<FastingStateSummary[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    cutoffDate.setHours(0, 0, 0, 0);
    
    const dateStr = cutoffDate.toISOString().split('T')[0];
    
    return await db
      .select()
      .from(fastingStateSummaries)
      .where(
        and(
          eq(fastingStateSummaries.userId, userId),
          gte(fastingStateSummaries.date, dateStr)
        )
      )
      .orderBy(desc(fastingStateSummaries.date));
  }

  async deleteFastingSummariesBefore(userId: string, cutoffDate: Date): Promise<number> {
    const dateStr = cutoffDate.toISOString().split('T')[0];
    
    const result = await db
      .delete(fastingStateSummaries)
      .where(
        and(
          eq(fastingStateSummaries.userId, userId),
          lt(fastingStateSummaries.date, dateStr)
        )
      )
      .returning();
    return result.length;
  }

  async deleteAllFastingSummaries(userId: string): Promise<number> {
    const result = await db
      .delete(fastingStateSummaries)
      .where(eq(fastingStateSummaries.userId, userId))
      .returning();
    return result.length;
  }

  async setBuffer(userId: string, amount: number, forDate: string): Promise<User> {
    const [user] = await db
      .update(users)
      .set({
        bufferAmount: amount,
        bufferForDate: forDate,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async clearBuffer(userId: string): Promise<User> {
    const [user] = await db
      .update(users)
      .set({
        bufferAmount: null,
        bufferForDate: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }
}

export const storage = new DatabaseStorage();

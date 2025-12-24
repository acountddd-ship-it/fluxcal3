import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertFoodItemSchema } from "@shared/schema";
import { setupAuth, isAuthenticated } from "./replitAuth";

export async function registerRoutes(app: Express): Promise<Server> {
  // Set up Replit Auth
  await setupAuth(app);

  // Get current authenticated user
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Update user profile
  app.patch("/api/user/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
      const existingUser = await storage.getUser(userId);
      
      const updateData: Record<string, any> = {};
      // Handle explicit null values for profile reset
      if (req.body.weight !== undefined) updateData.weight = req.body.weight === null ? null : req.body.weight;
      if (req.body.height !== undefined) updateData.height = req.body.height;
      if (req.body.age !== undefined) updateData.age = req.body.age;
      if (req.body.gender !== undefined) updateData.gender = req.body.gender;
      if (req.body.activityLevel !== undefined) updateData.activityLevel = req.body.activityLevel;
      
      // Allow manual setting of fasting tracking start date
      if (req.body.fastingTrackingStartDate !== undefined) {
        updateData.fastingTrackingStartDate = req.body.fastingTrackingStartDate ? new Date(req.body.fastingTrackingStartDate) : null;
      } else if (existingUser && !existingUser.fastingTrackingStartDate) {
        // Set fasting tracking start date for users without one (new users completing profile)
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        updateData.fastingTrackingStartDate = startOfToday;
      }
      
      const user = await storage.updateUser(userId, updateData);
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  // Update energy reserve with burn catch-up
  // This endpoint handles the continuous energy reserve model:
  // 1. Read current reserve and lastUpdateTime
  // 2. Calculate burn since last update (TDEE-based)
  // 3. Add delta calories
  // 4. Clamp to TDEE max
  // 5. Persist new values
  app.patch("/api/user/update-balance", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { deltaCalories, tdee } = req.body;
      
      if (typeof deltaCalories !== "number" || typeof tdee !== "number") {
        return res.status(400).json({ error: "Invalid delta calories or TDEE" });
      }
      
      const user = await storage.updateEnergyReserve(userId, deltaCalories, tdee);
      res.json(user);
    } catch (error) {
      console.error("Failed to update energy reserve:", error);
      res.status(500).json({ error: "Failed to update energy reserve" });
    }
  });
  
  // Initialize energy reserve - starts at 0 from midnight today
  app.post("/api/user/init-energy-reserve", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { tdee } = req.body;
      
      if (typeof tdee !== "number" || tdee <= 0) {
        return res.status(400).json({ error: "Valid TDEE is required" });
      }
      
      const user = await storage.initializeEnergyReserve(userId, tdee);
      res.json(user);
    } catch (error) {
      console.error("Failed to initialize energy reserve:", error);
      res.status(500).json({ error: "Failed to initialize energy reserve" });
    }
  });

  // Update user goals
  app.patch("/api/user/goals", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { targetWeight, targetDays, currentWeight, bmr } = req.body;
      
      if (!targetWeight || !targetDays || !currentWeight || !bmr) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      
      const weightDiff = currentWeight - targetWeight;
      if (weightDiff <= 0) {
        return res.status(400).json({ error: "Target weight must be less than current weight" });
      }
      if (targetDays <= 0) {
        return res.status(400).json({ error: "Target days must be positive" });
      }
      
      // Calculate deficit: 7700 kcal = 1kg of body fat
      const totalCaloriesToBurn = weightDiff * 7700;
      const dailyDeficit = Math.round(totalCaloriesToBurn / targetDays);
      const safeDeficit = Math.min(dailyDeficit, 1000);
      const dailyGoalCalories = Math.max(bmr - safeDeficit, 1200);
      
      const user = await storage.updateUserGoals(userId, {
        goalWeight: targetWeight,
        goalDays: targetDays,
        dailyGoalCalories,
        dailyDeficit: safeDeficit,
      });
      
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: "Failed to update user goals" });
    }
  });

  // Reset user profile (for restart functionality)
  app.post("/api/user/reset", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { fastingTrackingStartDate } = req.body;
      
      // Clear all user data except id and basic auth info
      const resetData: Record<string, any> = {
        weight: null,
        height: null,
        age: null,
        gender: null,
        activityLevel: null,
        goalWeight: null,
        goalDays: null,
        dailyGoalCalories: null,
        dailyDeficit: null,
        cumulativeNetCalories: 0,
        lastBalanceUpdateDate: null,
        fastingTrackingStartDate: fastingTrackingStartDate ? new Date(fastingTrackingStartDate) : null,
      };
      
      const user = await storage.updateUser(userId, resetData);
      res.json(user);
    } catch (error) {
      console.error("Failed to reset user:", error);
      res.status(500).json({ error: "Failed to reset user" });
    }
  });

  // Calculate and set buffer at day end
  // Buffer rules:
  // - If under goal AND under TDEE: buffer = goal - consumed (for next day only)
  // - If over goal but under TDEE: no buffer
  // - If over TDEE: no buffer
  app.post("/api/user/calculate-buffer", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { date, consumed, tdee } = req.body; // date is YYYY-MM-DD, consumed is calories eaten that day
      
      if (!date || typeof consumed !== "number" || typeof tdee !== "number") {
        return res.status(400).json({ error: "Missing required fields: date, consumed, tdee" });
      }
      
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      const goal = user.dailyGoalCalories || tdee; // Fallback to TDEE if no goal set
      
      // Calculate next day's date
      const currentDate = new Date(date);
      currentDate.setDate(currentDate.getDate() + 1);
      const nextDateStr = currentDate.toISOString().split('T')[0];
      
      // Buffer rules:
      // 1. If consumed < goal AND consumed < tdee: buffer = goal - consumed
      // 2. Otherwise: no new buffer (but don't clear today's buffer if it exists)
      if (consumed < goal && consumed < tdee) {
        const bufferAmount = Math.round(goal - consumed);
        const updatedUser = await storage.setBuffer(userId, bufferAmount, nextDateStr);
        res.json({ 
          bufferSet: true, 
          bufferAmount, 
          forDate: nextDateStr,
          user: updatedUser 
        });
      } else {
        // Clear any existing buffer when user doesn't qualify for a new one
        // This handles: expired buffers AND previously scheduled buffers for tomorrow
        // Using <= ensures buffers are revoked if eligibility is lost
        if (user.bufferForDate && user.bufferForDate <= nextDateStr) {
          const updatedUser = await storage.clearBuffer(userId);
          res.json({ 
            bufferSet: false, 
            reason: consumed >= tdee ? "exceeded_tdee" : "met_or_exceeded_goal",
            bufferCleared: true,
            user: updatedUser 
          });
        } else {
          // No buffer to clear
          res.json({ 
            bufferSet: false, 
            reason: consumed >= tdee ? "exceeded_tdee" : "met_or_exceeded_goal",
            user 
          });
        }
      }
    } catch (error) {
      console.error("Failed to calculate buffer:", error);
      res.status(500).json({ error: "Failed to calculate buffer" });
    }
  });

  // Add food item
  app.post("/api/food", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
      const normalizedBody = {
        userId,
        name: req.body.name,
        timestamp: req.body.timestamp ? new Date(req.body.timestamp) : new Date(),
        mealType: req.body.mealType || undefined,
        calories: req.body.calories != null ? req.body.calories : undefined,
        protein: req.body.protein != null ? req.body.protein : undefined,
        carbs: req.body.carbs != null ? req.body.carbs : undefined,
        fat: req.body.fat != null ? req.body.fat : undefined,
      };
      
      const parsed = insertFoodItemSchema.safeParse(normalizedBody);
      
      if (!parsed.success) {
        console.error("Validation error:", parsed.error);
        return res.status(400).json({ error: "Invalid food data", details: parsed.error });
      }
      
      // Validate: don't allow entries before tracking start date
      const user = await storage.getUser(userId);
      if (user?.fastingTrackingStartDate) {
        const startDate = new Date(user.fastingTrackingStartDate);
        startDate.setHours(0, 0, 0, 0);
        const entryDate = new Date(normalizedBody.timestamp);
        entryDate.setHours(0, 0, 0, 0);
        if (entryDate < startDate) {
          return res.status(400).json({ 
            error: `Cannot add entries before your tracking start date (${startDate.toLocaleDateString()})` 
          });
        }
      }
      
      const foodItem = await storage.addFoodItem(parsed.data);
      
      // Only set start date if user doesn't have one yet (first food entry)
      // Use the exact meal timestamp, not midnight, for accurate burn calculations
      const currentUser = user || await storage.getUser(userId);
      if (currentUser && !currentUser.fastingTrackingStartDate) {
        await storage.updateUser(userId, { fastingTrackingStartDate: new Date(foodItem.timestamp) });
      }
      
      res.json(foodItem);
    } catch (error) {
      console.error("Failed to add food:", error);
      res.status(500).json({ error: "Failed to add food item" });
    }
  });

  // Get food items for a specific day
  // The date param is in user's local timezone (YYYY-MM-DD), tz query param is timezone offset in minutes
  app.get("/api/food/date/:date", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const dateStr = req.params.date; // YYYY-MM-DD format
      const tzOffset = parseInt(req.query.tz as string) || 0; // Client's timezone offset in minutes
      
      // Parse date string as local date in user's timezone
      const [year, month, day] = dateStr.split('-').map(Number);
      if (!year || !month || !day) {
        return res.status(400).json({ error: "Invalid date format" });
      }
      
      // Create start/end of day in user's local timezone, then convert to UTC
      // tzOffset is negative for timezones ahead of UTC (e.g., -660 for AEDT)
      // To get UTC from local: UTC = local + offset (but JS offset is reversed)
      const startOfDayUTC = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
      startOfDayUTC.setMinutes(startOfDayUTC.getMinutes() + tzOffset);
      
      const endOfDayUTC = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
      endOfDayUTC.setMinutes(endOfDayUTC.getMinutes() + tzOffset);
      
      const items = await storage.getFoodItemsInRange(userId, startOfDayUTC, endOfDayUTC);
      res.json(items);
    } catch (error) {
      console.error("Failed to get food items:", error);
      res.status(500).json({ error: "Failed to get food items" });
    }
  });

  // Get most recent food item (for fasting state calculation)
  app.get("/api/food/last", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const lastFood = await storage.getMostRecentFoodItem(userId);
      res.json(lastFood);
    } catch (error) {
      console.error("Failed to get most recent food:", error);
      res.status(500).json({ error: "Failed to get most recent food item" });
    }
  });

  // Update food item
  app.put("/api/food/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user.claims.sub;
      const { name, calories, timestamp } = req.body;
      
      const updateData: { name?: string; calories?: number; timestamp?: Date } = {};
      if (name) updateData.name = name;
      if (calories !== undefined) updateData.calories = calories;
      if (timestamp) updateData.timestamp = new Date(timestamp);
      
      const updated = await storage.updateFoodItem(id, userId, updateData);
      if (!updated) {
        return res.status(404).json({ error: "Food item not found or not owned by user" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Failed to update food:", error);
      res.status(500).json({ error: "Failed to update food item" });
    }
  });

  // Delete all food items for user (must be before /:id to avoid matching "all" as an id)
  app.delete("/api/food/all", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const deletedCount = await storage.deleteAllFoodItems(userId);
      
      // Clear all fasting summaries and reset tracking start date
      await storage.deleteAllFastingSummaries(userId);
      await storage.updateUser(userId, { fastingTrackingStartDate: null });
      
      res.json({ success: true, deletedCount });
    } catch (error) {
      console.error("Failed to delete all food items:", error);
      res.status(500).json({ error: "Failed to delete all food items" });
    }
  });

  // Delete food item
  app.delete("/api/food/:id", isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const userId = req.user.claims.sub;
      const deleted = await storage.deleteFoodItem(id, userId);
      if (!deleted) {
        return res.status(404).json({ error: "Food item not found or not owned by user" });
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete food item" });
    }
  });

  // Helper function to calculate fasting state durations for a specific day
  // Takes the last meal before day start (can be undefined) and all meals within the day
  function calculateFastingDurationsForDay(
    lastMealBeforeDayStart: Date | null,
    dayMeals: Date[],
    dayStart: Date,
    dayEnd: Date
  ): { fed: number; postAbsorptive: number; fatBurning: number; deepKetosis: number; autophagy: number } {
    const result = { fed: 0, postAbsorptive: 0, fatBurning: 0, deepKetosis: 0, autophagy: 0 };
    
    // Sort meals within the day by timestamp
    const sortedDayMeals = [...dayMeals].sort((a, b) => a.getTime() - b.getTime());
    
    // Track the last meal time and process time windows
    let lastMealTime = lastMealBeforeDayStart;
    let currentTime = dayStart;
    
    // Process each meal within the day
    for (const meal of sortedDayMeals) {
      // Allocate time from currentTime to meal time
      allocateFastingTimeWithOffset(lastMealTime, currentTime, meal, result);
      
      // Reset: the meal resets fasting clock
      lastMealTime = meal;
      currentTime = meal;
    }
    
    // Allocate remaining time from last meal (or last event) to end of day
    allocateFastingTimeWithOffset(lastMealTime, currentTime, dayEnd, result);
    
    return result;
  }
  
  // Allocate fasting time from windowStart to windowEnd, considering hours since lastMeal
  function allocateFastingTimeWithOffset(
    lastMeal: Date | null,
    windowStart: Date,
    windowEnd: Date,
    result: { fed: number; postAbsorptive: number; fatBurning: number; deepKetosis: number; autophagy: number }
  ) {
    if (windowEnd <= windowStart) return;
    
    // Calculate hours since last meal at window start and end
    const hoursSinceMealAtStart = lastMeal 
      ? (windowStart.getTime() - lastMeal.getTime()) / (1000 * 3600)
      : 24; // If no last meal, assume deep into fasting
    const hoursSinceMealAtEnd = lastMeal
      ? (windowEnd.getTime() - lastMeal.getTime()) / (1000 * 3600)
      : hoursSinceMealAtStart + (windowEnd.getTime() - windowStart.getTime()) / (1000 * 3600);
    
    // Stage boundaries in hours
    const stageBoundaries = [0, 4, 8, 12, 16, Infinity];
    const stageNames = ['fed', 'postAbsorptive', 'fatBurning', 'deepKetosis', 'autophagy'] as const;
    
    // Iterate through each stage and calculate overlap
    for (let i = 0; i < stageNames.length; i++) {
      const stageStart = stageBoundaries[i];
      const stageEnd = stageBoundaries[i + 1];
      
      // Calculate overlap between [hoursSinceMealAtStart, hoursSinceMealAtEnd] and [stageStart, stageEnd]
      const overlapStart = Math.max(hoursSinceMealAtStart, stageStart);
      const overlapEnd = Math.min(hoursSinceMealAtEnd, stageEnd);
      
      if (overlapEnd > overlapStart) {
        const overlapHours = overlapEnd - overlapStart;
        result[stageNames[i]] += overlapHours * 3600; // Convert to seconds
      }
    }
  }

  // Get fasting summaries for the last 14 days
  app.get("/api/fasting/summary", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const summaries = await storage.getFastingSummaries(userId, 14);
      res.json(summaries);
    } catch (error) {
      console.error("Error fetching fasting summaries:", error);
      res.status(500).json({ error: "Failed to fetch fasting summaries" });
    }
  });

  // Recalculate and store fasting summaries for the last 14 days
  app.post("/api/fasting/recalculate", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
      // Get user to check fasting tracking start date
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Delete records older than 14 days
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 14);
      await storage.deleteFastingSummariesBefore(userId, cutoffDate);
      
      // Get food items for the last 15 days (need extra day for meal before day start)
      const queryStartDate = new Date();
      queryStartDate.setDate(queryStartDate.getDate() - 15);
      queryStartDate.setHours(0, 0, 0, 0);
      
      const endDate = new Date();
      endDate.setHours(23, 59, 59, 999);
      
      const foodItems = await storage.getFoodItemsInRange(userId, queryStartDate, endDate);
      
      // Sort food items by timestamp once (ascending order)
      const sortedFoodItems = [...foodItems].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      
      // Keep original tracking start timestamp (includes meal time from onboarding)
      const originalTrackingTimestamp = user.fastingTrackingStartDate ? new Date(user.fastingTrackingStartDate) : null;
      
      // Normalize to midnight for day comparisons
      let trackingStartDate = originalTrackingTimestamp ? new Date(originalTrackingTimestamp) : null;
      if (trackingStartDate) {
        trackingStartDate.setHours(0, 0, 0, 0);
      }
      
      // If no food items exist at all, return empty summaries (don't generate fake data)
      if (sortedFoodItems.length === 0 && !originalTrackingTimestamp) {
        return res.json([]);
      }
      
      // If no start date exists, backfill from earliest food record in 14-day window
      if (!trackingStartDate) {
        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13); // 14 days including today
        fourteenDaysAgo.setHours(0, 0, 0, 0);
        
        // Find earliest food record within 14-day window
        const mealsInWindow = sortedFoodItems.filter(item => item.timestamp >= fourteenDaysAgo);
        if (mealsInWindow.length > 0) {
          trackingStartDate = new Date(mealsInWindow[0].timestamp);
          trackingStartDate.setHours(0, 0, 0, 0); // Start of that day
        } else if (originalTrackingTimestamp) {
          // Use onboarding timestamp as start
          trackingStartDate = new Date(originalTrackingTimestamp);
          trackingStartDate.setHours(0, 0, 0, 0);
        } else {
          // No meals and no tracking start - return empty
          return res.json([]);
        }
        
        // Save the backfilled start date to user record
        await storage.updateUser(userId, { fastingTrackingStartDate: trackingStartDate });
      }
      
      // Calculate summaries for each day in the last 14 days (but not before start date)
      const summaries = [];
      for (let i = 0; i < 14; i++) {
        const dayStart = new Date();
        dayStart.setDate(dayStart.getDate() - i);
        dayStart.setHours(0, 0, 0, 0);
        
        // Skip days before the tracking start date
        if (dayStart < trackingStartDate) {
          continue;
        }
        
        // For today, only calculate up to current time (not end of day)
        const now = new Date();
        const isToday = dayStart.toDateString() === now.toDateString();
        const dayEnd = isToday ? now : new Date(dayStart);
        if (!isToday) {
          dayEnd.setHours(23, 59, 59, 999);
        }
        
        // Get meals within this day (already sorted)
        const dayMeals = sortedFoodItems
          .filter(item => item.timestamp >= dayStart && item.timestamp <= dayEnd)
          .map(m => m.timestamp);
        
        // Find last meal before day start using reverse iteration on sorted array
        let lastMealBefore: Date | null = null;
        for (let j = sortedFoodItems.length - 1; j >= 0; j--) {
          if (sortedFoodItems[j].timestamp < dayStart) {
            lastMealBefore = sortedFoodItems[j].timestamp;
            break;
          }
        }
        
        // If there's no previous meal from food records, use the onboarding timestamp
        let effectiveLastMealBefore = lastMealBefore;
        let effectiveDayStart = dayStart;
        
        if (!lastMealBefore && originalTrackingTimestamp) {
          // Use onboarding timestamp as the baseline "last meal" if it's before this day
          if (originalTrackingTimestamp < dayStart) {
            effectiveLastMealBefore = originalTrackingTimestamp;
          } else if (originalTrackingTimestamp >= dayStart && originalTrackingTimestamp <= dayEnd) {
            // Onboarding timestamp is within this day - use it as both start AND last meal
            effectiveDayStart = originalTrackingTimestamp;
            effectiveLastMealBefore = originalTrackingTimestamp;
          }
        }
        
        // On tracking start date with no meals, start from first meal if available
        if (dayStart.getTime() === trackingStartDate!.getTime() && !effectiveLastMealBefore && dayMeals.length > 0) {
          effectiveDayStart = dayMeals[0];
        }
        
        // Calculate fasting durations using correct function
        const durations = calculateFastingDurationsForDay(effectiveLastMealBefore, dayMeals, effectiveDayStart, dayEnd);
        
        // On tracking start date, force autophagy to 0 (can't reach 72+ hours on first day)
        const isTrackingStartDate = dayStart.getTime() === trackingStartDate!.getTime();
        
        const dateStr = dayStart.toISOString().split('T')[0];
        
        const summary = await storage.upsertFastingSummary({
          userId,
          date: dateStr,
          fedSeconds: Math.round(durations.fed),
          postAbsorptiveSeconds: Math.round(durations.postAbsorptive),
          fatBurningSeconds: Math.round(durations.fatBurning),
          deepKetosisSeconds: Math.round(durations.deepKetosis),
          autophagySeconds: isTrackingStartDate ? 0 : Math.round(durations.autophagy),
        });
        
        summaries.push(summary);
      }
      
      res.json(summaries);
    } catch (error) {
      console.error("Error recalculating fasting summaries:", error);
      res.status(500).json({ error: "Failed to recalculate fasting summaries" });
    }
  });

  // DEBUG: Add/remove 100 buffer calories for testing (remove easily)
  app.post("/api/debug/add-buffer", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: "User not found" });
      
      // Use client timezone offset if provided
      const tzOffset = parseInt(req.query.tz as string) || 0;
      const now = new Date();
      const localNow = new Date(now.getTime() - tzOffset * 60000);
      const todayStr = localNow.toISOString().split('T')[0];
      
      const newBuffer = (user.bufferAmount || 0) + 100;
      const updatedUser = await storage.updateUser(userId, {
        bufferAmount: newBuffer,
        bufferForDate: todayStr
      });
      
      res.json({ user: updatedUser, bufferForDate: todayStr });
    } catch (error) {
      console.error("Debug buffer add failed:", error);
      res.status(500).json({ error: "Failed to add debug buffer" });
    }
  });

  // DEBUG: Clear buffer for testing
  app.post("/api/debug/clear-buffer", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const updatedUser = await storage.clearBuffer(userId);
      res.json({ user: updatedUser });
    } catch (error) {
      console.error("Debug buffer clear failed:", error);
      res.status(500).json({ error: "Failed to clear debug buffer" });
    }
  });

  // ========== Test User Login ==========
  // This route bypasses Replit Auth for testing purposes
  // Available in all environments for demo access
  app.post("/api/dev/test-login", async (req: any, res) => {
      try {
        const TEST_USER_ID = "test-user-dev-123";
        
        // Create or update the test user with realistic data
        await storage.upsertUser({
          id: TEST_USER_ID,
          email: "testuser@dev.local",
          firstName: "Test",
          lastName: "User",
          profileImageUrl: null,
        });
        
        // Update with biometric data
        const now = new Date();
        const trackingStartDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
        await storage.updateUser(TEST_USER_ID, {
          weight: 75.00,
          height: 175,
          age: 30,
          gender: "male",
          activityLevel: "lightly_active",
          goalWeight: 70.00,
          goalDays: 90,
          goalStartDate: now,
          dailyGoalCalories: 1800,
          dailyDeficit: 250,
          cumulativeNetCalories: 500.00,
          lastBalanceUpdateDate: now,
          fastingTrackingStartDate: trackingStartDate,
        });
        
        // Add some seed food entries for today
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        
        // Clear any existing test foods first
        await storage.deleteAllFoodItems(TEST_USER_ID);
        
        // Add breakfast (3 hours ago)
        const breakfastTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
        await storage.addFoodItem({
          userId: TEST_USER_ID,
          name: "Oatmeal with berries",
          calories: 350,
          timestamp: breakfastTime,
          mealType: "breakfast",
          protein: 12,
          carbs: 58,
          fat: 8,
        });
        
        // Add lunch (1 hour ago)
        const lunchTime = new Date(now.getTime() - 1 * 60 * 60 * 1000);
        await storage.addFoodItem({
          userId: TEST_USER_ID,
          name: "Grilled chicken salad",
          calories: 450,
          timestamp: lunchTime,
          mealType: "lunch",
          protein: 35,
          carbs: 25,
          fat: 22,
        });
        
        // Add snack (30 min ago)
        const snackTime = new Date(now.getTime() - 30 * 60 * 1000);
        await storage.addFoodItem({
          userId: TEST_USER_ID,
          name: "Greek yogurt",
          calories: 150,
          timestamp: snackTime,
          mealType: "snack",
          protein: 15,
          carbs: 12,
          fat: 5,
        });
        
        // Create a fake session user object mimicking OIDC claims
        const fakeUser = {
          claims: {
            sub: TEST_USER_ID,
            email: "testuser@dev.local",
            first_name: "Test",
            last_name: "User",
            profile_image_url: null,
          },
          access_token: "dev-test-token",
          refresh_token: "dev-refresh-token",
          expires_at: Math.floor(Date.now() / 1000) + 86400 * 7, // 7 days from now
        };
        
        // Log in the user using passport's req.login
        req.login(fakeUser, (err: any) => {
          if (err) {
            console.error("Test user login failed:", err);
            return res.status(500).json({ error: "Failed to establish session" });
          }
          res.json({ success: true, message: "Logged in as Test User" });
        });
      } catch (error) {
        console.error("Dev test login failed:", error);
        res.status(500).json({ error: "Failed to create test user session" });
      }
  });
  // ========== END Test User Login ==========

  const httpServer = createServer(app);
  return httpServer;
}

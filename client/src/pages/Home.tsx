import { useState, useEffect, useMemo } from "react";
import { Calculator, Plus, Utensils, Flame, RotateCcw, ChevronDown, ChevronLeft, ChevronRight, Loader2, LogOut, Trash2, Pencil } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from "recharts";
import { DeusExBackground, DeusExGlow } from "@/components/DeusExBackground";
import { AMPMToggle } from "@/components/AMPMToggle";
import { HoldToDeleteButton } from "@/components/HoldToDeleteButton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";

// Types
type Gender = "male" | "female";
type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";

interface UserStats {
  weight: number;
  height: number;
  age: number;
  gender: Gender;
  activityLevel: ActivityLevel;
  bmr: number;
  tdee: number;
  goalWeight?: number;
  goalDays?: number;
  dailyGoalCalories?: number;
  dailyDeficit?: number;
  cumulativeNetCalories?: number;
  lastBalanceUpdateDate?: string;
  bufferAmount?: number;
  bufferForDate?: string;
}

interface FoodItem {
  id: string;
  name: string;
  calories: number;
  timestamp: number;
  mealType?: "breakfast" | "lunch" | "dinner" | "snack";
  protein?: number;
  carbs?: number;
  fat?: number;
}

interface FastingStateSummary {
  id: number;
  userId: string;
  date: string;
  fedSeconds: number;
  postAbsorptiveSeconds: number;
  fatBurningSeconds: number;
  deepKetosisSeconds: number;
  autophagySeconds: number;
  updatedAt: string;
}

const DEFAULT_STATS: UserStats = {
  weight: 90,
  height: 169,
  age: 35,
  gender: "male",
  activityLevel: "sedentary",
  bmr: 1786,
  tdee: 2143,
};

const MEAL_EXAMPLES = [
  "Salad with olive oil",
  "Grilled chicken breast",
  "Greek yogurt with honey",
  "Avocado toast",
  "Salmon with vegetables",
  "Oatmeal with berries",
  "Steak and potatoes",
  "Veggie stir fry",
  "Scrambled eggs",
  "Quinoa bowl",
];

const calculateBMR = (weight: number, height: number, age: number, gender: Gender): number => {
  let bmr = (10 * weight) + (6.25 * height) - (5 * age);
  if (gender === "male") {
    bmr += 5;
  } else {
    bmr -= 161;
  }
  return Math.round(bmr);
};

const getActivityMultiplier = (level: ActivityLevel): number => {
  switch (level) {
    case "sedentary": return 1.2;
    case "light": return 1.375;
    case "moderate": return 1.55;
    case "active": return 1.725;
    case "very_active": return 1.9;
    default: return 1.2;
  }
};

// Sequential burn queue calculation
// Foods are burned in order of when they were eaten (by timestamp)
// Each food must be fully burned before the next one starts depleting
interface BurnQueueItem {
  id: string;
  burnStart: number;      // timestamp when this food starts burning
  burnEnd: number;        // timestamp when this food is fully burned
  fillPercent: number;    // 0-100, how much is remaining (100 = full, 0 = empty)
  remainingSeconds: number; // seconds until fully burned (for currently burning items)
  burnDurationSeconds: number; // total seconds this specific item takes to burn
  isCurrentlyBurning: boolean;
  isBurned: boolean;
  isWaiting: boolean;
}

// Format remaining burn time into approximate display (~Xh, <30m, <15m, <5m)
const formatBurnTime = (seconds: number): string => {
  if (seconds <= 0) return "";
  
  const hours = seconds / 3600;
  const minutes = seconds / 60;
  
  if (hours >= 1) {
    // Round to nearest hour
    return `~${Math.round(hours)}h`;
  } else if (minutes >= 30) {
    return "<30m";
  } else if (minutes >= 15) {
    return "<15m";
  } else {
    return "<5m";
  }
};

const calculateBurnQueue = (
  foods: FoodItem[],
  currentTime: number,
  tdee: number
): Map<string, BurnQueueItem> => {
  const burnRatePerMs = tdee / (24 * 60 * 60 * 1000); // calories per millisecond
  const result = new Map<string, BurnQueueItem>();
  
  if (foods.length === 0 || tdee <= 0) return result;
  
  // Sort foods by timestamp (oldest first)
  const sortedFoods = [...foods].sort((a, b) => a.timestamp - b.timestamp);
  
  let nextBurnStart = sortedFoods[0].timestamp;
  
  for (const food of sortedFoods) {
    // Burn starts at the later of: food timestamp OR when previous food finishes
    const burnStart = Math.max(food.timestamp, nextBurnStart);
    
    // Time to burn this food = calories / burn rate
    const burnDurationMs = food.calories / burnRatePerMs;
    const burnEnd = burnStart + burnDurationMs;
    const burnDurationSeconds = burnDurationMs / 1000;
    
    // Calculate fill percentage and remaining time
    let fillPercent = 100;
    let remainingSeconds = 0;
    let isCurrentlyBurning = false;
    let isBurned = false;
    let isWaiting = false;
    
    if (currentTime >= burnEnd) {
      // Fully burned
      fillPercent = 0;
      remainingSeconds = 0;
      isBurned = true;
    } else if (currentTime >= burnStart) {
      // Currently burning
      const elapsed = currentTime - burnStart;
      const progress = elapsed / burnDurationMs;
      fillPercent = Math.max(0, (1 - progress) * 100);
      remainingSeconds = Math.max(0, (burnEnd - currentTime) / 1000);
      isCurrentlyBurning = true;
    } else {
      // Waiting in queue - show individual burn duration, not cumulative
      fillPercent = 100;
      remainingSeconds = burnDurationSeconds;
      isWaiting = true;
    }
    
    result.set(food.id, {
      id: food.id,
      burnStart,
      burnEnd,
      fillPercent,
      remainingSeconds,
      burnDurationSeconds,
      isCurrentlyBurning,
      isBurned,
      isWaiting,
    });
    
    // Next food starts burning when this one ends
    nextBurnStart = burnEnd;
  }
  
  return result;
};

export default function Home() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [stats, setStats] = useState<UserStats>(DEFAULT_STATS);
  const [foods, setFoods] = useState<FoodItem[]>([]);
  const [fastingSummaries, setFastingSummaries] = useState<FastingStateSummary[]>([]);
  const [now, setNow] = useState(Date.now());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [newFoodName, setNewFoodName] = useState("");
  const [newFoodCals, setNewFoodCals] = useState("");
  const [mealType, setMealType] = useState<"breakfast" | "lunch" | "dinner" | "snack">("lunch");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [foodHour, setFoodHour] = useState("");
  const [foodMinute, setFoodMinute] = useState("");
  const [foodPeriod, setFoodPeriod] = useState<"AM" | "PM">("AM");

  const [editWeight, setEditWeight] = useState(DEFAULT_STATS.weight.toString());
  const [editHeight, setEditHeight] = useState(DEFAULT_STATS.height.toString());
  const [editAge, setEditAge] = useState(DEFAULT_STATS.age.toString());
  const [editGender, setEditGender] = useState<Gender>(DEFAULT_STATS.gender);
  const [editActivity, setEditActivity] = useState<ActivityLevel>(DEFAULT_STATS.activityLevel);
  const [isLoading, setIsLoading] = useState(false);
  
  // Full onboarding state (first-time setup)
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [goalTargetWeight, setGoalTargetWeight] = useState("");
  const [goalTargetDays, setGoalTargetDays] = useState("");
  const [editTrackingStartDate, setEditTrackingStartDate] = useState("");
  const [trackingStartDate, setTrackingStartDate] = useState<Date | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isNewUser, setIsNewUser] = useState(false);
  
  // Onboarding state - simplified calorie input flow
  const [lastMealTimestamp, setLastMealTimestamp] = useState<Date | null>(null);
  const [mostRecentMealTimestamp, setMostRecentMealTimestamp] = useState<number | null>(null); // Global most recent meal for fasting calculation
    const [showDebugPanel, setShowDebugPanel] = useState(false);
  
  // Food history for quick re-adding custom foods (includes macros)
  const [foodHistory, setFoodHistory] = useState<{name: string; calories: number; protein?: number; carbs?: number; fat?: number}[]>([]);
  
  // Edit food item state
  const [editingFood, setEditingFood] = useState<FoodItem | null>(null);
  const [deletingFoodId, setDeletingFoodId] = useState<string | null>(null);
  const [editFoodName, setEditFoodName] = useState("");
  const [editFoodCals, setEditFoodCals] = useState("");
  const [editFoodHour, setEditFoodHour] = useState("");
  const [editFoodMinute, setEditFoodMinute] = useState("");
  const [editFoodPeriod, setEditFoodPeriod] = useState<"AM" | "PM">("AM");
  const [editFoodDay, setEditFoodDay] = useState<"today" | "yesterday">("today");

  // Date navigation state - activitySelectedDate is independent from main display (always today)
  const [selectedDate, setSelectedDate] = useState(new Date()); // Main display date (always today)
  const [activitySelectedDate, setActivitySelectedDate] = useState(new Date()); // Activity section date (user can navigate)
  const [weeklyTotals, setWeeklyTotals] = useState<{[key: string]: number}>({});
  const [activityFoods, setActivityFoods] = useState<FoodItem[]>([]); // Food items for selected activity day
  const [yesterdayFoodsCache, setYesterdayFoodsCache] = useState<FoodItem[] | null>(null); // Pre-cached yesterday's foods
  const [viewingWeek, setViewingWeek] = useState<"this" | "last">("this");
  
  // Log intake form state
  const [showDetails, setShowDetails] = useState(false);
  const [logDay, setLogDay] = useState<string>("0"); // 0 = today, 1 = 1 day ago, etc
  
  // Animated display values
  const [displayBalance, setDisplayBalance] = useState<number | null>(null);
  const [displayEaten, setDisplayEaten] = useState<number | null>(null);
  
  // Client-side anchor for energy balance (always uses local time to prevent freezes)
  // balanceAnchorValue: the balance as of balanceAnchorTimestamp
  // balanceAnchorTimestamp: LOCAL client time (not server time) to keep ticking smooth
  const [balanceAnchorValue, setBalanceAnchorValue] = useState<number>(0);
  const [balanceAnchorTimestamp, setBalanceAnchorTimestamp] = useState<number>(Date.now());
  const [anchorInitialized, setAnchorInitialized] = useState(false);
  
  const [displayFastingHours, setDisplayFastingHours] = useState<number | null>(null);
  
  // Quick input popup state
  const [quickInputOpen, setQuickInputOpen] = useState(false);
  const [quickFoodName, setQuickFoodName] = useState("");
  const [quickFoodCals, setQuickFoodCals] = useState("");
  
  // Delete all confirmation dialog state
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [showMaxBalanceTest, setShowMaxBalanceTest] = useState(false); // For testing max balance indicator
  
  // Yesterday's net calories (TDEE - consumed) for comparison
  const [yesterdayConsumed, setYesterdayConsumed] = useState<number | null>(null);
  
  // Random meal example for placeholder
  const [mealPlaceholder] = useState(() => MEAL_EXAMPLES[Math.floor(Math.random() * MEAL_EXAMPLES.length)]);
  
  // Intentionally prevent auto-focus on dialogs to avoid keyboard popup blocking the view on mobile
  // Users tap the input field they want to focus, which triggers proper scroll positioning

  // Helper to get week start (Monday)
  const getWeekStart = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  // Get days of current week based on activity section selection
  const getWeekDays = () => {
    const weekStart = getWeekStart(activitySelectedDate);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      days.push(d);
    }
    return days;
  };

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const isToday = (date: Date) => {
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };
  const isActivitySelected = (date: Date) => date.toDateString() === activitySelectedDate.toDateString();
  const isFuture = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date > today;
  };
  const isBeforeStart = (date: Date) => {
    if (!trackingStartDate) return false;
    const dateStart = new Date(date);
    dateStart.setHours(0, 0, 0, 0);
    const startDateMidnight = new Date(trackingStartDate);
    startDateMidnight.setHours(0, 0, 0, 0);
    return dateStart < startDateMidnight;
  };

  // Track the current date string to detect day changes
  const [currentDateStr, setCurrentDateStr] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  // Pre-load yesterday's foods for instant switching
  const loadYesterdayFoodsCache = async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = formatDateLocal(yesterday);
    
    try {
      const response = await fetch(`/api/food/date/${dateStr}?tz=${getTzOffset()}`, { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        const formattedFood = data.map((item: any) => ({
          id: item.id.toString(),
          name: item.name,
          calories: parseFloat(item.calories),
          timestamp: new Date(item.timestamp).getTime(),
          mealType: item.mealType,
          protein: item.protein ? parseFloat(item.protein) : undefined,
          carbs: item.carbs ? parseFloat(item.carbs) : undefined,
          fat: item.fat ? parseFloat(item.fat) : undefined,
        }));
        setYesterdayFoodsCache(formattedFood);
      }
    } catch (error) {
      console.error("Failed to pre-load yesterday's foods:", error);
    }
  };

  // Load user stats, food items, and food history on mount
  useEffect(() => {
    loadUserStats();
    loadFoodItems();
    loadFoodHistory();
    loadWeeklyTotals();
    loadFastingSummaries();
    loadMostRecentMeal();
    loadYesterdayFoodsCache(); // Pre-load yesterday for instant switching
    
    const interval = setInterval(() => {
      setNow(Date.now());
      
      // Check if the day has changed (midnight passed)
      const todayStr = formatDateLocal(new Date());
      if (todayStr !== currentDateStr) {
        setCurrentDateStr(todayStr);
        setSelectedDate(new Date());
        setFoods([]); // Clear today's foods immediately
        loadFoodItems(new Date()); // Reload for new day
        loadWeeklyTotals();
        setActivitySelectedDate(new Date());
        loadYesterdayConsumed(); // Refresh yesterday's data for new day
      }
    }, 100);
    
    // Save energy balance periodically (every 30 seconds)
    const saveInterval = setInterval(() => {
      if (anchorInitialized && stats.tdee > 0) {
        saveEnergyBalanceToStorage(stats.tdee, stats.dailyGoalCalories);
      }
    }, 30000); // Every 30 seconds
    
    return () => {
      clearInterval(interval);
      clearInterval(saveInterval);
    };
  }, [currentDateStr, anchorInitialized, stats.tdee, stats.dailyGoalCalories]);

  // Check if a date is yesterday
  const isYesterday = (date: Date) => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return date.toDateString() === yesterday.toDateString();
  };

  // Handle activity date changes - use cached data for yesterday, show today's foods for today
  useEffect(() => {
    if (isToday(activitySelectedDate)) {
      // When viewing today, activityFoods is not used (we use foods directly)
      // No need to do anything
    } else if (isYesterday(activitySelectedDate)) {
      // Use cached yesterday data for instant switching
      if (yesterdayFoodsCache !== null) {
        setActivityFoods(yesterdayFoodsCache);
      } else {
        // Cache not ready yet, fetch directly
        loadActivityFoods();
      }
    }
  }, [activitySelectedDate, yesterdayFoodsCache]);

  // Load weekly totals separately (doesn't need to re-run on every date switch)
  useEffect(() => {
    loadWeeklyTotals();
  }, [viewingWeek]);
  
  // Load yesterday's net when TDEE is available
  useEffect(() => {
    if (stats.tdee > 0) {
      loadYesterdayConsumed();
    }
  }, [stats.tdee]);
  
  // Load food items for the selected activity day with race condition protection
  const loadActivityFoods = async () => {
    // Capture the date at call time to avoid stale data from race conditions
    const targetDate = new Date(activitySelectedDate);
    const dateStr = formatDateLocal(targetDate);
    
    try {
      const response = await fetch(`/api/food/date/${dateStr}?tz=${getTzOffset()}`, { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        // Check if the selected date is still the same before updating state
        const currentDateStr = formatDateLocal(activitySelectedDate);
        if (dateStr !== currentDateStr) {
          return; // Date changed during fetch, ignore stale response
        }
        
        const formattedFood = data.map((item: any) => ({
          id: item.id.toString(),
          name: item.name,
          calories: parseFloat(item.calories),
          timestamp: new Date(item.timestamp).getTime(),
          mealType: item.mealType,
          protein: item.protein ? parseFloat(item.protein) : undefined,
          carbs: item.carbs ? parseFloat(item.carbs) : undefined,
          fat: item.fat ? parseFloat(item.fat) : undefined,
        }));
        setActivityFoods(formattedFood.sort((a: FoodItem, b: FoodItem) => a.timestamp - b.timestamp));
      }
    } catch (error) {
      console.error("Failed to load activity foods:", error);
    }
  };

  // Helper to format date as YYYY-MM-DD in local timezone
  const formatDateLocal = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Get timezone offset in minutes (for server queries)
  const getTzOffset = () => new Date().getTimezoneOffset();

  // Load weekly totals for the week view - fetch all days in parallel
  const loadFastingSummaries = async () => {
    try {
      const response = await fetch("/api/fasting/summary", { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        if (data.length === 0) {
          // No summaries exist, trigger initial calculation
          recalculateFastingSummaries();
        loadMostRecentMeal();
        } else {
          setFastingSummaries(data);
        }
      }
    } catch (error) {
      console.error("Failed to load fasting summaries:", error);
    }
  };

  const recalculateFastingSummaries = async () => {
    try {
      const response = await fetch("/api/fasting/recalculate", {
        method: "POST",
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setFastingSummaries(data);
      }
    } catch (error) {
      console.error("Failed to recalculate fasting summaries:", error);
    }
  };

  const loadWeeklyTotals = async () => {
    const weekDays = getViewingWeekDays();
    const totals: {[key: string]: number} = {};
    
    const fetchPromises = weekDays
      .filter(day => !isFuture(day))
      .map(async (day) => {
        const dateStr = formatDateLocal(day);
        try {
          const response = await fetch(`/api/food/date/${dateStr}?tz=${getTzOffset()}`, { credentials: "include" });
          if (response.ok) {
            const data = await response.json();
            totals[dateStr] = data.reduce((sum: number, item: any) => sum + parseFloat(item.calories || 0), 0);
          }
        } catch (e) {
          console.error('Failed to load weekly totals:', e);
        }
      });
    
    await Promise.all(fetchPromises);
    setWeeklyTotals(totals);
  };

  // Load yesterday's consumed calories for deficit/surplus display
  const loadYesterdayConsumed = async () => {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dateStr = formatDateLocal(yesterday);
      
      const response = await fetch(`/api/food/date/${dateStr}?tz=${getTzOffset()}`, { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        // Only show yesterday's result if there was food logged
        if (data.length === 0) {
          setYesterdayConsumed(null);
          return;
        }
        const totalConsumed = data.reduce((sum: number, item: any) => sum + parseFloat(item.calories || 0), 0);
        setYesterdayConsumed(totalConsumed);
      }
    } catch (error) {
      console.error("Failed to load yesterday's data:", error);
    }
  };

  // Week navigation functions - these control Activity section only, not main display
  const goToPreviousWeek = () => {
    const newDate = new Date(activitySelectedDate);
    newDate.setDate(newDate.getDate() - 7);
    setActivitySelectedDate(newDate);
  };

  const goToNextWeek = () => {
    const newDate = new Date(activitySelectedDate);
    newDate.setDate(newDate.getDate() + 7);
    const today = new Date();
    if (newDate <= today) {
      setActivitySelectedDate(newDate);
    }
  };

  const selectDay = (date: Date) => {
    if (!isFuture(date) && !isBeforeStart(date)) {
      setActivitySelectedDate(date);
    }
  };

  const goToToday = () => {
    setActivitySelectedDate(new Date());
    setViewingWeek("this");
  };

  // Get current day name (Mon, Tue, etc.)
  const getCurrentDayName = () => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[selectedDate.getDay()];
  };

  // Get full day name
  const getFullDayName = () => {
    return selectedDate.toLocaleDateString('en-US', { weekday: 'long' });
  };

  // Sync log day with selected date when it changes (now uses "days ago" format)
  useEffect(() => {
    // Calculate how many days ago the selected date is
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selected = new Date(selectedDate);
    selected.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today.getTime() - selected.getTime()) / (1000 * 60 * 60 * 24));
    setLogDay(String(Math.max(0, Math.min(7, diffDays))));
  }, [selectedDate]);

  // Initialize time defaults on mount
  useEffect(() => {
    const now = new Date();
    let hours = now.getHours();
    const period = hours >= 12 ? "PM" : "AM";
    if (hours > 12) hours -= 12;
    if (hours === 0) hours = 12;
    
    setFoodHour(String(hours));
    setFoodMinute(String(now.getMinutes()).padStart(2, '0'));
    setFoodPeriod(period);
  }, []);

  // Reset detail form to current time/date whenever "add detail" is toggled
  useEffect(() => {
    if (showDetails) {
      const now = new Date();
      const rawHours = now.getHours();
      let displayHours = rawHours;
      const period = rawHours >= 12 ? "PM" : "AM";
      if (displayHours > 12) displayHours -= 12;
      if (displayHours === 0) displayHours = 12;
      
      // Determine meal type based on time
      let meal: "breakfast" | "lunch" | "dinner" | "snack" = "lunch";
      if (rawHours >= 4 && rawHours <= 11) {
        meal = "breakfast";
      } else if (rawHours >= 12 && rawHours <= 16) {
        meal = "lunch";
      } else if (rawHours >= 17 || rawHours <= 3) {
        meal = "dinner";
      }
      
      setFoodHour(String(displayHours));
      setFoodMinute(String(now.getMinutes()).padStart(2, '0'));
      setFoodPeriod(period);
      setProtein("");
      setCarbs("");
      setFat("");
      setMealType(meal);
    }
  }, [showDetails]);

  // Switch between this week and last week viewing (Activity section only)
  const switchWeek = (week: "this" | "last") => {
    setViewingWeek(week);
    const today = new Date();
    if (week === "last") {
      const lastWeek = new Date(today);
      lastWeek.setDate(today.getDate() - 7);
      setActivitySelectedDate(lastWeek);
    } else {
      setActivitySelectedDate(today);
    }
  };

  // Get days for the viewing week based on activitySelectedDate
  const getViewingWeekDays = () => {
    const weekStart = getWeekStart(activitySelectedDate);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      days.push(d);
    }
    return days;
  };

  const loadFoodHistory = () => {
    try {
      const stored = localStorage.getItem('fluxcal_food_history');
      if (stored) {
        setFoodHistory(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to load food history:', e);
    }
  };

  // Load energy balance from localStorage (works independently of server)
  const loadEnergyBalanceFromStorage = (tdee: number, goalCalories?: number): boolean => {
    try {
      const stored = localStorage.getItem('fluxcal_energy_balance');
      if (stored) {
        const data = JSON.parse(stored);
        const { value, timestamp, storedTdee, storedGoalRate } = data;
        
        // Use current goal rate if available, otherwise stored rate, otherwise TDEE
        const effectiveRate = goalCalories || storedGoalRate || tdee;
        
        // Calculate catch-up: time elapsed since last save
        const now = Date.now();
        const secondsSince = Math.max(0, (now - timestamp) / 1000);
        const burnRatePerSec = effectiveRate / 86400;
        const catchUp = secondsSince * burnRatePerSec;
        
        // Set anchor with catch-up applied
        setBalanceAnchorValue(value + catchUp);
        setBalanceAnchorTimestamp(now);
        setAnchorInitialized(true);
        
        return true; // Successfully loaded from storage
      }
    } catch (e) {
      console.error('Failed to load energy balance from storage:', e);
    }
    return false; // No storage or error
  };

  // Save energy balance to localStorage (for offline persistence)
  const saveEnergyBalanceToStorage = (tdee: number, goalCalories?: number) => {
    try {
      const effectiveRate = goalCalories || tdee;
      const data = {
        value: balanceAnchorValue,
        timestamp: balanceAnchorTimestamp,
        storedTdee: tdee,
        storedGoalRate: effectiveRate,
      };
      localStorage.setItem('fluxcal_energy_balance', JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save energy balance to storage:', e);
    }
  };

  const saveFoodToHistory = (name: string, calories: number, protein?: number, carbs?: number, fat?: number) => {
    const quickAddNames = ['Food', 'Drink', 'Snack'];
    if (quickAddNames.includes(name)) return;
    
    setFoodHistory(prev => {
      const existing = prev.find(h => h.name === name && h.calories === calories);
      if (existing) return prev;
      const updated = [{ name, calories, protein, carbs, fat }, ...prev].slice(0, 10);
      localStorage.setItem('fluxcal_food_history', JSON.stringify(updated));
      return updated;
    });
  };

  const handleAddFromHistory = async (name: string, calories: number, protein?: number, carbs?: number, fat?: number) => {
    try {
      setIsLoading(true);
      // Always add to today with current time (main display always shows today)
      const targetDate = new Date();
      
      const response = await fetch("/api/food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name,
          calories,
          timestamp: targetDate,
          protein: protein || null,
          carbs: carbs || null,
          fat: fat || null,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const newFood: FoodItem = {
          id: data.id.toString(),
          name: data.name,
          calories: parseFloat(data.calories),
          timestamp: new Date(data.timestamp).getTime(),
          mealType: data.mealType,
          protein: data.protein ? parseFloat(data.protein) : undefined,
          carbs: data.carbs ? parseFloat(data.carbs) : undefined,
          fat: data.fat ? parseFloat(data.fat) : undefined,
        };
        setFoods(prev => [...prev, newFood]);
        // Update server-side energy reserve
        updateEnergyReserve(newFood.calories);
        recalculateFastingSummaries();
        loadMostRecentMeal();
      }
    } catch (error) {
      console.error("Failed to add food from history:", error);
    } finally {
      setIsLoading(false);
    }
  };



  // Initialize energy reserve on server - starts at 0 from midnight today
  // Uses goalCalories for burn rate if provided (for goal-based tracking)
  const initializeEnergyReserve = async (tdeeValue: number, goalCalories?: number) => {
    // Try loading from localStorage first (works offline)
    const loadedFromStorage = loadEnergyBalanceFromStorage(tdeeValue, goalCalories);
    
    // If loaded from storage, still try to sync with server in background (optional)
    // But don't wait for it - localStorage is the source of truth for display
    const syncWithServer = async () => {
      try {
        const response = await fetch("/api/user/init-energy-reserve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ tdee: tdeeValue }),
        });
        if (response.ok) {
          const data = await response.json();
          const serverBalance = parseFloat(data.cumulativeNetCalories || "0");
          const serverTimestamp = data.lastBalanceUpdateDate 
            ? new Date(data.lastBalanceUpdateDate).getTime() 
            : Date.now();
          
          // Use goal calories for burn rate if set (psychological budget), otherwise TDEE
          const effectiveRate = goalCalories || tdeeValue;
          const burnRatePerSec = effectiveRate / 86400;
          const secondsSinceServer = Math.max(0, (Date.now() - serverTimestamp) / 1000);
          const currentBalance = serverBalance + (secondsSinceServer * burnRatePerSec);
          
          // Update anchor if server data is available (but localStorage takes precedence if already loaded)
          if (!loadedFromStorage) {
            setBalanceAnchorValue(currentBalance);
            setBalanceAnchorTimestamp(Date.now());
            setAnchorInitialized(true);
            // Save to localStorage for future offline use
            saveEnergyBalanceToStorage(tdeeValue, goalCalories);
          }
          
          setStats(prev => ({
            ...prev,
            cumulativeNetCalories: serverBalance,
            lastBalanceUpdateDate: data.lastBalanceUpdateDate,
          }));
        }
      } catch (error) {
        console.error("Failed to sync energy reserve with server:", error);
        // If server fails but we have localStorage, that's fine - continue with localStorage
        if (!loadedFromStorage) {
          // No localStorage and server failed - initialize fresh
          setBalanceAnchorValue(0);
          setBalanceAnchorTimestamp(Date.now());
          setAnchorInitialized(true);
          saveEnergyBalanceToStorage(tdeeValue, goalCalories);
        }
      }
    };
    
    // If we loaded from storage, sync in background (non-blocking)
    // If not, try server first
    if (loadedFromStorage) {
      syncWithServer(); // Fire and forget
    } else {
      await syncWithServer();
    }
  };

  // Update energy reserve when food is added
  // Optimistic update: subtract from anchor value, keep anchor timestamp (no freeze!)
  // Saves to localStorage immediately for offline persistence
  // DON'T resync anchor from server response - this causes ~3 cal discrepancy from network latency
  const updateEnergyReserve = async (deltaCalories: number) => {
    // Optimistic update: adjust anchor value (subtract for food added, add for food removed)
    // Keep the anchor timestamp - this ensures continuous ticking
    setBalanceAnchorValue(prev => {
      const newValue = prev - deltaCalories;
      // Save to localStorage immediately with the new value (works offline)
      const effectiveRate = stats.dailyGoalCalories || stats.tdee;
      try {
        const data = {
          value: newValue,
          timestamp: balanceAnchorTimestamp, // Keep same timestamp
          storedTdee: stats.tdee,
          storedGoalRate: effectiveRate,
        };
        localStorage.setItem('fluxcal_energy_balance', JSON.stringify(data));
      } catch (e) {
        console.error('Failed to save energy balance to storage:', e);
      }
      return newValue;
    });
    
    // Sync with server in background (for persistence only, don't update local display)
    // This is optional - localStorage is the source of truth
    try {
      const response = await fetch("/api/user/update-balance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ deltaCalories, tdee: stats.dailyGoalCalories || stats.tdee }),
      });
      if (response.ok) {
        const data = await response.json();
        // Only update stats for persistence - DON'T touch anchor values
        // The anchor stays accurate based on optimistic update
        setStats(prev => ({
          ...prev,
          cumulativeNetCalories: parseFloat(data.cumulativeNetCalories || "0"),
          lastBalanceUpdateDate: data.lastBalanceUpdateDate,
        }));
      }
    } catch (error) {
      console.error("Failed to update energy reserve on server:", error);
      // That's okay - localStorage has the correct value
    }
  };

  const loadUserStats = async () => {
    try {
      const response = await fetch(`/api/auth/user`, { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        // Check if user has completed onboarding (has biometric data)
        if (!data.weight || !data.height || !data.age || !data.gender || !data.activityLevel) {
          setIsNewUser(true);
          setShowOnboarding(true);
          setIsInitialLoad(false);
          return;
        }
        
        // Calculate BMR and TDEE on frontend
        const bmr = calculateBMR(parseFloat(data.weight), data.height, data.age, data.gender);
        const tdee = Math.round(bmr * getActivityMultiplier(data.activityLevel));
        
        // Check if buffer applies to today
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const bufferApplies = data.bufferForDate === todayStr;
        
        setStats({
          weight: parseFloat(data.weight),
          height: data.height,
          age: data.age,
          gender: data.gender,
          activityLevel: data.activityLevel,
          bmr,
          tdee,
          goalWeight: data.goalWeight ? parseFloat(data.goalWeight) : undefined,
          goalDays: data.goalDays || undefined,
          dailyGoalCalories: data.dailyGoalCalories || undefined,
          dailyDeficit: data.dailyDeficit || undefined,
          cumulativeNetCalories: data.cumulativeNetCalories ? parseFloat(data.cumulativeNetCalories) : 0,
          lastBalanceUpdateDate: data.lastBalanceUpdateDate,
          bufferAmount: bufferApplies ? data.bufferAmount : undefined,
          bufferForDate: bufferApplies ? data.bufferForDate : undefined,
        });
        setEditWeight(data.weight);
        setEditHeight(data.height.toString());
        setEditAge(data.age.toString());
        setEditGender(data.gender);
        setEditActivity(data.activityLevel);
        if (data.fastingTrackingStartDate) {
          const startDate = new Date(data.fastingTrackingStartDate);
          setEditTrackingStartDate(startDate.toISOString().split('T')[0]);
          setTrackingStartDate(startDate);
        } else {
          setTrackingStartDate(null);
        }
        
        // Initialize energy reserve - try localStorage first (works offline)
        // Use goal calories for burn rate if set (psychological budget)
        const effectiveRate = data.dailyGoalCalories || tdee;
        
        // Try loading from localStorage first (works completely offline)
        const loadedFromStorage = loadEnergyBalanceFromStorage(tdee, data.dailyGoalCalories);
        
        if (!loadedFromStorage) {
          // No localStorage data - initialize from server or fresh
          if (!data.lastBalanceUpdateDate && data.weight) {
            await initializeEnergyReserve(tdee, data.dailyGoalCalories);
          } else if (data.lastBalanceUpdateDate) {
            // Initialize client anchor from server data
            const serverBalance = data.cumulativeNetCalories ? parseFloat(data.cumulativeNetCalories) : 0;
            const serverTimestamp = new Date(data.lastBalanceUpdateDate).getTime();
            
            // Calculate current balance based on server anchor using goal rate
            const burnRatePerSec = effectiveRate / 86400;
            const secondsSinceServer = Math.max(0, (Date.now() - serverTimestamp) / 1000);
            const currentBalance = serverBalance + (secondsSinceServer * burnRatePerSec);
            
            // Set client anchor to current balance at current time
            setBalanceAnchorValue(currentBalance);
            setBalanceAnchorTimestamp(Date.now());
            setAnchorInitialized(true);
            // Save to localStorage for future offline use
            saveEnergyBalanceToStorage(tdee, data.dailyGoalCalories);
          }
        } else {
          // Loaded from localStorage - optionally sync with server in background (non-blocking)
          // Server sync is optional, localStorage is source of truth
        }
        
        setIsInitialLoad(false);
      } else if (response.status === 401) {
        // Not authenticated - will be handled by ProtectedRoute
        setIsInitialLoad(false);
      }
    } catch (error) {
      console.error("Failed to load user stats:", error);
      setIsInitialLoad(false);
    }
  };

  const loadFoodItems = async (date?: Date) => {
    try {
      const targetDate = date || selectedDate;
      const dateStr = formatDateLocal(targetDate);
      const response = await fetch(`/api/food/date/${dateStr}?tz=${getTzOffset()}`, { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        const formattedFood = data.map((item: any) => ({
          id: item.id.toString(),
          name: item.name,
          calories: parseFloat(item.calories),
          timestamp: new Date(item.timestamp).getTime(),
          mealType: item.mealType,
          protein: item.protein ? parseFloat(item.protein) : undefined,
          carbs: item.carbs ? parseFloat(item.carbs) : undefined,
          fat: item.fat ? parseFloat(item.fat) : undefined,
        }));
        setFoods(formattedFood.sort((a: FoodItem, b: FoodItem) => a.timestamp - b.timestamp));
      }
    } catch (error) {
      console.error("Failed to load food items:", error);
    }
  };

  // Load the most recent meal timestamp for fasting calculation
  // This is the canonical source of truth for fasting state, independent of which day is being viewed
  const loadMostRecentMeal = async () => {
    try {
      const response = await fetch("/api/food/last", { credentials: "include" });
      if (response.ok) {
        const data = await response.json();
        if (data && data.timestamp) {
          setMostRecentMealTimestamp(new Date(data.timestamp).getTime());
        } else {
          setMostRecentMealTimestamp(null);
        }
      }
    } catch (error) {
      console.error("Failed to load most recent meal:", error);
    }
  };

  // Determine minimum daily calories based on gender
  const getMinimumDailyCalories = (gender: string) => {
    return gender === 'female' ? 1200 : 1500;
  };
  
  const minimumDailyCalories = getMinimumDailyCalories(stats.gender);
  
  // Burn rate calculations
  // TDEE rate: Used for daily burn progress bar and food depletion (actual metabolic burn)
  const tdeeBurnRatePerSecond = stats.tdee / 86400;
  // Goal rate: Used for energy balance ticker (psychological budget rate)
  // Falls back to TDEE if no goal is set
  const goalBurnRatePerSecond = (stats.dailyGoalCalories || stats.tdee) / 86400;
  
  // Calculate total calories eaten today
  const totalEaten = foods.reduce((acc, food) => acc + food.calories, 0);
  
  // Calculate daily macros for radar chart (from the currently viewed day's foods)
  const dailyMacros = useMemo(() => {
    const displayFoods = isToday(activitySelectedDate) ? foods : activityFoods;
    return displayFoods.reduce((acc, food) => ({
      protein: acc.protein + (food.protein || 0),
      carbs: acc.carbs + (food.carbs || 0),
      fat: acc.fat + (food.fat || 0),
    }), { protein: 0, carbs: 0, fat: 0 });
  }, [foods, activityFoods, activitySelectedDate]);
  
  // Calculate burn queue for food depletion visualization
  // Uses TDEE (actual metabolic burn) for sequential food burning
  // Only applies to today - past days show all foods as fully burned
  const burnQueue = useMemo(() => {
    if (!isToday(activitySelectedDate)) {
      // For past days, create a map with all foods marked as burned (no animation)
      const result = new Map<string, BurnQueueItem>();
      for (const food of activityFoods) {
        result.set(food.id, {
          id: food.id,
          burnStart: food.timestamp,
          burnEnd: food.timestamp,
          fillPercent: 0,
          remainingSeconds: 0,
          burnDurationSeconds: 0,
          isCurrentlyBurning: false,
          isBurned: true,
          isWaiting: false,
        });
      }
      return result;
    }
    return calculateBurnQueue(foods, now, stats.tdee);
  }, [foods, activityFoods, activitySelectedDate, now, stats.tdee]);
  
  // ===== DAILY BMR BURN PROGRESS (resets at midnight) =====
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const secondsSinceStartOfDay = (now - startOfDay.getTime()) / 1000;
  const todaysBurn = secondsSinceStartOfDay * tdeeBurnRatePerSecond;
  const dailyBurnProgress = (todaysBurn / stats.tdee) * 100; // Progress towards full day burn
  
  // Today's net = eaten - burned today (for display)
  const todaysNetCalories = totalEaten - todaysBurn;
  
  // ===== CUMULATIVE ENERGY BALANCE (never resets) =====
  // Uses client-side anchor (balanceAnchorValue, balanceAnchorTimestamp) for smooth ticking
  // The anchor always uses LOCAL client time to avoid server clock sync issues
  // Uses GOAL rate for psychological budget display (smaller number when on deficit diet)
  const secondsSinceAnchor = Math.max(0, (now - balanceAnchorTimestamp) / 1000);
  const burnSinceAnchor = secondsSinceAnchor * goalBurnRatePerSecond;
  
  // Energy balance = anchor value + burn since anchor
  // Positive = deficit (burned more than eaten)
  // Negative = surplus (ate more than burned)
  const cumulativeBalance = balanceAnchorValue + burnSinceAnchor;
  
  // Energy reserve for display (same as cumulative balance)
  const energyReserve = cumulativeBalance;
  
  // Check if intake exceeds TDEE
  const intakeExceedsMax = totalEaten > stats.tdee;

  const formatCal = (val: number) => Math.abs(val).toFixed(2);

  // Fasting stage calculations
  // Use the globally fetched mostRecentMealTimestamp as the canonical source
  // This ensures fasting state is always correct regardless of which day is being viewed
  const getLastMealTime = () => {
    // Primary source: server-provided most recent meal timestamp
    if (mostRecentMealTimestamp !== null) {
      return mostRecentMealTimestamp;
    }
    
    // Fallback: combine today's foods with activity foods
    const allRecentFoods = [...foods, ...activityFoods];
    if (allRecentFoods.length > 0) {
      return Math.max(...allRecentFoods.map(f => f.timestamp));
    }
    
    // Final fallback: onboarding timestamp
    if (lastMealTimestamp) {
      return lastMealTimestamp.getTime();
    }
    
    return null;
  };

  const lastMealTime = getLastMealTime();
  const secondsSinceLastMeal = lastMealTime ? (now - lastMealTime) / 1000 : 0;
  const hoursSinceLastMeal = secondsSinceLastMeal / 3600;

  const getFastingStage = () => {
    // If no food entries, show "Awaiting first meal" state
    if (!lastMealTime) return { name: "Awaiting Entry", color: "bg-muted", progress: 0 };
    if (hoursSinceLastMeal < 4) return { name: "Fed", color: "bg-accent", progress: (hoursSinceLastMeal / 4) * 100 };
    if (hoursSinceLastMeal < 8) return { name: "Post-Absorptive", color: "bg-primary/80", progress: ((hoursSinceLastMeal - 4) / 4) * 100 };
    if (hoursSinceLastMeal < 12) return { name: "Fat Burning", color: "bg-primary", progress: ((hoursSinceLastMeal - 8) / 4) * 100 };
    if (hoursSinceLastMeal < 16) return { name: "Deep Ketosis", color: "bg-primary/60", progress: ((hoursSinceLastMeal - 12) / 4) * 100 };
    return { name: "Autophagy", color: "bg-primary/40", progress: 100 };
  };

  const fastingStage = getFastingStage();

  // Display cumulativeBalance directly for real-time ticking
  // No need for useEffect - just display the live calculated value

  useEffect(() => {
    if (displayEaten === null) {
      setDisplayEaten(totalEaten);
      return;
    }
    const diff = totalEaten - displayEaten;
    if (Math.abs(diff) < 0.5) {
      setDisplayEaten(totalEaten);
      return;
    }
    const step = diff / 15;
    const interval = setInterval(() => {
      setDisplayEaten(prev => {
        if (prev === null) return totalEaten;
        const newVal = prev + step;
        if ((step > 0 && newVal >= totalEaten) || (step < 0 && newVal <= totalEaten)) {
          clearInterval(interval);
          return totalEaten;
        }
        return newVal;
      });
    }, 20);
    return () => clearInterval(interval);
  }, [totalEaten]);

  useEffect(() => {
    if (displayFastingHours === null) {
      setDisplayFastingHours(hoursSinceLastMeal);
      return;
    }
    // Detect sudden drop (food was logged)
    const diff = hoursSinceLastMeal - displayFastingHours;
    if (diff < -0.5) {
      // Animate down to new value
      const step = diff / 20;
      const interval = setInterval(() => {
        setDisplayFastingHours(prev => {
          if (prev === null) return hoursSinceLastMeal;
          const newVal = prev + step;
          if (newVal <= hoursSinceLastMeal) {
            clearInterval(interval);
            return hoursSinceLastMeal;
          }
          return newVal;
        });
      }, 15);
      return () => clearInterval(interval);
    } else {
      // Normal tick - just update
      setDisplayFastingHours(hoursSinceLastMeal);
    }
  }, [hoursSinceLastMeal]);

  // Use live values for display - cumulativeBalance updates every 100ms via the `now` state
  // Cap energy balance at daily goal (or TDEE if no goal) to prevent "banking" calories
  const maxEnergyBalance = stats.dailyGoalCalories || stats.tdee;
  const isAtMaxBalance = cumulativeBalance >= maxEnergyBalance;
  const shownBalance = Math.min(cumulativeBalance, maxEnergyBalance);
  const shownEaten = displayEaten ?? totalEaten;
  const shownFastingHours = displayFastingHours ?? hoursSinceLastMeal;

  const formatFastingTime = (hours: number) => {
    if (hours < 1) {
      const mins = Math.floor(hours * 60);
      return `${mins}m`;
    }
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    return `${h}h ${m}m`;
  };

  // Calculate time to reach zero energy balance
  // In new model: negative balance = surplus (ate more than burned)
  // When surplus exists, show time until it's burned off (balance reaches 0)
  const getTimeToZero = () => {
    // If balance is non-negative (deficit or zero), no surplus to burn
    if (cumulativeBalance >= 0) return null;
    
    // Balance is negative (surplus) - calculate time to burn it off
    // We need to burn |balance| calories at goal rate (consistent with balance display)
    const surplusCalories = Math.abs(cumulativeBalance);
    const secondsToZero = surplusCalories / goalBurnRatePerSecond;
    const hours = Math.floor(secondsToZero / 3600);
    const minutes = Math.floor((secondsToZero % 3600) / 60);
    const seconds = Math.floor(secondsToZero % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else if (minutes > 0) {
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    } else {
      return `${seconds}s`;
    }
  };

  const timeToZero = getTimeToZero();

  const handleSaveStats = async () => {
    const w = parseFloat(editWeight) || 70;
    const h = parseInt(editHeight) || 170;
    const a = parseInt(editAge) || 30;
    
    // Calculate BMR and TDEE immediately on frontend
    const newBmr = calculateBMR(w, h, a, editGender);
    const newTdee = Math.round(newBmr * getActivityMultiplier(editActivity));

    // Check if goals are being set
    const targetWeight = parseFloat(goalTargetWeight);
    const targetDays = parseInt(goalTargetDays);
    const hasValidGoals = !isNaN(targetWeight) && !isNaN(targetDays) && targetWeight < w && targetDays > 0;

    // Calculate goal calories if goals are set
    let dailyGoalCalories: number | undefined;
    let dailyDeficit: number | undefined;
    if (hasValidGoals) {
      const weightDiff = w - targetWeight;
      const totalCaloriesToBurn = weightDiff * 7700;
      dailyDeficit = Math.min(Math.round(totalCaloriesToBurn / targetDays), 1000);
      dailyGoalCalories = Math.max(newBmr - dailyDeficit, 1200);
    }

    // Update local state immediately for instant feedback
    setStats(prev => ({
      ...prev,
      weight: w,
      height: h,
      age: a,
      gender: editGender,
      activityLevel: editActivity,
      bmr: newBmr,
      tdee: newTdee,
      ...(hasValidGoals ? {
        goalWeight: targetWeight,
        goalDays: targetDays,
        dailyGoalCalories,
        dailyDeficit,
      } : {}),
    }));

    try {
      setIsLoading(true);
      // Save biometric data to backend
      const response = await fetch(`/api/user/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          weight: w,
          height: h,
          age: a,
          gender: editGender,
          activityLevel: editActivity,
        }),
      });

      // Also save goals if provided
      if (response.ok && hasValidGoals) {
        await fetch(`/api/user/goals`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            targetWeight,
            targetDays,
            currentWeight: w,
            bmr: newBmr,
          }),
        });
      }

      // Save tracking start date if changed
      if (response.ok && editTrackingStartDate) {
        const startDate = new Date(editTrackingStartDate);
        startDate.setHours(0, 0, 0, 0);
        await fetch(`/api/user/profile`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            fastingTrackingStartDate: startDate.toISOString(),
          }),
        });
      }

      if (response.ok) {
        setIsSettingsOpen(false);
        setGoalTargetWeight("");
        setGoalTargetDays("");
        // Reload fasting summaries with new start date
        loadFastingSummaries();
      }
    } catch (error) {
      console.error("Failed to save user stats:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveGoals = async () => {
    const targetWeight = parseFloat(goalTargetWeight);
    const targetDays = parseInt(goalTargetDays);
    
    if (isNaN(targetWeight) || isNaN(targetDays)) return;
    if (targetWeight >= stats.weight) return;
    if (targetDays <= 0) return;

    try {
      setIsLoading(true);
      const response = await fetch(`/api/user/goals`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          targetWeight,
          targetDays,
          currentWeight: stats.weight,
          bmr: stats.bmr,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const newGoalCalories = data.dailyGoalCalories;
        
        // Recalculate anchor using the new goal rate
        // This ensures the balance display is correct with the new goal
        if (newGoalCalories && stats.lastBalanceUpdateDate) {
          const serverBalance = stats.cumulativeNetCalories ?? 0;
          const serverTimestamp = new Date(stats.lastBalanceUpdateDate).getTime();
          const newBurnRate = newGoalCalories / 86400;
          const secondsSinceServer = Math.max(0, (Date.now() - serverTimestamp) / 1000);
          const recalculatedBalance = serverBalance + (secondsSinceServer * newBurnRate);
          setBalanceAnchorValue(recalculatedBalance);
          setBalanceAnchorTimestamp(Date.now());
          // Save to localStorage with new goal rate
          saveEnergyBalanceToStorage(stats.tdee, newGoalCalories);
        }
        
        setStats(prev => ({
          ...prev,
          goalWeight: parseFloat(data.goalWeight),
          goalDays: data.goalDays,
          dailyGoalCalories: newGoalCalories,
          dailyDeficit: data.dailyDeficit,
        }));
        setShowOnboarding(false);
      }
    } catch (error) {
      console.error("Failed to save goals:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddFood = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFoodName || !newFoodCals) return;
    
    const cals = parseFloat(newFoodCals);
    if (isNaN(cals)) return;

    // Calculate target date from logDay (0 = today, 1 = 1 day ago, etc)
    const today = new Date();
    const daysAgo = parseInt(logDay) || 0;
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() - daysAgo);

    // Set time from foodHour, foodMinute, foodPeriod
    // If no time specified (details not expanded), use current time
    if (foodHour && foodMinute) {
      let hour = parseInt(foodHour);
      const minute = parseInt(foodMinute);
      // Convert 12-hour to 24-hour format
      if (foodPeriod === "PM" && hour !== 12) hour += 12;
      if (foodPeriod === "AM" && hour === 12) hour = 0;
      targetDate.setHours(hour, minute, 0, 0);
    } else {
      // Use current time when details not specified
      const now = new Date();
      targetDate.setHours(now.getHours(), now.getMinutes(), 0, 0);
    }
    const timestamp = targetDate.getTime();

    // Validate: don't allow entries before tracking start date
    if (trackingStartDate) {
      const startDateMidnight = new Date(trackingStartDate);
      startDateMidnight.setHours(0, 0, 0, 0);
      if (targetDate < startDateMidnight) {
        alert(`Cannot add entries before your tracking start date (${startDateMidnight.toLocaleDateString()})`);
        return;
      }
    }

    try {
      setIsLoading(true);
      const response = await fetch("/api/food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: newFoodName,
          calories: cals,
          timestamp: new Date(timestamp),
          mealType: mealType || null,
          protein: protein ? parseFloat(protein) : null,
          carbs: carbs ? parseFloat(carbs) : null,
          fat: fat ? parseFloat(fat) : null,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const newFood: FoodItem = {
          id: data.id.toString(),
          name: data.name,
          calories: parseFloat(data.calories),
          timestamp: new Date(data.timestamp).getTime(),
          mealType: data.mealType,
          protein: data.protein ? parseFloat(data.protein) : undefined,
          carbs: data.carbs ? parseFloat(data.carbs) : undefined,
          fat: data.fat ? parseFloat(data.fat) : undefined,
        };
        saveFoodToHistory(newFood.name, newFood.calories, newFood.protein, newFood.carbs, newFood.fat);
        setNewFoodName("");
        setNewFoodCals("");
        setProtein("");
        setCarbs("");
        setFat("");
        setFoodHour("");
        setFoodMinute("");
        
        // Check if the target day is today - if so, add to foods list
        // Main display always shows today, so only add if logging for today
        const todayStr = formatDateLocal(new Date());
        const targetDateStr = formatDateLocal(targetDate);
        const activityDateStr = formatDateLocal(activitySelectedDate);
        
        if (todayStr === targetDateStr) {
          // Adding for today - update today's foods
          setFoods(prev => [...prev, newFood]);
        }
        
        // If the target date matches the currently selected activity date, update activity foods
        if (targetDateStr === activityDateStr) {
          setActivityFoods(prev => [...prev, newFood].sort((a, b) => a.timestamp - b.timestamp));
        }
        
        // Always update energy reserve regardless of entry date
        updateEnergyReserve(newFood.calories);
        
        // Always recalculate summaries and reload weekly totals
        recalculateFastingSummaries();
        loadMostRecentMeal();
        loadWeeklyTotals();
      } else {
        // Handle error response
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || errorData.message || "Failed to save food. Please try again.";
        alert(errorMsg);
      }
    } catch (error) {
      console.error("Failed to add food item:", error);
      alert("Failed to save food. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteAllOnly = async () => {
    try {
      const response = await fetch("/api/food/all", { method: "DELETE", credentials: "include" });
      if (response.ok) {
        setFoods([]);
        setActivityFoods([]);
        setYesterdayFoodsCache(null);
        setFastingSummaries([]);
        setWeeklyTotals({});
        queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      }
    } catch (error) {
      console.error("Failed to delete all food items:", error);
    }
    setDeleteAllDialogOpen(false);
  };

  const handleRestartApp = async () => {
    try {
      // Delete all food items
      await fetch("/api/food/all", { method: "DELETE", credentials: "include" });
      
      // Reset user profile to trigger onboarding (clear all user data)
      // Set fastingTrackingStartDate to null so onboarding can set it fresh
      await fetch("/api/user/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          fastingTrackingStartDate: null,
        }),
      });
      
      // Reset local state completely
      setFoods([]);
      setActivityFoods([]);
      setYesterdayFoodsCache(null);
      setFastingSummaries([]);
      setWeeklyTotals({});
      setStats(DEFAULT_STATS);
      setTrackingStartDate(null);
      setEditTrackingStartDate("");
      setEditWeight(DEFAULT_STATS.weight.toString());
      setEditHeight(DEFAULT_STATS.height.toString());
      setEditAge(DEFAULT_STATS.age.toString());
      setEditGender(DEFAULT_STATS.gender);
      setEditActivity(DEFAULT_STATS.activityLevel);
      setGoalTargetWeight("");
      setGoalTargetDays("");
      setLastMealTimestamp(null);
      setActivitySelectedDate(new Date());
      setBalanceAnchorValue(0);
      setBalanceAnchorTimestamp(Date.now());
      setAnchorInitialized(false);
      
      // Trigger onboarding
      setIsNewUser(true);
      setShowOnboarding(true);
      setOnboardingStep(1);
      
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    } catch (error) {
      console.error("Failed to restart app:", error);
    }
    setDeleteAllDialogOpen(false);
  };

  const handleDeleteFood = async (foodId: string) => {
    // Start delete animation
    setDeletingFoodId(foodId);
    
    // Wait for animation to complete before actually deleting
    setTimeout(async () => {
      try {
        // Find the food item to get its calories before deleting
        const foodToDelete = foods.find(f => f.id === foodId) || activityFoods.find(f => f.id === foodId);
        const deletedCalories = foodToDelete?.calories || 0;
        
        const response = await fetch(`/api/food/${foodId}`, { method: "DELETE", credentials: "include" });
        if (response.ok) {
          // Update the appropriate list based on which day we're viewing
          if (isToday(activitySelectedDate)) {
            setFoods(prev => prev.filter(f => f.id !== foodId));
          } else {
            setActivityFoods(prev => prev.filter(f => f.id !== foodId));
            // Also update the yesterday cache if viewing yesterday
            if (isYesterday(activitySelectedDate)) {
              setYesterdayFoodsCache(prev => prev ? prev.filter(f => f.id !== foodId) : null);
            }
          }
          // Update energy reserve with negative delta (removing calories)
          if (deletedCalories > 0) {
            updateEnergyReserve(-deletedCalories);
          }
          recalculateFastingSummaries();
          loadMostRecentMeal();
          loadWeeklyTotals();
        }
      } catch (error) {
        console.error("Failed to delete food item:", error);
      } finally {
        setDeletingFoodId(null);
      }
    }, 300); // Match animation duration
  };

  const handleQuickAddFood = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickFoodName || !quickFoodCals) return;
    
    const cals = parseFloat(quickFoodCals);
    if (isNaN(cals)) return;

    const timestamp = new Date();

    try {
      setIsLoading(true);
      const response = await fetch("/api/food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: quickFoodName,
          calories: cals,
          timestamp: timestamp,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const newFood: FoodItem = {
          id: data.id.toString(),
          name: data.name,
          calories: parseFloat(data.calories),
          timestamp: new Date(data.timestamp).getTime(),
        };
        saveFoodToHistory(newFood.name, newFood.calories);
        setQuickFoodName("");
        setQuickFoodCals("");
        setQuickInputOpen(false);
        
        // Add to foods list if the entry is for today (main display always shows today)
        const todayStr = formatDateLocal(new Date());
        const entryDateStr = formatDateLocal(new Date(newFood.timestamp));
        if (todayStr === entryDateStr) {
          setFoods(prev => [...prev, newFood]);
        }
        // Always update energy reserve regardless of date
        updateEnergyReserve(newFood.calories);
        recalculateFastingSummaries();
        loadMostRecentMeal();
        loadWeeklyTotals();
      } else {
        const error = await response.json().catch(() => ({}));
        alert(error.error || error.message || "Failed to save food. Please try again.");
      }
    } catch (error) {
      console.error("Failed to add food item:", error);
      alert("Failed to save food. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickHistoryAdd = async (name: string, calories: number, protein?: number, carbs?: number, fat?: number) => {
    try {
      setIsLoading(true);
      const response = await fetch("/api/food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name,
          calories,
          timestamp: new Date(),
          protein: protein || null,
          carbs: carbs || null,
          fat: fat || null,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const newFood: FoodItem = {
          id: data.id.toString(),
          name: data.name,
          calories: parseFloat(data.calories),
          timestamp: new Date(data.timestamp).getTime(),
          protein: data.protein ? parseFloat(data.protein) : undefined,
          carbs: data.carbs ? parseFloat(data.carbs) : undefined,
          fat: data.fat ? parseFloat(data.fat) : undefined,
        };
        setQuickInputOpen(false);
        
        // Always add to foods list - this is always for today
        setFoods(prev => [...prev, newFood]);
        // Update server-side energy reserve
        updateEnergyReserve(newFood.calories);
        recalculateFastingSummaries();
        loadMostRecentMeal();
        loadWeeklyTotals();
      } else {
        const error = await response.json().catch(() => ({}));
        alert(error.error || error.message || "Failed to save food. Please try again.");
      }
    } catch (error) {
      console.error("Failed to add food item:", error);
      alert("Failed to save food. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const openEditFood = (food: FoodItem) => {
    setEditingFood(food);
    setEditFoodName(food.name);
    setEditFoodCals(food.calories.toString());
    const date = new Date(food.timestamp);
    let hours = date.getHours();
    const period = hours >= 12 ? "PM" : "AM";
    if (hours > 12) hours -= 12;
    if (hours === 0) hours = 12;
    setEditFoodHour(hours.toString());
    setEditFoodMinute(date.getMinutes().toString().padStart(2, '0'));
    setEditFoodPeriod(period);
    // Determine if food was logged today or yesterday
    const foodDate = new Date(food.timestamp);
    const today = new Date();
    const isFromToday = foodDate.toDateString() === today.toDateString();
    setEditFoodDay(isFromToday ? "today" : "yesterday");
  };

  const handleSaveEditFood = async () => {
    if (!editingFood) return;
    
    const cals = parseFloat(editFoodCals);
    if (!editFoodName.trim() || isNaN(cals) || cals <= 0) return;
    
    let hour = parseInt(editFoodHour) || 12;
    const minute = parseInt(editFoodMinute) || 0;
    if (editFoodPeriod === "PM" && hour !== 12) hour += 12;
    if (editFoodPeriod === "AM" && hour === 12) hour = 0;
    
    // Determine target date based on editFoodDay selection
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    const targetDate = editFoodDay === "today" ? today : yesterday;
    const timestamp = new Date(targetDate);
    timestamp.setHours(hour, minute, 0, 0);
    
    // Determine if the day changed (for moving between lists)
    const originalDate = new Date(editingFood.timestamp);
    const wasToday = originalDate.toDateString() === today.toDateString();
    const willBeToday = editFoodDay === "today";
    
    try {
      setIsLoading(true);
      const response = await fetch(`/api/food/${editingFood.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: editFoodName.trim(),
          calories: cals,
          timestamp: timestamp,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const newCalories = parseFloat(data.calories);
        const oldCalories = editingFood.calories;
        const calorieDelta = newCalories - oldCalories;
        
        const updatedFood = {
          id: editingFood.id,
          name: data.name,
          calories: newCalories,
          timestamp: new Date(data.timestamp).getTime(),
          mealType: data.mealType,
          protein: data.protein ? parseFloat(data.protein) : undefined,
          carbs: data.carbs ? parseFloat(data.carbs) : undefined,
          fat: data.fat ? parseFloat(data.fat) : undefined,
        };
        
        // Handle moving food between days
        if (wasToday && !willBeToday) {
          // Moving from today to yesterday: remove from foods, add to activityFoods and cache
          setFoods(prev => prev.filter(f => f.id !== editingFood.id));
          setActivityFoods(prev => [...prev, updatedFood].sort((a, b) => a.timestamp - b.timestamp));
          setYesterdayFoodsCache(prev => prev ? [...prev, updatedFood].sort((a, b) => a.timestamp - b.timestamp) : [updatedFood]);
          // Undo the calorie contribution to today's energy reserve
          updateEnergyReserve(-oldCalories);
        } else if (!wasToday && willBeToday) {
          // Moving from yesterday to today: remove from activityFoods and cache, add to foods
          setActivityFoods(prev => prev.filter(f => f.id !== editingFood.id));
          setYesterdayFoodsCache(prev => prev ? prev.filter(f => f.id !== editingFood.id) : null);
          setFoods(prev => [...prev, updatedFood].sort((a, b) => a.timestamp - b.timestamp));
          // Add the calorie contribution to today's energy reserve
          updateEnergyReserve(newCalories);
        } else {
          // Same day - just update in place
          if (willBeToday) {
            setFoods(prev => prev.map(f => f.id === editingFood.id ? { ...f, ...updatedFood } : f));
          } else {
            setActivityFoods(prev => prev.map(f => f.id === editingFood.id ? { ...f, ...updatedFood } : f));
            setYesterdayFoodsCache(prev => prev ? prev.map(f => f.id === editingFood.id ? { ...f, ...updatedFood } : f) : null);
          }
          // Update energy reserve with calorie difference (only for today's foods)
          if (willBeToday && calorieDelta !== 0) {
            updateEnergyReserve(calorieDelta);
          }
        }
        setEditingFood(null);
        recalculateFastingSummaries();
        loadMostRecentMeal();
        loadWeeklyTotals();
        // Refresh yesterday's status if the edit affected yesterday
        if (!willBeToday || !wasToday) {
          loadYesterdayConsumed();
        }
      }
    } catch (error) {
      console.error("Failed to update food item:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle full onboarding completion (new user setup)
  const handleCompleteOnboarding = async () => {
    const weight = parseFloat(editWeight);
    const height = parseInt(editHeight);
    const age = parseInt(editAge);

    if (isNaN(weight) || isNaN(height) || isNaN(age)) return;

    // Calculate BMR and TDEE immediately on frontend
    const bmr = calculateBMR(weight, height, age, editGender);
    const tdee = Math.round(bmr * getActivityMultiplier(editActivity));

    // Calculate goal deficit if goal is set
    let dailyGoalCalories: number | undefined;
    let dailyDeficit: number | undefined;
    const targetWeight = parseFloat(goalTargetWeight);
    const targetDays = parseInt(goalTargetDays);

    if (!isNaN(targetWeight) && !isNaN(targetDays) && targetWeight < weight && targetDays > 0) {
      const weightDiff = weight - targetWeight;
      const totalCaloriesToBurn = weightDiff * 7700;
      dailyDeficit = Math.min(Math.round(totalCaloriesToBurn / targetDays), 1000);
      const minDaily = editGender === 'female' ? 1200 : 1500;
      dailyGoalCalories = Math.max(bmr - dailyDeficit, minDaily);
    }

    // Start tracking from midnight today - simple and clean
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    // Update local state immediately
    setStats({
      weight,
      height,
      age,
      gender: editGender,
      activityLevel: editActivity,
      bmr,
      tdee,
      goalWeight: targetWeight || undefined,
      goalDays: targetDays || undefined,
      dailyGoalCalories,
      dailyDeficit,
      cumulativeNetCalories: 0,
    });
    setTrackingStartDate(startDate);
    setEditTrackingStartDate(startDate.toISOString().split('T')[0]);

    try {
      setIsLoading(true);
      // Save biometric data to backend with start date
      const response = await fetch(`/api/user/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          weight,
          height,
          age,
          gender: editGender,
          activityLevel: editActivity,
          fastingTrackingStartDate: startDate.toISOString(),
        }),
      });

      if (response.ok && dailyGoalCalories) {
        // Save goals if set
        await fetch(`/api/user/goals`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            targetWeight,
            targetDays,
            currentWeight: weight,
            bmr,
          }),
        });
      }
      
      // Initialize energy balance starting from midnight today at 0
      // Pass goal calories for correct burn rate
      await initializeEnergyReserve(tdee, dailyGoalCalories);

      setShowOnboarding(false);
      setIsNewUser(false);
    } catch (error) {
      console.error("Failed to complete onboarding:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate estimated daily deficit for preview
  const previewDeficit = goalTargetWeight && goalTargetDays 
    ? Math.min(Math.round(((stats.weight - parseFloat(goalTargetWeight)) * 7700) / parseInt(goalTargetDays)), 1000)
    : 0;
  const previewGoalCalories = goalTargetWeight && goalTargetDays
    ? Math.max(stats.bmr - previewDeficit, 1200)
    : stats.bmr;

  return (
    <div className="min-h-screen text-foreground bg-background font-sans selection:bg-primary/10 relative">
      <DeusExBackground />
      <DeusExGlow />
      
      {/* Full Onboarding Modal (first-time setup) */}
      <Dialog open={showOnboarding} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-lg bg-card border-border/30" onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-primary" />
              Welcome to FluxCal
            </DialogTitle>
            <DialogDescription className="text-muted-foreground/80">
              Let's set up your metabolic profile for accurate real-time calorie tracking.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            {/* Step indicator */}
            <div className="flex items-center justify-center gap-2 pb-2">
              <div className={`w-2 h-2 rounded-full transition-colors ${onboardingStep >= 1 ? 'bg-primary' : 'bg-border'}`} />
              <div className={`w-6 h-[2px] transition-colors ${onboardingStep >= 2 ? 'bg-primary' : 'bg-border'}`} />
              <div className={`w-2 h-2 rounded-full transition-colors ${onboardingStep >= 2 ? 'bg-primary' : 'bg-border'}`} />
              <div className={`w-6 h-[2px] transition-colors ${onboardingStep >= 3 ? 'bg-primary' : 'bg-border'}`} />
              <div className={`w-2 h-2 rounded-full transition-colors ${onboardingStep >= 3 ? 'bg-primary' : 'bg-border'}`} />
            </div>

            <AnimatePresence mode="wait">
              {onboardingStep === 1 && (
                <motion.div
                  key="step1"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-4"
                >
                  <div className="text-sm font-medium text-center text-muted-foreground">Your Body Stats</div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs tracking-wide">Weight (kg)</Label>
                      <Input 
                        data-testid="input-onboard-weight"
                        type="number" 
                        value={editWeight} 
                        onChange={(e) => setEditWeight(e.target.value)}
                        placeholder="e.g., 75"
                        className="bg-secondary/50 border-border/40 focus:border-primary/40"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs tracking-wide">Height (cm)</Label>
                      <Input 
                        data-testid="input-onboard-height"
                        type="number" 
                        value={editHeight} 
                        onChange={(e) => setEditHeight(e.target.value)}
                        placeholder="e.g., 170"
                        className="bg-secondary/50 border-border/40 focus:border-primary/40"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs tracking-wide">Age</Label>
                      <Input 
                        data-testid="input-onboard-age"
                        type="number" 
                        value={editAge} 
                        onChange={(e) => setEditAge(e.target.value)}
                        placeholder="e.g., 30"
                        className="bg-secondary/50 border-border/40 focus:border-primary/40"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs tracking-wide">Gender</Label>
                      <Select value={editGender} onValueChange={(v: Gender) => setEditGender(v)}>
                        <SelectTrigger className="bg-secondary/50 border-border/40">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent className="bg-card border-border/30">
                          <SelectItem value="male">Male</SelectItem>
                          <SelectItem value="female">Female</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label className="text-xs tracking-wide">Activity Level</Label>
                    <Select value={editActivity} onValueChange={(v: ActivityLevel) => setEditActivity(v)}>
                      <SelectTrigger className="bg-secondary/50 border-border/40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border/30">
                        <SelectItem value="sedentary">Sedentary (little/no exercise)</SelectItem>
                        <SelectItem value="light">Light (1-3 days/week)</SelectItem>
                        <SelectItem value="moderate">Moderate (3-5 days/week)</SelectItem>
                        <SelectItem value="active">Active (6-7 days/week)</SelectItem>
                        <SelectItem value="very_active">Very Active (2x/day)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Live BMR preview */}
                  {editWeight && editHeight && editAge && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="bg-primary/5 border border-primary/20 p-3 rounded-lg text-xs text-foreground/80"
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Your BMR:</span>
                        <span className="font-mono text-primary">
                          {calculateBMR(parseFloat(editWeight)||0, parseInt(editHeight)||0, parseInt(editAge)||0, editGender)} kcal/day
                        </span>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              )}

              {onboardingStep === 2 && (
                <motion.div
                  key="step2"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-4"
                >
                  <div className="text-sm font-medium text-center text-muted-foreground">Weight Loss Goal (Optional)</div>
                  
                  <div className="bg-primary/5 border border-primary/20 p-3 rounded-lg text-xs text-foreground/80">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Current Weight:</span>
                      <span className="font-mono">{editWeight} kg</span>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs tracking-wide">Target Weight (kg)</Label>
                      <Input 
                        data-testid="input-target-weight"
                        type="number" 
                        value={goalTargetWeight} 
                        onChange={(e) => setGoalTargetWeight(e.target.value)}
                        placeholder={`Less than ${editWeight}`}
                        className="bg-secondary/50 border-border/40 focus:border-primary/40"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs tracking-wide">Days to Reach Goal</Label>
                      <Input 
                        data-testid="input-target-days"
                        type="number" 
                        value={goalTargetDays} 
                        onChange={(e) => setGoalTargetDays(e.target.value)}
                        placeholder="e.g., 90"
                        className="bg-secondary/50 border-border/40 focus:border-primary/40"
                      />
                    </div>
                  </div>
                  
                  {goalTargetWeight && goalTargetDays && parseFloat(goalTargetWeight) < parseFloat(editWeight) && parseInt(goalTargetDays) > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-primary/10 border border-primary/30 p-4 rounded-lg space-y-2"
                    >
                      <div className="text-xs text-muted-foreground tracking-wide">YOUR PLAN</div>
                      <div className="flex justify-between text-sm">
                        <span>Weight to lose:</span>
                        <span className="font-mono text-primary">{(parseFloat(editWeight) - parseFloat(goalTargetWeight)).toFixed(1)} kg</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Daily deficit:</span>
                        <span className="font-mono text-primary">
                          {Math.min(Math.round(((parseFloat(editWeight) - parseFloat(goalTargetWeight)) * 7700) / parseInt(goalTargetDays)), 1000)} kcal
                        </span>
                      </div>
                      <div className="flex justify-between text-sm font-medium">
                        <span>Daily calorie goal:</span>
                        <span className="font-mono text-primary">
                          {(() => {
                            const minDaily = editGender === 'female' ? 1200 : 1500;
                            const goal = Math.max(
                              calculateBMR(parseFloat(editWeight)||0, parseInt(editHeight)||0, parseInt(editAge)||0, editGender) - 
                              Math.min(Math.round(((parseFloat(editWeight) - parseFloat(goalTargetWeight)) * 7700) / parseInt(goalTargetDays)), 1000),
                              minDaily
                            );
                            return goal;
                          })()} kcal
                        </span>
                      </div>
                      {(() => {
                        const minDaily = editGender === 'female' ? 1200 : 1500;
                        const goal = Math.max(
                          calculateBMR(parseFloat(editWeight)||0, parseInt(editHeight)||0, parseInt(editAge)||0, editGender) - 
                          Math.min(Math.round(((parseFloat(editWeight) - parseFloat(goalTargetWeight)) * 7700) / parseInt(goalTargetDays)), 1000),
                          minDaily
                        );
                        return goal === minDaily && (
                          <div className="mt-2 text-[10px] text-muted-foreground/60 italic">
                            This is the minimum daily intake the app supports.
                          </div>
                        );
                      })()}
                    </motion.div>
                  )}
                </motion.div>
              )}

              {onboardingStep === 3 && (
                <motion.div
                  key="step3"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-4"
                >
                  <div className="text-sm font-medium text-center text-muted-foreground">Ready to Start</div>
                  
                  <div className="bg-primary/5 border border-primary/20 p-4 rounded-lg space-y-3">
                    <div className="text-center space-y-2">
                      <div className="text-2xl font-light text-primary">0.00</div>
                      <p className="text-xs text-muted-foreground">
                        Your energy balance starts at zero from midnight today.
                      </p>
                    </div>
                    
                    <div className="text-xs text-foreground/80 space-y-1">
                      <p>As your body burns calories throughout the day, your balance will increase.</p>
                      <p>When you log food, it will be subtracted from your balance.</p>
                    </div>
                  </div>
                  
                  <p className="text-xs text-muted-foreground text-center">
                    Log your first meal after setup to start tracking.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          
          <div className="flex gap-2">
            {onboardingStep === 1 ? (
              <Button 
                onClick={() => setOnboardingStep(2)}
                disabled={!editWeight || !editHeight || !editAge}
                data-testid="button-next-step"
                className="flex-1 font-light tracking-wide bg-primary active:scale-95 active:opacity-80 transition-transform disabled:opacity-50"
              >
                Next
              </Button>
            ) : onboardingStep === 2 ? (
              <>
                <Button 
                  variant="outline"
                  onClick={() => setOnboardingStep(1)}
                  className="font-light tracking-wide border-border/40 active:scale-95 active:opacity-80 transition-transform"
                >
                  Back
                </Button>
                <Button 
                  onClick={() => setOnboardingStep(3)}
                  data-testid="button-next-step-2"
                  className="flex-1 font-light tracking-wide bg-primary active:scale-95 active:opacity-80 transition-transform"
                >
                  {goalTargetWeight && goalTargetDays ? 'Next' : 'Skip Goal'}
                </Button>
              </>
            ) : (
              <>
                <Button 
                  variant="outline"
                  onClick={() => setOnboardingStep(2)}
                  className="font-light tracking-wide border-border/40 active:scale-95 active:opacity-80 transition-transform"
                >
                  Back
                </Button>
                <Button 
                  onClick={handleCompleteOnboarding}
                  disabled={isLoading}
                  data-testid="button-complete-onboarding"
                  className="flex-1 font-light tracking-wide bg-primary active:scale-95 active:opacity-80 transition-transform disabled:opacity-50"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Setting up...
                    </span>
                  ) : (
                    'Start Tracking'
                  )}
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
      
      
      {/* --- Header --- */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/20 bg-background/80 backdrop-blur-lg">
        <div className="container mx-auto max-w-2xl px-4 h-16 flex items-center justify-between">
          <div className="flex flex-col justify-center">
            <div className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-primary" />
              <span className="font-light text-lg tracking-wide">FluxCal</span>
            </div>
            {user && (
              <span className="text-[10px] text-muted-foreground/50 pl-7 -mt-0.5 truncate max-w-[120px]">
                {(user.email?.split('@')[0]) || user.firstName || 'User'}
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-2 shrink-0">
          <Dialog open={isSettingsOpen} onOpenChange={(open) => {
            setIsSettingsOpen(open);
            if (open) {
              // Pre-populate goal fields with current values when opening
              if (stats.goalWeight) setGoalTargetWeight(stats.goalWeight.toString());
              if (stats.goalDays) setGoalTargetDays(stats.goalDays.toString());
            }
          }}>
            <DialogTrigger asChild>
              <Button 
                variant="outline" 
                size="sm" 
                className="gap-2 border-border/40 text-xs tracking-wide font-light bg-secondary/30 active:scale-95 active:opacity-80 transition-transform"
              >
                <Calculator className="w-4 h-4" />
                <span>BMR: {stats.bmr}</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md bg-card border-border/30" onOpenAutoFocus={(e) => e.preventDefault()}>
              <DialogHeader>
                <DialogTitle>Metabolic Profile</DialogTitle>
                <DialogDescription className="text-muted-foreground/80">
                  Calibrate your biometric data for accurate real-time tracking.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs tracking-wide">Weight (kg)</Label>
                    <Input 
                      type="number" 
                      value={editWeight} 
                      onChange={(e) => setEditWeight(e.target.value)}
                      inputMode="numeric"
                      className="bg-secondary/50 border-border/40 focus:border-primary/40"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs tracking-wide">Height (cm)</Label>
                    <Input 
                      type="number" 
                      value={editHeight} 
                      onChange={(e) => setEditHeight(e.target.value)}
                      inputMode="numeric"
                      className="bg-secondary/50 border-border/40 focus:border-primary/40"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label className="text-xs tracking-wide">Age</Label>
                    <Input 
                      type="number" 
                      value={editAge} 
                      onChange={(e) => setEditAge(e.target.value)}
                      inputMode="numeric"
                      className="bg-secondary/50 border-border/40 focus:border-primary/40"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs tracking-wide">Gender</Label>
                    <Select value={editGender} onValueChange={(v: Gender) => setEditGender(v)}>
                      <SelectTrigger className="bg-secondary/50 border-border/40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border/30">
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs tracking-wide">Lifestyle</Label>
                    <Select value={editActivity} onValueChange={(v: ActivityLevel) => setEditActivity(v)}>
                      <SelectTrigger className="bg-secondary/50 border-border/40 text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border/30">
                        <SelectItem value="sedentary">Sedentary</SelectItem>
                        <SelectItem value="light">Light</SelectItem>
                        <SelectItem value="moderate">Moderate</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="very_active">Very Active</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="bg-primary/5 border border-primary/20 p-3 rounded-lg text-xs text-foreground/80 space-y-1">
                  <div>
                    <span className="text-muted-foreground">Estimated BMR: </span>
                    <span className="font-mono">{calculateBMR(parseFloat(editWeight)||0, parseFloat(editHeight)||0, parseFloat(editAge)||0, editGender)} kcal/day</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Burn rate: </span>
                    <span className="font-mono">{(calculateBMR(parseFloat(editWeight)||0, parseFloat(editHeight)||0, parseFloat(editAge)||0, editGender) / 86400).toFixed(5)} kcal/sec</span>
                  </div>
                </div>
                
                {/* Weight Goal Section */}
                <div className="pt-4 border-t border-border/20">
                  <Label className="text-xs tracking-wide text-muted-foreground mb-3 block">WEIGHT GOAL (optional)</Label>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs tracking-wide">Target Weight (kg)</Label>
                      <Input 
                        type="number" 
                        value={goalTargetWeight} 
                        onChange={(e) => setGoalTargetWeight(e.target.value)}
                        placeholder={stats.goalWeight?.toString() || "e.g. 75"}
                        className="bg-secondary/50 border-border/40 focus:border-primary/40"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs tracking-wide">Days to Goal</Label>
                      <Input 
                        type="number" 
                        value={goalTargetDays} 
                        onChange={(e) => setGoalTargetDays(e.target.value)}
                        placeholder={stats.goalDays?.toString() || "e.g. 90"}
                        className="bg-secondary/50 border-border/40 focus:border-primary/40"
                      />
                    </div>
                  </div>
                  {goalTargetWeight && goalTargetDays && parseFloat(goalTargetWeight) < parseFloat(editWeight) && (
                    <div className="mt-2 space-y-1">
                      <div className="text-xs text-muted-foreground/70">
                        Daily goal: <span className="text-primary font-mono">
                          {(() => {
                            const minDaily = stats.gender === 'female' ? 1200 : 1500;
                            return Math.max(calculateBMR(parseFloat(editWeight)||0, parseFloat(editHeight)||0, parseFloat(editAge)||0, editGender) - 
                              Math.min(Math.round(((parseFloat(editWeight) - parseFloat(goalTargetWeight)) * 7700) / parseInt(goalTargetDays)), 1000), minDaily);
                          })()} kcal
                        </span>
                      </div>
                      {(() => {
                        const minDaily = stats.gender === 'female' ? 1200 : 1500;
                        const goal = Math.max(calculateBMR(parseFloat(editWeight)||0, parseFloat(editHeight)||0, parseFloat(editAge)||0, editGender) - 
                          Math.min(Math.round(((parseFloat(editWeight) - parseFloat(goalTargetWeight)) * 7700) / parseInt(goalTargetDays)), 1000), minDaily);
                        return goal === minDaily && (
                          <p className="text-[10px] text-muted-foreground/60 italic">
                            This is the minimum daily intake the app supports.
                          </p>
                        );
                      })()}
                    </div>
                  )}
                </div>
                
                {/* Fasting Tracking Start Date */}
                <div className="pt-4 border-t border-border/20">
                  <Label className="text-xs tracking-wide text-muted-foreground mb-3 block">FASTING TRACKING START DATE</Label>
                  <div className="space-y-2">
                    <Input 
                      type="date"
                      value={editTrackingStartDate}
                      disabled
                      className="bg-secondary/30 border-border/20 text-muted-foreground/50 cursor-not-allowed opacity-60"
                      data-testid="input-tracking-start-date"
                    />
                    <p className="text-[11px] text-muted-foreground/60">
                      Fasting data is calculated from this date and cannot be changed. Don't worry about the past, focus on the now!
                    </p>
                  </div>
                </div>
              </div>
              <Button 
                onClick={handleSaveStats} 
                disabled={isLoading}
                data-testid="button-save-calibrate"
                className="w-full font-light tracking-wide bg-primary active:scale-95 active:opacity-80 transition-transform disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </span>
                ) : (
                  'Save & Calibrate'
                )}
              </Button>
            </DialogContent>
          </Dialog>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.location.href = "/api/logout"}
            data-testid="button-logout"
            className="text-muted-foreground/60 active:scale-95 active:opacity-80 transition-transform"
          >
            <LogOut className="w-4 h-4" />
          </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-2xl px-4 pt-24 pb-32 flex flex-col gap-8 relative z-10">
        
        {/* --- Main Display --- */}
        <section>
          <Card className="deus-ex-panel border-0 soft-shadow group transition-all duration-300 relative rounded-xl">
            {/* Quick Input Button */}
            <Dialog open={quickInputOpen} onOpenChange={setQuickInputOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-4 right-4 h-12 w-12 rounded-full bg-transparent border border-primary/30 active:scale-95 active:opacity-80 transition-transform"
                  data-testid="button-quick-input"
                >
                  <Plus className="w-7 h-7 text-primary" />
                </Button>
              </DialogTrigger>
              <DialogContent className="glass-panel border-border/30 max-w-sm" onOpenAutoFocus={(e) => e.preventDefault()}>
                <DialogHeader className="mb-2">
                  <DialogTitle className="text-sm font-light tracking-[0.1em]">QUICK INPUT</DialogTitle>
                </DialogHeader>
                
                <form onSubmit={handleQuickAddFood} className="space-y-4">
                  <div className="flex gap-2">
                    <Input 
                      placeholder={`e.g. ${mealPlaceholder}`}
                      value={quickFoodName}
                      onChange={(e) => setQuickFoodName(e.target.value)}
                      className="bg-secondary/40 border-border/30 focus:border-primary/40 text-sm flex-1 placeholder:text-muted-foreground/30"
                      data-testid="input-quick-food-name"
                    />
                    <Input 
                      type="number" 
                      placeholder="Cal" 
                      value={quickFoodCals}
                      onChange={(e) => setQuickFoodCals(e.target.value)}
                      inputMode="numeric"
                      className="bg-secondary/40 border-border/30 focus:border-primary/40 font-mono text-right text-sm w-20 placeholder:text-muted-foreground/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      data-testid="input-quick-food-calories"
                    />
                    <Button 
                      type="submit" 
                      size="icon"
                      className="bg-gradient-to-br from-primary to-accent text-white/90 border border-primary/40 h-9 w-9 active:scale-95 active:opacity-80 transition-transform"
                      data-testid="button-quick-add"
                      disabled={!quickFoodName || !quickFoodCals || isLoading}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </form>

                {foodHistory.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] tracking-[0.1em] text-muted-foreground/60">HISTORY</span>
                      <button
                        onClick={() => { setFoodHistory([]); localStorage.removeItem('fluxcal_food_history'); }}
                        className="text-[10px] text-muted-foreground/60 hover:text-destructive transition-colors"
                        data-testid="button-quick-clear-history"
                      >
                        clear
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {foodHistory.map((item, idx) => (
                        <Button
                          key={idx}
                          variant="outline"
                          size="sm"
                          onClick={() => handleQuickHistoryAdd(item.name, item.calories, item.protein, item.carbs, item.fat)}
                          disabled={isLoading}
                          className="h-7 px-2 text-xs font-light border-border/30 active:scale-95 active:opacity-80 transition-transform"
                          data-testid={`button-quick-history-${idx}`}
                        >
                          {item.name} <span className="font-mono text-muted-foreground ml-1">{item.calories}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>

            <CardContent className="pt-12 pb-12 flex flex-col items-center justify-center text-center space-y-6">
              <div className="flex flex-col items-center gap-1">
                <span className="text-xs tracking-[0.15em] text-muted-foreground font-light">ENERGY BALANCE</span>
                {stats.dailyGoalCalories && (
                  <span className="text-[9px] tracking-wide text-muted-foreground/40 font-light">based on your goal</span>
                )}
              </div>
              
              <div 
                onClick={() => {
                  // Only allow toggle for testing if not naturally at max
                  if (!isAtMaxBalance) {
                    setShowMaxBalanceTest(prev => !prev);
                  }
                }}
                className="cursor-pointer select-none"
              >
                <div 
                  className={`font-mono text-6xl md:text-7xl font-light tabular-nums ${
                    shownBalance >= 0 ? 'text-gradient-gold' : 'text-gradient-red'
                  }`}
                >
                  {shownBalance < 0 ? "-" : ""}{formatCal(shownBalance)}
                </div>
                {(isAtMaxBalance || showMaxBalanceTest) && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center justify-center gap-2 mt-2"
                  >
                    <div className="h-px w-6 bg-gradient-to-r from-transparent to-primary/40"></div>
                    <span className="text-[9px] tracking-[0.2em] text-primary/60 font-light uppercase">max energy reached</span>
                    <div className="h-px w-6 bg-gradient-to-l from-transparent to-primary/40"></div>
                  </motion.div>
                )}
              </div>

              <div className="flex flex-col items-center gap-2">
                <span className="text-[9px] tracking-[0.2em] text-muted-foreground/40 uppercase">today</span>
                <div className="flex items-center gap-8 text-xs font-light">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-muted-foreground/70 tracking-wider">BURNED</span>
                    <span className="font-mono text-sm text-primary">{todaysBurn.toFixed(1)}</span>
                  </div>
                  <div className="h-6 w-px bg-border/30"></div>
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-muted-foreground/70 tracking-wider">CONSUMED</span>
                    <span className={`font-mono text-sm ${intakeExceedsMax ? 'text-destructive' : 'text-accent'}`}>{totalEaten.toFixed(0)}</span>
                  </div>
                </div>
              </div>
              
              {/* Yesterday's result indicator - fixed height to prevent layout shift */}
              <div className="h-4 flex items-center justify-center">
                {yesterdayConsumed !== null ? (() => {
                  const goalTarget = stats.dailyGoalCalories || stats.tdee;
                  const tdeeTarget = stats.tdee;
                  
                  // Three scenarios:
                  // 1. Under goal = deficit vs goal
                  // 2. Over goal but under TDEE = over goal, under TDEE
                  // 3. Over TDEE = surplus
                  
                  let message: string;
                  if (yesterdayConsumed <= goalTarget) {
                    // Scenario 1: Under goal - show deficit
                    const deficit = goalTarget - yesterdayConsumed;
                    const modifier = deficit < 200 ? 'Slight' : deficit < 500 ? 'Moderate' : 'Heavy';
                    message = stats.dailyGoalCalories 
                      ? `${modifier} deficit vs goal yesterday`
                      : `${modifier} deficit yesterday`;
                  } else if (yesterdayConsumed <= tdeeTarget && stats.dailyGoalCalories) {
                    // Scenario 2: Over goal but under TDEE (only if goal is set and different from TDEE)
                    message = 'Over goal, under TDEE yesterday';
                  } else {
                    // Scenario 3: Over TDEE - show surplus
                    const surplus = yesterdayConsumed - tdeeTarget;
                    const modifier = surplus < 200 ? 'Slight' : surplus < 500 ? 'Moderate' : 'Heavy';
                    message = `${modifier} surplus yesterday`;
                  }
                  
                  return (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3 }}
                      className="text-[10px] font-light tracking-wide text-muted-foreground/30"
                    >
                      {message}
                    </motion.div>
                  );
                })() : (
                  <span className="text-[10px] font-light tracking-wide invisible">
                    Placeholder text here
                  </span>
                )}
              </div>

              {timeToZero && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-xs text-muted-foreground/60 tracking-wide font-light pt-2"
                >
                  Breaks even in <span className="font-mono text-primary/80">{timeToZero}</span>
                </motion.div>
              )}
              {!timeToZero && fastingStage && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-xs text-muted-foreground/60 tracking-wide font-light pt-2"
                >
                  Currently in{" "}
                  <span className="font-mono text-primary relative inline-flex">
                    {fastingStage.name.split('').map((char, idx) => (
                      <motion.span
                        key={idx}
                        style={{
                          textShadow: "0 0 8px rgba(242, 162, 60, 0.7), 0 0 16px rgba(242, 162, 60, 0.5), 0 0 24px rgba(242, 162, 60, 0.3)"
                        }}
                        animate={{
                          opacity: [0.85, 1, 0.85],
                          textShadow: [
                            "0 0 6px rgba(242, 162, 60, 0.5), 0 0 12px rgba(242, 162, 60, 0.3)",
                            "0 0 16px rgba(242, 162, 60, 1), 0 0 32px rgba(242, 162, 60, 1), 0 0 48px rgba(242, 162, 60, 0.72)",
                            "0 0 6px rgba(242, 162, 60, 0.5), 0 0 12px rgba(242, 162, 60, 0.3)"
                          ]
                        }}
                        transition={{
                          duration: 2 + (idx * 0.15),
                          repeat: Infinity,
                          ease: "easeInOut",
                          delay: idx * 0.08
                        }}
                      >
                        {char === ' ' ? '\u00A0' : char}
                      </motion.span>
                    ))}
                  </span>
                </motion.div>
              )}
              
              {/* Progress indicator */}
              <div className="w-full space-y-3 pt-4">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground/60 tracking-wider">DAILY BURN</span>
                    <span className="text-[10px] text-primary/70 font-mono">{todaysBurn.toFixed(1)} / {stats.tdee}</span>
                  </div>
                  <div className="h-[2px] bg-gradient-to-r from-primary/10 via-primary/40 to-primary/10 rounded-full relative overflow-hidden">
                    <motion.div 
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary/30 to-primary/60"
                      style={{ 
                        width: `${Math.min((todaysBurn / stats.tdee) * 100, 100)}%`
                      }}
                    />
                  </div>
                </div>
                
                {/* Food Intake Progress Bar - with goal visualization and buffer */}
                <div className="space-y-1">
                  {(() => {
                    const buffer = stats.bufferAmount || 0;
                    const goal = stats.dailyGoalCalories || stats.tdee;
                    const effectiveGoal = goal + buffer;
                    // Normalize bar to max of effectiveGoal or TDEE to properly show all zones
                    const barMax = Math.max(effectiveGoal, stats.tdee);
                    const bufferZoneStart = (goal / barMax) * 100;
                    const bufferZoneEnd = (effectiveGoal / barMax) * 100;
                    const isInBuffer = totalEaten > goal && totalEaten <= effectiveGoal;
                    const exceedsBuffer = totalEaten > effectiveGoal;
                    
                    return (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-muted-foreground/60 tracking-wider">
                            {stats.dailyGoalCalories ? 'GOAL INTAKE' : 'FOOD INTAKE'}
                            {buffer > 0 && <span className="text-amber-400/60 ml-1">(+{buffer} buffer)</span>}
                          </span>
                          <span className={`text-[10px] font-mono ${
                            exceedsBuffer
                              ? 'text-destructive/70' 
                              : isInBuffer
                                ? 'text-amber-400/70'
                                : 'text-accent/70'
                          }`}>
                            {totalEaten.toFixed(0)} / {effectiveGoal}
                          </span>
                        </div>
                        
                        {/* Progress bar with buffer zone */}
                        <div className="h-[2px] rounded-full relative overflow-hidden">
                          {stats.dailyGoalCalories ? (
                            <>
                              {/* Background: Goal zone (green) */}
                              <div 
                                className="absolute inset-y-0 left-0 bg-gradient-to-r from-accent/20 to-accent/30"
                                style={{ width: `${bufferZoneStart}%` }}
                              />
                              
                              {/* Buffer zone - warm amber glow */}
                              {buffer > 0 && (
                                <motion.div 
                                  className="absolute inset-y-0"
                                  style={{ 
                                    left: `${bufferZoneStart}%`,
                                    width: `${bufferZoneEnd - bufferZoneStart}%`,
                                    background: 'linear-gradient(to right, rgba(251, 191, 36, 0.25), rgba(245, 158, 11, 0.35))',
                                    boxShadow: '0 0 8px rgba(251, 191, 36, 0.3), inset 0 0 4px rgba(251, 191, 36, 0.2)'
                                  }}
                                  animate={{
                                    opacity: [0.7, 1, 0.7],
                                    boxShadow: [
                                      '0 0 4px rgba(251, 191, 36, 0.2), inset 0 0 2px rgba(251, 191, 36, 0.1)',
                                      '0 0 12px rgba(251, 191, 36, 0.5), inset 0 0 6px rgba(251, 191, 36, 0.3)',
                                      '0 0 4px rgba(251, 191, 36, 0.2), inset 0 0 2px rgba(251, 191, 36, 0.1)'
                                    ]
                                  }}
                                  transition={{
                                    duration: 3,
                                    repeat: Infinity,
                                    ease: "easeInOut"
                                  }}
                                />
                              )}
                              
                              {/* Overage zone beyond buffer (warning) */}
                              <div 
                                className="absolute inset-y-0 bg-gradient-to-r from-red-500/20 to-red-500/30"
                                style={{ 
                                  left: `${bufferZoneEnd}%`,
                                  right: '0%'
                                }}
                              />
                              
                              {/* Active fill - changes color based on zone */}
                              <motion.div 
                                className={`absolute inset-y-0 left-0 ${
                                  exceedsBuffer
                                    ? 'bg-gradient-to-r from-accent/50 via-amber-400/60 to-red-500/80'
                                    : isInBuffer 
                                      ? 'bg-gradient-to-r from-accent/50 to-amber-400/70'
                                      : 'bg-gradient-to-r from-accent/40 to-accent/70'
                                }`}
                                style={{ 
                                  width: `${Math.min((shownEaten / barMax) * 100, 100)}%`
                                }}
                              />
                              
                              {/* Goal threshold marker */}
                              <div 
                                className="absolute inset-y-0 w-[2px] bg-primary/60 z-10"
                                style={{ left: `${bufferZoneStart}%` }}
                              />
                              
                              {/* Buffer end marker (if buffer exists) */}
                              {buffer > 0 && (
                                <div 
                                  className="absolute inset-y-0 w-[1px] bg-amber-400/50 z-10"
                                  style={{ left: `${bufferZoneEnd}%` }}
                                />
                              )}
                              
                              {/* Overflow indicator when exceeding effective goal */}
                              {exceedsBuffer && (
                                <motion.div
                                  className="absolute inset-y-0 right-0 w-2 bg-gradient-to-r from-transparent to-red-500/80"
                                  animate={{
                                    opacity: [0.6, 1, 0.6],
                                  }}
                                  transition={{
                                    duration: 1,
                                    repeat: Infinity,
                                    ease: "easeInOut"
                                  }}
                                />
                              )}
                            </>
                          ) : (
                            <>
                              {/* Original single-color behavior when no goal */}
                              <div className="absolute inset-0 bg-gradient-to-r from-accent/10 via-accent/40 to-accent/10" />
                              <motion.div 
                                className={`absolute inset-y-0 left-0 ${intakeExceedsMax ? 'bg-gradient-to-r from-destructive/30 to-destructive/60' : 'bg-gradient-to-r from-accent/30 to-accent/60'}`}
                                style={{ 
                                  width: `${Math.min((shownEaten / barMax) * 100, 100)}%`
                                }}
                              />
                            </>
                          )}
                        </div>
                        
                        {/* Goal info text with buffer info */}
                        {stats.dailyGoalCalories && (
                          <div className="flex items-center justify-between text-[9px] text-muted-foreground/50">
                            <span>Goal: {stats.dailyGoalCalories}{buffer > 0 && <span className="text-amber-400/60"> +{buffer}</span>}</span>
                            <span>TDEE: {stats.tdee}</span>
                          </div>
                        )}
                        
                        {/* Buffer info message - subtle */}
                        {buffer > 0 && (
                          <p className="mt-1 text-[9px] text-amber-400/40">
                            +{buffer} buffer from yesterday (single-use)
                          </p>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

            </CardContent>
          </Card>
        </section>

        {/* --- Fasting Timeline --- */}
        <section className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs tracking-[0.15em] text-muted-foreground font-light">FASTING STATE</span>
            </div>
            
            {/* Timeline Progress Bar */}
            <div className="relative bg-card/40 border-border/30 border rounded-lg backdrop-blur-sm pl-6 pr-10 py-4 overflow-hidden">
              {/* Moving average line graph background */}
              <svg 
                className="absolute inset-0 w-full h-full z-0 pointer-events-none"
                preserveAspectRatio="none"
                viewBox="0 0 100 100"
              >
                <defs>
                  <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.1" />
                    <stop offset={`${Math.min((shownFastingHours / 16) * 100, 100)}%`} stopColor="hsl(var(--primary))" stopOpacity="0.4" />
                    <stop offset={`${Math.min((shownFastingHours / 16) * 100 + 5, 100)}%`} stopColor="hsl(var(--primary))" stopOpacity="0.1" />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.05" />
                  </linearGradient>
                  <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.15" />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {(() => {
                  const stages = [0, 25, 50, 75, 100];
                  
                  // Calculate totals from historical fasting summaries
                  const totals = fastingSummaries.reduce((acc, s) => ({
                    fed: acc.fed + s.fedSeconds,
                    postAbsorptive: acc.postAbsorptive + s.postAbsorptiveSeconds,
                    fatBurning: acc.fatBurning + s.fatBurningSeconds,
                    deepKetosis: acc.deepKetosis + s.deepKetosisSeconds,
                    autophagy: acc.autophagy + s.autophagySeconds,
                  }), { fed: 0, postAbsorptive: 0, fatBurning: 0, deepKetosis: 0, autophagy: 0 });
                  
                  const allTotals = [totals.fed, totals.postAbsorptive, totals.fatBurning, totals.deepKetosis, totals.autophagy];
                  const maxTotal = Math.max(...allTotals, 1);
                  
                  const getHeight = (stageIdx: number) => {
                    // If we have historical data, use it for proportional heights
                    if (fastingSummaries.length > 0) {
                      const proportion = allTotals[stageIdx] / maxTotal;
                      return 15 + (proportion * 60); // Scale from 15 to 75
                    }
                    // Fallback to current session display
                    const stageStartHour = stageIdx * 4;
                    const stageEndHour = (stageIdx + 1) * 4;
                    const isActive = shownFastingHours >= stageStartHour && shownFastingHours < stageEndHour;
                    const isReached = shownFastingHours >= stageStartHour;
                    if (stageIdx === 4) {
                      return shownFastingHours >= 16 ? 75 : 15;
                    }
                    return isActive ? 70 : isReached ? 40 : 15;
                  };
                  const points = stages.map((x, i) => ({ x, y: 100 - getHeight(i) }));
                  
                  // Generate smooth cubic Bezier curves using Catmull-Rom interpolation
                  const tension = 0.3; // Lower = smoother curves
                  const getCubicBezierPath = (pts: {x: number, y: number}[]) => {
                    if (pts.length < 2) return '';
                    
                    let d = `M ${pts[0].x} ${pts[0].y}`;
                    
                    for (let i = 0; i < pts.length - 1; i++) {
                      const p0 = pts[Math.max(i - 1, 0)];
                      const p1 = pts[i];
                      const p2 = pts[i + 1];
                      const p3 = pts[Math.min(i + 2, pts.length - 1)];
                      
                      // Calculate control points using Catmull-Rom to Bezier conversion
                      const cp1x = p1.x + (p2.x - p0.x) * tension;
                      const cp1y = p1.y + (p2.y - p0.y) * tension;
                      const cp2x = p2.x - (p3.x - p1.x) * tension;
                      const cp2y = p2.y - (p3.y - p1.y) * tension;
                      
                      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x} ${p2.y.toFixed(1)}`;
                    }
                    return d;
                  };
                  
                  const curvePath = getCubicBezierPath(points);
                  const curveIndex = curvePath.indexOf('C');
                  // Fallback to straight lines if curve generation fails
                  const curveSegment = curveIndex >= 0 
                    ? curvePath.slice(curveIndex) 
                    : points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ');
                  const path = `M 0 100 L 0 ${points[0].y} ${curveSegment} L 100 100 Z`;
                  const linePath = curveIndex >= 0 ? curvePath : `M ${points[0].x} ${points[0].y} ${curveSegment}`;
                  return (
                    <>
                      <path d={path} fill="url(#areaGradient)" />
                      <path d={linePath} fill="none" stroke="url(#lineGradient)" strokeWidth="0.5" />
                    </>
                  );
                })()}
              </svg>
              
              {/* Shared container for progress bar and circles */}
              <div className="relative h-16 z-10">
                {/* Crystalline Facet Glows - positioned at each stage */}
                {[
                  { percent: 0, startHour: 0 },
                  { percent: 25, startHour: 4 },
                  { percent: 50, startHour: 8 },
                  { percent: 75, startHour: 12 },
                  { percent: 100, startHour: 16 },
                ].map((stage, idx) => {
                  const isActive = idx === 0 ? shownFastingHours < 4 :
                                   idx === 1 ? shownFastingHours >= 4 && shownFastingHours < 8 :
                                   idx === 2 ? shownFastingHours >= 8 && shownFastingHours < 12 :
                                   idx === 3 ? shownFastingHours >= 12 && shownFastingHours < 16 :
                                   shownFastingHours >= 16;
                  const isReached = shownFastingHours >= stage.startHour;
                  
                  return (
                    <div
                      key={idx}
                      className="absolute bottom-0 z-0 pointer-events-none"
                      style={{
                        left: `${stage.percent}%`,
                        transform: 'translateX(-50%)',
                      }}
                    >
                      {/* Outer soft glow */}
                      <motion.div
                        className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full transition-all duration-500"
                        animate={isActive ? { 
                          opacity: [0.4, 0.7, 0.4],
                          scale: [1, 1.1, 1],
                        } : isReached ? {
                          opacity: 0.4,
                        } : {}}
                        transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                        style={{
                          width: isActive ? 60 : isReached ? 30 : 16,
                          height: isActive ? 60 : isReached ? 30 : 16,
                          marginBottom: -10,
                          background: isActive 
                            ? 'radial-gradient(circle, hsl(45, 100%, 60% / 0.5) 0%, hsl(var(--primary) / 0.3) 40%, transparent 70%)'
                            : isReached
                            ? 'radial-gradient(circle, hsl(var(--primary) / 0.25) 0%, transparent 70%)'
                            : 'radial-gradient(circle, hsl(var(--primary) / 0.1) 0%, transparent 70%)',
                          filter: isActive ? 'blur(8px)' : 'blur(4px)',
                        }}
                      />
                      
                      {/* Diamond/crystal shape */}
                      <div
                        className="absolute bottom-0 left-1/2 -translate-x-1/2 transition-all duration-500"
                        style={{
                          width: 10,
                          height: 20,
                          clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                          background: isActive 
                            ? 'linear-gradient(180deg, hsl(45, 100%, 70%) 0%, hsl(var(--primary)) 60%, hsl(var(--primary) / 0.5) 100%)'
                            : isReached
                            ? 'linear-gradient(180deg, hsl(var(--primary) / 0.6) 0%, hsl(var(--primary) / 0.2) 100%)'
                            : 'linear-gradient(180deg, hsl(var(--primary) / 0.2) 0%, hsl(var(--primary) / 0.05) 100%)',
                          opacity: isActive ? 1 : isReached ? 0.7 : 0.3,
                        }}
                      />
                      
                      {/* Inner bright core for active */}
                      {isActive && (
                        <motion.div
                          className="absolute bottom-0 left-1/2 -translate-x-1/2"
                          animate={{ opacity: [0.7, 1, 0.7] }}
                          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                          style={{
                            width: 4,
                            height: 10,
                            clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                            background: 'linear-gradient(180deg, hsl(50, 100%, 85%) 0%, hsl(45, 100%, 65%) 100%)',
                          }}
                        />
                      )}
                    </div>
                  );
                })}
                {/* Background progress line - centered at circle center (10px) */}
                <div 
                  className="absolute h-[4px] bg-gradient-to-r from-primary/10 via-primary/30 to-primary/10 rounded-full z-0"
                  style={{ left: '0%', right: '0%', top: '8px' }}
                />
                
                {/* Active progress fill - same positioning, z-index 1 */}
                <motion.div 
                  className="absolute h-[4px] bg-gradient-to-r from-primary/30 to-primary/60 rounded-full z-[1]"
                  style={{ 
                    left: '0%',
                    top: '8px',
                    width: `${Math.min((shownFastingHours / 16) * 100, 100)}%`
                  }}
                  transition={{ duration: 0.5 }}
                />
                
                {/* Static glow at end of progress bar */}
                <div
                  className="absolute z-[2] h-[4px] w-[4px] rounded-full bg-primary shadow-[0_0_6px_2px_rgba(var(--primary),0.5)]"
                  style={{ 
                    left: `${Math.min((shownFastingHours / 16) * 100, 100)}%`,
                    top: '8px',
                    marginLeft: '-2px'
                  }}
                />
                
                {/* Timer positioned at progress bar end */}
                <motion.div
                  className="absolute z-20"
                  style={{ 
                    left: `clamp(8%, ${Math.min((shownFastingHours / 16) * 100, 92)}%, 92%)`,
                    top: '-24px',
                    transform: 'translateX(-50%)'
                  }}
                  transition={{ duration: 0.5 }}
                >
                  <span className="text-[8px] font-mono text-primary/90 px-1 py-0.5 whitespace-nowrap">
                    {formatFastingTime(shownFastingHours)}
                  </span>
                </motion.div>

                {/* Circle nodes - positioned at exact stage boundaries, z-index 10 to appear above line */}
                {[
                  { label: "Fed", startHour: 0, isActive: shownFastingHours < 4 },
                  { label: "Post-Absorptive", startHour: 4, isActive: shownFastingHours >= 4 && shownFastingHours < 8 },
                  { label: "Fat Burning", startHour: 8, isActive: shownFastingHours >= 8 && shownFastingHours < 12 },
                  { label: "Deep Ketosis", startHour: 12, isActive: shownFastingHours >= 12 && shownFastingHours < 16 },
                  { label: "Autophagy", startHour: 16, isActive: shownFastingHours >= 16 },
                ].map((stage, idx) => {
                  const progressPercent = (stage.startHour / 16) * 100;
                  const isReached = shownFastingHours >= stage.startHour;
                  
                  return (
                    <div 
                      key={idx} 
                      className="absolute flex flex-col items-center z-10"
                      style={{ 
                        left: `${progressPercent}%`, 
                        top: '0px',
                        transform: 'translateX(-50%)'
                      }}
                    >
                      {/* Circle node - with background to hide line */}
                      <motion.div
                        className="relative"
                        animate={stage.isActive ? { scale: 1.15 } : { scale: 1 }}
                        transition={{ duration: 0.3 }}
                      >
                        {/* Glow effect for active */}
                        {stage.isActive && (
                          <motion.div
                            className="absolute -inset-2 rounded-full bg-primary/20 blur-md"
                            animate={{ scale: [1, 1.3, 1] }}
                            transition={{ duration: 2, repeat: Infinity }}
                          />
                        )}
                        
                        <div
                          className={`w-5 h-5 rounded-full border-2 relative transition-all ${
                            stage.isActive
                              ? "border-primary bg-primary/30 shadow-lg shadow-primary/30"
                              : isReached
                              ? "border-primary/40 bg-card"
                              : "border-border/40 bg-card"
                          }`}
                        >
                          {/* Inner dot for active */}
                          {stage.isActive && (
                            <motion.div
                              className="absolute inset-1 rounded-full bg-primary"
                              animate={{ scale: [0.4, 0.6, 0.4] }}
                              transition={{ duration: 2, repeat: Infinity }}
                            />
                          )}
                        </div>
                      </motion.div>

                      {/* Label - positioned below circle, smaller text that enlarges when active */}
                      <span
                        className={`mt-1.5 text-center leading-tight whitespace-nowrap transition-all duration-300 ${
                          stage.isActive
                            ? "text-[11px] text-primary/90 font-medium"
                            : isReached
                            ? "text-[8px] text-muted-foreground/60 font-light"
                            : "text-[8px] text-muted-foreground/30 font-light"
                        }`}
                      >
                        {stage.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            
          </section>

        {/* --- Log Intake Form (Inline) --- */}
        <section className="space-y-4">
          <h3 className="text-xs tracking-[0.15em] text-muted-foreground font-light flex items-center gap-2">
            <Utensils className="w-3 h-3 opacity-70" />
            LOG INTAKE
          </h3>

          <form onSubmit={handleAddFood} className="space-y-3">
            {/* Quick Add Row with submit button */}
            <div className="flex gap-2">
              <div className="flex-1">
                <Input 
                  placeholder={`e.g. ${mealPlaceholder}`}
                  value={newFoodName}
                  onChange={(e) => setNewFoodName(e.target.value)}
                  className="bg-secondary/40 border-border/30 focus:border-primary/40 focus:bg-secondary/50 transition-colors font-light text-sm placeholder:text-muted-foreground/30"
                  data-testid="input-food-name"
                />
              </div>
              <div className="w-20">
                <Input 
                  type="text" 
                  placeholder="Cal" 
                  value={newFoodCals}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9.]/g, '');
                    setNewFoodCals(val);
                  }}
                  onFocus={(e) => {
                    if (e.currentTarget.value) {
                      setTimeout(() => {
                        e.currentTarget.setSelectionRange(
                          e.currentTarget.value.length,
                          e.currentTarget.value.length
                        );
                      }, 0);
                    }
                  }}
                  inputMode="numeric"
                  className="bg-secondary/40 border-border/30 focus:border-primary/40 focus:bg-secondary/50 transition-colors font-mono text-right text-sm placeholder:text-muted-foreground/30"
                  data-testid="input-food-calories"
                />
              </div>
              <Button 
                type="submit" 
                size="icon"
                className="bg-gradient-to-br from-primary to-accent text-white/90 border-0 shadow-sm h-9 w-9 active:scale-95 active:opacity-80 transition-transform"
                data-testid="button-add-food"
                disabled={!newFoodName || !newFoodCals}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </form>

          {/* Separator with add detail button */}
          <div className="flex items-center gap-3 py-3">
            <div className="flex-1 h-px bg-border/20" />
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-[10px] text-muted-foreground/60 hover:text-primary transition-colors tracking-wide whitespace-nowrap"
              data-testid="button-toggle-details"
            >
              {showDetails ? "hide detail" : "add detail"}
            </button>
            <div className="flex-1 h-px bg-border/20" />
          </div>

          {/* Details - Collapsible (appears below separator) */}
          <AnimatePresence>
            {showDetails && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="space-y-3 pb-3">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground/70">Meal Type</Label>
                    <Select value={mealType} onValueChange={(v: any) => setMealType(v)}>
                      <SelectTrigger className="bg-secondary/40 border-border/30 focus:border-primary/40 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-card border-border/30">
                        <SelectItem value="breakfast">Breakfast</SelectItem>
                        <SelectItem value="lunch">Lunch</SelectItem>
                        <SelectItem value="dinner">Dinner</SelectItem>
                        <SelectItem value="snack">Snack</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground/70">Day & Time</Label>
                    <div className="flex gap-1.5 items-center">
                      {/* Day selector - Today/Yesterday only */}
                      <Select value={logDay} onValueChange={setLogDay}>
                        <SelectTrigger className="bg-secondary/40 border-border/30 focus:border-primary/40 h-8 text-xs w-[90px] px-2">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-card border-border/30">
                          <SelectItem value="0">Today</SelectItem>
                          <SelectItem value="1">Yesterday</SelectItem>
                        </SelectContent>
                      </Select>
                      {/* Time inputs */}
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={foodHour}
                        onFocus={(e) => {
                          e.target.value = "";
                          setFoodHour("");
                        }}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                          setFoodHour(val);
                        }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value) || 12;
                          if (num === 0 || num > 12) setFoodHour("12");
                          else setFoodHour(String(num));
                        }}
                        placeholder="12"
                        className="w-10 h-8 text-center text-xs bg-secondary/40 border-border/30 focus:border-primary/40 px-1"
                        data-testid="input-food-hour"
                      />
                      <span className="text-muted-foreground/60 font-light text-xs">:</span>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={foodMinute}
                        onFocus={(e) => {
                          e.target.value = "";
                          setFoodMinute("");
                        }}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                          setFoodMinute(val);
                        }}
                        onBlur={(e) => {
                          const num = parseInt(e.target.value) || 0;
                          if (num > 59) setFoodMinute("59");
                          else setFoodMinute(String(num).padStart(2, '0'));
                        }}
                        placeholder="00"
                        className="w-10 h-8 text-center text-xs bg-secondary/40 border-border/30 focus:border-primary/40 px-1"
                        data-testid="input-food-minute"
                      />
                      <AMPMToggle
                        value={foodPeriod}
                        onChange={setFoodPeriod}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground/70">Protein (g)</Label>
                      <Input 
                        type="number" 
                        placeholder="0" 
                        value={protein}
                        onChange={(e) => setProtein(e.target.value)}
                        inputMode="numeric"
                        className="bg-secondary/40 border-border/30 focus:border-primary/40 h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground/70">Carbs (g)</Label>
                      <Input 
                        type="number" 
                        placeholder="0" 
                        value={carbs}
                        onChange={(e) => setCarbs(e.target.value)}
                        inputMode="numeric"
                        className="bg-secondary/40 border-border/30 focus:border-primary/40 h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground/70">Fat (g)</Label>
                      <Input 
                        type="number" 
                        placeholder="0" 
                        value={fat}
                        onChange={(e) => setFat(e.target.value)}
                        inputMode="numeric"
                        className="bg-secondary/40 border-border/30 focus:border-primary/40 h-8 text-xs"
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className={`space-y-3 ${showDetails ? 'pt-3 border-t border-border/20' : ''}`}>
            {/* QUICK ADD - Hidden for now
            <span className="text-[10px] text-muted-foreground/60 tracking-wider uppercase font-light">Quick add</span>
            <div className="flex gap-2">
              {["Food", "Drink", "Snack"].map((category) => (
                <button
                  key={category}
                  onClick={() => { setNewFoodName(category); setNewFoodCals(""); }}
                  className="flex-1 text-xs px-3 py-2 rounded-md bg-primary/10 hover:bg-primary/20 border border-primary/30 transition-colors font-light text-primary/80 hover:text-primary"
                >
                  {category}
                </button>
              ))}
            </div>
            */}

            {/* QUICK CALORIES - Hidden for now
            <div>
              <p className="text-[10px] text-muted-foreground/60 tracking-wider uppercase font-light mb-1.5">QUICK CALORIES</p>
              <div className="grid grid-cols-5 gap-1">
                {[100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map((cal) => (
                  <button
                    key={cal}
                    onClick={() => { setNewFoodCals(cal.toString()); }}
                    className="text-[11px] px-1.5 py-1 rounded-md bg-secondary/30 hover:bg-secondary/60 border border-border/40 transition-colors font-mono text-muted-foreground/80 hover:text-foreground"
                  >
                    {cal}
                  </button>
                ))}
              </div>
            </div>
            */}

            {foodHistory.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] text-muted-foreground/60 tracking-wider uppercase font-light">HISTORY</p>
                  <button
                    onClick={() => { setFoodHistory([]); localStorage.removeItem('fluxcal_food_history'); }}
                    className="text-[10px] text-muted-foreground/60 hover:text-destructive transition-colors"
                    data-testid="button-clear-history"
                  >
                    clear history
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {foodHistory.map((item, idx) => (
                    <button
                      key={`${item.name}-${item.calories}-${idx}`}
                      onClick={() => handleAddFromHistory(item.name, item.calories, item.protein, item.carbs, item.fat)}
                      disabled={isLoading}
                      data-testid={`button-history-${idx}`}
                      className="text-[11px] px-2 py-1.5 rounded-md bg-primary/10 border border-primary/30 font-light text-primary/80 disabled:opacity-50 flex items-center gap-1.5 active:scale-95 active:opacity-80 transition-transform"
                    >
                      <span className="truncate max-w-[80px]">{item.name}</span>
                      <span className="font-mono text-[10px] text-primary/60">{item.calories}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Sci-Fi Macro Radar Chart - Between History and Activity */}
        {(dailyMacros.protein > 0 || dailyMacros.carbs > 0 || dailyMacros.fat > 0) && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="my-6"
            data-testid="container-macro-radar"
          >
            <div className="relative">
              {/* HUD Frame - Outer ring */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="absolute w-[200px] h-[200px] rounded-full border border-primary/20" />
                <div className="absolute w-[160px] h-[160px] rounded-full border border-primary/10" />
                <div className="absolute w-[120px] h-[120px] rounded-full border border-primary/5" />
              </div>
              
              {/* Scanning line animation */}
              <motion.div
                className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <motion.div
                  className="absolute w-[180px] h-0.5 bg-gradient-to-r from-transparent via-primary/30 to-transparent"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                  style={{ transformOrigin: "center" }}
                />
              </motion.div>
              
              {/* Corner brackets - HUD style */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-2">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-px bg-primary/40" />
                  <span className="text-[8px] tracking-[0.2em] text-primary/50 font-mono">MACROS</span>
                  <div className="w-3 h-px bg-primary/40" />
                </div>
              </div>
              
              {/* Radar Chart */}
              <div className="h-[200px] relative z-10" data-testid="chart-macro-radar">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart 
                    data={(() => {
                      const maxValue = Math.max(dailyMacros.protein, dailyMacros.carbs, dailyMacros.fat, 1);
                      const domain = Math.max(maxValue * 1.2, 50);
                      return [
                        { name: 'Protein', value: dailyMacros.protein, fullMark: domain },
                        { name: 'Carbs', value: dailyMacros.carbs, fullMark: domain },
                        { name: 'Fat', value: dailyMacros.fat, fullMark: domain },
                      ];
                    })()}
                    cx="50%"
                    cy="50%"
                    outerRadius="65%"
                  >
                    <PolarGrid 
                      stroke="hsl(var(--primary))" 
                      strokeOpacity={0.15}
                      gridType="polygon"
                    />
                    <PolarAngleAxis 
                      dataKey="name" 
                      tick={{ 
                        fill: 'hsl(var(--muted-foreground))', 
                        fontSize: 10,
                        fontWeight: 300,
                      }}
                      stroke="hsl(var(--primary))"
                      strokeOpacity={0.2}
                    />
                    <Radar 
                      name="Macros" 
                      dataKey="value" 
                      stroke="hsl(var(--primary))" 
                      fill="url(#macroGradient)" 
                      fillOpacity={0.4}
                      strokeWidth={2}
                      dot={{ 
                        r: 3, 
                        fill: 'hsl(var(--primary))', 
                        strokeWidth: 0 
                      }}
                    />
                    <defs>
                      <linearGradient id="macroGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.8} />
                        <stop offset="50%" stopColor="hsl(var(--accent))" stopOpacity={0.6} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                      </linearGradient>
                    </defs>
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              
              {/* Macro values display - HUD style */}
              <div className="flex justify-center gap-6 mt-2">
                <motion.div 
                  className="text-center"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  data-testid="value-macro-protein"
                >
                  <div className="text-[10px] tracking-wider text-muted-foreground/50 font-mono">PROT</div>
                  <div className="text-sm font-mono text-primary">{dailyMacros.protein.toFixed(0)}g</div>
                </motion.div>
                <motion.div 
                  className="text-center"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  data-testid="value-macro-carbs"
                >
                  <div className="text-[10px] tracking-wider text-muted-foreground/50 font-mono">CARB</div>
                  <div className="text-sm font-mono text-accent">{dailyMacros.carbs.toFixed(0)}g</div>
                </motion.div>
                <motion.div 
                  className="text-center"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  data-testid="value-macro-fat"
                >
                  <div className="text-[10px] tracking-wider text-muted-foreground/50 font-mono">FAT</div>
                  <div className="text-sm font-mono text-yellow-500/80">{dailyMacros.fat.toFixed(0)}g</div>
                </motion.div>
              </div>
              
              {/* Subtle pulse effect on center */}
              <motion.div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-primary/60 pointer-events-none"
                style={{ marginTop: '-10px' }}
                animate={{ 
                  scale: [1, 1.5, 1],
                  opacity: [0.6, 0.2, 0.6]
                }}
                transition={{ 
                  duration: 2, 
                  repeat: Infinity,
                  ease: "easeInOut"
                }}
              />
            </div>
          </motion.div>
        )}

        {/* --- Activity Log with integrated day navigation --- */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs tracking-[0.15em] text-muted-foreground font-light">ACTIVITY</h3>
            
            {/* Today/Yesterday toggle */}
            <div className="flex items-center gap-1">
              {(() => {
                const today = new Date();
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayStr = formatDateLocal(yesterday);
                const hasYesterdayData = weeklyTotals[yesterdayStr] > 0;
                
                return (
                  <>
                    <button
                      onClick={() => setActivitySelectedDate(yesterday)}
                      data-testid="button-day-yesterday"
                      className={`
                        relative px-2 py-1 rounded text-[10px] font-light transition-all
                        ${isActivitySelected(yesterday) 
                          ? 'bg-primary/30 text-primary' 
                          : 'text-muted-foreground/50 hover:text-muted-foreground'
                        }
                      `}
                    >
                      Yesterday
                      {hasYesterdayData && !isActivitySelected(yesterday) && (
                        <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-0.5 h-0.5 rounded-full bg-primary/60" />
                      )}
                    </button>
                    <button
                      onClick={goToToday}
                      data-testid="button-day-today"
                      className={`
                        relative px-2 py-1 rounded text-[10px] font-light transition-all
                        ${isToday(activitySelectedDate) 
                          ? 'bg-primary/30 text-primary' 
                          : 'text-accent/70 hover:text-accent'
                        }
                      `}
                    >
                      Today
                    </button>
                  </>
                );
              })()}
            </div>

            <Dialog open={deleteAllDialogOpen} onOpenChange={setDeleteAllDialogOpen}>
              <DialogTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-6 px-2 text-[10px] text-muted-foreground/60 active:scale-95 active:opacity-80 transition-transform"
                  data-testid="button-delete-all"
                >
                  delete all
                </Button>
              </DialogTrigger>
              <DialogContent className="glass-panel border-border/30 max-w-sm">
                <DialogHeader>
                  <DialogTitle className="text-sm font-light tracking-[0.1em]">DELETE ALL ENTRIES</DialogTitle>
                  <p className="text-sm text-muted-foreground pt-2">
                    You are about to delete all entries. Do you want to restart?
                  </p>
                </DialogHeader>
                <div className="flex flex-col gap-2 pt-4">
                  <Button 
                    onClick={handleRestartApp}
                    className="w-full bg-primary text-primary-foreground active:scale-95 active:opacity-80 transition-transform"
                    data-testid="button-restart"
                  >
                    Restart
                  </Button>
                  <Button 
                    onClick={handleDeleteAllOnly}
                    variant="destructive"
                    className="w-full active:scale-95 active:opacity-80 transition-transform"
                    data-testid="button-just-delete"
                  >
                    Just Delete
                  </Button>
                  <Button 
                    onClick={() => setDeleteAllDialogOpen(false)}
                    variant="ghost"
                    className="w-full text-muted-foreground active:scale-95 active:opacity-80 transition-transform"
                    data-testid="button-cancel-delete"
                  >
                    Cancel
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          
          {/* Date header with smooth transition */}
          <AnimatePresence mode="wait">
            <motion.div
              key={formatDateLocal(activitySelectedDate)}
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 5 }}
              transition={{ duration: 0.15 }}
              className="mb-3 flex items-center justify-between"
            >
              <span className="text-xs text-muted-foreground/70">
                {isToday(activitySelectedDate) 
                  ? `Today, ${activitySelectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                  : activitySelectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              </span>
              <span className="text-xs text-muted-foreground/50 font-mono">
                Total {Math.round((isToday(activitySelectedDate) ? foods : activityFoods).reduce((sum, f) => sum + f.calories, 0))}
              </span>
            </motion.div>
          </AnimatePresence>
          
          <ScrollArea className="h-[320px]">
            <div className="space-y-2 pr-4">
              {/* Use activityFoods when viewing past day, foods when viewing today */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={isToday(activitySelectedDate) ? 'today' : 'yesterday'}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
              {(isToday(activitySelectedDate) ? foods : activityFoods).length === 0 ? (
                <div className="text-center py-12 text-muted-foreground/40 text-xs space-y-2">
                  <p>No items logged{!isToday(activitySelectedDate) ? ' for this day' : ''}.</p>
                  <p className="text-muted-foreground/30">Your metabolism is working silently.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {(isToday(activitySelectedDate) ? foods : activityFoods).map((food) => {
                    const burnStatus = burnQueue.get(food.id);
                    const fillPercent = burnStatus?.fillPercent ?? 100;
                    const remainingSeconds = burnStatus?.remainingSeconds ?? 0;
                    const isCurrentlyBurning = burnStatus?.isCurrentlyBurning ?? false;
                    const isBurned = burnStatus?.isBurned ?? false;
                    const isWaiting = burnStatus?.isWaiting ?? false;
                    // Show remaining time in approximate format (~Xh, <30m, etc)
                    const timeDisplay = formatBurnTime(remainingSeconds);
                    
                    const isDeleting = deletingFoodId === food.id;
                    
                    return (
                      <motion.div
                        key={food.id}
                        layout
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ 
                          opacity: isDeleting ? 0 : 1, 
                          y: 0,
                        }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ 
                          duration: 0.3,
                          layout: { duration: 0.25, ease: "easeOut" }
                        }}
                        className={`relative rounded-lg border group overflow-hidden ${
                          isDeleting
                            ? 'border-red-400/25'
                            : isCurrentlyBurning 
                              ? 'border-amber-700/20' 
                              : 'border-border/30 hover:border-primary/30'
                        }`}
                        style={{ 
                          background: isDeleting ? 'rgba(239, 68, 68, 0.12)' : 'hsla(40, 10%, 50%, 0.08)',
                          transition: 'background 0.15s ease-out, border-color 0.15s ease-out'
                        }}
                      >
                        {/* Burn progress fill - solid subtle tint (hidden when deleting) */}
                        {!isDeleting && (
                          <div 
                            className="absolute top-0 right-0 bottom-0 transition-all duration-100"
                            style={{
                              width: `${fillPercent}%`,
                              background: isBurned 
                                ? 'transparent' 
                                : isCurrentlyBurning 
                                  ? 'rgba(150, 140, 120, 0.10)'
                                  : 'rgba(130, 125, 110, 0.07)',
                            }}
                          />
                        )}
                        
                                                
                        {/* Capping line at burn edge - shows for burning items */}
                        {!isDeleting && !isBurned && fillPercent > 0 && fillPercent < 100 && (
                          <div 
                            className="absolute top-0 bottom-0 w-px pointer-events-none"
                            style={{ 
                              left: `${100 - fillPercent}%`,
                              background: isCurrentlyBurning 
                                ? 'rgba(200, 170, 120, 0.25)' 
                                : 'rgba(180, 160, 120, 0.15)',
                            }}
                          />
                        )}
                        
                        
                        {/* Content layer on top */}
                        <div className="relative z-10 p-3">
                          <div className="flex items-center justify-between">
                            <div className="flex flex-col gap-1 flex-1">
                              <div className="flex items-center gap-2">
                                <span className={`font-light text-sm ${isBurned ? 'text-muted-foreground/50' : ''}`}>{food.name}</span>
                                {food.mealType && (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-light capitalize ${
                                    isBurned ? 'bg-muted/10 text-muted-foreground/40' : 'bg-primary/10 text-primary/70'
                                  }`}>
                                    {food.mealType}
                                  </span>
                                )}
                                {isCurrentlyBurning && (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400/80 font-medium animate-burning-label">
                                      Burning
                                    </span>
                                    {timeDisplay && (
                                      <span className="text-[10px] font-mono text-amber-400/70">
                                        {timeDisplay}
                                      </span>
                                    )}
                                  </div>
                                )}
                                {isWaiting && (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted/20 text-muted-foreground/60 font-medium">
                                      Queued
                                    </span>
                                    {timeDisplay && (
                                      <span className="text-[10px] font-mono text-muted-foreground/50">
                                        {timeDisplay}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-3">
                                <span className={`text-xs ${isBurned ? 'text-muted-foreground/40' : 'text-muted-foreground/60'}`}>
                                  {new Date(food.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                </span>
                                {(food.protein || food.carbs || food.fat) && (
                                  <span className={`text-[10px] font-mono space-x-2 ${isBurned ? 'text-muted-foreground/30' : 'text-muted-foreground/50'}`}>
                                    {food.protein && <span>P:{food.protein}g</span>}
                                    {food.carbs && <span>C:{food.carbs}g</span>}
                                    {food.fat && <span>F:{food.fat}g</span>}
                                  </span>
                                )}
                              </div>
                                                          </div>
                            <div className="flex items-center gap-2">
                              <span className={`font-mono text-sm font-light ${isBurned ? 'text-muted-foreground/40 line-through' : 'text-accent'}`}>
                                +{food.calories}
                              </span>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => openEditFood(food)}
                                  className="h-6 w-6 text-muted-foreground/60 active:scale-95 active:opacity-80 transition-transform"
                                  data-testid={`button-edit-food-${food.id}`}
                                >
                                  <Pencil className="w-3 h-3" />
                                </Button>
                                <HoldToDeleteButton
                                  onDelete={() => handleDeleteFood(food.id)}
                                  testId={`button-delete-food-${food.id}`}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
                </motion.div>
              </AnimatePresence>
            </div>
          </ScrollArea>
        </section>

        {/* Edit Food Dialog */}
        <Dialog open={!!editingFood} onOpenChange={(open) => !open && setEditingFood(null)}>
          <DialogContent className="sm:max-w-md bg-card border-border/30" onOpenAutoFocus={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>Edit Entry</DialogTitle>
              <DialogDescription className="text-muted-foreground/80">
                Update the food name, calories, or time.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={editFoodName}
                  onChange={(e) => setEditFoodName(e.target.value)}
                  placeholder="Food name"
                  data-testid="input-edit-food-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Calories</Label>
                <Input
                  type="number"
                  value={editFoodCals}
                  onChange={(e) => setEditFoodCals(e.target.value)}
                  inputMode="numeric"
                  placeholder="Calories"
                  data-testid="input-edit-food-cals"
                />
              </div>
              <div className="space-y-2">
                <Label>Day</Label>
                <Select value={editFoodDay} onValueChange={(v: "today" | "yesterday") => setEditFoodDay(v)}>
                  <SelectTrigger className="w-full bg-secondary/40 border-border/30" data-testid="select-edit-food-day">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="yesterday">Yesterday</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Time</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={editFoodHour}
                    onFocus={(e) => {
                      e.target.value = "";
                      setEditFoodHour("");
                    }}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                      setEditFoodHour(val);
                    }}
                    onBlur={(e) => {
                      const num = parseInt(e.target.value) || 12;
                      if (num === 0 || num > 12) setEditFoodHour("12");
                      else setEditFoodHour(String(num));
                    }}
                    placeholder="12"
                    className="w-14 h-9 text-center bg-secondary/40 border-border/30 focus:border-primary/40"
                    data-testid="input-edit-food-hour"
                  />
                  <span className="text-muted-foreground">:</span>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={editFoodMinute}
                    onFocus={(e) => {
                      e.target.value = "";
                      setEditFoodMinute("");
                    }}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                      setEditFoodMinute(val);
                    }}
                    onBlur={(e) => {
                      const num = parseInt(e.target.value) || 0;
                      if (num > 59) setEditFoodMinute("59");
                      else setEditFoodMinute(String(num).padStart(2, '0'));
                    }}
                    placeholder="00"
                    className="w-14 h-9 text-center bg-secondary/40 border-border/30 focus:border-primary/40"
                    data-testid="input-edit-food-minute"
                  />
                  <AMPMToggle
                    value={editFoodPeriod}
                    onChange={setEditFoodPeriod}
                  />
                </div>
              </div>
            </div>
            <DialogFooter className="gap-3">
              <Button 
                variant="ghost" 
                onClick={() => setEditingFood(null)} 
                className="border border-border/20 text-muted-foreground/60 active:scale-95 active:opacity-80 transition-transform"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleSaveEditFood} 
                disabled={isLoading} 
                data-testid="button-save-edit-food" 
                className="bg-transparent border border-primary/30 text-primary/70 shadow-[0_0_8px_rgba(180,140,60,0.1)] active:scale-95 active:opacity-80 transition-all hover:shadow-[0_0_12px_rgba(180,140,60,0.15)]"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Hidden debug toggle button - bottom right */}
        <button
          onClick={() => setShowDebugPanel(!showDebugPanel)}
          className="fixed bottom-4 right-4 w-8 h-8 rounded-full bg-transparent opacity-0 hover:opacity-10 z-50"
          aria-label="Toggle debug panel"
        />
        
        {/* ========== DEBUG PANEL ========== */}
        {/* Remove this entire section before production - it's purely for testing */}
        {showDebugPanel && (
        <section className="mt-8 p-4 rounded-lg bg-card/30 border border-dashed border-muted-foreground/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] tracking-[0.15em] text-muted-foreground/40 font-mono">DEBUG PANEL</span>
            <span className="text-[9px] text-muted-foreground/30">Remove before production</span>
          </div>
          
          <div className="grid grid-cols-2 gap-4 text-xs">
            {/* Buffer Controls */}
            <div className="space-y-2">
              <p className="text-[10px] text-muted-foreground/50 font-mono">BUFFER</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      const tzOffset = new Date().getTimezoneOffset();
                      const res = await fetch(`/api/debug/add-buffer?tz=${tzOffset}`, { method: "POST" });
                      if (res.ok) {
                        const { user } = await res.json();
                        setStats(prev => ({
                          ...prev,
                          bufferAmount: user.bufferAmount,
                          bufferForDate: user.bufferForDate,
                        }));
                        queryClient.invalidateQueries({ queryKey: ["user"] });
                      }
                    } catch (error) {
                      console.error("Debug buffer add failed:", error);
                    }
                  }}
                  data-testid="button-debug-buffer"
                  className="h-7 text-[10px] font-mono"
                >
                  +100 buffer
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      const res = await fetch("/api/debug/clear-buffer", { method: "POST" });
                      if (res.ok) {
                        setStats(prev => ({
                          ...prev,
                          bufferAmount: undefined,
                          bufferForDate: undefined,
                        }));
                        queryClient.invalidateQueries({ queryKey: ["user"] });
                      }
                    } catch (error) {
                      console.error("Debug buffer clear failed:", error);
                    }
                  }}
                  data-testid="button-debug-clear-buffer"
                  className="h-7 text-[10px] font-mono"
                >
                  CLR buffer
                </Button>
              </div>
              <p className="text-[9px] text-muted-foreground/40">
                Current: {stats.bufferAmount ?? 0} for {stats.bufferForDate ?? 'none'}
              </p>
            </div>
            
            {/* Test Food Controls */}
            <div className="space-y-2">
              <p className="text-[10px] text-muted-foreground/50 font-mono">TEST FOOD</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    // Add food from 30 min ago
                    const timestamp = new Date(Date.now() - 30 * 60 * 1000);
                    try {
                      const res = await fetch("/api/food", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          name: "Test food 30m ago",
                          calories: 300,
                          timestamp: timestamp.toISOString(),
                          mealType: "snack"
                        }),
                        credentials: "include"
                      });
                      if (res.ok) {
                        await loadFoodItems();
                        await loadMostRecentMeal();
                      }
                    } catch (error) {
                      console.error("Debug add food failed:", error);
                    }
                  }}
                  data-testid="button-debug-add-food-30m"
                  className="h-7 text-[10px] font-mono"
                >
                  +300 (30m ago)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    // Add food from 2 hours ago
                    const timestamp = new Date(Date.now() - 2 * 60 * 60 * 1000);
                    try {
                      const res = await fetch("/api/food", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          name: "Test food 2h ago",
                          calories: 500,
                          timestamp: timestamp.toISOString(),
                          mealType: "lunch"
                        }),
                        credentials: "include"
                      });
                      if (res.ok) {
                        await loadFoodItems();
                        await loadMostRecentMeal();
                      }
                    } catch (error) {
                      console.error("Debug add food failed:", error);
                    }
                  }}
                  data-testid="button-debug-add-food-2h"
                  className="h-7 text-[10px] font-mono"
                >
                  +500 (2h ago)
                </Button>
              </div>
            </div>
            
            {/* Burn Queue Inspector */}
            <div className="col-span-2 space-y-2">
              <p className="text-[10px] text-muted-foreground/50 font-mono">BURN QUEUE</p>
              <div className="max-h-32 overflow-y-auto bg-secondary/20 rounded p-2 font-mono text-[9px] space-y-1">
                {burnQueue.size === 0 ? (
                  <p className="text-muted-foreground/40">No items in queue</p>
                ) : (
                  Array.from(burnQueue.entries()).map(([id, item]) => (
                    <div key={id} className="flex items-center gap-2">
                      <span className={`w-16 ${item.isCurrentlyBurning ? 'text-accent' : item.isBurned ? 'text-muted-foreground/40' : 'text-primary/60'}`}>
                        {item.isCurrentlyBurning ? '🔥 BURN' : item.isBurned ? '✓ DONE' : '⏳ WAIT'}
                      </span>
                      <span className="text-muted-foreground/60">{id.slice(0, 8)}...</span>
                      <span className="text-primary/70">{item.fillPercent.toFixed(1)}%</span>
                    </div>
                  ))
                )}
              </div>
            </div>
            
            {/* Rate Info */}
            <div className="col-span-2 space-y-1">
              <p className="text-[10px] text-muted-foreground/50 font-mono">RATES</p>
              <div className="flex gap-4 text-[9px] text-muted-foreground/40 font-mono">
                <span>TDEE: {stats.tdee} cal/day ({tdeeBurnRatePerSecond.toFixed(5)} cal/sec)</span>
                <span>Goal: {stats.dailyGoalCalories ?? 'none'} ({goalBurnRatePerSecond.toFixed(5)} cal/sec)</span>
              </div>
            </div>
          </div>
        </section>
        )}
        {/* ========== END DEBUG PANEL ========== */}

      </main>
    </div>
  );
}

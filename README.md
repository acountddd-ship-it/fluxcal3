# FluxCal - Realtime Metabolic Tracker

A real-time metabolic tracking application that calculates calorie burn based on user-specific Basal Metabolic Rate (BMR) and Total Daily Energy Expenditure (TDEE). Track your food intake, monitor caloric balance, and visualize your fasting states with beautiful, real-time updates.

## ✨ Key Features

- **Real-time Energy Balance**: Continuous calorie burn tracking using local time calculations with localStorage persistence
- **Week-based Navigation**: Navigate between days using a Mon-Sun pill interface with week navigation arrows
- **Food History**: Quick re-add of recently logged custom foods (max 10 items, localStorage-backed)
- **Edit/Delete Entries**: Each food entry has edit and delete buttons always visible for mobile-first UX
- **Fasting Tracker**: Visual timeline showing fasting stages (Fed → Post-Absorptive → Fat Burning → Deep Ketosis → Autophagy) with 2-week historical tracking
- **Goal Tracking**: Weight loss goals with daily calorie targets and progress visualization
- **Offline Support**: Energy balance works completely independently using localStorage and local time calculations

## 🏗️ System Architecture

### Frontend
- **Framework**: React 19 with TypeScript
- **Routing**: Wouter (lightweight client-side router)
- **State Management**: TanStack React Query for server state and caching
- **UI Components**: Shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom dark theme (luxury minimal design)
- **Animations**: Framer Motion for UI transitions
- **Fonts**: Inter for UI text, JetBrains Mono for numerical data display

### Backend
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript (ESM modules)
- **API Pattern**: RESTful JSON API with `/api` prefix
- **Build Tool**: Vite for development, esbuild for production bundling
- **Database**: SQLite (better-sqlite3) with Drizzle ORM

### Authentication
- **Provider**: Replit Auth via OpenID Connect (OIDC)
- **Login Options**: Google, GitHub, Apple, X, and email/password
- **Session Storage**: SQLite-backed sessions (7-day TTL)

### Data Layer
- **ORM**: Drizzle ORM with SQLite
- **Schema Location**: `shared/schema.ts` (shared between client and server)
- **Validation**: Zod schemas generated from Drizzle schemas via drizzle-zod
- **Database Tables**:
  - `sessions`: Stores user sessions for Replit Auth
  - `users`: Stores user profile + biometric data + goal tracking
  - `food_items`: Stores logged meals with calories, macros, and timestamps
  - `fasting_state_summaries`: Daily aggregates of fasting states with 14-day retention

## 📁 Project Structure

```
├── client/           # React frontend
│   ├── src/
│   │   ├── components/ui/  # Shadcn component library
│   │   ├── pages/          # Route components
│   │   ├── hooks/          # Custom React hooks
│   │   └── lib/            # Utilities and query client
├── server/           # Express backend
│   ├── index.ts      # Server entry point
│   ├── routes.ts     # API route definitions
│   ├── storage.ts    # Database access layer
│   └── db.ts         # Database connection
├── shared/           # Shared code between client/server
│   └── schema.ts     # Drizzle schema definitions
└── script/           # Build scripts
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd FluxCal
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables (optional):
```bash
# Create .env file (optional - defaults work for local development)
DATABASE_URL=file:./fluxcal.db
SESSION_SECRET=your-secret-key-here
PORT=5000
```

4. Initialize the database:
```bash
npm run db:push
```

### Development

Start the development server:
```bash
npm run dev
```

The app will be available at `http://localhost:5000`

### Production Build

Build for production:
```bash
npm run build
npm start
```

## 🔧 Available Scripts

- `npm run dev` - Start development server (server + Vite dev server)
- `npm run dev:client` - Start only the Vite dev server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run db:push` - Push database schema changes
- `npm run check` - Type check with TypeScript

## 💾 Local Storage

The app uses localStorage for:
- **Food History**: Recently logged custom foods (max 10 items)
- **Energy Balance**: Persistent energy balance tracking that works offline
  - Automatically calculates catch-up when app reopens
  - Saves every 30 seconds and on every food change
  - Works completely independently of server

## 🔐 Environment Variables

- `DATABASE_URL` - SQLite database file path (default: `./fluxcal.db`)
- `SESSION_SECRET` - Secret key for session encryption (required for production)
- `PORT` - Server port (default: 5000)
- `NODE_ENV` - Environment mode (`development` or `production`)

## 📝 License

MIT

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.


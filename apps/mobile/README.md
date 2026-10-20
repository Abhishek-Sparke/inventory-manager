# StockFlow Mobile Client (React Native & Expo)

The StockFlow mobile application is an offline-first inventory management and workflow companion built with **Expo SDK 57**, **React Native 0.86**, **Expo Router**, **Expo SQLite**, and **Android Home Screen AppWidgets**.

---

## Key Architecture & Features

- **Offline-First SQLite Engine**: Powered by `expo-sqlite` (WAL mode enabled). Tasks, product catalogs, and daily progress logs are written locally first with zero latency, and synchronized with the Django REST API in the background.
- **Hardware-Backed Zero-Trust Authentication**: Automatically bootstraps on initial launch via `POST /api/installations/bootstrap/`. Credentials are kept in hardware-backed secure storage using **Expo SecureStore** (`stockflow_installation_id_v1` and `stockflow_installation_token_v1`).
- **Android Home Screen Widgets**: Built using `react-native-android-widget` to give warehouse operators live glanceable inventory counters, high-priority task alerts, and daily progress summaries directly on their Android launcher.
- **Cross-Tab Synchronizer**: Shared in-memory event bus (`src/services/task-sync.ts`) instantly keeps the Tasks tab, Planner tab, and Widgets in sync without duplicate or redundant network roundtrips.
- **Expo Push Notifications**: Supports background alerts for task deadlines and low inventory stock levels.

---

## Directory Layout

```
apps/mobile/
├── app.json                  # Expo app configuration, schemes & plugins
├── package.json              # Dependencies and run scripts
├── index.ts                  # Entry point registering widget background tasks
├── plugins/                  # Expo Config Plugins
│   └── withCleartextTraffic.js # Configures cleartext HTTP & widget broadcast receivers
├── scripts/                  # Automated verification test runners
│   ├── test-scenarios.js     # Validates offline sync, database CRUD & API edge cases
│   ├── test-widget.js        # Validates widget data extraction & layouts
│   └── test-ios-config.js    # Validates iOS schemes & entitlements
└── src/
    ├── app/                  # Expo Router file-based screens
    │   ├── _layout.tsx       # Root layout & tab bar navigation
    │   ├── index.tsx         # Inventory overview & stock management screen
    │   ├── tasks.tsx         # Task scheduling & priority tracker
    │   ├── planner.tsx       # Daily operational planner & progress journal
    │   └── explore.tsx       # Metrics, analytics & device recovery
    ├── components/           # Reusable UI cards, inputs, and modal sheets
    ├── constants/            # API URLs and design tokens
    ├── services/             # Core logic: database.ts, installation.ts, task-sync.ts
    └── widgets/              # Home screen widget templates
```

---

## Command Reference

All commands must be executed within the `apps/mobile/` directory:

```bash
cd apps/mobile
```

### 1. Installation

```bash
# Install dependencies according to package-lock.json
npm install
```

> [!NOTE]
> On Windows PowerShell, if you see an error that `running scripts is disabled on this system`, run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` in PowerShell, or alternatively run commands with `.cmd` (e.g. `npm.cmd install`, `npm.cmd test`).

> [!IMPORTANT]
> When adding new dependencies, always run:
> ```bash
> npx expo install <package-name>
> ```
> This guarantees that compatible versions for Expo SDK 57 are selected.

---

### 2. Development Server Commands

| Command | Description |
| :--- | :--- |
| `npm start` | Starts the Metro bundler server (`npx expo start`) |
| `npm run start:tunnel` | Starts Metro with an ngrok tunnel (bypasses local network/firewall limits) |
| `npm run start:clear` | Starts Metro after clearing the cache (`npx expo start -c`) |
| `npm run web` | Launches the app in a web browser preview (`npx expo start --web`) |

While Metro is running in your terminal, press:
- `a` — Open on a connected Android device or running emulator
- `i` — Open on an iOS simulator (macOS only)
- `w` — Open in your desktop web browser
- `r` — Reload the app bundle
- `?` — Show all keyboard shortcuts

---

### 3. Native Run Commands

```bash
# Compile and run natively on Android device or emulator
npm run android

# Compile and run natively on iOS simulator (macOS with Xcode)
npm run ios
```

---

### 4. Automated Tests & Code Quality

```bash
# Run complete test suite (test-scenarios + test-widget + test-ios-config)
npm test

# Run linter
npm run lint

# Run TypeScript typechecker without emitting files
npx tsc --noEmit

# Run Expo health check
npx expo-doctor
```

---

### 5. Connecting to the Backend

By default, the mobile app connects to:
- Production/Render: `https://stockflow-api-lv0v.onrender.com/api`

To point to your local development backend:

#### For Android Emulator:
Use Android's loopback alias `10.0.2.2`:
```powershell
# Windows PowerShell
$env:EXPO_PUBLIC_API_URL="http://10.0.2.2:8000/api"; npm start

# macOS / Linux
EXPO_PUBLIC_API_URL="http://10.0.2.2:8000/api" npm start
```

#### For Physical Phone:
Use your machine's local network IP (e.g. `192.168.1.50`):
```powershell
# Windows PowerShell
$env:EXPO_PUBLIC_API_URL="http://192.168.1.50:8000/api"; npm run start:tunnel
```

---

### 6. Standalone & Production Cloud Builds (EAS)

```bash
# Authenticate with Expo Application Services
npx eas-cli login

# Build development client APK for Android testing
npx eas-cli build --profile development --platform android

# Build production release for Google Play & Apple App Store
npx eas-cli build --profile production --platform all

# Deploy instant over-the-air (OTA) updates
npx eas-cli update --branch production --message "Update offline sync handler"
```

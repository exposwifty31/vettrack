# VetTrack — App Store & Play Store Metadata

Use this file as the source of truth when submitting to App Store Connect and Google Play Console.

**Product scope:** Equipment-first operations platform. Medication tasks, ER/patient modules, and billing claims workflows were removed June 2026 — see [`docs/scope-change-2026.md`](../scope-change-2026.md).

**Current release:** 1.0.1 (Build 20) — matches `ios/App/App.xcodeproj` and locales `whatsNew.*`.

---

## App identity

| Field | Value |
|-------|-------|
| App name | VetTrack |
| Bundle ID (iOS) | `uk.vettrack.app` |
| Package name (Android) | `uk.vettrack.app` |
| Category (iOS) | Medical |
| Category (Android) | Medical |
| Age rating | 4+ / Everyone |
| Price | Free |
| Available regions | Israel (IL), United Kingdom (GB) — expand as needed |

---

## Short description (30 chars — Google Play)

```
Veterinary hospital operations
```

## Subtitle (30 chars — App Store only)

```
Equipment & task management
```

---

## Full description (4000 chars max)

```
VetTrack is the operations platform for veterinary hospitals.

Track every piece of equipment across rooms and wards in real time. Scan
barcodes and NFC tags to check equipment in and out, record sterilisation
dates, flag issues, and receive automated overdue alerts — all from your
phone.

EQUIPMENT TRACKING
• Real-time room-by-room equipment radar
• NFC and QR scan workflows for check-out and return
• Issue reporting with photo evidence
• Automatic expiry and maintenance reminders
• Asset Copilot explanations for equipment status

TASKS
• Unified task list for floor operations (appointments model)
• Assign, track, and complete operational tasks
• Role-based workflows for vets and technicians

INVENTORY & PROCUREMENT
• Live stock levels for containers and items
• Purchase orders and restock workflows
• Dispense events with audit trail

CODE BLUE & WARD BOARD
• Code Blue emergency session coordination (online-only mutations)
• Crash cart inventory checks
• Ward equipment board with realtime SSE updates

MULTI-CLINIC READY
• Single app serves multiple clinics with strict data isolation
• Role-based access: admin, vet, senior technician, technician, student
• Hebrew and English interfaces

RELIABILITY
• Progressive Web App technology — works on any browser
• Background sync resumes automatically after connectivity loss
• Push notifications for urgent tasks and return reminders

VetTrack is designed for busy veterinary teams who need instant answers
about where equipment is, who has it, and what's due next.
```

---

## Keywords

### App Store keywords (100 chars, comma-separated)

```
veterinary,vet,equipment,hospital,NFC,tracking,task,inventory,clinic,barcode
```

### Google Play tags (up to 5 from their fixed list)

- Health & Fitness
- Medical
- Business
- Tools
- Productivity

---

## Screenshots required

### App Store (required sizes)

| Device | Size | Count |
|--------|------|-------|
| iPhone 6.9" (Pro Max) | 1320 × 2868 px | ≥3, ≤10 |
| iPhone 6.7" | 1290 × 2796 px | ≥3 |
| iPad Pro 13" | 2064 × 2752 px | ≥3 |

### Google Play (required)

| Type | Size |
|------|------|
| Phone screenshots | 1080 × 1920 px minimum, ≥2, ≤8 |
| 7" tablet (optional) | 1200 × 1920 px |
| Feature graphic | 1024 × 500 px (JPG/PNG) |
| Icon | 512 × 512 px (PNG, no alpha) |

### Suggested screenshot sequence

1. Equipment radar — room grid with status indicators
2. Equipment detail — check-out flow with NFC scan
3. Task list — operational tasks with status chips
4. Task detail — assignment and completion flow
5. Code Blue session — emergency coordination view
6. Inventory dashboard — stock levels and restock
7. Home dashboard — shift summary and alerts

### Screenshot asset management

1. **Source directory:** store raw captures under `artifacts/mobile/screenshots/source/` (one PNG per sequence item above, named `01-equipment-radar.png` … `07-home-dashboard.png`).
2. **Batch resize:** use ImageMagick (or `scripts/mobile/generate-store-screenshots.sh`) to emit store-ready sizes into `artifacts/mobile/screenshots/generated/`:

   ```bash
   # Phone (1080×1920) — map each source to its sequence name
   magick artifacts/mobile/screenshots/source/01-equipment-radar.png \
     -resize 1080x1920^ -gravity center -extent 1080x1920 \
     artifacts/mobile/screenshots/generated/phone/01-equipment-radar.png
   ```

   Repeat for entries 02–07. For App Store 6.7" (1290×2796), change `-extent` to `1290x2796`.

3. **Capture configuration (reproduce each sequence entry):**

   | Sequence entry | Device / simulator | Screen to open |
   |----------------|-------------------|----------------|
   | 1. Equipment radar | iPhone 15 Pro / Pixel 7 | Ward or equipment room grid |
   | 2. Equipment detail | same | Equipment detail → check-out / NFC flow |
   | 3. Task list | same | `/equipment/tasks` task list |
   | 4. Task detail | same | Active task → completion flow |
   | 5. Code Blue session | same | `/code-blue` active session |
   | 6. Inventory dashboard | same | Inventory overview |
   | 7. Home dashboard | same | `/home` shift summary |

---

## App Store review notes (for human reviewer)

```
VetTrack is a professional veterinary hospital operations tool.

To review:
1. Sign in with the test credentials supplied in App Store Connect review
   notes (Clerk email/password). There is no "Guest / Demo" button on the
   login screen — dev builds without Clerk show a direct "כניסה ללוח הבקרה"
   link on /signin instead.
2. The NFC scanner requires a physical device with NFC — use the
   manual-entry fallback on the simulator. Native NFC uses @capgo/capacitor-nfc
   (see src/lib/nfc-platform.ts).
3. The camera feature requires VITE_FEATURE_CAMERA=true at build time and
   device camera permission — accept when prompted or use the library picker.
4. Code Blue (emergency) screens are accessible from the app navigation.
   Emergency mutations require an active network connection.
```

---

## Legal URLs (App Store Connect / Play Console)

| Field | URL | Live? |
|-------|-----|-------|
| Privacy policy | `https://vettrack.uk/privacy` | Verify after deploy |
| Terms of use | `https://vettrack.uk/terms` | Verify after deploy |
| Support | `https://vettrack.uk/support` | Verify after deploy |

See [../legal-pages.md](../legal-pages.md) for implementation status. Verify all three URLs in a browser without login after production deploy.

---

## Version history notes (for release notes / What's New)

### 1.0.1 — Build 20 (current)

```text
• Equipment-first operations: tracking, tasks, inventory, Code Blue
• Real-time ward board and offline-capable equipment workflows
• Hebrew and English interface
• Stability and App Store review fixes
```

### 1.0.0 — Initial release

```text
VetTrack 1.0 — veterinary hospital operations on your phone.

• Real-time equipment tracking with NFC and QR scanning
• Operational task management
• Code Blue emergency session coordination
• Offline-first equipment workflows
• Hebrew and English interface
```

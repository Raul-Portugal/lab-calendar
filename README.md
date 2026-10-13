# 🧪 LabCal - Laboratory & Biomedical Research Calendar

A modern, clutter-free calendar web application tailored for laboratory researchers, biomedical scientists, and academic project management.

Inspired by Google Calendar, LabCal provides specialized wet-lab features:
- **Chained Multi-Step / Multi-Day Protocols**: Pre-loaded Western Blot (2 days), PCR, RNA Extraction, Bacterial Transformation, plus an interactive Protocol Builder.
- **Three-Tier Drag & Drop Manipulation**:
  - **Normal Drag**: Move or resize an individual step.
  - **Shift + Drag**: Move the entire protocol group synchronously across hours and days.
  - **Ctrl / Cmd + Drag or Resize**: Cascade shift downstream steps while preserving relative gaps.
  - **Broken Chain Warning**: Visual indicator (`⚠️`) if a step is scheduled before its predecessor finishes.
- **Passive / Incubation Hatched Overlay**: Passive steps (blocking, incubation, gel polymerization) render with a distinctive hatched pattern and allow active benchwork blocks to overlap them.
- **Recurring Series & Exceptions**: Google Calendar-style recurring events (e.g. Wednesday Lab Meeting) with "This occurrence only" vs "All occurrences" editing.
- **Weekly Flexible Quotas**: Goal tracking (e.g. Thesis Writing 4h/week) with dynamic calculation, progress bars, and over-scheduling indicators.
- **RFC 5545 iCalendar (.ics) Export**: Strict CRLF, 75-octet folded iCalendar exporter.
- **Protocol Sharing**: Export and import custom protocols as `.protocol.json` to share with lab members.

---

## 🚀 Quick Start (Zero Setup)

Launch the application using the included local Python server:

```powershell
python server.py
```

This will automatically start the server at `http://127.0.0.1:8000` and open your default browser.

---

## 📱 Use Across Devices (PWA & Mobile Install)

LabCal is a fully offline-capable **Progressive Web App (PWA)**:
- **Desktop (Chrome / Edge / Safari)**: Click the **📲 Install App** button in the header (or the install icon in your browser's URL address bar) to install LabCal as a standalone desktop application.
- **iPad & iPhone (Safari)**: Open the URL, tap the **Share** button (`⎋`), and select **Add to Home Screen**.
- **Android (Chrome)**: Tap the three-dot menu and select **Install App** or **Add to Home screen**.

---

## ☁️ Safe Multi-Device Cloud Sync (24/7 Access)

LabCal operates **local-first** by default. To sync seamlessly across all your devices 24/7:

1. Click the **Cloud Sync** button in the top navigation bar.
2. Follow the 60-second guide:
   - Create a free project at [supabase.com](https://supabase.com).
   - Paste the 1-click SQL setup script into Supabase's SQL editor (enables Row-Level Security so only your authenticated user ID can access data).
   - Paste your Project URL and public `anon` key into the Database tab.
   - *(Optional & Recommended for Research)*: Enter an **Encryption Passphrase** to activate **Zero-Knowledge Client-Side Encryption (AES-GCM-256)**. All protocols, notes, and events are encrypted in your browser before transmission.
3. Sign in or create an account with your email. Your calendar will now automatically synchronize across your phone, tablet, lab workstation, and home laptop!

**How conflicts are handled:** sync never silently throws data away. If only the cloud changed, this device takes the cloud version; if only this device changed, it is uploaded. If **both** changed since the last sync (e.g. you edited offline on your laptop and on your phone), LabCal asks which version to keep and offers to download a backup of this device first. Taking the cloud version can be undone with <kbd>Ctrl</kbd> + <kbd>Z</kbd>. The first time a device connects to a cloud that already has data, you will be asked once which version to keep.

---

## 🌐 Free Public Web Hosting (Deploy to the Web)

To access LabCal from anywhere on HTTPS:
- **GitHub Pages**: Push this directory to a GitHub repository, go to **Settings -> Pages**, and select `main` branch.
- **Vercel / Cloudflare Pages / Netlify**: Connect the repository or drag-and-drop the project folder for instant global HTTPS hosting.


---

## 🧪 Built-in Protocols

### Western Blot (2 Days)
- **Day 1**:
  - 1. Hand Cast Gels (20 min active cast, 40 min passive polymerization)
  - 2. Prepare Samples (Lysate & Denature) (45 min, active)
  - 3. Load & Run SDS-PAGE (15 min active load, 105 min run)
  - 4. Rapid Transfer to Membrane (45 min, active)
  - 5. Total Protein Staining (Ponceau S) & Water Wash (15 min, active)
  - 6. Membrane Blocking (60 min, passive hatched block)
  - 7. Primary Antibody Incubation Setup (15 min active, overnight 4°C wait)
- **Day 2**:
  - 8. Washes (TBST 3x 10 min) (30 min active, Day 2 anchored at 09:00 AM)
  - 9. Secondary Antibody Incubation (60 min, passive hatched block)
  - 10. Final Washes & ChemiDoc Imaging (40 min, active)

---

## ⌨️ Shortcuts & Interactions

| Action | Shortcut / Gesture |
| :--- | :--- |
| **Move Single Step** | Click & drag event card |
| **Move Entire Protocol Group** | Hold <kbd>Shift</kbd> while dragging any step in the protocol |
| **Cascade Shift Downstream** | Hold <kbd>Ctrl</kbd> or <kbd>Cmd</kbd> while dragging or resizing a step |
| **Resize Duration** | Drag top or bottom handle on event card |
| **Split Event (in half / 3a, 3b)** | Right-click event -> **Split in Half** |
| **Duplicate Event** | Right-click event -> **Duplicate** |
| **Undo** | <kbd>Ctrl</kbd> + <kbd>Z</kbd> |
| **Redo** | <kbd>Ctrl</kbd> + <kbd>Y</kbd> or <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> |
| **Search** | Top search bar filters by title, protocol name, or bench notes |
| **Overnight event** | Drag from a time slot into the next day's column, or set an end date in the event dialog |
| **Reorder protocol steps** | In the Protocol Builder, drag a step by its ⋮⋮ handle (or use ▲ / ▼) |

Events and protocol steps can run past midnight: e.g. a 20 h incubation started at 19:00 ends at 15:00 the next day, and is drawn on both days.

### Phones & tablets (touch)

| Action | Gesture |
| :--- | :--- |
| **Scroll** | Swipe up / down as usual |
| **Previous / next days** | Swipe left / right (phones open in the 3-day view; Day, Week and Month are in the header) |
| **Create event** | Long-press an empty time slot, drag to set the duration, release |
| **Move event** | Long-press the event, then drag it |
| **Event menu** (split, duplicate, protocol shift/cascade, delete) | Long-press the event and release without moving |
| **Place a protocol / goal / quick event** | Tap it in the sidebar, then tap a time slot (tap it again to cancel) |
| **All-day event (month view)** | Tap a day |

---

## 🧪 Running the Tests

Start the local server and open `http://127.0.0.1:8000/test.html`. The suite runs in the browser against an isolated storage key, so it never touches your real calendar data. Cloud sync is tested against a mocked Supabase API (no network calls).

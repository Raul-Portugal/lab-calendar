/**
 * Utility functions for Lab Calendar
 * Date manipulation, floating wall-clock time, collision layout, category colors, and RFC 5545 formatting
 */

// Generate unique IDs
export function generateId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 6)}`;
}

// Format Date object to YYYY-MM-DD (local calendar date, DST-safe)
export function formatDateKey(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Parse YYYY-MM-DD to Date object at local 00:00:00
export function parseDateKey(dateKey) {
  if (!dateKey) return new Date();
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

// Shift a dateKey by deltaDays using calendar date arithmetic (DST-immune)
export function shiftDateKey(dateKey, deltaDays) {
  const d = parseDateKey(dateKey);
  d.setDate(d.getDate() + deltaDays);
  return formatDateKey(d);
}

// Format time from minutes from midnight (0..1439) to "HH:MM"
export function minutesToTime(minutes) {
  const clamped = Math.max(0, Math.min(1439, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Convert "HH:MM" to minutes from midnight
export function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Format 12-hour or 24-hour display string
export function formatTimeDisplay(timeStr, use24Hour = false) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  if (use24Hour) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const period = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 === 0 ? 12 : h % 12;
  const displayM = m === 0 ? '' : `:${String(m).padStart(2, '0')}`;
  return `${displayH}${displayM} ${period}`;
}

// Format duration in minutes to human readable string (e.g., "1h 30m", "45 min")
export function formatDuration(durationMinutes) {
  const hours = Math.floor(durationMinutes / 60);
  const mins = durationMinutes % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

// Get Monday of the week for a given date
export function getMondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  // In JS: 0 is Sunday, 1 is Monday... 6 is Saturday.
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff, 0, 0, 0, 0);
}

// Get array of 7 Date objects for the week (Monday through Sunday)
export function getWeekDates(date) {
  const monday = getMondayOfWeek(date);
  const week = [];
  for (let i = 0; i < 7; i++) {
    const nextDay = new Date(monday);
    nextDay.setDate(monday.getDate() + i);
    week.push(nextDay);
  }
  return week;
}

// Check if two Date objects represent the same calendar day
export function isSameDay(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

// Snap minutes to 15-minute grid
export function snapToGrid(minutes, interval = 15) {
  return Math.round(minutes / interval) * interval;
}

// Clamp value between min and max
export function clamp(val, min, max) {
  return Math.max(min, Math.min(val, max));
}

// Month names and short day names
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export const DAY_NAMES_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Canonical Category Colors
export const CATEGORY_COLORS = {
  'Meeting': 'emerald',          // Collaborative: Meetings, Seminars
  'Protocol': 'ocean',           // Experimental: Wet-lab Protocols
  'Bench Work': 'ocean',         // Experimental: General Benchwork, Cell culture
  'Quota Task': 'lavender',      // Cognitive: Writing, Analysis, Reading
  'Instrumentation': 'amber',    // Equipment: Microscopy, FACS, Instruments
  'Lab Operations': 'rose'       // Maintenance: Reagents, Autoclave, Inventory
};

export function getCategoryDefaultColor(category) {
  return CATEGORY_COLORS[category] || 'ocean';
}

/**
 * Layout Engine for Google Calendar with Active / Passive Layering
 * Passive steps act as a backdrop layer (zIndex 5) and allow active events
 * on the same time slot to sit directly over them without being partitioned into tiny columns!
 */
export function computeEventLayout(events) {
  if (!events || events.length === 0) return [];

  // Separate active events from passive background events
  const passives = [];
  const actives = [];

  events.forEach((evt) => {
    const item = {
      ...evt,
      startMin: timeToMinutes(evt.startTime),
      endMin: timeToMinutes(evt.endTime),
      isPassive: evt.stepType === 'passive'
    };
    if (item.isPassive) {
      passives.push(item);
    } else {
      actives.push(item);
    }
  });

  const layoutResults = [];

  // 1. Passive events span full width as backdrop layer
  passives.forEach((p) => {
    layoutResults.push({
      id: p.id,
      colIndex: 0,
      totalCols: 1,
      startMin: p.startMin,
      endMin: p.endMin,
      isPassive: true,
      zIndex: 5
    });
  });

  // 2. Active events are partitioned among themselves
  if (actives.length > 0) {
    actives.sort((a, b) => {
      if (a.startMin !== b.startMin) return a.startMin - b.startMin;
      return (b.endMin - b.startMin) - (a.endMin - a.startMin);
    });

    const clusters = [];
    let currentCluster = [];
    let clusterEnd = -1;

    for (const evt of actives) {
      if (currentCluster.length === 0) {
        currentCluster.push(evt);
        clusterEnd = evt.endMin;
      } else {
        if (evt.startMin < clusterEnd) {
          currentCluster.push(evt);
          clusterEnd = Math.max(clusterEnd, evt.endMin);
        } else {
          clusters.push(currentCluster);
          currentCluster = [evt];
          clusterEnd = evt.endMin;
        }
      }
    }
    if (currentCluster.length > 0) {
      clusters.push(currentCluster);
    }

    for (const cluster of clusters) {
      const columns = [];

      for (const evt of cluster) {
        let placed = false;
        for (let i = 0; i < columns.length; i++) {
          const lastEvt = columns[i][columns[i].length - 1];
          if (evt.startMin >= lastEvt.endMin) {
            columns[i].push(evt);
            evt.colIndex = i;
            placed = true;
            break;
          }
        }
        if (!placed) {
          columns.push([evt]);
          evt.colIndex = columns.length - 1;
        }
      }

      const totalCols = columns.length;
      for (const evt of cluster) {
        const overlapsPassive = passives.some(
          (p) => evt.startMin < p.endMin && evt.endMin > p.startMin
        );
        layoutResults.push({
          id: evt.id,
          colIndex: evt.colIndex,
          totalCols: totalCols,
          startMin: evt.startMin,
          endMin: evt.endMin,
          isPassive: false,
          zIndex: 15,
          overlapsPassive: overlapsPassive
        });
      }
    }
  }

  return layoutResults;
}

// Preset color palette
export const PALETTE = {
  emerald: { bg: '#e6f4ea', border: '#137333', text: '#0d5324', dot: '#34a853' }, // Green / Meetings, Seminars
  ocean: { bg: '#e8f0fe', border: '#1967d2', text: '#1557b0', dot: '#1a73e8' },   // Blue / Wet lab, Protocols
  lavender: { bg: '#f3e8fd', border: '#8430ce', text: '#6b21a8', dot: '#9334ea' }, // Purple / Cognitive, Quotas
  amber: { bg: '#fef7e0', border: '#b06000', text: '#8a4b00', dot: '#f2994a' },   // Orange / Instrumentation
  coral: { bg: '#fce8e6', border: '#c5221f', text: '#9a1614', dot: '#ea4335' },   // Red / Critical
  cyan: { bg: '#e1f5fe', border: '#0288d1', text: '#0277bd', dot: '#00acc1' },    // Teal / Buffer, Transfer
  rose: { bg: '#fce4ec', border: '#c2185b', text: '#ad1457', dot: '#e91e63' },    // Pink / Lab Ops, Reagents
  slate: { bg: '#f1f3f4', border: '#5f6368', text: '#3c4043', dot: '#5f6368' },   // Grey / General
};

export function getPaletteColor(name) {
  return PALETTE[name] || PALETTE.ocean;
}

// Restrict a color name to known palette keys (it is interpolated into class names and CSS vars)
export function safeColor(name, fallback = 'ocean') {
  return Object.prototype.hasOwnProperty.call(PALETTE, name) ? name : fallback;
}

/**
 * RFC 5545 Line Folding Helper (Folds at 75 octets with CRLF + space)
 */
export function foldIcsLine(line) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  // Count UTF-8 bytes, never splitting a multi-byte character (µ, °, emoji...)
  const parts = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75; // continuation lines: 1 space + 74 octets

  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    if (currentBytes + charBytes > limit) {
      parts.push(current);
      current = '';
      currentBytes = 0;
      limit = 74;
    }
    current += char;
    currentBytes += charBytes;
  }
  parts.push(current);

  return parts.map((part, i) => (i === 0 ? part : ' ' + part)).join('\r\n');
}

// Calculate whole days between two date keys (YYYY-MM-DD)
export function calculateDaysBetween(startDateKey, endDateKey) {
  if (!startDateKey || !endDateKey) return 0;
  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endDateKey);
  const diffTime = end.getTime() - start.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

// Escape HTML special characters for safe innerHTML injection
export function escapeHtml(str) {
  if (str === null || str === undefined || str === '') return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


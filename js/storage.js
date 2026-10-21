/**
 * Storage, Migration, Protocol Sharing & Strict RFC 5545 iCalendar Exporter
 * Implements schemaVersion: 2, migration pipeline, multi-tab sync, and protocol JSON sharing
 */

import { generateId, formatDateKey, getWeekDates, foldIcsLine, shiftDateKey, parseDateKey, isAllDayEvent } from './utils.js';
import { DEFAULT_QUOTAS } from './quotas.js';
import { firstOccurrence, ruleToRRule } from './recurrence.js';

const DEFAULT_STORAGE_KEY = 'lab_calendar_data_v2';
const CURRENT_SCHEMA_VERSION = 2;

/**
 * Resolve the localStorage key. The test suite sets window.__LABCAL_STORAGE_KEY__
 * before importing the store so it never touches the real calendar data.
 */
export function getStorageKey() {
  return (typeof window !== 'undefined' && window.__LABCAL_STORAGE_KEY__) || DEFAULT_STORAGE_KEY;
}

function isUsingDefaultStorageKey() {
  return getStorageKey() === DEFAULT_STORAGE_KEY;
}

/**
 * Initial Seed Data for fresh install
 */
export function getInitialSeedData() {
  const today = new Date();
  const weekDates = getWeekDates(today);

  // Tuesday of current week for sample thesis writing quota block
  const tuesdayKey = formatDateKey(weekDates[1]);
  // Sample series start on the Monday of the first install week
  const seriesFromKey = formatDateKey(weekDates[0]);

  // Recurring Series (Seed)
  const defaultSeries = [
    {
      id: 'series_lab_meeting',
      title: 'Lab Meeting & Project Updates',
      rule: { freq: 'WEEKLY', byDay: ['WE'] },
      startTime: '09:30',
      endTime: '12:00',
      from: seriesFromKey,
      until: null,
      color: 'emerald',
      category: 'Meeting',
      notes: 'Weekly lab group progress presentations in Seminar Room B / Zoom.'
    },
    {
      id: 'series_seminar',
      title: 'Department Seminar',
      rule: { freq: 'WEEKLY', byDay: ['FR'] },
      startTime: '15:00',
      endTime: '16:30',
      from: seriesFromKey,
      until: null,
      color: 'ocean',
      category: 'Meeting',
      notes: 'Invited speaker lecture, Main Auditorium.'
    }
  ];

  const defaultEvents = [
    // Thesis Writing allocation (Tuesday 14:00 - 16:00, 2h allocated towards 4h quota)
    {
      id: generateId('evt_quota'),
      title: 'Thesis Writing (Results Ch. 3)',
      dateKey: tuesdayKey,
      startTime: '14:00',
      endTime: '16:00',
      color: 'lavender',
      category: 'Quota Task',
      quotaId: 'quota_thesis',
      notes: 'Draft figures 3.2 and 3.3 narrative text.'
    }
  ];

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    series: defaultSeries,
    exceptions: [],
    events: defaultEvents,
    quotas: DEFAULT_QUOTAS,
    customProtocols: [],
    settings: {
      use24Hour: false,
      // All default categories visible (Lab Operations used to be missing, hiding its events)
      visibleCategories: ['Meeting', 'Protocol', 'Bench Work', 'Quota Task', 'Instrumentation', 'Lab Operations']
    }
  };
}

/**
 * Migration pipeline for backward compatibility
 */
export function migrateState(loadedData) {
  if (!loadedData || typeof loadedData !== 'object') {
    return getInitialSeedData();
  }

  // If already version 2
  if (loadedData.schemaVersion === 2) {
    return {
      schemaVersion: 2,
      series: loadedData.series || [],
      exceptions: loadedData.exceptions || [],
      events: loadedData.events || [],
      quotas: loadedData.quotas || DEFAULT_QUOTAS,
      customProtocols: loadedData.customProtocols || [],
      deletedProtocolIds: loadedData.deletedProtocolIds || [],
      quickClasses: loadedData.quickClasses,
      categories: loadedData.categories,
      settings: loadedData.settings || { use24Hour: false, visibleCategories: [] }
    };
  }

  // Migrate from v1
  console.log('Migrating Lab Calendar data to schemaVersion 2...');
  const seed = getInitialSeedData();
  const series = [...seed.series];
  const events = [];

  (loadedData.events || []).forEach((e) => {
    // If it was marked isRecurring in v1, series already covers it
    if (!e.isRecurring) {
      events.push(e);
    }
  });

  return {
    schemaVersion: 2,
    series: series,
    exceptions: [],
    events: events,
    quotas: loadedData.quotas || DEFAULT_QUOTAS,
    customProtocols: loadedData.customProtocols || [],
    quickClasses: loadedData.quickClasses,
    categories: loadedData.categories,
    settings: loadedData.settings || seed.settings
  };
}

/**
 * Load state from localStorage with migration
 */
export function loadStateFromStorage() {
  try {
    const raw = localStorage.getItem(getStorageKey()) ||
      (isUsingDefaultStorageKey() ? localStorage.getItem('lab_calendar_data_v1') : null);
    if (!raw) {
      const initial = getInitialSeedData();
      saveStateToStorage(initial);
      return initial;
    }
    const parsed = JSON.parse(raw);
    return migrateState(parsed);
  } catch (err) {
    console.warn('Failed to load storage, using seed data:', err);
    return getInitialSeedData();
  }
}

/**
 * Save state to localStorage
 */
export function saveStateToStorage(data) {
  try {
    const payload = {
      ...data,
      schemaVersion: CURRENT_SCHEMA_VERSION
    };
    localStorage.setItem(getStorageKey(), JSON.stringify(payload));
  } catch (err) {
    console.error('Failed to save to localStorage:', err);
  }
}

/**
 * Export complete backup to JSON
 */
export function exportStateToJson(data) {
  downloadTextFile(
    JSON.stringify(data, null, 2),
    `lab_calendar_backup_${new Date().toISOString().slice(0, 10)}.json`,
    'application/json'
  );
}

/**
 * Export single protocol template to shareable .protocol.json
 */
export function exportSingleProtocol(protocol) {
  const safeName = protocol.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  downloadTextFile(JSON.stringify(protocol, null, 2), `${safeName}.protocol.json`, 'application/json');
}

/**
 * Strict RFC 5545 iCalendar (.ics) Exporter
 * Implements CRLF line endings, 75-octet folding, character escaping, stable UIDs, DTSTAMP, and RRULE
 */
export function exportToIcs(events, seriesList = [], exceptions = [], fileLabel = '') {
  downloadTextFile(
    buildIcsContent(events, seriesList, exceptions),
    `lab_calendar_${fileLabel || new Date().toISOString().slice(0, 10)}.ics`,
    'text/calendar;charset=utf-8'
  );
}

function downloadTextFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const icsDate = (dateKey) => dateKey.replace(/-/g, '');
const icsTime = (time) => time.replace(':', '') + '00';

/**
 * Build RFC 5545 iCalendar text. Times are floating (local wall-clock), so UNTIL,
 * EXDATE and RECURRENCE-ID are floating too. Cancelled occurrences become EXDATEs and
 * modified occurrences become RECURRENCE-ID overrides of the series.
 */
export function buildIcsContent(events, seriesList = [], exceptions = []) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lab Calendar//BioSchedule Web App//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    // Suggested name when a calendar app creates a calendar for the import
    'X-WR-CALNAME:LabCal'
  ];

  const nowCompact = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';

  // 1. Export Recurring Series with RRULE
  (seriesList || []).forEach((s) => {
    const uid = `series-${s.id}@labcalendar.app`;
    // RFC 5545: DTSTART is the first real instance
    const firstKey = firstOccurrence(s.rule, s.from);
    const startCompact = icsTime(s.startTime);
    const endCompact = icsTime(s.endTime);

    let rrule = `RRULE:${ruleToRRule(s.rule, s.from)}`;
    if (s.until) {
      rrule += `;UNTIL=${icsDate(s.until)}T235959`;
    }

    const seriesExceptions = (exceptions || []).filter((e) => e.seriesId === s.id);

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${nowCompact}`);
    lines.push(`DTSTART:${icsDate(firstKey)}T${startCompact}`);
    lines.push(`DTEND:${icsDate(firstKey)}T${endCompact}`);
    lines.push(rrule);
    // Cancelled occurrences are excluded here; modified ones are overridden below via RECURRENCE-ID
    seriesExceptions.filter((e) => e.type === 'cancelled').forEach((e) => {
      lines.push(`EXDATE:${icsDate(e.occurrenceDate)}T${startCompact}`);
    });
    lines.push(`SUMMARY:${escapeIcsText(s.title)}`);
    if (s.notes) {
      lines.push(`DESCRIPTION:${escapeIcsText(s.notes)}`);
    }
    lines.push(`CATEGORIES:${escapeIcsText(s.category || 'Meeting')}`);
    lines.push('END:VEVENT');

    seriesExceptions.filter((e) => e.type === 'modified' && e.override).forEach((e) => {
      const o = e.override;
      const dateKey = o.dateKey || e.occurrenceDate;
      const notes = o.notes !== undefined ? o.notes : s.notes;
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${nowCompact}`);
      lines.push(`RECURRENCE-ID:${icsDate(e.occurrenceDate)}T${startCompact}`);
      lines.push(`DTSTART:${icsDate(dateKey)}T${icsTime(o.startTime || s.startTime)}`);
      lines.push(`DTEND:${icsDate(dateKey)}T${icsTime(o.endTime || s.endTime)}`);
      lines.push(`SUMMARY:${escapeIcsText(o.title || s.title)}`);
      if (notes) {
        lines.push(`DESCRIPTION:${escapeIcsText(notes)}`);
      }
      lines.push(`CATEGORIES:${escapeIcsText(o.category || s.category || 'Meeting')}`);
      lines.push('END:VEVENT');
    });
  });

  // 2. Export Standalone and Instantiated Protocol Events
  (events || []).forEach((evt) => {
    // Single occurrences of a recurring series (date-range exports) get a stable UID per
    // date, so re-importing the same week updates them instead of adding copies
    const uid = evt.isSeriesOccurrence
      ? `series-${evt.seriesId}-${evt.occurrenceDate}@labcalendar.app`
      : `event-${evt.id}@labcalendar.app`;

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${nowCompact}`);
    if (isAllDayEvent(evt)) {
      // DTEND is exclusive for all-day events
      const endKey = evt.endDateKey || evt.dateKey;
      lines.push(`DTSTART;VALUE=DATE:${icsDate(evt.dateKey)}`);
      lines.push(`DTEND;VALUE=DATE:${icsDate(shiftDateKey(endKey, 1))}`);
    } else {
      // Timed events may end on a later day (overnight incubations)
      lines.push(`DTSTART:${icsDate(evt.dateKey)}T${icsTime(evt.startTime)}`);
      lines.push(`DTEND:${icsDate(evt.endDateKey || evt.dateKey)}T${icsTime(evt.endTime)}`);
    }
    lines.push(`SUMMARY:${escapeIcsText(evt.title)}`);
    if (evt.notes) {
      lines.push(`DESCRIPTION:${escapeIcsText(evt.notes)}`);
    }
    const cat = evt.protocolName || evt.category || 'Wet Lab';
    lines.push(`CATEGORIES:${escapeIcsText(cat)}`);
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');

  // Format with CRLF (\r\n) and 75-octet line folding
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

function escapeIcsText(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

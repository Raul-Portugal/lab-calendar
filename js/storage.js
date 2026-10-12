/**
 * Storage, Migration, Protocol Sharing & Strict RFC 5545 iCalendar Exporter
 * Implements schemaVersion: 2, migration pipeline, multi-tab sync, and protocol JSON sharing
 */

import { generateId, formatDateKey, getWeekDates, foldIcsLine, shiftDateKey } from './utils.js';
import { BUILT_IN_PROTOCOLS } from './protocols.js';
import { DEFAULT_QUOTAS } from './quotas.js';

const STORAGE_KEY = 'lab_calendar_data_v2';
const CURRENT_SCHEMA_VERSION = 2;

/**
 * Initial Seed Data for fresh install
 */
export function getInitialSeedData() {
  const today = new Date();
  const weekDates = getWeekDates(today);

  // Tuesday of current week for sample thesis writing quota block
  const tuesdayKey = formatDateKey(weekDates[1]);
  // Thursday of current week for initial Western Blot showcase (avoids Wednesday lab meeting collision!)
  const thursdayKey = formatDateKey(weekDates[3]);

  // Recurring Series (Seed)
  const defaultSeries = [
    {
      id: 'series_lab_meeting',
      title: 'Lab Meeting & Project Updates',
      rule: { freq: 'WEEKLY', byDay: ['WE'] },
      startTime: '09:30',
      endTime: '12:00',
      from: '2026-09-01',
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
      from: '2026-09-01',
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
      visibleCategories: ['Meeting', 'Protocol', 'Bench Work', 'Quota Task', 'Instrumentation']
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
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('lab_calendar_data_v1');
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error('Failed to save to localStorage:', err);
  }
}

/**
 * Export complete backup to JSON
 */
export function exportStateToJson(data) {
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lab_calendar_backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export single protocol template to shareable .protocol.json
 */
export function exportSingleProtocol(protocol) {
  const jsonStr = JSON.stringify(protocol, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = protocol.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  a.download = `${safeName}.protocol.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Strict RFC 5545 iCalendar (.ics) Exporter
 * Implements CRLF line endings, 75-octet folding, character escaping, stable UIDs, DTSTAMP, and RRULE
 */
export function exportToIcs(events, seriesList = []) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lab Calendar//BioSchedule Web App//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];

  const nowCompact = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';

  // 1. Export Recurring Series with RRULE
  (seriesList || []).forEach((s) => {
    const uid = `series-${s.id}@labcalendar.app`;
    const fromCompact = s.from.replace(/-/g, '');
    const startCompact = s.startTime.replace(':', '') + '00';
    const endCompact = s.endTime.replace(':', '') + '00';

    const byDays = (s.rule?.byDay || ['WE']).join(',');
    let rrule = `RRULE:FREQ=${s.rule?.freq || 'WEEKLY'};BYDAY=${byDays}`;
    if (s.until) {
      rrule += `;UNTIL=${s.until.replace(/-/g, '')}T235959Z`;
    }

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${nowCompact}`);
    lines.push(`DTSTART:${fromCompact}T${startCompact}`);
    lines.push(`DTEND:${fromCompact}T${endCompact}`);
    lines.push(rrule);
    lines.push(`SUMMARY:${escapeIcsText(s.title)}`);
    if (s.notes) {
      lines.push(`DESCRIPTION:${escapeIcsText(s.notes)}`);
    }
    lines.push(`CATEGORIES:${escapeIcsText(s.category || 'Meeting')}`);
    lines.push('END:VEVENT');
  });

  // 2. Export Standalone and Instantiated Protocol Events
  (events || []).forEach((evt) => {
    // Skip virtual occurrences that belong to a series (series handles it via RRULE)
    if (evt.isSeriesOccurrence && !evt.isException) return;

    const uid = `event-${evt.id}@labcalendar.app`;
    const dateCompact = evt.dateKey.replace(/-/g, '');
    const startCompact = evt.startTime.replace(':', '') + '00';
    const endCompact = evt.endTime.replace(':', '') + '00';

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${nowCompact}`);
    if (evt.isAllDay) {
      const startCompact = evt.dateKey.replace(/-/g, '');
      const endKey = evt.endDateKey || evt.dateKey;
      const nextDayKey = shiftDateKey(endKey, 1);
      const endCompact = nextDayKey.replace(/-/g, '');
      lines.push(`DTSTART;VALUE=DATE:${startCompact}`);
      lines.push(`DTEND;VALUE=DATE:${endCompact}`);
    } else {
      const dateCompact = evt.dateKey.replace(/-/g, '');
      const startCompact = evt.startTime.replace(':', '') + '00';
      const endCompact = evt.endTime.replace(':', '') + '00';
      lines.push(`DTSTART:${dateCompact}T${startCompact}`);
      lines.push(`DTEND:${dateCompact}T${endCompact}`);
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
  const foldedLines = lines.map(foldIcsLine);
  const icsContent = foldedLines.join('\r\n') + '\r\n';

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lab_calendar_${new Date().toISOString().slice(0, 10)}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeIcsText(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

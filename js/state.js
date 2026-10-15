/**
 * Central Reactive State Store, Recurrence Expander & History Engine
 * Implements Series + Exceptions data model and derived step indexing
 */

import {
  generateId,
  parseDateKey,
  shiftDateKey,
  calculateDaysBetween,
  getEventSpan,
  getEventDayRange,
  spanToFields,
  isAllDayEvent
} from './utils.js';
import { loadStateFromStorage, saveStateToStorage, getStorageKey } from './storage.js';
import { BUILT_IN_PROTOCOLS, shiftProtocolGroup as shiftProtoEvents, cascadeShiftProtocolSteps, checkProtocolChainIntegrity } from './protocols.js';

const DAY_CODE_MAP = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// Notifications that only change what is displayed: nothing to persist
const VIEW_ONLY_CHANGES = new Set(['date_change', 'view_change', 'hover_change']);
// Notifications whose data did not originate from a local user edit (no cloud push)
const NON_LOCAL_CHANGES = new Set(['storage_sync', 'cloud_pull', 'filter_change', ...VIEW_ONLY_CHANGES]);

/**
 * True when a notification represents a local edit of calendar data that
 * should be marked as unsynced and pushed to the cloud.
 */
export function isLocalDataChange(changeType) {
  return !NON_LOCAL_CHANGES.has(changeType);
}

export const DEFAULT_QUICK_CLASSES = [
  { id: 'qc_lab_meeting', title: 'Lab Meeting', duration: 90, color: 'emerald', category: 'Meeting' },
  { id: 'qc_bench_work', title: 'Bench Work', duration: 120, color: 'ocean', category: 'Bench Work' },
  { id: 'qc_cell_culture', title: 'Cell Culture Passage', duration: 60, color: 'ocean', category: 'Bench Work' },
  { id: 'qc_microscopy', title: 'Confocal Microscopy', duration: 120, color: 'amber', category: 'Instrumentation' },
  { id: 'qc_facs', title: 'FACS / Flow Cytometry', duration: 90, color: 'amber', category: 'Instrumentation' },
  { id: 'qc_deep_work', title: 'Deep Work / Writing', duration: 120, color: 'lavender', category: 'Quota Task' },
  { id: 'qc_maintenance', title: 'Lab Maintenance / Reagents', duration: 60, color: 'rose', category: 'Lab Operations' }
];

export const DEFAULT_CATEGORIES = [
  { id: 'cat_meeting', name: 'Meeting', color: 'emerald' },
  { id: 'cat_protocol', name: 'Protocol', color: 'ocean' },
  { id: 'cat_bench_work', name: 'Bench Work', color: 'ocean' },
  { id: 'cat_quota_task', name: 'Quota Task', color: 'lavender' },
  { id: 'cat_instrumentation', name: 'Instrumentation', color: 'amber' },
  { id: 'cat_lab_operations', name: 'Lab Operations', color: 'rose' }
];

class StateStore {
  constructor() {
    const loaded = loadStateFromStorage();

    this.currentDate = new Date();
    this.currentView = 'week'; // 'week', 'day', 'month'
    this.events = loaded.events || [];
    this.series = loaded.series || [];
    this.exceptions = loaded.exceptions || [];
    this.quotas = loaded.quotas || [];
    this.customProtocols = loaded.customProtocols || [];
    this.deletedProtocolIds = new Set(loaded.deletedProtocolIds || []);
    this.quickClasses = loaded.quickClasses || DEFAULT_QUICK_CLASSES;
    this.categories = loaded.categories || DEFAULT_CATEGORIES;
    this.settings = loaded.settings || { use24Hour: false };
    
    this.selectedEventId = null;
    this.hoveredProtocolGroupId = null;
    this.searchQuery = '';
    this.visibleCategories = new Set(
      loaded.settings?.visibleCategories || this.categories.map(c => c.name)
    );

    // Multi-tab sync listener
    window.addEventListener('storage', (e) => {
      if (e.key === getStorageKey()) {
        this.applyData(loadStateFromStorage());
        this.notify('storage_sync');
      }
    });

    // Undo / Redo stacks
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = 100;

    this.listeners = new Set();
  }

  /**
   * Replace persisted data fields from a loaded / imported / synced snapshot.
   * Fields missing from the snapshot keep their current value.
   */
  applyData(data) {
    if (!data) return;
    if (Array.isArray(data.events)) this.events = data.events;
    if (Array.isArray(data.series)) this.series = data.series;
    if (Array.isArray(data.exceptions)) this.exceptions = data.exceptions;
    if (Array.isArray(data.quotas)) this.quotas = data.quotas;
    if (Array.isArray(data.customProtocols)) this.customProtocols = data.customProtocols;
    if (Array.isArray(data.deletedProtocolIds)) this.deletedProtocolIds = new Set(data.deletedProtocolIds);
    if (Array.isArray(data.quickClasses)) this.quickClasses = data.quickClasses;
    if (Array.isArray(data.categories)) this.categories = data.categories;
    if (data.settings && typeof data.settings === 'object') {
      this.settings = { ...this.settings, use24Hour: Boolean(data.settings.use24Hour) };
      if (Array.isArray(data.settings.visibleCategories)) {
        this.visibleCategories = new Set(data.settings.visibleCategories);
      }
    }
  }

  // Subscribe to state mutations
  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify(changeType = 'update') {
    if (!VIEW_ONLY_CHANGES.has(changeType)) {
      this.persist();
    }
    for (const cb of this.listeners) {
      cb(changeType, this);
    }
  }

  persist() {
    saveStateToStorage({
      series: this.series,
      exceptions: this.exceptions,
      events: this.events,
      quotas: this.quotas,
      customProtocols: this.customProtocols,
      deletedProtocolIds: Array.from(this.deletedProtocolIds),
      quickClasses: this.quickClasses,
      categories: this.categories,
      settings: {
        use24Hour: this.settings.use24Hour,
        visibleCategories: Array.from(this.visibleCategories)
      }
    });
  }

  // Push snapshot strictly on user action completion (e.g. pointerup)
  pushHistorySnapshot(actionDescription = 'Change') {
    const snapshot = {
      series: JSON.parse(JSON.stringify(this.series)),
      exceptions: JSON.parse(JSON.stringify(this.exceptions)),
      events: JSON.parse(JSON.stringify(this.events)),
      quotas: JSON.parse(JSON.stringify(this.quotas)),
      customProtocols: JSON.parse(JSON.stringify(this.customProtocols)),
      deletedProtocolIds: Array.from(this.deletedProtocolIds),
      quickClasses: JSON.parse(JSON.stringify(this.quickClasses)),
      categories: JSON.parse(JSON.stringify(this.categories)),
      description: actionDescription
    };
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    const current = {
      series: JSON.parse(JSON.stringify(this.series)),
      exceptions: JSON.parse(JSON.stringify(this.exceptions)),
      events: JSON.parse(JSON.stringify(this.events)),
      quotas: JSON.parse(JSON.stringify(this.quotas)),
      customProtocols: JSON.parse(JSON.stringify(this.customProtocols)),
      deletedProtocolIds: Array.from(this.deletedProtocolIds),
      quickClasses: JSON.parse(JSON.stringify(this.quickClasses)),
      categories: JSON.parse(JSON.stringify(this.categories)),
      description: 'Current State'
    };
    this.redoStack.push(current);

    const prev = this.undoStack.pop();
    this.series = prev.series;
    this.exceptions = prev.exceptions;
    this.events = prev.events;
    this.quotas = prev.quotas;
    this.customProtocols = prev.customProtocols;
    if (prev.deletedProtocolIds) this.deletedProtocolIds = new Set(prev.deletedProtocolIds);
    if (prev.quickClasses) this.quickClasses = prev.quickClasses;
    if (prev.categories) this.categories = prev.categories;
    this.notify('undo');
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    const current = {
      series: JSON.parse(JSON.stringify(this.series)),
      exceptions: JSON.parse(JSON.stringify(this.exceptions)),
      events: JSON.parse(JSON.stringify(this.events)),
      quotas: JSON.parse(JSON.stringify(this.quotas)),
      customProtocols: JSON.parse(JSON.stringify(this.customProtocols)),
      deletedProtocolIds: Array.from(this.deletedProtocolIds),
      quickClasses: JSON.parse(JSON.stringify(this.quickClasses)),
      categories: JSON.parse(JSON.stringify(this.categories)),
      description: 'Current State'
    };
    this.undoStack.push(current);

    const next = this.redoStack.pop();
    this.series = next.series;
    this.exceptions = next.exceptions;
    this.events = next.events;
    this.quotas = next.quotas;
    this.customProtocols = next.customProtocols;
    if (next.deletedProtocolIds) this.deletedProtocolIds = new Set(next.deletedProtocolIds);
    if (next.quickClasses) this.quickClasses = next.quickClasses;
    if (next.categories) this.categories = next.categories;
    this.notify('redo');
    return true;
  }

  // Navigation
  setDate(date) {
    this.currentDate = new Date(date);
    this.notify('date_change');
  }

  navigate(direction) {
    if (direction === 0) {
      this.currentDate = new Date();
    } else {
      const d = new Date(this.currentDate);
      if (this.currentView === 'day') {
        d.setDate(d.getDate() + direction);
      } else if (this.currentView === '3day') {
        d.setDate(d.getDate() + direction * 3);
      } else if (this.currentView === 'week') {
        d.setDate(d.getDate() + (direction * 7));
      } else if (this.currentView === 'month') {
        // Clamp the day so e.g. Jan 31 -> Feb 28 instead of overflowing into March
        const target = new Date(d.getFullYear(), d.getMonth() + direction, 1);
        const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
        d.setFullYear(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), lastDay));
      }
      this.currentDate = d;
    }
    this.notify('date_change');
  }

  setView(view) {
    if (['week', '3day', 'day', 'month'].includes(view)) {
      this.currentView = view;
      this.notify('view_change');
    }
  }

  setSearchQuery(q) {
    this.searchQuery = (q || '').trim().toLowerCase();
    this.notify('filter_change');
  }

  toggleCategory(category) {
    if (this.visibleCategories.has(category)) {
      this.visibleCategories.delete(category);
    } else {
      this.visibleCategories.add(category);
    }
    this.notify('filter_change');
  }

  // Hover highlighting is applied directly to the DOM by the renderer (no full re-render)
  setHoveredProtocolGroup(groupId) {
    this.hoveredProtocolGroupId = groupId;
  }

  seriesOccursOn(s, dateKey) {
    const dayCode = DAY_CODE_MAP[parseDateKey(dateKey).getDay()];
    if (!s.rule?.byDay?.includes(dayCode)) return false;
    if (s.from && dateKey < s.from) return false;
    if (s.until && dateKey > s.until) return false;
    return true;
  }

  /**
   * The rendered event for one occurrence of a series (with its exception applied),
   * or null if the series does not occur on that date or the occurrence is cancelled.
   */
  buildSeriesOccurrence(s, occurrenceDate) {
    if (!this.seriesOccursOn(s, occurrenceDate)) return null;

    const exc = this.exceptions.find((e) => e.seriesId === s.id && e.occurrenceDate === occurrenceDate);
    if (exc?.type === 'cancelled') return null;

    const base = {
      seriesId: s.id,
      occurrenceDate,
      isSeriesOccurrence: true,
      title: s.title,
      dateKey: occurrenceDate,
      startTime: s.startTime,
      endTime: s.endTime,
      color: s.color,
      category: s.category,
      notes: s.notes
    };

    if (exc?.type === 'modified' && exc.override) {
      const o = exc.override;
      return {
        ...base,
        id: `${s.id}_${occurrenceDate}_exc`,
        isException: true,
        title: o.title || s.title,
        dateKey: o.dateKey || occurrenceDate,
        startTime: o.startTime || s.startTime,
        endTime: o.endTime || s.endTime,
        color: o.color || s.color,
        category: o.category || s.category,
        notes: o.notes !== undefined ? o.notes : s.notes
      };
    }

    return { ...base, id: `${s.id}_${occurrenceDate}`, isException: false };
  }

  /**
   * Recurrence Expansion: Generates rendered events for dates in the range,
   * applying exceptions, derived step indices, and broken chain warnings.
   */
  getExpandedEventsForRange(dateKeysList) {
    const dateKeySet = new Set(dateKeysList);
    const resultEvents = [];

    // 1. Expand Recurring Series
    dateKeysList.forEach((dateKey) => {
      this.series.forEach((s) => {
        const occurrence = this.buildSeriesOccurrence(s, dateKey);
        if (occurrence) resultEvents.push(occurrence);
      });
    });

    // 1b. Occurrences moved INTO this range from a date outside it ("this occurrence" moves)
    this.exceptions.forEach((exc) => {
      const movedTo = exc.type === 'modified' && exc.override?.dateKey;
      if (!movedTo || !dateKeySet.has(movedTo) || dateKeySet.has(exc.occurrenceDate)) return;
      const s = this.series.find((item) => item.id === exc.seriesId);
      const occurrence = s && this.buildSeriesOccurrence(s, exc.occurrenceDate);
      if (occurrence) resultEvents.push(occurrence);
    });

    // 2. Add regular scheduled events within the range (including multi-day spans)
    const minDateKey = dateKeysList[0];
    const maxDateKey = dateKeysList[dateKeysList.length - 1];

    this.events.forEach((evt) => {
      const { firstKey, lastKey } = getEventDayRange(evt);
      if (firstKey <= maxDateKey && lastKey >= minDateKey) {
        resultEvents.push(evt);
      }
    });

    // 3. Compute Dynamic Step Labels ("Step X of N", "3a / 3b") & Chain Integrity
    // Group all events in result by protocolGroupId
    const protocolGroups = new Map();
    resultEvents.forEach((evt) => {
      if (evt.protocolGroupId) {
        if (!protocolGroups.has(evt.protocolGroupId)) {
          // Find ALL events in the store for this protocol group so total step count is accurate
          const allGroupEvents = this.events
            .filter((e) => e.protocolGroupId === evt.protocolGroupId)
            .sort((a, b) => getEventSpan(a).startAbs - getEventSpan(b).startAbs);
          protocolGroups.set(evt.protocolGroupId, allGroupEvents);
        }
      }
    });

    // Compute labels and broken chain flags without mutating stored events
    const derivedById = new Map();
    protocolGroups.forEach((allGroupEvents, groupId) => {
      const brokenSteps = checkProtocolChainIntegrity(allGroupEvents, groupId);
      const totalCount = allGroupEvents.length;

      allGroupEvents.forEach((stepEvt, idx) => {
        let label = `Step ${idx + 1} of ${totalCount}`;
        if (stepEvt.isSplitHalf) {
          label = `Step ${stepEvt.splitLabel || `${idx + 1}`}`;
        }
        derivedById.set(stepEvt.id, {
          derivedStepLabel: label,
          hasBrokenChainWarning: brokenSteps.has(stepEvt.id)
        });
      });
    });

    return resultEvents.map((evt) => {
      const derived = derivedById.get(evt.id);
      return derived ? { ...evt, ...derived } : evt;
    });
  }

  // Event Mutations
  addEvent(event) {
    this.pushHistorySnapshot(`Add event "${event.title}"`);
    this.events.push(event);
    this.notify('event_added');
  }

  addEvents(eventArray, description = 'Add events') {
    this.pushHistorySnapshot(description);
    this.events.push(...eventArray);
    this.notify('events_added');
  }

  updateEvent(id, updates) {
    const idx = this.events.findIndex((e) => e.id === id);
    if (idx === -1) return;
    this.pushHistorySnapshot(`Update event "${this.events[idx].title}"`);
    this.events[idx] = { ...this.events[idx], ...updates };
    this.notify('event_updated');
  }

  deleteEvent(id) {
    const idx = this.events.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const deleted = this.events[idx];
    this.pushHistorySnapshot(`Delete event "${deleted.title}"`);
    this.events.splice(idx, 1);
    if (this.selectedEventId === id) this.selectedEventId = null;
    this.notify('event_deleted');
  }

  deleteProtocolGroup(groupId) {
    this.pushHistorySnapshot(`Delete protocol group`);
    this.events = this.events.filter((e) => e.protocolGroupId !== groupId);
    this.notify('protocol_group_deleted');
  }

  // Split event: creates "3a" and "3b" if chained, or two equal blocks
  splitEvent(id) {
    const target = this.events.find((e) => e.id === id);
    if (!target || isAllDayEvent(target)) return;

    const { startAbs, endAbs } = getEventSpan(target);
    if (endAbs - startAbs < 20) return;
    const midAbs = startAbs + Math.floor((endAbs - startAbs) / 2);

    this.pushHistorySnapshot(`Split event "${target.title}"`);

    // First half
    Object.assign(target, spanToFields(startAbs, midAbs));
    if (target.isChained) {
      target.isSplitHalf = true;
      target.splitLabel = 'Part A';
    }

    // Second half
    const part2 = {
      ...JSON.parse(JSON.stringify(target)),
      id: generateId('evt_split'),
      ...spanToFields(midAbs, endAbs),
      title: `${target.title} (Part B)`,
      isSplitHalf: target.isChained,
      splitLabel: 'Part B'
    };

    this.events.push(part2);
    this.notify('event_split');
  }

  // Duplicate event: creates detached copy
  duplicateEvent(id) {
    const target = this.events.find((e) => e.id === id);
    if (!target) return;

    this.pushHistorySnapshot(`Duplicate event "${target.title}"`);

    const clone = {
      ...JSON.parse(JSON.stringify(target)),
      id: generateId('evt_clone'),
      title: `${target.title} (Copy)`
    };
    // Timed copies go right after the original (possibly into the next day)
    if (!isAllDayEvent(target)) {
      const { startAbs, endAbs } = getEventSpan(target);
      Object.assign(clone, spanToFields(endAbs, endAbs + (endAbs - startAbs)));
    }

    // Detach from protocol group to ensure independent behavior
    delete clone.protocolGroupId;
    delete clone.isChained;
    delete clone.isSplitHalf;

    this.events.push(clone);
    this.notify('event_duplicated');
  }

  // Shift protocol group (Shift + Drag)
  shiftProtocolGroup(groupId, deltaDays, deltaMinutes) {
    if (!groupId) return;
    this.pushHistorySnapshot(`Shift entire protocol run`);
    this.events = shiftProtoEvents(this.events, groupId, deltaDays, deltaMinutes);
    this.notify('protocol_group_shifted');
  }

  // Cascade shift protocol steps (Ctrl / Cmd + Drag)
  cascadeShiftProtocolSteps(groupId, targetStepId, deltaDays, deltaMinutes) {
    if (!groupId || !targetStepId) return;
    this.pushHistorySnapshot(`Cascade shift protocol steps`);
    this.events = cascadeShiftProtocolSteps(this.events, groupId, targetStepId, deltaDays, deltaMinutes);
    this.notify('protocol_group_cascaded');
  }

  // Resize a protocol step and push only the steps after it by the change in end time (Ctrl + resize)
  resizeStepAndCascade(stepId, updates, deltaMinutes) {
    const idx = this.events.findIndex((e) => e.id === stepId);
    if (idx === -1) return;
    const step = this.events[idx];
    this.pushHistorySnapshot(`Resize "${step.title}" and cascade`);
    this.events[idx] = { ...step, ...updates };
    if (step.protocolGroupId && deltaMinutes) {
      this.events = cascadeShiftProtocolSteps(this.events, step.protocolGroupId, stepId, 0, deltaMinutes, false);
    }
    this.notify('protocol_group_cascaded');
  }

  // Series Finder (exact id only: a prefix match could pick the wrong series)
  findSeries(seriesId) {
    if (!seriesId) return null;
    return this.series.find((s) => s.id === seriesId) || null;
  }

  /**
   * Turn occurrence-level edits into series-level fields. A move to another day becomes a
   * weekday shift of the recurrence rule; all-day fields are not supported on series.
   */
  toSeriesUpdates(seriesItem, occurrenceDate, updates) {
    const { dateKey, endDateKey, isAllDay, ...rest } = updates;
    const dayShift = dateKey ? calculateDaysBetween(occurrenceDate, dateKey) : 0;
    if (dayShift !== 0 && seriesItem.rule?.byDay) {
      const shifted = seriesItem.rule.byDay.map((code) => {
        const idx = DAY_CODE_MAP.indexOf(code);
        return idx === -1 ? code : DAY_CODE_MAP[(((idx + dayShift) % 7) + 7) % 7];
      });
      rest.rule = { ...seriesItem.rule, byDay: [...new Set(shifted)] };
    }
    return { updates: rest, dayShift };
  }

  // Series Mutations (Series + Exceptions)
  modifySeriesOccurrence(seriesId, occurrenceDate, updates, mode = 'this') {
    const seriesItem = this.findSeries(seriesId);
    if (!seriesItem) return;
    const actualSeriesId = seriesItem.id;

    this.pushHistorySnapshot(`Modify series occurrence (${mode})`);

    if (mode === 'this') {
      // Modify this occurrence only -> SeriesException
      const excIdx = this.exceptions.findIndex(
        (e) => e.seriesId === actualSeriesId && e.occurrenceDate === occurrenceDate
      );
      if (excIdx >= 0) {
        this.exceptions[excIdx].override = { ...this.exceptions[excIdx].override, ...updates };
      } else {
        this.exceptions.push({
          id: generateId('exc'),
          seriesId: actualSeriesId,
          occurrenceDate: occurrenceDate,
          type: 'modified',
          override: updates
        });
      }
    } else if (mode === 'all') {
      // Modify all events in series
      const { updates: seriesUpdates } = this.toSeriesUpdates(seriesItem, occurrenceDate, updates);
      Object.assign(seriesItem, seriesUpdates);
    } else if (mode === 'following') {
      // Modify this and following events: end the old series, start a new one
      const { updates: seriesUpdates, dayShift } = this.toSeriesUpdates(seriesItem, occurrenceDate, updates);
      const originalUntil = seriesItem.until;
      seriesItem.until = shiftDateKey(occurrenceDate, -1);

      const newFrom = dayShift < 0 ? shiftDateKey(occurrenceDate, dayShift) : occurrenceDate;
      const newSeries = {
        ...JSON.parse(JSON.stringify(seriesItem)),
        id: generateId('series'),
        from: newFrom,
        until: originalUntil || null,
        ...seriesUpdates
      };
      this.series.push(newSeries);

      // Exceptions after the split belong to occurrences that no longer exist in the old series
      this.exceptions = this.exceptions.filter(
        (e) => !(e.seriesId === actualSeriesId && e.occurrenceDate >= occurrenceDate)
      );
    }

    this.notify('series_updated');
  }

  deleteSeriesOccurrence(seriesId, occurrenceDate, mode = 'this') {
    const seriesItem = this.findSeries(seriesId);
    if (!seriesItem) return;
    const actualSeriesId = seriesItem.id;

    this.pushHistorySnapshot(`Delete series occurrence (${mode})`);

    if (mode === 'this') {
      // Cancel this occurrence only
      // Remove any prior modified exception for this occurrence
      this.exceptions = this.exceptions.filter(
        (e) => !(e.seriesId === actualSeriesId && e.occurrenceDate === occurrenceDate)
      );
      this.exceptions.push({
        id: generateId('exc'),
        seriesId: actualSeriesId,
        occurrenceDate: occurrenceDate,
        type: 'cancelled'
      });
      // Also remove any standalone event cached with this series id & date
      this.events = this.events.filter(
        (e) => !(e.seriesId === actualSeriesId && (e.occurrenceDate === occurrenceDate || e.dateKey === occurrenceDate))
      );
    } else if (mode === 'all') {
      // Delete whole series
      this.series = this.series.filter((s) => s.id !== actualSeriesId);
      this.exceptions = this.exceptions.filter((e) => e.seriesId !== actualSeriesId);
      this.events = this.events.filter((e) => e.seriesId !== actualSeriesId);
    } else if (mode === 'following') {
      // Stop series before this occurrence
      const prevDate = shiftDateKey(occurrenceDate, -1);
      seriesItem.until = prevDate;
      this.exceptions = this.exceptions.filter(
        (e) => !(e.seriesId === actualSeriesId && e.occurrenceDate >= occurrenceDate)
      );
      this.events = this.events.filter(
        (e) => !(e.seriesId === actualSeriesId && e.dateKey >= occurrenceDate)
      );
    }

    this.notify('series_deleted');
  }

  // Protocols (Built-in + Custom)
  getAllProtocols() {
    const all = [...BUILT_IN_PROTOCOLS, ...this.customProtocols];
    return all.filter((p) => !this.deletedProtocolIds.has(p.id));
  }

  addCustomProtocol(protocol) {
    this.addCustomProtocols([protocol]);
  }

  // One undo step for importing several protocols at once
  addCustomProtocols(protocols) {
    if (protocols.length === 0) return;
    this.pushHistorySnapshot(protocols.length === 1
      ? `Create protocol "${protocols[0].name}"`
      : `Import ${protocols.length} protocols`);
    this.customProtocols.push(...protocols);
    this.notify('protocol_created');
  }

  updateCustomProtocol(protocolId, updates) {
    const proto = this.customProtocols.find((p) => p.id === protocolId);
    if (!proto) return;
    this.pushHistorySnapshot(`Update protocol "${proto.name}"`);
    Object.assign(proto, updates);
    this.notify('protocol_updated');
  }

  deleteProtocol(protocolId) {
    const proto = this.getAllProtocols().find((p) => p.id === protocolId);
    this.pushHistorySnapshot(`Delete protocol "${proto?.name || 'Protocol'}"`);
    this.deletedProtocolIds.add(protocolId);
    this.customProtocols = this.customProtocols.filter((p) => p.id !== protocolId);
    this.notify('protocol_deleted');
  }

  deleteCustomProtocol(protocolId) {
    this.deleteProtocol(protocolId);
  }

  // Quotas
  addQuota(quota) {
    this.pushHistorySnapshot(`Add quota "${quota.title}"`);
    this.quotas.push(quota);
    this.notify('quota_added');
  }

  updateQuota(quotaId, updates) {
    const q = this.quotas.find((item) => item.id === quotaId);
    if (!q) return;
    this.pushHistorySnapshot(`Update quota "${q.title}"`);
    Object.assign(q, updates);
    this.notify('quota_updated');
  }

  deleteQuota(quotaId) {
    this.pushHistorySnapshot(`Delete quota`);
    this.quotas = this.quotas.filter((q) => q.id !== quotaId);
    this.events.forEach((evt) => {
      if (evt.quotaId === quotaId) {
        delete evt.quotaId;
      }
    });
    this.notify('quota_deleted');
  }

  // Quick Event Classes
  addQuickClass(quickClass) {
    this.pushHistorySnapshot(`Add quick class "${quickClass.title}"`);
    this.quickClasses.push(quickClass);
    this.notify('quick_class_added');
  }

  updateQuickClass(id, updates) {
    const qc = this.quickClasses.find((c) => c.id === id);
    if (!qc) return;
    this.pushHistorySnapshot(`Update quick class "${qc.title}"`);
    Object.assign(qc, updates);
    this.notify('quick_class_updated');
  }

  deleteQuickClass(id) {
    this.pushHistorySnapshot(`Delete quick class`);
    this.quickClasses = this.quickClasses.filter((c) => c.id !== id);
    this.notify('quick_class_deleted');
  }

  // Filter Calendars / Categories
  hasCategoryNamed(name, exceptName = null) {
    const lower = name.toLowerCase();
    return this.categories.some((c) => c.name !== exceptName && c.name.toLowerCase() === lower);
  }

  /**
   * Add a category { name, color }. Returns false if the name is empty or already used.
   */
  addCategory({ name, color = 'ocean' } = {}) {
    const trimmed = (name || '').trim();
    if (!trimmed || this.hasCategoryNamed(trimmed)) return false;
    this.pushHistorySnapshot(`Add category "${trimmed}"`);
    this.categories.push({ id: generateId('cat'), name: trimmed, color: color });
    this.visibleCategories.add(trimmed);
    this.notify('category_added');
    return true;
  }

  /**
   * Rename / recolor a category and carry the rename over to everything that references it.
   * Returns false if the new name collides with another category.
   */
  updateCategory(oldName, { name, color } = {}) {
    const cat = this.categories.find((c) => c.name === oldName);
    if (!cat) return false;
    const trimmed = (name || '').trim() || oldName;
    if (this.hasCategoryNamed(trimmed, oldName)) return false;

    this.pushHistorySnapshot(`Update category "${oldName}"`);
    cat.name = trimmed;
    if (color) cat.color = color;

    if (this.visibleCategories.has(oldName)) {
      this.visibleCategories.delete(oldName);
      this.visibleCategories.add(trimmed);
    }

    const rename = (item) => {
      if (item.category === oldName) item.category = trimmed;
    };
    this.events.forEach(rename);
    this.series.forEach(rename);
    this.quickClasses.forEach(rename);
    this.quotas.forEach((q) => {
      if (Array.isArray(q.categories)) {
        q.categories = q.categories.map((c) => (c === oldName ? trimmed : c));
      }
    });

    this.notify('category_updated');
    return true;
  }

  deleteCategory(name) {
    this.pushHistorySnapshot(`Delete category "${name}"`);
    this.categories = this.categories.filter((c) => c.name !== name);
    this.visibleCategories.delete(name);
    this.notify('category_deleted');
  }
}

export const store = new StateStore();

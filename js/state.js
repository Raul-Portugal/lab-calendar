/**
 * Central Reactive State Store, Recurrence Expander & History Engine
 * Implements Series + Exceptions data model and derived step indexing
 */

import { generateId, timeToMinutes, minutesToTime, formatDateKey, parseDateKey, shiftDateKey } from './utils.js';
import { loadStateFromStorage, saveStateToStorage } from './storage.js';
import { BUILT_IN_PROTOCOLS, shiftProtocolGroup as shiftProtoEvents, cascadeShiftProtocolSteps, checkProtocolChainIntegrity } from './protocols.js';

const DAY_CODE_MAP = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

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
      if (e.key === 'lab_calendar_data_v2') {
        const reloaded = loadStateFromStorage();
        this.events = reloaded.events;
        this.series = reloaded.series;
        this.exceptions = reloaded.exceptions;
        this.quotas = reloaded.quotas;
        this.customProtocols = reloaded.customProtocols;
        this.deletedProtocolIds = new Set(reloaded.deletedProtocolIds || []);
        this.notify('storage_sync');
      }
    });

    // Undo / Redo stacks
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = 100;

    this.listeners = new Set();
  }

  // Subscribe to state mutations
  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify(changeType = 'update') {
    this.persist();
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
      } else if (this.currentView === 'week') {
        d.setDate(d.getDate() + (direction * 7));
      } else if (this.currentView === 'month') {
        d.setMonth(d.getMonth() + direction);
      }
      this.currentDate = d;
    }
    this.notify('date_change');
  }

  setView(view) {
    if (['week', 'day', 'month'].includes(view)) {
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

  setHoveredProtocolGroup(groupId) {
    if (this.hoveredProtocolGroupId !== groupId) {
      this.hoveredProtocolGroupId = groupId;
      this.notify('hover_change');
    }
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
      const d = parseDateKey(dateKey);
      const dayCode = DAY_CODE_MAP[d.getDay()];

      this.series.forEach((s) => {
        // Check rule matches day of week
        if (!s.rule?.byDay?.includes(dayCode)) return;

        // Check date is within series range
        if (dateKey < s.from) return;
        if (s.until && dateKey > s.until) return;

        // Check if an exception exists for this occurrence
        const exc = this.exceptions.find((e) => e.seriesId === s.id && e.occurrenceDate === dateKey);
        if (exc) {
          if (exc.type === 'cancelled') {
            // Cancelled occurrence: skip
            return;
          } else if (exc.type === 'modified' && exc.override) {
            // Modified occurrence
            resultEvents.push({
              id: `${s.id}_${dateKey}_exc`,
              seriesId: s.id,
              occurrenceDate: dateKey,
              isSeriesOccurrence: true,
              isException: true,
              title: exc.override.title || s.title,
              dateKey: exc.override.dateKey || dateKey,
              startTime: exc.override.startTime || s.startTime,
              endTime: exc.override.endTime || s.endTime,
              color: exc.override.color || s.color,
              category: s.category,
              notes: exc.override.notes !== undefined ? exc.override.notes : s.notes
            });
            return;
          }
        }

        // Normal unmodified occurrence
        resultEvents.push({
          id: `${s.id}_${dateKey}`,
          seriesId: s.id,
          occurrenceDate: dateKey,
          isSeriesOccurrence: true,
          isException: false,
          title: s.title,
          dateKey: dateKey,
          startTime: s.startTime,
          endTime: s.endTime,
          color: s.color,
          category: s.category,
          notes: s.notes
        });
      });
    });

    // 2. Add regular scheduled events within the range (including multi-day spans)
    const minDateKey = dateKeysList[0];
    const maxDateKey = dateKeysList[dateKeysList.length - 1];

    this.events.forEach((evt) => {
      const startKey = evt.dateKey;
      const endKey = evt.endDateKey || evt.dateKey;
      if (dateKeySet.has(startKey) || (startKey <= maxDateKey && endKey >= minDateKey)) {
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
            .sort((a, b) => {
              if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
              return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
            });
          protocolGroups.set(evt.protocolGroupId, allGroupEvents);
        }
      }
    });

    // Assign labels and broken chain flags
    protocolGroups.forEach((allGroupEvents, groupId) => {
      const brokenSteps = checkProtocolChainIntegrity(allGroupEvents, groupId);
      const totalCount = allGroupEvents.length;

      allGroupEvents.forEach((stepEvt, idx) => {
        let label = `Step ${idx + 1} of ${totalCount}`;
        if (stepEvt.isSplitHalf) {
          label = `Step ${stepEvt.splitLabel || `${idx + 1}`}`;
        }
        stepEvt.derivedStepLabel = label;
        stepEvt.hasBrokenChainWarning = brokenSteps.has(stepEvt.id);
      });
    });

    return resultEvents;
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
    if (!target) return;

    const startMin = timeToMinutes(target.startTime);
    const endMin = timeToMinutes(target.endTime);
    const duration = endMin - startMin;
    if (duration < 20) return;

    const half = Math.floor(duration / 2);
    const midMin = startMin + half;

    this.pushHistorySnapshot(`Split event "${target.title}"`);

    // First half
    target.endTime = minutesToTime(midMin);
    if (target.isChained) {
      target.isSplitHalf = true;
      target.splitLabel = 'Part A';
    }

    // Second half
    const part2 = {
      ...JSON.parse(JSON.stringify(target)),
      id: generateId('evt_split'),
      startTime: minutesToTime(midMin),
      endTime: minutesToTime(endMin),
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

    const startMin = timeToMinutes(target.startTime);
    const endMin = timeToMinutes(target.endTime);
    const duration = endMin - startMin;

    let newStart = Math.min(1440 - duration, startMin + duration);
    let newEnd = newStart + duration;

    const clone = {
      ...JSON.parse(JSON.stringify(target)),
      id: generateId('evt_clone'),
      title: `${target.title} (Copy)`,
      startTime: minutesToTime(newStart),
      endTime: minutesToTime(newEnd)
    };

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

  // Robust Series Finder
  findSeries(seriesId) {
    if (!seriesId) return null;
    return this.series.find((s) => s.id === seriesId) ||
           this.series.find((s) => seriesId.startsWith(s.id)) ||
           null;
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
      Object.assign(seriesItem, updates);
    } else if (mode === 'following') {
      // Modify this and following events
      const prevDate = shiftDateKey(occurrenceDate, -1);
      seriesItem.until = prevDate;

      // Create new series starting from occurrenceDate
      const newSeries = {
        ...JSON.parse(JSON.stringify(seriesItem)),
        id: generateId('series'),
        from: occurrenceDate,
        until: null,
        ...updates
      };
      this.series.push(newSeries);
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
    this.pushHistorySnapshot(`Create protocol "${protocol.name}"`);
    this.customProtocols.push(protocol);
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
  addCategory(name, color = 'ocean') {
    const trimmed = (name || '').trim();
    if (!trimmed || this.categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) return;
    this.pushHistorySnapshot(`Add category "${trimmed}"`);
    this.categories.push({ id: generateId('cat'), name: trimmed, color: color });
    this.visibleCategories.add(trimmed);
    this.notify('category_added');
  }

  updateCategory(oldName, newName, newColor) {
    const cat = this.categories.find((c) => c.name === oldName);
    if (!cat) return;
    this.pushHistorySnapshot(`Update category "${oldName}"`);
    const trimmed = (newName || '').trim() || oldName;
    cat.name = trimmed;
    if (newColor) cat.color = newColor;

    if (this.visibleCategories.has(oldName)) {
      this.visibleCategories.delete(oldName);
      this.visibleCategories.add(trimmed);
    }

    this.events.forEach((e) => {
      if (e.category === oldName) e.category = trimmed;
    });
    this.quickClasses.forEach((qc) => {
      if (qc.category === oldName) qc.category = trimmed;
    });

    this.notify('category_updated');
  }

  deleteCategory(name) {
    this.pushHistorySnapshot(`Delete category "${name}"`);
    this.categories = this.categories.filter((c) => c.name !== name);
    this.visibleCategories.delete(name);
    this.notify('category_deleted');
  }
}

export const store = new StateStore();

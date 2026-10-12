/**
 * Drag and Drop & In-Calendar Direct Manipulation
 * Supports 3-tier protocol shifting (single, Shift=whole group, Ctrl/Cmd=cascade),
 * recurring series modification prompts, 15-minute grid snapping, and ghost preview
 */

import {
  snapToGrid,
  clamp,
  minutesToTime,
  timeToMinutes,
  formatDateKey,
  parseDateKey,
  generateId,
  shiftDateKey,
  formatTimeDisplay,
  getCategoryDefaultColor,
  escapeHtml
} from './utils.js';
import { instantiateProtocol } from './protocols.js';
import { createEventFromQuota, calculateWeeklyQuotaStats, getSuggestedQuotaDuration } from './quotas.js';

export class DragDropController {
  constructor(store, calendarRenderer, onOpenEditModal, onPromptSeriesEdit) {
    this.store = store;
    this.calendar = calendarRenderer;
    this.onOpenEditModal = onOpenEditModal;
    this.onPromptSeriesEdit = onPromptSeriesEdit;

    this.ghostPreviewEl = null;
    this.draftContext = null;
    this.wasDragging = false;

    this.init();
  }

  init() {
    this.initSidebarDragSources();
    this.initGridDropListeners();
    this.initInCalendarEventInteractions();
    this.initQuickCreatePopover();
    this.initContextMenu();
  }

  /**
   * 1. Sidebar Drag Sources (Single events, Quotas, Protocols)
   */
  initSidebarDragSources() {
    document.addEventListener('dragstart', (e) => {
      const dragSource = e.target.closest('[data-drag-type]');
      if (!dragSource) return;

      const dragType = dragSource.dataset.dragType;
      const dragPayload = dragSource.dataset.dragPayload;

      e.dataTransfer.setData('text/plain', JSON.stringify({ type: dragType, payload: dragPayload }));
      e.dataTransfer.effectAllowed = 'copyMove';

      dragSource.classList.add('is-dragging-source');
    });

    document.addEventListener('dragend', (e) => {
      const dragSource = e.target.closest('[data-drag-type]');
      if (dragSource) {
        dragSource.classList.remove('is-dragging-source');
      }
      this.removeGhostPreview();
    });
  }

  /**
   * 2. Grid Drop Listeners (Drop from Sidebar)
   */
  initGridDropListeners() {
    const container = this.calendar.container;

    container.addEventListener('dragover', (e) => {
      const dayCol = e.target.closest('.cal-day-column');
      if (!dayCol) return;

      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';

      const rect = dayCol.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;
      const snappedMinute = snapToGrid(clamp(relativeY, 0, 1425), 15);

      this.updateGhostPreview(dayCol, snappedMinute, 60);
    });

    container.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget || !container.contains(e.relatedTarget)) {
        this.removeGhostPreview();
      }
    });

    container.addEventListener('drop', (e) => {
      e.preventDefault();
      this.removeGhostPreview();

      const dayCol = e.target.closest('.cal-day-column');
      if (!dayCol) return;

      const dateKey = dayCol.dataset.dateKey;
      if (!dateKey) return;

      const rect = dayCol.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;
      const snappedStartMinute = snapToGrid(clamp(relativeY, 0, 1425), 15);

      try {
        const dataStr = e.dataTransfer.getData('text/plain');
        if (!dataStr) return;
        const dragData = JSON.parse(dataStr);

        this.handleSidebarDrop(dragData, dateKey, snappedStartMinute);
      } catch (err) {
        console.error('Error handling drop:', err);
      }
    });
  }

  handleSidebarDrop(dragData, dateKey, startMinute) {
    const { type, payload } = dragData;

    if (type === 'protocol') {
      const allProtocols = this.store.getAllProtocols();
      const proto = allProtocols.find((p) => p.id === payload);
      if (!proto) return;

      const { events } = instantiateProtocol(proto, dateKey, startMinute);
      this.store.addEvents(events, `Added protocol "${proto.name}"`);
      this.showToast(`Scheduled "${proto.name}" (${events.length} steps). Hold Shift to move group; Ctrl to cascade.`);
    } else if (type === 'quota') {
      const quota = this.store.quotas.find((q) => q.id === payload);
      if (!quota) return;

      const stats = calculateWeeklyQuotaStats(this.store.quotas, this.store.events, parseDateKey(dateKey));
      const stat = stats[quota.id];
      const duration = getSuggestedQuotaDuration(stat);

      const newEvt = createEventFromQuota(quota, dateKey, startMinute, duration);
      this.store.addEvent(newEvt);
      this.showToast(`Allocated ${Math.round(duration / 60 * 10) / 10}h for "${quota.title}". Weekly progress updated.`);
    } else if (type === 'event_class') {
      const template = JSON.parse(payload);
      const endMinute = Math.min(1440, startMinute + (template.duration || 60));

      const newEvt = {
        id: generateId('evt_class'),
        title: template.title,
        dateKey: dateKey,
        startTime: minutesToTime(startMinute),
        endTime: minutesToTime(endMinute),
        color: template.color || 'ocean',
        category: template.category || 'Bench Work',
        notes: template.notes || ''
      };
      if (newEvt.category && !this.store.visibleCategories.has(newEvt.category)) {
        this.store.visibleCategories.add(newEvt.category);
      }
      this.store.addEvent(newEvt);
      this.showToast(`Added "${newEvt.title}"`);
    }
  }

  /**
   * 3. In-Calendar Event Dragging & Resizing with 3-Tier Protocol Shifting & Series Handling
   */
  initInCalendarEventInteractions() {
    const container = this.calendar.container;

    container.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;

      const resizeHandle = e.target.closest('.resize-handle');
      const eventCard = e.target.closest('.cal-event-card');

      if (resizeHandle && eventCard) {
        e.preventDefault();
        e.stopPropagation();
        this.startResizing(eventCard, resizeHandle, e);
      } else if (eventCard) {
        if (e.target.closest('.action-btn')) return;
        e.preventDefault();
        this.startMovingEvent(eventCard, e);
      } else {
        const dayCol = e.target.closest('.cal-day-column');
        if (dayCol) {
          e.preventDefault();
          this.startDraftEventCreation(dayCol, e);
        }
      }
    });

    // Single-click on event to view/edit
    container.addEventListener('click', (e) => {
      if (this.wasDragging) {
        this.wasDragging = false;
        return;
      }

      const eventCard = e.target.closest('.cal-event-card');
      if (eventCard) {
        const eventId = eventCard.dataset.eventId;
        const isSeries = eventCard.dataset.isSeriesOccurrence === 'true';

        if (isSeries) {
          const seriesId = eventCard.dataset.seriesId;
          const occDate = eventCard.dataset.occurrenceDate;
          const seriesObj = this.store.findSeries(seriesId);
          if (seriesObj && this.onOpenEditModal) {
            const seriesEvent = {
              id: eventId,
              seriesId: seriesObj.id,
              isSeriesOccurrence: true,
              occurrenceDate: occDate,
              title: seriesObj.title,
              dateKey: occDate,
              startTime: seriesObj.startTime,
              endTime: seriesObj.endTime,
              category: seriesObj.category,
              color: seriesObj.color,
              notes: seriesObj.notes || ''
            };
            this.onOpenEditModal(seriesEvent);
          }
        } else {
          const targetEvent = this.store.events.find((evt) => evt.id === eventId);
          if (targetEvent && this.onOpenEditModal) {
            this.onOpenEditModal(targetEvent);
          }
        }
      }
    });
  }

  /**
   * Google Calendar-style Interactive Draft Box Creation
   */
  startDraftEventCreation(dayCol, startEvent) {
    this.closeQuickCreatePopover();

    const colRect = dayCol.getBoundingClientRect();
    const relativeY = startEvent.clientY - colRect.top;
    const startMin = snapToGrid(clamp(relativeY, 0, 1410), 15);
    const initialEndMin = Math.min(1440, startMin + 60);

    const draftEl = document.createElement('div');
    draftEl.className = 'cal-draft-event';
    draftEl.style.top = `${startMin}px`;
    draftEl.style.height = `${initialEndMin - startMin}px`;
    draftEl.innerHTML = `
      <span class="draft-time-label">${formatTimeDisplay(minutesToTime(startMin))} – ${formatTimeDisplay(minutesToTime(initialEndMin))}</span>
      <span class="draft-prompt-text">(Drag to adjust duration)</span>
    `;
    dayCol.appendChild(draftEl);

    this.draftContext = {
      dayCol,
      dateKey: dayCol.dataset.dateKey,
      startMin,
      endMin: initialEndMin,
      draftEl,
      startY: startEvent.clientY
    };

    const onMouseMove = (moveEvt) => {
      if (!this.draftContext) return;
      const curRelativeY = moveEvt.clientY - colRect.top;
      const curMin = snapToGrid(clamp(curRelativeY, 0, 1440), 15);
      const newEndMin = Math.max(startMin + 15, curMin);
      this.draftContext.endMin = newEndMin;
      draftEl.style.height = `${newEndMin - startMin}px`;
      const timeLbl = draftEl.querySelector('.draft-time-label');
      if (timeLbl) {
        timeLbl.textContent = `${formatTimeDisplay(minutesToTime(startMin))} – ${formatTimeDisplay(minutesToTime(newEndMin))}`;
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      if (!this.draftContext) return;
      this.openQuickCreatePopover(this.draftContext);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  initQuickCreatePopover() {
    this.popoverEl = document.getElementById('quickCreatePopover');
    this.popoverTitleInput = document.getElementById('popoverTitleInput');
    this.popoverTimeLabel = document.getElementById('popoverTimeLabel');
    this.popoverCategorySelect = document.getElementById('popoverCategorySelect');
    this.popoverSaveBtn = document.getElementById('popoverSaveBtn');
    this.popoverMoreOptionsBtn = document.getElementById('popoverMoreOptionsBtn');
    this.popoverCloseBtn = document.getElementById('popoverCloseBtn');

    this.popoverSaveBtn?.addEventListener('click', () => this.saveDraftEventFromPopover());
    this.popoverMoreOptionsBtn?.addEventListener('click', () => this.moreOptionsFromPopover());
    this.popoverCloseBtn?.addEventListener('click', () => this.closeQuickCreatePopover());

    this.popoverTitleInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.saveDraftEventFromPopover();
      } else if (e.key === 'Escape') {
        this.closeQuickCreatePopover();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.popoverEl && !this.popoverEl.classList.contains('hidden')) {
        this.closeQuickCreatePopover();
      }
    });

    document.addEventListener('mousedown', (e) => {
      if (this.popoverEl && !this.popoverEl.classList.contains('hidden')) {
        if (!this.popoverEl.contains(e.target) && !e.target.closest('.cal-draft-event')) {
          this.closeQuickCreatePopover();
        }
      }
    });
  }

  openQuickCreatePopover(draftCtx) {
    if (!this.popoverEl) return;
    const { dateKey, startMin, endMin, draftEl } = draftCtx;
    const rect = draftEl.getBoundingClientRect();

    const [y, m, d] = dateKey.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
    const monthName = dateObj.toLocaleDateString('en-US', { month: 'short' });
    const timeLabel = `${dayName}, ${monthName} ${d} • ${formatTimeDisplay(minutesToTime(startMin))} – ${formatTimeDisplay(minutesToTime(endMin))}`;
    if (this.popoverTimeLabel) {
      this.popoverTimeLabel.textContent = timeLabel;
    }

    if (this.popoverCategorySelect) {
      this.popoverCategorySelect.innerHTML = '';
      const categories = this.store.categories || [];
      categories.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.name;
        opt.textContent = c.name;
        this.popoverCategorySelect.appendChild(opt);
      });
      this.popoverCategorySelect.value = 'Bench Work';
    }

    if (this.popoverTitleInput) {
      this.popoverTitleInput.value = '';
    }

    let popoverLeft = rect.right + 12;
    if (popoverLeft + 330 > window.innerWidth) {
      popoverLeft = Math.max(10, rect.left - 330);
    }
    let popoverTop = rect.top;
    if (popoverTop + 240 > window.innerHeight) {
      popoverTop = Math.max(10, window.innerHeight - 250);
    }

    this.popoverEl.style.left = `${popoverLeft}px`;
    this.popoverEl.style.top = `${popoverTop}px`;
    this.popoverEl.classList.remove('hidden');

    setTimeout(() => this.popoverTitleInput?.focus(), 50);
  }

  closeQuickCreatePopover() {
    if (this.popoverEl) this.popoverEl.classList.add('hidden');
    if (this.draftContext?.draftEl) {
      this.draftContext.draftEl.remove();
      this.draftContext = null;
    }
  }

  saveDraftEventFromPopover() {
    if (!this.draftContext) return;
    const { dateKey, startMin, endMin } = this.draftContext;
    const title = (this.popoverTitleInput?.value || '').trim() || 'New Event';
    const cat = this.popoverCategorySelect?.value || 'Bench Work';
    const color = getCategoryDefaultColor(cat);

    const newEvt = {
      id: generateId('evt_user'),
      title,
      dateKey,
      startTime: minutesToTime(startMin),
      endTime: minutesToTime(endMin),
      category: cat,
      color,
      notes: ''
    };

    if (!this.store.visibleCategories.has(cat)) {
      this.store.visibleCategories.add(cat);
    }

    this.store.addEvent(newEvt);
    this.closeQuickCreatePopover();
    this.showToast(`Created "${title}"`);
  }

  moreOptionsFromPopover() {
    if (!this.draftContext) return;
    const { dateKey, startMin, endMin } = this.draftContext;
    const title = (this.popoverTitleInput?.value || '').trim();
    const cat = this.popoverCategorySelect?.value || 'Bench Work';
    const color = getCategoryDefaultColor(cat);

    const draftData = {
      id: '',
      title,
      dateKey,
      startTime: minutesToTime(startMin),
      endTime: minutesToTime(endMin),
      category: cat,
      color,
      notes: ''
    };

    this.closeQuickCreatePopover();
    if (this.onOpenEditModal) {
      this.onOpenEditModal(draftData);
    }
  }

  startMovingEvent(eventCard, startEvent) {
    const eventId = eventCard.dataset.eventId;
    const isSeries = eventCard.dataset.isSeriesOccurrence === 'true';
    const seriesId = eventCard.dataset.seriesId;
    const occurrenceDate = eventCard.dataset.occurrenceDate;

    // Find event data
    let evt = this.store.events.find((e) => e.id === eventId);
    if (!evt && isSeries) {
      const seriesObj = this.store.series.find((s) => s.id === seriesId);
      if (seriesObj) {
        evt = {
          id: eventId,
          title: seriesObj.title,
          dateKey: occurrenceDate,
          startTime: seriesObj.startTime,
          endTime: seriesObj.endTime,
          isSeriesOccurrence: true,
          seriesId: seriesId,
          occurrenceDate: occurrenceDate
        };
      }
    }
    if (!evt) return;

    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const origDateKey = evt.dateKey;
    const origStartMin = timeToMinutes(evt.startTime);
    const origEndMin = timeToMinutes(evt.endTime);
    const duration = origEndMin - origStartMin;

    const isChained = evt.isChained && evt.protocolGroupId;
    let didMove = false;

    eventCard.classList.add('is-being-dragged');

    const onMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      if (!didMove && (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4)) {
        didMove = true;
        this.wasDragging = true;
      }
      if (!didMove) return;

      const dayCol = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest('.cal-day-column');
      if (!dayCol) return;

      const rect = dayCol.getBoundingClientRect();
      const relativeY = moveEvent.clientY - rect.top;
      const targetStartMin = snapToGrid(clamp(relativeY - (duration / 2), 0, 1440 - duration), 15);

      const isShift = moveEvent.shiftKey;
      const isCtrl = moveEvent.ctrlKey || moveEvent.metaKey;

      if (isChained) {
        if (isShift) {
          this.updateGhostPreview(dayCol, targetStartMin, duration, `Shift Entire Protocol Group (${evt.protocolName || 'Protocol'})`);
        } else if (isCtrl) {
          this.updateGhostPreview(dayCol, targetStartMin, duration, `Cascade Shift Downstream Steps`);
        } else {
          this.updateGhostPreview(dayCol, targetStartMin, duration, `Shift: group • Ctrl: cascade`);
        }
      } else {
        this.updateGhostPreview(dayCol, targetStartMin, duration, '');
      }
    };

    const onMouseUp = (upEvent) => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      eventCard.classList.remove('is-being-dragged');
      this.removeGhostPreview();

      if (!didMove) return;

      const dayCol = document.elementFromPoint(upEvent.clientX, upEvent.clientY)?.closest('.cal-day-column');
      if (!dayCol) return;

      const rect = dayCol.getBoundingClientRect();
      const relativeY = upEvent.clientY - rect.top;
      const newStartMin = snapToGrid(clamp(relativeY - (duration / 2), 0, 1440 - duration), 15);
      const newEndMin = newStartMin + duration;
      const newDateKey = dayCol.dataset.dateKey;

      const isShift = upEvent.shiftKey;
      const isCtrl = upEvent.ctrlKey || upEvent.metaKey;

      // Handle Recurring Series move
      if (isSeries) {
        if (this.onPromptSeriesEdit) {
          this.onPromptSeriesEdit(
            this.store.series.find((s) => s.id === seriesId),
            occurrenceDate,
            {
              dateKey: newDateKey,
              startTime: minutesToTime(newStartMin),
              endTime: minutesToTime(newEndMin)
            }
          );
        }
        return;
      }

      // Handle Protocol moves
      if (isChained) {
        const curDate = parseDateKey(origDateKey);
        const targetDate = parseDateKey(newDateKey);
        const diffTime = targetDate.getTime() - curDate.getTime();
        const deltaDays = Math.round(diffTime / (1000 * 3600 * 24));
        const deltaMinutes = newStartMin - origStartMin;

        if (isShift) {
          // Whole group shift
          this.store.shiftProtocolGroup(evt.protocolGroupId, deltaDays, deltaMinutes);
          this.showToast(`Shifted entire protocol group by ${deltaDays} day(s), ${deltaMinutes} mins.`);
        } else if (isCtrl) {
          // Cascade shift downstream
          this.store.cascadeShiftProtocolSteps(evt.protocolGroupId, evt.id, deltaDays, deltaMinutes);
          this.showToast(`Cascaded downstream steps by ${deltaDays} day(s), ${deltaMinutes} mins.`);
        } else {
          // Single step shift
          this.store.updateEvent(evt.id, {
            dateKey: newDateKey,
            startTime: minutesToTime(newStartMin),
            endTime: minutesToTime(newEndMin)
          });
          this.showToast(`Moved individual step. Hold Shift to move group; Ctrl to cascade.`);
        }
      } else {
        // Regular single event move
        this.store.updateEvent(evt.id, {
          dateKey: newDateKey,
          startTime: minutesToTime(newStartMin),
          endTime: minutesToTime(newEndMin)
        });
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  startResizing(eventCard, handle, startEvent) {
    const isTop = handle.classList.contains('resize-handle-top');
    const eventId = eventCard.dataset.eventId;
    const isSeries = eventCard.dataset.isSeriesOccurrence === 'true';
    const seriesId = eventCard.dataset.seriesId;
    const occurrenceDate = eventCard.dataset.occurrenceDate;

    let evt = this.store.events.find((e) => e.id === eventId);
    if (!evt && isSeries) {
      const seriesObj = this.store.series.find((s) => s.id === seriesId);
      if (seriesObj) {
        evt = {
          id: eventId,
          title: seriesObj.title,
          dateKey: occurrenceDate,
          startTime: seriesObj.startTime,
          endTime: seriesObj.endTime
        };
      }
    }
    if (!evt) return;

    const dayCol = eventCard.closest('.cal-day-column');
    if (!dayCol) return;

    const colRect = dayCol.getBoundingClientRect();
    const origStartMin = timeToMinutes(evt.startTime);
    const origEndMin = timeToMinutes(evt.endTime);

    let curStartMin = origStartMin;
    let curEndMin = origEndMin;

    eventCard.classList.add('is-resizing');

    const onMouseMove = (moveEvent) => {
      const relativeY = moveEvent.clientY - colRect.top;
      const snappedMin = snapToGrid(clamp(relativeY, 0, 1440), 15);

      if (isTop) {
        curStartMin = Math.min(snappedMin, curEndMin - 15);
        eventCard.style.top = `${curStartMin}px`;
        eventCard.style.height = `${curEndMin - curStartMin}px`;
      } else {
        curEndMin = Math.max(snappedMin, curStartMin + 15);
        eventCard.style.height = `${curEndMin - curStartMin}px`;
      }
    };

    const onMouseUp = (upEvent) => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      eventCard.classList.remove('is-resizing');

      const isCtrl = upEvent.ctrlKey || upEvent.metaKey;

      if (isSeries) {
        if (this.onPromptSeriesEdit) {
          this.onPromptSeriesEdit(
            this.store.series.find((s) => s.id === seriesId),
            occurrenceDate,
            {
              startTime: minutesToTime(curStartMin),
              endTime: minutesToTime(curEndMin)
            }
          );
        }
        return;
      }

      if (evt.isChained && isCtrl && !isTop) {
        // Cascade resize end time downstream
        const deltaMinutes = curEndMin - origEndMin;
        this.store.updateEvent(evt.id, {
          startTime: minutesToTime(curStartMin),
          endTime: minutesToTime(curEndMin)
        });
        this.store.cascadeShiftProtocolSteps(evt.protocolGroupId, evt.id, 0, deltaMinutes);
        this.showToast(`Extended duration and cascaded downstream steps by ${deltaMinutes} min.`);
      } else {
        this.store.updateEvent(evt.id, {
          startTime: minutesToTime(curStartMin),
          endTime: minutesToTime(curEndMin)
        });
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  /**
   * 4. Context Menu (Right Click) for Split, Duplicate, Group Shift, Cascade, Delete
   */
  initContextMenu() {
    const menuEl = document.getElementById('eventContextMenu');
    if (!menuEl) return;

    this.calendar.container.addEventListener('contextmenu', (e) => {
      const eventCard = e.target.closest('.cal-event-card');
      if (!eventCard) return;

      e.preventDefault();
      const eventId = eventCard.dataset.eventId;
      const isSeries = eventCard.dataset.isSeriesOccurrence === 'true';
      const seriesId = eventCard.dataset.seriesId;
      const occurrenceDate = eventCard.dataset.occurrenceDate;

      let evt = this.store.events.find((item) => item.id === eventId);
      if (!evt && isSeries) {
        const s = this.store.findSeries(seriesId);
        if (s) {
          evt = { ...s, id: eventId, isSeriesOccurrence: true, seriesId: s.id, occurrenceDate: occurrenceDate, dateKey: occurrenceDate };
        }
      }
      if (!evt) return;

      this.activeContextEvent = evt;

      menuEl.style.top = `${Math.min(window.innerHeight - 280, e.clientY)}px`;
      menuEl.style.left = `${Math.min(window.innerWidth - 240, e.clientX)}px`;
      menuEl.classList.remove('hidden');

      // Adjust group options
      const groupShiftOption = menuEl.querySelector('[data-action="shift-group"]');
      const cascadeOption = menuEl.querySelector('[data-action="cascade-shift"]');
      const deleteGroupOption = menuEl.querySelector('[data-action="delete-group"]');

      if (groupShiftOption && cascadeOption && deleteGroupOption) {
        if (evt.protocolGroupId) {
          groupShiftOption.classList.remove('hidden');
          cascadeOption.classList.remove('hidden');
          deleteGroupOption.classList.remove('hidden');
        } else {
          groupShiftOption.classList.add('hidden');
          cascadeOption.classList.add('hidden');
          deleteGroupOption.classList.add('hidden');
        }
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#eventContextMenu')) {
        menuEl.classList.add('hidden');
      }
    });

    // Action clicks
    menuEl.addEventListener('click', (e) => {
      const item = e.target.closest('[data-action]');
      if (!item || !this.activeContextEvent) return;

      const action = item.dataset.action;
      const evt = this.activeContextEvent;
      menuEl.classList.add('hidden');

      if (action === 'edit') {
        if (this.onOpenEditModal) this.onOpenEditModal(evt);
      } else if (action === 'split') {
        this.store.splitEvent(evt.id);
        this.showToast(`Split "${evt.title}" into two parts`);
      } else if (action === 'duplicate') {
        this.store.duplicateEvent(evt.id);
        this.showToast(`Duplicated "${evt.title}"`);
      } else if (action === 'shift-group') {
        const daysStr = prompt('Shift entire protocol run by how many days? (+1 next day, -1 prev day)', '1');
        if (daysStr !== null) {
          const days = parseInt(daysStr, 10);
          if (!isNaN(days)) {
            this.store.shiftProtocolGroup(evt.protocolGroupId, days, 0);
            this.showToast(`Shifted protocol run by ${days} day(s).`);
          }
        }
      } else if (action === 'cascade-shift') {
        const minStr = prompt('Cascade downstream steps by how many minutes? (e.g. +30 or -15)', '30');
        if (minStr !== null) {
          const mins = parseInt(minStr, 10);
          if (!isNaN(mins)) {
            this.store.cascadeShiftProtocolSteps(evt.protocolGroupId, evt.id, 0, mins);
            this.showToast(`Cascaded downstream steps by ${mins} min.`);
          }
        }
      } else if (action === 'delete-group') {
        if (confirm(`Delete all steps for "${evt.protocolName || 'this protocol'}"?`)) {
          this.store.deleteProtocolGroup(evt.protocolGroupId);
          this.showToast(`Deleted protocol run.`);
        }
      } else if (action === 'delete') {
        if (evt.isSeriesOccurrence) {
          const s = this.store.findSeries(evt.seriesId || evt.id);
          if (s && this.onPromptSeriesEdit) {
            this.onPromptSeriesEdit(s, evt.occurrenceDate || evt.dateKey, null, true); // delete mode
          }
        } else {
          this.store.deleteEvent(evt.id);
          this.showToast(`Deleted "${evt.title}"`);
        }
      }
    });
  }

  /**
   * Visual Ghost Box
   */
  updateGhostPreview(dayCol, startMinute, durationMinutes = 60, customLabel = '') {
    if (!this.ghostPreviewEl) {
      this.ghostPreviewEl = document.createElement('div');
      this.ghostPreviewEl.className = 'cal-ghost-preview';
      document.body.appendChild(this.ghostPreviewEl);
    }

    const rect = dayCol.getBoundingClientRect();
    const top = rect.top + window.scrollY + startMinute;
    const left = rect.left + window.scrollX + 2;
    const width = rect.width - 4;
    const height = Math.max(24, durationMinutes);

    this.ghostPreviewEl.style.top = `${top}px`;
    this.ghostPreviewEl.style.left = `${left}px`;
    this.ghostPreviewEl.style.width = `${width}px`;
    this.ghostPreviewEl.style.height = `${height}px`;
    this.ghostPreviewEl.style.display = 'block';

    const timeLabel = `${minutesToTime(startMinute)} – ${minutesToTime(startMinute + durationMinutes)}`;
    this.ghostPreviewEl.innerHTML = `
      <div class="ghost-time">${timeLabel}</div>
      ${customLabel ? `<div class="ghost-extra">${escapeHtml(customLabel)}</div>` : ''}
    `;
  }

  removeGhostPreview() {
    if (this.ghostPreviewEl) {
      this.ghostPreviewEl.style.display = 'none';
    }
  }

  showToast(message) {
    const toast = document.getElementById('appToast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 3500);
  }
}

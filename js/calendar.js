/**
 * Calendar Grid Renderer (Week, Day, Month views)
 * Google Calendar layout with collision resolution, passive step hatched styling,
 * recurrence badges, and live current-time indicator
 */

import {
  formatDateKey,
  getWeekDates,
  isSameDay,
  DAY_NAMES_SHORT,
  MONTH_NAMES,
  timeToMinutes,
  formatTimeDisplay,
  formatDuration,
  computeEventLayout,
  getPaletteColor,
  minutesToTime,
  calculateDaysBetween,
  escapeHtml,
  safeColor
} from './utils.js';

export class CalendarRenderer {
  constructor(containerEl, store) {
    this.container = containerEl;
    this.store = store;
    this.hourHeight = 60; // 60px per hour = 1px per minute
    this.currentTimerId = null;
  }

  render() {
    // Keep the user's scroll position across re-renders of the time grid;
    // only scroll to the start of the work day on first display.
    const prevScrollEl = document.getElementById('calendarScrollBody');
    this.preservedScrollTop = prevScrollEl ? prevScrollEl.scrollTop : null;
    this.container.innerHTML = '';

    if (this.store.currentView === 'month') {
      this.renderMonthView();
    } else if (this.store.currentView === 'day') {
      this.renderTimeGridView([this.store.currentDate]);
    } else {
      // Default: Week view (Mon to Sun)
      const weekDates = getWeekDates(this.store.currentDate);
      this.renderTimeGridView(weekDates);
    }

    this.startCurrentTimeTicker();
  }

  /**
   * Render Time Grid (Day or Week view)
   */
  renderTimeGridView(dates) {
    const today = new Date();
    const isWeek = dates.length > 1;
    const dateKeysList = dates.map(formatDateKey);

    // Expand series and events for this range
    const expandedEvents = this.store.getExpandedEventsForRange(dateKeysList);

    // Outer wrapper
    const gridWrapper = document.createElement('div');
    gridWrapper.className = `cal-grid-wrapper ${isWeek ? 'view-week' : 'view-day'}`;

    // 1. Header Row (Day names and dates)
    const headerRow = document.createElement('div');
    headerRow.className = 'cal-header-row';

    // Gutter spacer in header
    const gutterSpacer = document.createElement('div');
    gutterSpacer.className = 'cal-header-gutter';
    gutterSpacer.innerHTML = `<span class="timezone-label">Local</span>`;
    headerRow.appendChild(gutterSpacer);

    // Day Header Columns
    const dayHeadersContainer = document.createElement('div');
    dayHeadersContainer.className = 'cal-day-headers';

    dates.forEach((date) => {
      const isCurrentDay = isSameDay(date, today);
      const dayIndex = (date.getDay() + 6) % 7; // 0 for Mon ... 6 for Sun
      const dayHeader = document.createElement('div');
      dayHeader.className = `cal-day-header ${isCurrentDay ? 'is-today' : ''}`;
      dayHeader.dataset.dateKey = formatDateKey(date);

      dayHeader.innerHTML = `
        <div class="day-name">${DAY_NAMES_SHORT[dayIndex]}</div>
        <div class="day-number ${isCurrentDay ? 'today-badge' : ''}">${date.getDate()}</div>
      `;

      // Quick click on day number switches to Day view
      dayHeader.addEventListener('click', () => {
        this.store.setDate(date);
        this.store.setView('day');
      });

      dayHeadersContainer.appendChild(dayHeader);
    });

    headerRow.appendChild(dayHeadersContainer);
    gridWrapper.appendChild(headerRow);

    // 1.5. All-Day & Multi-Day Banner Row
    const allDayRow = document.createElement('div');
    allDayRow.className = 'cal-allday-row';

    const allDayGutter = document.createElement('div');
    allDayGutter.className = 'cal-allday-gutter';
    allDayGutter.innerHTML = `<span>all-day</span>`;
    allDayRow.appendChild(allDayGutter);

    const allDayGrid = document.createElement('div');
    allDayGrid.className = 'cal-allday-grid';
    allDayGrid.style.gridTemplateColumns = `repeat(${dates.length}, 1fr)`;

    // Filter all-day and multi-day events
    const allDayEvents = expandedEvents.filter((e) => (
      (e.isAllDay || (e.endDateKey && e.endDateKey !== e.dateKey)) && this.matchesFilters(e)
    ));
    this.renderAllDayEvents(allDayGrid, dates, allDayEvents);

    allDayRow.appendChild(allDayGrid);
    gridWrapper.appendChild(allDayRow);

    // 2. Scrollable Body
    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'cal-scroll-body';
    scrollContainer.id = 'calendarScrollBody';

    const gridContent = document.createElement('div');
    gridContent.className = 'cal-grid-content';

    // Time Gutter (Left column with hours 00:00 to 23:00)
    const timeGutter = document.createElement('div');
    timeGutter.className = 'cal-time-gutter';

    for (let h = 0; h < 24; h++) {
      const slot = document.createElement('div');
      slot.className = 'time-label-slot';
      slot.style.height = `${this.hourHeight}px`;
      const timeStr = `${String(h).padStart(2, '0')}:00`;
      slot.innerHTML = `<span>${formatTimeDisplay(timeStr, this.store.settings.use24Hour)}</span>`;
      timeGutter.appendChild(slot);
    }
    gridContent.appendChild(timeGutter);

    // Day Columns Grid Container
    const columnsContainer = document.createElement('div');
    columnsContainer.className = 'cal-day-columns';

    dates.forEach((date) => {
      const dateKey = formatDateKey(date);
      const isCurrentDay = isSameDay(date, today);

      const dayColumn = document.createElement('div');
      dayColumn.className = `cal-day-column ${isCurrentDay ? 'is-today-col' : ''}`;
      dayColumn.dataset.dateKey = dateKey;

      // Render 24 hour slot rows
      for (let h = 0; h < 24; h++) {
        const hourRow = document.createElement('div');
        hourRow.className = 'cal-hour-row';
        hourRow.style.height = `${this.hourHeight}px`;
        hourRow.dataset.hour = h;
        hourRow.dataset.dateKey = dateKey;

        // 15-minute sub-intervals
        for (let q = 0; q < 4; q++) {
          const quarter = document.createElement('div');
          quarter.className = 'cal-quarter-slot';
          quarter.dataset.minute = h * 60 + q * 15;
          quarter.dataset.dateKey = dateKey;
          hourRow.appendChild(quarter);
        }

        dayColumn.appendChild(hourRow);
      }

      // Render Current Time Indicator if today
      if (isCurrentDay) {
        const timeLine = document.createElement('div');
        timeLine.className = 'current-time-line';
        timeLine.id = 'currentTimeIndicator';
        dayColumn.appendChild(timeLine);
      }

      // Render Events for this date
      this.renderEventsForDay(dayColumn, dateKey, expandedEvents);

      columnsContainer.appendChild(dayColumn);
    });

    gridContent.appendChild(columnsContainer);
    scrollContainer.appendChild(gridContent);
    gridWrapper.appendChild(scrollContainer);

    this.container.appendChild(gridWrapper);

    // Restore scroll synchronously (no flash), then measure scrollbar width to align headers
    scrollContainer.scrollTop = this.preservedScrollTop ?? 8.5 * this.hourHeight;
    requestAnimationFrame(() => {
      const scrollbarWidth = scrollContainer.offsetWidth - scrollContainer.clientWidth;
      document.documentElement.style.setProperty('--scrollbar-width', `${scrollbarWidth}px`);
    });
  }

  /**
   * Render Events on a Day Column
   */
  renderEventsForDay(dayColumn, dateKey, allExpandedEvents) {
    // Filter events for this day (exclude all-day events, as they render in all-day banner grid)
    const dayEvents = allExpandedEvents.filter((evt) => (
      !evt.isAllDay && evt.dateKey === dateKey && this.matchesFilters(evt)
    ));

    // Compute overlapping column layout
    const layout = computeEventLayout(dayEvents);
    const layoutMap = new Map(layout.map((l) => [l.id, l]));

    dayEvents.forEach((evt) => {
      const l = layoutMap.get(evt.id) || { colIndex: 0, totalCols: 1, startMin: 0, endMin: 60 };
      const topPx = l.startMin;
      const durationMin = Math.max(15, l.endMin - l.startMin);
      const heightPx = Math.max(22, durationMin);

      const colWidthPercent = 100 / l.totalCols;
      const leftPercent = l.colIndex * colWidthPercent;

      const isPassive = evt.stepType === 'passive';
      const overlapsPassive = l.overlapsPassive === true;
      const card = document.createElement('div');
      card.className = `cal-event-card color-${safeColor(evt.color)} ${evt.isChained ? 'is-chained-step' : ''} ${isPassive ? 'is-passive-step' : ''} ${overlapsPassive ? 'has-passive-underlay' : ''}`;
      card.id = `evt_${evt.id}`;
      card.dataset.eventId = evt.id;
      if (evt.isSeriesOccurrence) {
        card.dataset.isSeriesOccurrence = 'true';
        card.dataset.seriesId = evt.seriesId;
        card.dataset.occurrenceDate = evt.occurrenceDate;
      }
      if (evt.protocolGroupId) {
        card.dataset.protocolGroupId = evt.protocolGroupId;
        if (this.store.hoveredProtocolGroupId === evt.protocolGroupId) {
          card.classList.add('linked-group-highlight');
        }
      }

      card.style.top = `${topPx}px`;
      card.style.height = `${heightPx}px`;

      if (isPassive) {
        card.style.left = `2px`;
        card.style.width = `calc(100% - 4px)`;
        card.style.zIndex = '5';
      } else if (overlapsPassive) {
        // Leave 26px gap on the left so the underlying passive step remains clearly visible!
        const gutter = 26;
        card.style.left = `calc(${leftPercent}% + ${gutter + 2}px)`;
        card.style.width = `calc(${colWidthPercent}% - ${gutter + 4}px)`;
        card.style.zIndex = '15';
      } else {
        card.style.left = `calc(${leftPercent}% + 2px)`;
        card.style.width = `calc(${colWidthPercent}% - 4px)`;
        card.style.zIndex = l.zIndex ? String(l.zIndex) : '15';
      }

      // Build badges
      const timeDisplay = `${formatTimeDisplay(evt.startTime, this.store.settings.use24Hour)} – ${formatTimeDisplay(evt.endTime, this.store.settings.use24Hour)}`;
      const durationDisplay = formatDuration(durationMin);

      let stepBadgeHtml = '';
      if (evt.isChained && evt.derivedStepLabel) {
        stepBadgeHtml = `
          <div class="step-counter-badge" title="${escapeHtml(evt.derivedStepLabel)} in ${escapeHtml(evt.protocolName || 'Protocol')}">
            <svg class="badge-icon" viewBox="0 0 24 24"><path fill="currentColor" d="M19 19v1a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-1l4-5V8a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1v6l4 5m-8-9v-2h-2v2h2m0 4.5l-2.5 3.12h7L13 14.5V12h-2v2.5Z"/></svg>
            <span>${escapeHtml(evt.derivedStepLabel)}</span>
          </div>
        `;
      } else if (evt.quotaId) {
        stepBadgeHtml = `
          <div class="step-counter-badge quota-badge" title="Flexible weekly goal">
            <svg class="badge-icon" viewBox="0 0 24 24"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2m3-4H7v-2h10v2m0-4H7V7h10v2Z"/></svg>
            <span>Quota</span>
          </div>
        `;
      } else if (evt.isSeriesOccurrence) {
        stepBadgeHtml = `
          <div class="step-counter-badge recurring-badge" title="Weekly Recurring Series">
            <span>🔁 Recurring</span>
          </div>
        `;
      }

      // Broken sequence warning badge
      let warningHtml = '';
      if (evt.hasBrokenChainWarning) {
        warningHtml = `
          <div class="broken-chain-warning" title="Warning: This step starts before its predecessor ends!">
            ⚠️ Sequence conflict
          </div>
        `;
      }

      const passiveRibbonHtml = isPassive
        ? `<div class="passive-left-strip" title="Incubation running in background">
             <span>⏳</span>
             <span class="passive-vertical-text">Incubating</span>
           </div>`
        : '';

      card.innerHTML = `
        <div class="resize-handle resize-handle-top" title="Drag to adjust start time"></div>
        ${passiveRibbonHtml}
        <div class="event-card-inner" style="${isPassive ? 'padding-left: 28px;' : ''}">
          <div class="event-card-header">
            <div class="event-title" title="${escapeHtml(evt.title)}">${escapeHtml(evt.title)}</div>
            ${stepBadgeHtml}
          </div>
          ${warningHtml}
          <div class="event-time-row">
            <span class="event-time">${escapeHtml(timeDisplay)}</span>
            <span class="event-duration">(${durationDisplay})</span>
            ${isPassive ? `<span class="passive-pill">Passive</span>` : ''}
          </div>
          ${evt.notes && heightPx > 45 ? `<div class="event-notes-preview">${escapeHtml(evt.notes)}</div>` : ''}
          ${evt.isChained ? `<div class="protocol-shift-tip">Shift: whole group • Ctrl: cascade</div>` : ''}
        </div>
        <div class="resize-handle resize-handle-bottom" title="Drag to adjust end time"></div>
      `;

      // Hover group linking highlight (toggled in place: re-rendering would reset drag/scroll state)
      if (evt.protocolGroupId) {
        card.addEventListener('mouseenter', () => {
          this.store.setHoveredProtocolGroup(evt.protocolGroupId);
          this.highlightProtocolGroup(evt.protocolGroupId);
        });
        card.addEventListener('mouseleave', () => {
          this.store.setHoveredProtocolGroup(null);
          this.highlightProtocolGroup(null);
        });
      }

      dayColumn.appendChild(card);
    });
  }

  /**
   * Search + category filter shared by every view. Only events in a known, unchecked
   * category are hidden (events whose category was deleted stay visible).
   */
  matchesFilters(evt) {
    const q = this.store.searchQuery;
    if (q) {
      const haystack = [evt.title, evt.protocolName, evt.notes]
        .filter((v) => typeof v === 'string')
        .join('\n')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (evt.category &&
        !this.store.visibleCategories.has(evt.category) &&
        this.store.categories.some((c) => c.name === evt.category)) {
      return false;
    }
    return true;
  }

  highlightProtocolGroup(groupId) {
    this.container.querySelectorAll('.cal-event-card[data-protocol-group-id]').forEach((card) => {
      card.classList.toggle('linked-group-highlight', Boolean(groupId) && card.dataset.protocolGroupId === groupId);
    });
  }

  /**
   * Render Month View with Week-Row Architecture:
   * - Continuous multi-day event bars across week columns with continuation borders
   * - Click-and-drag across days to create all-day / multi-day events
   * - Date numbers clickable to switch to Day View
   */
  renderMonthView() {
    const curDate = new Date(this.store.currentDate);
    const year = curDate.getFullYear();
    const month = curDate.getMonth();

    const monthViewContainer = document.createElement('div');
    monthViewContainer.className = 'cal-month-view';

    // Day of week headers
    const headerRow = document.createElement('div');
    headerRow.className = 'month-header-row';
    DAY_NAMES_SHORT.forEach((dayName) => {
      const dEl = document.createElement('div');
      dEl.className = 'month-day-name';
      dEl.textContent = dayName;
      headerRow.appendChild(dEl);
    });
    monthViewContainer.appendChild(headerRow);

    const firstDayOfMonth = new Date(year, month, 1);
    const startDayIndex = (firstDayOfMonth.getDay() + 6) % 7; // Monday = 0
    const startDate = new Date(year, month, 1 - startDayIndex);
    const today = new Date();

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const numWeeks = (startDayIndex + daysInMonth > 35) ? 6 : 5;
    const totalDays = numWeeks * 7;

    const cellDates = [];
    for (let c = 0; c < totalDays; c++) {
      const cd = new Date(startDate);
      cd.setDate(startDate.getDate() + c);
      cellDates.push(cd);
    }

    const allDateKeys = cellDates.map(formatDateKey);
    const allExpanded = this.store.getExpandedEventsForRange(allDateKeys);

    // Apply category & search query filters
    const filteredEvents = allExpanded.filter((e) => this.matchesFilters(e));

    // Weeks container
    const weeksContainer = document.createElement('div');
    weeksContainer.className = 'month-weeks-container';

    // Drag-to-select state variables
    let isDragging = false;
    let dragStartKey = null;
    let dragCurrentKey = null;

    const updateHighlight = (startKey, currentKey) => {
      const minK = startKey < currentKey ? startKey : currentKey;
      const maxK = startKey < currentKey ? currentKey : startKey;
      monthViewContainer.querySelectorAll('.month-cell').forEach((cell) => {
        const k = cell.dataset.dateKey;
        if (k && k >= minK && k <= maxK) {
          cell.classList.add('is-drag-selected');
        } else {
          cell.classList.remove('is-drag-selected');
        }
      });
    };

    const onGlobalMouseMove = (e) => {
      if (!isDragging) return;
      let cell = e.target?.closest?.('.month-cell');
      if (!cell) {
        const target = document.elementFromPoint(e.clientX, e.clientY);
        cell = target?.closest?.('.month-cell');
        if (!cell) {
          const weekRow = (target || e.target)?.closest?.('.month-week-row');
          if (weekRow) {
            const rect = weekRow.getBoundingClientRect();
            const relX = Math.max(0, Math.min(e.clientX - rect.left, rect.width - 1));
            const colIdx = Math.min(6, Math.max(0, Math.floor((relX / rect.width) * 7)));
            const daysBg = weekRow.querySelector('.month-week-days-bg');
            cell = daysBg?.children[colIdx];
          }
        }
      }
      if (cell && cell.dataset.dateKey && cell.dataset.dateKey !== dragCurrentKey) {
        dragCurrentKey = cell.dataset.dateKey;
        updateHighlight(dragStartKey, dragCurrentKey);
      }
    };

    const onGlobalMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      window.removeEventListener('mousemove', onGlobalMouseMove);
      window.removeEventListener('mouseup', onGlobalMouseUp);

      monthViewContainer.querySelectorAll('.month-cell.is-drag-selected').forEach((c) => {
        c.classList.remove('is-drag-selected');
      });

      if (dragStartKey && dragCurrentKey) {
        const minK = dragStartKey < dragCurrentKey ? dragStartKey : dragCurrentKey;
        const maxK = dragStartKey < dragCurrentKey ? dragCurrentKey : dragStartKey;
        window.app?.openEventEditModal({
          isAllDay: true,
          dateKey: minK,
          endDateKey: maxK,
          title: ''
        });
      }
      dragStartKey = null;
      dragCurrentKey = null;
    };

    // Render each week row
    for (let w = 0; w < numWeeks; w++) {
      const weekDates = cellDates.slice(w * 7, (w + 1) * 7);
      const weekDateKeys = weekDates.map(formatDateKey);
      const weekMinKey = weekDateKeys[0];
      const weekMaxKey = weekDateKeys[6];

      const weekRow = document.createElement('div');
      weekRow.className = 'month-week-row';

      // 1. Background day cells
      const daysBg = document.createElement('div');
      daysBg.className = 'month-week-days-bg';

      weekDates.forEach((cellDate) => {
        const dateKey = formatDateKey(cellDate);
        const isCurrentMonth = cellDate.getMonth() === month;
        const isCurrentDay = isSameDay(cellDate, today);

        const cellEl = document.createElement('div');
        cellEl.className = `month-cell ${isCurrentMonth ? '' : 'other-month'} ${isCurrentDay ? 'is-today' : ''}`;
        cellEl.dataset.dateKey = dateKey;

        const dateNumber = document.createElement('div');
        dateNumber.className = `month-date-number ${isCurrentDay ? 'today-badge' : ''}`;
        dateNumber.textContent = cellDate.getDate();

        // Clicking date number navigates to Day View
        dateNumber.addEventListener('mousedown', (e) => e.stopPropagation());
        dateNumber.addEventListener('click', (e) => {
          e.stopPropagation();
          this.store.setDate(cellDate);
          this.store.setView('day');
        });

        cellEl.appendChild(dateNumber);

        // Hover during drag
        cellEl.addEventListener('mouseenter', () => {
          if (isDragging && dateKey !== dragCurrentKey) {
            dragCurrentKey = dateKey;
            updateHighlight(dragStartKey, dragCurrentKey);
          }
        });

        // Click-and-drag start on cell
        cellEl.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          isDragging = true;
          dragStartKey = dateKey;
          dragCurrentKey = dateKey;
          updateHighlight(dragStartKey, dragCurrentKey);
          window.addEventListener('mousemove', onGlobalMouseMove);
          window.addEventListener('mouseup', onGlobalMouseUp);
        });

        daysBg.appendChild(cellEl);
      });

      weekRow.appendChild(daysBg);

      // 2. Events layer
      const eventsLayer = document.createElement('div');
      eventsLayer.className = 'month-week-events-layer';

      // Separate multi-day/all-day events vs single-day timed events
      const multiDayEvents = [];
      const singleDayEvents = [];

      filteredEvents.forEach((evt) => {
        const startKey = evt.dateKey;
        const endKey = evt.endDateKey || evt.dateKey;
        const isMulti = Boolean(evt.isAllDay || (evt.endDateKey && evt.endDateKey !== evt.dateKey));

        if (isMulti) {
          if (startKey <= weekMaxKey && endKey >= weekMinKey) {
            multiDayEvents.push(evt);
          }
        } else {
          if (weekDateKeys.includes(startKey)) {
            singleDayEvents.push(evt);
          }
        }
      });

      // Sort multi-day events: longer spans first, then start date
      multiDayEvents.sort((a, b) => {
        const spanA = calculateDaysBetween(a.dateKey, a.endDateKey || a.dateKey);
        const spanB = calculateDaysBetween(b.dateKey, b.endDateKey || b.dateKey);
        if (spanA !== spanB) return spanB - spanA;
        return a.dateKey.localeCompare(b.dateKey);
      });

      // Sort single-day events by startTime
      singleDayEvents.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

      // Render multi-day events
      multiDayEvents.forEach((evt) => {
        const startKey = evt.dateKey;
        const endKey = evt.endDateKey || evt.dateKey;

        let startCol = weekDateKeys.indexOf(startKey);
        let isContinuationLeft = false;
        if (startCol === -1) {
          startCol = 0;
          isContinuationLeft = true;
        }

        let endCol = weekDateKeys.indexOf(endKey);
        let isContinuationRight = false;
        if (endCol === -1) {
          endCol = 6;
          isContinuationRight = true;
        }

        const span = (endCol - startCol) + 1;
        const bar = document.createElement('div');
        bar.className = `month-multiday-bar color-${safeColor(evt.color)} ${isContinuationLeft ? 'is-continuation-left' : ''} ${isContinuationRight ? 'is-continuation-right' : ''}`;
        bar.style.gridColumn = `${startCol + 1} / span ${span}`;
        bar.dataset.eventId = evt.id;

        const multiDaysCount = calculateDaysBetween(startKey, endKey) + 1;
        const spanLabel = multiDaysCount > 1 ? ` (${multiDaysCount}d)` : '';
        bar.innerHTML = `<span class="allday-title">${escapeHtml(evt.title)}${spanLabel}</span>`;
        bar.title = `${evt.title} (${startKey}${endKey !== startKey ? ' to ' + endKey : ''})`;

        bar.addEventListener('mousedown', (e) => e.stopPropagation());
        bar.addEventListener('click', (e) => {
          e.stopPropagation();
          window.app?.openEventEditModal(evt);
        });

        eventsLayer.appendChild(bar);
      });

      // Render single-day timed events
      singleDayEvents.forEach((evt) => {
        const colIdx = weekDateKeys.indexOf(evt.dateKey);
        if (colIdx === -1) return;

        const pill = document.createElement('div');
        pill.className = `month-event-pill color-${safeColor(evt.color)}`;
        pill.style.gridColumn = `${colIdx + 1} / span 1`;
        pill.dataset.eventId = evt.id;
        pill.title = `${evt.startTime || ''} ${evt.title}`;
        pill.innerHTML = `<span class="pill-dot"></span><span class="pill-text">${evt.startTime ? escapeHtml(evt.startTime) + ' ' : ''}${escapeHtml(evt.title)}</span>`;

        pill.addEventListener('mousedown', (e) => e.stopPropagation());
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          window.app?.openEventEditModal(evt);
        });

        eventsLayer.appendChild(pill);
      });

      weekRow.appendChild(eventsLayer);
      weeksContainer.appendChild(weekRow);
    }

    monthViewContainer.appendChild(weeksContainer);
    this.container.appendChild(monthViewContainer);
  }

  /**
   * Render All-Day and Multi-Day Event Banners in header row
   */
  renderAllDayEvents(allDayGrid, dates, allDayEvents) {
    allDayGrid.innerHTML = '';
    const dateKeys = dates.map(formatDateKey);
    const minDateKey = dateKeys[0];
    const maxDateKey = dateKeys[dateKeys.length - 1];

    dates.forEach((d, idx) => {
      const cell = document.createElement('div');
      cell.className = 'cal-allday-cell';
      cell.dataset.dateKey = formatDateKey(d);
      cell.dataset.colIndex = idx;
      cell.title = `Click to add all-day event for ${formatDateKey(d)}`;
      cell.addEventListener('click', () => {
        window.app?.openEventEditModal({
          isAllDay: true,
          dateKey: formatDateKey(d),
          endDateKey: formatDateKey(d)
        });
      });
      allDayGrid.appendChild(cell);
    });

    if (!allDayEvents || allDayEvents.length === 0) return;

    allDayEvents.forEach((evt) => {
      const startKey = evt.dateKey;
      const endKey = evt.endDateKey || evt.dateKey;

      let startCol = dateKeys.indexOf(startKey);
      if (startCol === -1) {
        startCol = startKey < minDateKey ? 0 : dateKeys.length - 1;
      }
      let endCol = dateKeys.indexOf(endKey);
      if (endCol === -1) {
        endCol = endKey > maxDateKey ? dateKeys.length - 1 : 0;
      }

      if (startCol > endCol) return;

      const span = (endCol - startCol) + 1;
      const bar = document.createElement('div');
      bar.className = `cal-allday-bar color-${safeColor(evt.color)}`;
      bar.id = `allday_${evt.id}`;
      bar.dataset.eventId = evt.id;
      bar.style.gridColumn = `${startCol + 1} / span ${span}`;

      const multiLabel = span > 1 ? ` (${span}d)` : '';
      bar.innerHTML = `
        <span class="allday-title">${escapeHtml(evt.title)}${multiLabel}</span>
      `;
      bar.title = `${evt.title} (${startKey}${endKey !== startKey ? ' to ' + endKey : ''})`;

      bar.addEventListener('click', (e) => {
        e.stopPropagation();
        window.app?.openEventEditModal(evt);
      });

      allDayGrid.appendChild(bar);
    });
  }

  /**
   * Update live red current-time indicator line & handle midnight rollover
   */
  startCurrentTimeTicker() {
    if (this.currentTimerId) {
      clearInterval(this.currentTimerId);
    }

    let lastDay = new Date().getDate();

    const updateIndicator = () => {
      const now = new Date();
      // Handle midnight rollover
      if (now.getDate() !== lastDay) {
        lastDay = now.getDate();
        this.render();
        return;
      }

      const indicator = document.getElementById('currentTimeIndicator');
      if (!indicator) return;
      const currentMin = now.getHours() * 60 + now.getMinutes();
      indicator.style.top = `${currentMin}px`;
    };

    updateIndicator();
    this.currentTimerId = setInterval(updateIndicator, 60000);
  }
}

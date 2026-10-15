/**
 * Main Application Bootstrap & Coordinator
 * Integrates State, Calendar Engine, Drag & Drop, Protocols, Quotas, Modals,
 * and Series + Exceptions Prompting
 */

import { store, isLocalDataChange } from './state.js';
import { CalendarRenderer } from './calendar.js';
import { DragDropController } from './drag-drop.js';
import { ProtocolBuilder } from './protocol-builder.js';
import { calculateQuotaStats } from './quotas.js';
import { exportToIcs, exportStateToJson, exportSingleProtocol } from './storage.js';
import { SyncManager, SUPABASE_SETUP_SQL } from './sync.js';
import { sanitizeProtocol, normalizeProtocolCategory, UNCATEGORIZED_PROTOCOLS } from './protocols.js';

const COLLAPSED_PROTOCOL_CATEGORIES_KEY = 'labcal_collapsed_protocol_categories';
const COLLAPSED_SIDEBAR_SECTIONS_KEY = 'labcal_collapsed_sidebar_sections';
import {
  formatDateKey,
  getWeekDates,
  isSameDay,
  MONTH_NAMES,
  DAY_NAMES_SHORT,
  timeToMinutes,
  minutesToTime,
  generateId,
  parseDateKey,
  getCategoryDefaultColor,
  escapeHtml,
  safeColor,
  isSmallScreen,
  isAllDayEvent,
  toAbsMinutes,
  shiftDateKey,
  calculateDaysBetween,
  getEventDayRange
} from './utils.js';

class LabCalendarApp {
  constructor() {
    this.store = store;
    this.syncManager = new SyncManager(store);
    this.currentEditingEvent = null;
    this.collapsedProtocolCategories = this.loadCollapsedProtocolCategories();
    this.initDOM();
    this.initCalendar();
    this.initProtocolBuilder();
    this.initDragDrop();
    this.initEventListeners();
    this.initMiniCalendar();
    this.initCloudSyncModal();
    this.initSyncConflictModal();
    this.initPwa();

    // Subscribe to state changes for automatic UI re-renders
    store.subscribe((changeType) => {
      this.onStateChanged(changeType);
    });

    // Initial render
    this.renderAll();

    // If connected to cloud, perform initial sync
    if (this.syncManager.isConnected()) {
      this.syncManager.syncNow();
    }
  }

  initDOM() {
    this.calendarContainer = document.getElementById('calendarContainer');
    this.currentDateTitle = document.getElementById('currentDateTitle');
    this.sidebarEl = document.getElementById('appSidebar');
    this.sidebarToggleBtn = document.getElementById('sidebarToggleBtn');

    // Navigation
    this.todayBtn = document.getElementById('todayBtn');
    this.prevBtn = document.getElementById('prevBtn');
    this.nextBtn = document.getElementById('nextBtn');
    this.viewBtns = document.querySelectorAll('.view-btn');
    this.searchInput = document.getElementById('searchInput');

    // Undo / Redo
    this.undoBtn = document.getElementById('undoBtn');
    this.redoBtn = document.getElementById('redoBtn');

    // Create dropdown
    this.createMainBtn = document.getElementById('createMainBtn');
    this.createDropdown = document.getElementById('createDropdown');
    this.createEventOption = document.getElementById('createEventOption');
    this.createProtocolOption = document.getElementById('createProtocolOption');
    this.createQuotaOption = document.getElementById('createQuotaOption');

    // Export dropdown
    this.directGcalBtn = document.getElementById('directGcalBtn');
    this.exportMenuBtn = document.getElementById('exportMenuBtn');
    this.exportDropdown = document.getElementById('exportDropdown');
    this.exportIcsBtn = document.getElementById('exportIcsBtn');
    this.exportJsonBtn = document.getElementById('exportJsonBtn');
    this.importJsonTriggerBtn = document.getElementById('importJsonTriggerBtn');
    this.jsonFileInput = document.getElementById('jsonFileInput');
    this.protocolFileInput = document.getElementById('protocolFileInput');

    // Sidebar lists
    this.sidebarQuotasList = document.getElementById('sidebarQuotasList');
    this.sidebarProtocolsList = document.getElementById('sidebarProtocolsList');
    this.sidebarEventClassesGrid = document.getElementById('sidebarEventClassesGrid');
    this.sidebarCategoryFilters = document.getElementById('sidebarCategoryFilters');
    this.miniCalendarWidget = document.getElementById('miniCalendarWidget');
    this.quotaCountBadge = document.getElementById('quotaCountBadge');
    this.protocolCountBadge = document.getElementById('protocolCountBadge');

    // Action buttons in sidebar headers
    this.addQuotaLinkBtn = document.getElementById('addQuotaLinkBtn');
    this.buildProtocolLinkBtn = document.getElementById('buildProtocolLinkBtn');
    this.addQuickClassLinkBtn = document.getElementById('addQuickClassLinkBtn');
    this.addCategoryLinkBtn = document.getElementById('addCategoryLinkBtn');

    // Modals
    this.eventEditModal = document.getElementById('eventEditModal');
    this.quotaCreatorModal = document.getElementById('quotaCreatorModal');
    this.quickClassModal = document.getElementById('quickClassModal');
    this.categoryModal = document.getElementById('categoryModal');
    this.seriesPromptModal = document.getElementById('seriesPromptModal');
  }

  initCalendar() {
    this.calendar = new CalendarRenderer(this.calendarContainer, store);
  }

  initProtocolBuilder() {
    this.protocolBuilder = new ProtocolBuilder(store, () => {
      this.renderSidebarProtocols();
      this.showToast('Custom protocol saved to library!');
    });
  }

  initDragDrop() {
    this.dragDrop = new DragDropController(
      store,
      this.calendar,
      (event) => {
        this.openEventEditModal(event);
      },
      (seriesObj, occDate, pendingUpdates = null, isDelete = false) => {
        this.openSeriesPromptModal(seriesObj, occDate, pendingUpdates, isDelete);
      }
    );
  }

  initEventListeners() {
    // Sidebar toggle
    this.sidebarToggleBtn?.addEventListener('click', () => {
      this.sidebarEl.classList.toggle('collapsed');
    });

    // Phones: start on the 3-day view with the sidebar hidden (it slides over the calendar)
    if (isSmallScreen()) {
      this.sidebarEl?.classList.add('collapsed');
      store.currentView = '3day';
    }

    // Phones: tapping outside the open sidebar closes it
    document.addEventListener('pointerdown', (e) => {
      if (!isSmallScreen() || !this.sidebarEl || this.sidebarEl.classList.contains('collapsed')) return;
      if (this.sidebarEl.contains(e.target) || this.sidebarToggleBtn?.contains(e.target)) return;
      if (e.target.closest('.modal-backdrop')) return;
      this.sidebarEl.classList.add('collapsed');
    });

    // Date navigation
    this.todayBtn?.addEventListener('click', () => store.navigate(0));
    this.prevBtn?.addEventListener('click', () => store.navigate(-1));
    this.nextBtn?.addEventListener('click', () => store.navigate(1));

    // View selector (Day, Week, Month)
    this.viewBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.viewBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        store.setView(btn.dataset.view);
      });
    });

    // Search filter
    this.searchInput?.addEventListener('input', (e) => {
      store.setSearchQuery(e.target.value);
    });

    // Undo / Redo
    this.undoBtn?.addEventListener('click', () => {
      if (store.undo()) this.showToast('Action undone');
    });
    this.redoBtn?.addEventListener('click', () => {
      if (store.redo()) this.showToast('Action redone');
    });

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          store.redo();
        } else {
          store.undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        store.redo();
      }
    });

    // Create dropdown menu
    this.createMainBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.createDropdown.classList.toggle('hidden');
    });

    this.createEventOption?.addEventListener('click', () => {
      this.createDropdown.classList.add('hidden');
      this.openEventEditModal();
    });

    this.createProtocolOption?.addEventListener('click', () => {
      this.createDropdown.classList.add('hidden');
      this.protocolBuilder.open();
    });

    this.createQuotaOption?.addEventListener('click', () => {
      this.createDropdown.classList.add('hidden');
      this.openQuotaCreatorModal();
    });

    this.addQuotaLinkBtn?.addEventListener('click', () => this.openQuotaCreatorModal());
    this.buildProtocolLinkBtn?.addEventListener('click', () => this.protocolBuilder.open());
    document.getElementById('importProtocolLinkBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.protocolFileInput?.click();
    });
    this.addQuickClassLinkBtn?.addEventListener('click', () => this.openQuickClassModal());
    this.addCategoryLinkBtn?.addEventListener('click', () => this.openCategoryModal());

    // Direct 1-Click GCal export button
    this.directGcalBtn?.addEventListener('click', () => this.openIcsExportModal());

    // Export dropdown menu
    this.exportMenuBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.exportDropdown.classList.toggle('hidden');
    });

    this.exportIcsBtn?.addEventListener('click', () => {
      this.exportDropdown.classList.add('hidden');
      this.openIcsExportModal();
    });

    this.exportJsonBtn?.addEventListener('click', () => {
      this.exportDropdown.classList.add('hidden');
      this.exportBackup();
      this.showToast('Exported backup (.json)');
    });

    this.importJsonTriggerBtn?.addEventListener('click', () => {
      this.exportDropdown.classList.add('hidden');
      this.jsonFileInput.click();
    });

    this.jsonFileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        let parsed;
        try {
          parsed = JSON.parse(event.target.result);
        } catch (err) {
          alert('Invalid backup JSON file.');
          return;
        }
        const hasCalendarData = parsed && typeof parsed === 'object' &&
          ['events', 'series', 'quotas', 'customProtocols', 'categories'].some((k) => Array.isArray(parsed[k]));
        if (!hasCalendarData) {
          alert('This file does not look like a LabCal backup.');
          return;
        }
        if (!confirm('Replace the current calendar with this backup? You can undo with Ctrl+Z.')) return;

        // Undoable, and synced to the cloud like any other edit
        store.pushHistorySnapshot('Import backup');
        store.applyData(parsed);
        store.notify('backup_import');
        this.showToast('Calendar restored successfully!');
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    // Protocol import: one or more .protocol.json files, each holding a protocol or a list of them
    this.protocolFileInput?.addEventListener('change', async (e) => {
      const files = [...(e.target.files || [])];
      e.target.value = '';
      if (files.length === 0) return;

      const imported = [];
      const problems = [];
      for (const file of files) {
        let data;
        try {
          data = JSON.parse(await file.text());
        } catch (err) {
          problems.push(`${file.name}: not valid JSON`);
          continue;
        }
        const candidates = Array.isArray(data) ? data : [data];
        candidates.forEach((raw, i) => {
          const protocol = sanitizeProtocol(raw);
          if (protocol) {
            imported.push(protocol);
          } else {
            const label = candidates.length > 1 ? `${file.name} (item ${i + 1})` : file.name;
            problems.push(`${label}: needs a "name" and a non-empty "steps" list`);
          }
        });
      }

      if (imported.length > 0) {
        imported.forEach((protocol) => {
          protocol.id = generateId('proto_shared');
          // Show the category the protocol landed in
          this.collapsedProtocolCategories.delete(normalizeProtocolCategory(protocol.category));
        });
        store.addCustomProtocols(imported);
        this.showToast(imported.length === 1
          ? `Imported "${imported[0].name}" into ${normalizeProtocolCategory(imported[0].category)}`
          : `Imported ${imported.length} protocols`);
      }
      if (problems.length > 0) {
        alert(`Some protocols could not be imported:\n\n${problems.join('\n')}`);
      }
    });

    // Close dropdowns on outside click
    document.addEventListener('click', () => {
      this.createDropdown.classList.add('hidden');
      this.exportDropdown.classList.add('hidden');
    });

    this.initSidebarSections();
    this.initDisplayOptions();
    this.initIcsExportModal();

    this.initEventEditModal();
    this.initQuotaModal();
    this.initQuickClassModal();
    this.initCategoryModal();
    this.initSeriesPromptModal();
  }

  /**
   * Every sidebar section folds by clicking (or Enter/Space on) its header.
   * Folded sections are a per-device preference (not synced).
   */
  initSidebarSections() {
    let collapsed = new Set();
    try {
      collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSED_SIDEBAR_SECTIONS_KEY) || '[]'));
    } catch (e) {}

    const apply = (section, isCollapsed) => {
      section.classList.toggle('is-collapsed', isCollapsed);
      section.querySelector('.sidebar-section-header')?.setAttribute('aria-expanded', String(!isCollapsed));
    };

    document.querySelectorAll('.sidebar-section[data-section]').forEach((section) => {
      const id = section.dataset.section;
      const header = section.querySelector('.sidebar-section-header');
      apply(section, collapsed.has(id));

      const toggle = () => {
        if (collapsed.has(id)) collapsed.delete(id);
        else collapsed.add(id);
        apply(section, collapsed.has(id));
        try {
          localStorage.setItem(COLLAPSED_SIDEBAR_SECTIONS_KEY, JSON.stringify([...collapsed]));
        } catch (e) {}
      };

      header?.addEventListener('click', (e) => {
        // Header buttons (+ Add, Import...) keep working without folding the section
        if (e.target.closest('button, input, a')) return;
        toggle();
      });
      header?.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === header) {
          e.preventDefault();
          toggle();
        }
      });
    });
  }

  initDisplayOptions() {
    this.showPassiveToggle = document.getElementById('showPassiveToggle');
    this.highlightWorkingHoursToggle = document.getElementById('highlightWorkingHoursToggle');
    this.workingHoursStartInput = document.getElementById('workingHoursStart');
    this.workingHoursEndInput = document.getElementById('workingHoursEnd');

    this.showPassiveToggle?.addEventListener('change', () => {
      store.updateSettings({ showPassive: this.showPassiveToggle.checked });
      this.showToast(this.showPassiveToggle.checked ? 'Showing passive steps' : 'Passive steps hidden');
    });
    this.highlightWorkingHoursToggle?.addEventListener('change', () => {
      store.updateSettings({ highlightWorkingHours: this.highlightWorkingHoursToggle.checked });
    });

    const saveWorkingHours = () => {
      const start = this.workingHoursStartInput.value;
      const end = this.workingHoursEndInput.value;
      if (!start || !end || timeToMinutes(end) <= timeToMinutes(start)) {
        alert('Working hours must end after they start.');
        this.syncDisplayControls();
        return;
      }
      store.updateSettings({ workingHoursStart: start, workingHoursEnd: end });
    };
    this.workingHoursStartInput?.addEventListener('change', saveWorkingHours);
    this.workingHoursEndInput?.addEventListener('change', saveWorkingHours);

    this.syncDisplayControls();
  }

  // Reflect settings in the Display controls (also after a cloud sync or another tab)
  syncDisplayControls() {
    const s = store.settings;
    if (this.showPassiveToggle) this.showPassiveToggle.checked = s.showPassive !== false;
    if (this.highlightWorkingHoursToggle) this.highlightWorkingHoursToggle.checked = s.highlightWorkingHours !== false;
    if (this.workingHoursStartInput && document.activeElement !== this.workingHoursStartInput) {
      this.workingHoursStartInput.value = s.workingHoursStart;
    }
    if (this.workingHoursEndInput && document.activeElement !== this.workingHoursEndInput) {
      this.workingHoursEndInput.value = s.workingHoursEnd;
    }
  }

  onStateChanged(changeType) {
    if (changeType === 'settings_change' || changeType === 'cloud_pull' || changeType === 'storage_sync' || changeType === 'backup_import') {
      this.syncDisplayControls();
    }
    if (changeType === 'date_change') {
      // Keep the mini calendar on the month being viewed
      this.miniDate = new Date(store.currentDate);
    }
    this.renderHeaderTitle();
    this.calendar.render();
    this.renderSidebarQuotas();
    this.renderSidebarProtocols();
    this.renderSidebarQuickClasses();
    this.renderCategoryFilters();
    this.renderMiniCalendar();

    // Only real local data edits are marked unsynced and pushed (not navigation, hover, filters or cloud pulls)
    if (isLocalDataChange(changeType)) {
      this.syncManager.markDirty();
      this.syncManager.scheduleAutoSync();
    }
  }

  renderAll() {
    this.renderHeaderTitle();
    this.calendar.render();
    this.renderSidebarQuotas();
    this.renderSidebarProtocols();
    this.renderSidebarQuickClasses();
    this.renderCategoryFilters();
    this.renderMiniCalendar();
  }

  renderHeaderTitle() {
    const cur = store.currentDate;
    // Keep the view switcher in sync when the view changes programmatically
    // (e.g. clicking a day header opens the day view)
    this.viewBtns.forEach((b) => b.classList.toggle('active', b.dataset.view === store.currentView));

    if (store.currentView === '3day') {
      const end = parseDateKey(shiftDateKey(formatDateKey(cur), 2));
      this.currentDateTitle.textContent = cur.getMonth() === end.getMonth()
        ? `${MONTH_NAMES[cur.getMonth()]} ${cur.getDate()} – ${end.getDate()}, ${end.getFullYear()}`
        : `${MONTH_NAMES[cur.getMonth()]} ${cur.getDate()} – ${MONTH_NAMES[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
    } else if (store.currentView === 'day') {
      const dayName = cur.toLocaleDateString('en-US', { weekday: 'long' });
      this.currentDateTitle.textContent = `${dayName}, ${MONTH_NAMES[cur.getMonth()]} ${cur.getDate()}, ${cur.getFullYear()}`;
    } else if (store.currentView === 'month') {
      this.currentDateTitle.textContent = `${MONTH_NAMES[cur.getMonth()]} ${cur.getFullYear()}`;
    } else {
      const weekDates = getWeekDates(cur);
      const start = weekDates[0];
      const end = weekDates[6];
      if (start.getMonth() === end.getMonth()) {
        this.currentDateTitle.textContent = `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} – ${end.getDate()}, ${start.getFullYear()}`;
      } else {
        this.currentDateTitle.textContent = `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} – ${MONTH_NAMES[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
      }
    }
  }

  /**
   * Render Multi-Target Quotas (Weekly, Monthly, Total) with linked category tags
   * Supports quotas with single target type (e.g. only weekly) or multi-tier combinations
   */
  renderSidebarQuotas() {
    const stats = calculateQuotaStats(store.quotas, store.events, store.currentDate);
    this.sidebarQuotasList.innerHTML = '';
    this.quotaCountBadge.textContent = store.quotas.length;

    store.quotas.forEach((quota) => {
      const stat = stats[quota.id] || {
        hasWeekly: true,
        weeklyHours: 0,
        weeklyTarget: 3.0,
        weeklyPercentage: 0,
        isWeeklyOver: false
      };

      const card = document.createElement('div');
      card.className = 'quota-card';
      card.draggable = true;
      card.dataset.dragType = 'quota';
      card.dataset.dragPayload = quota.id;
      card.title = `Drag to allocate time for "${quota.title}" into calendar`;

      const categoriesHtml = (quota.categories && quota.categories.length > 0)
        ? `<div class="quota-categories-tags">
            ${quota.categories.map((c) => `<span class="quota-category-tag">${escapeHtml(c)}</span>`).join('')}
           </div>`
        : '';

      const metricRows = [];

      if (stat.hasWeekly) {
        const barWidth = Math.min(100, stat.weeklyPercentage);
        metricRows.push(`
          <div class="quota-metric-row">
            <div class="quota-metric-label">
              <span>Week</span>
              <span class="${stat.isWeeklyOver ? 'is-over-text' : ''}"><strong>${stat.weeklyHours}</strong> / ${stat.weeklyTarget}h (${stat.weeklyPercentage}%)</span>
            </div>
            <div class="quota-progress-track">
              <div class="quota-progress-bar ${stat.isWeeklyOver ? 'is-over' : (stat.weeklyPercentage >= 100 ? 'is-complete' : '')}" style="width: ${barWidth}%;"></div>
            </div>
          </div>
        `);
      }

      if (stat.hasMonthly) {
        const barWidth = Math.min(100, stat.monthlyPercentage);
        const showBar = !stat.hasWeekly;
        metricRows.push(`
          <div class="quota-metric-row">
            <div class="quota-metric-label">
              <span>Month</span>
              <span class="${stat.isMonthlyOver ? 'is-over-text' : ''}"><strong>${stat.monthlyHours}</strong> / ${stat.monthlyTarget}h (${stat.monthlyPercentage}%)</span>
            </div>
            ${showBar ? `
              <div class="quota-progress-track">
                <div class="quota-progress-bar ${stat.isMonthlyOver ? 'is-over' : (stat.monthlyPercentage >= 100 ? 'is-complete' : '')}" style="width: ${barWidth}%;"></div>
              </div>` : ''}
          </div>
        `);
      }

      if (stat.hasTotal) {
        const barWidth = Math.min(100, stat.totalPercentage);
        const showBar = !stat.hasWeekly && !stat.hasMonthly;
        metricRows.push(`
          <div class="quota-metric-row">
            <div class="quota-metric-label">
              <span>Total Goal</span>
              <span class="${stat.isTotalOver ? 'is-over-text' : ''}"><strong>${stat.totalHours}</strong> / ${stat.totalTarget}h (${stat.totalPercentage}%)</span>
            </div>
            ${showBar ? `
              <div class="quota-progress-track">
                <div class="quota-progress-bar ${stat.isTotalOver ? 'is-over' : (stat.totalPercentage >= 100 ? 'is-complete' : '')}" style="width: ${barWidth}%;"></div>
              </div>` : ''}
          </div>
        `);
      }

      card.innerHTML = `
        <div class="quota-card-top">
          <div class="quota-card-title">
            <span class="chip-color-dot" style="background:var(--color-${safeColor(quota.color, 'lavender')}-border);"></span>
            <span>${escapeHtml(quota.title)}</span>
          </div>
          <div style="display:flex; align-items:center; gap:4px;">
            <div class="quota-actions">
              <button class="quota-action-btn edit-quota-btn" title="Edit Goal">✎</button>
              <button class="quota-action-btn delete-quota-btn" title="Delete Goal">🗑</button>
            </div>
            <span class="quota-drag-handle">⋮⋮</span>
          </div>
        </div>
        ${categoriesHtml}
        <div class="quota-multi-metrics">
          ${metricRows.join('')}
        </div>
      `;

      card.querySelector('.edit-quota-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openQuotaCreatorModal(quota);
      });

      card.querySelector('.delete-quota-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete goal "${quota.title}"?`)) {
          store.deleteQuota(quota.id);
          this.showToast('Goal deleted');
        }
      });

      this.sidebarQuotasList.appendChild(card);
    });
  }

  /**
   * Render Draggable Quick Event Classes (Chips)
   */
  renderSidebarQuickClasses() {
    if (!this.sidebarEventClassesGrid) return;
    this.sidebarEventClassesGrid.innerHTML = '';
    const classes = store.quickClasses || [];

    classes.forEach((cls) => {
      const chip = document.createElement('div');
      chip.className = 'event-class-chip';
      chip.draggable = true;
      chip.dataset.dragType = 'event_class';
      chip.dataset.dragPayload = JSON.stringify(cls);
      chip.title = `Drag onto calendar to schedule ${cls.title} (${cls.duration}m)`;

      chip.innerHTML = `
        <span class="chip-color-dot" style="background:var(--color-${safeColor(cls.color)}-border, #1967d2);"></span>
        <span>${escapeHtml(cls.title)} (${escapeHtml(cls.duration)}m)</span>
        <span class="chip-actions">
          <button class="chip-btn edit-chip-btn" title="Edit class">✎</button>
          <button class="chip-btn delete-chip-btn" title="Delete class">✕</button>
        </span>
      `;

      chip.querySelector('.edit-chip-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openQuickClassModal(cls);
      });

      chip.querySelector('.delete-chip-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        store.deleteQuickClass(cls.id);
        this.showToast(`Deleted class "${cls.title}"`);
      });

      this.sidebarEventClassesGrid.appendChild(chip);
    });
  }

  /**
   * Render Draggable Protocol Templates Library (Supports Deleting Any Protocol)
   */
  renderSidebarProtocols() {
    const allProtocols = store.getAllProtocols();
    this.sidebarProtocolsList.innerHTML = '';
    this.protocolCountBadge.textContent = allProtocols.length;

    // Group by protocol category: alphabetical, "Uncategorized" last
    const groups = new Map();
    allProtocols.forEach((proto) => {
      const category = normalizeProtocolCategory(proto.category);
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(proto);
    });
    const categoryNames = [...groups.keys()].sort((a, b) => {
      if (a === UNCATEGORIZED_PROTOCOLS) return 1;
      if (b === UNCATEGORIZED_PROTOCOLS) return -1;
      return a.localeCompare(b);
    });

    categoryNames.forEach((category) => {
      const protocols = groups.get(category).sort((a, b) => a.name.localeCompare(b.name));
      const isCollapsed = this.collapsedProtocolCategories.has(category);

      const group = document.createElement('div');
      group.className = `protocol-category-group ${isCollapsed ? 'is-collapsed' : ''}`;

      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'protocol-category-header';
      header.setAttribute('aria-expanded', String(!isCollapsed));
      header.innerHTML = `
        <span class="protocol-category-chevron">▾</span>
        <span class="protocol-category-name">${escapeHtml(category)}</span>
        <span class="protocol-category-count">${protocols.length}</span>
      `;
      header.addEventListener('click', () => this.toggleProtocolCategory(category));

      const items = document.createElement('div');
      items.className = 'protocol-category-items';
      protocols.forEach((proto) => items.appendChild(this.createProtocolCard(proto)));

      group.appendChild(header);
      group.appendChild(items);
      this.sidebarProtocolsList.appendChild(group);
    });
  }

  // Folded protocol categories are a per-device preference (not synced)
  loadCollapsedProtocolCategories() {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSED_PROTOCOL_CATEGORIES_KEY) || '[]'));
    } catch (e) {
      return new Set();
    }
  }

  toggleProtocolCategory(category) {
    if (this.collapsedProtocolCategories.has(category)) {
      this.collapsedProtocolCategories.delete(category);
    } else {
      this.collapsedProtocolCategories.add(category);
    }
    try {
      localStorage.setItem(COLLAPSED_PROTOCOL_CATEGORIES_KEY, JSON.stringify([...this.collapsedProtocolCategories]));
    } catch (e) {}
    this.renderSidebarProtocols();
  }

  createProtocolCard(proto) {
    const card = document.createElement('div');
    card.className = 'protocol-card';
    card.draggable = true;
    card.dataset.dragType = 'protocol';
    card.dataset.dragPayload = proto.id;
    card.title = `Drag to instantiate ${proto.steps.length} chained steps`;

    const daysLabel = proto.totalDays === 1 ? '1 Day' : `${proto.totalDays} Days`;
    const isCustom = proto.id.startsWith('proto_custom') || proto.id.startsWith('proto_shared');

    card.innerHTML = `
      <div class="protocol-card-header">
        <div class="protocol-card-name">${escapeHtml(proto.name)}</div>
        <div class="protocol-card-actions">
          <span class="protocol-days-badge">${escapeHtml(daysLabel)}</span>
          <button class="protocol-action-btn edit-proto-btn" title="Edit Protocol">✎</button>
          <button class="protocol-action-btn share-btn" title="Export / Share .protocol.json">⤓</button>
          <button class="protocol-action-btn delete-proto-btn" title="Delete Protocol" style="color:var(--google-red);">🗑</button>
        </div>
      </div>
      <div class="protocol-card-meta">
        <span>${proto.steps.length} steps</span>
        ${isCustom ? `<span style="color:var(--google-blue); font-weight:600;"> (Custom)</span>` : ''}
      </div>
    `;

    card.querySelector('.edit-proto-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.protocolBuilder.open(proto);
    });

    card.querySelector('.share-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      exportSingleProtocol(proto);
      this.showToast(`Exported "${proto.name}" as .protocol.json`);
    });

    card.querySelector('.delete-proto-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Delete protocol template "${proto.name}" from library?`)) {
        store.deleteProtocol(proto.id);
        this.showToast(`Deleted protocol "${proto.name}"`);
      }
    });

    card.addEventListener('dblclick', () => {
      this.protocolBuilder.open(proto);
    });

    return card;
  }

  /**
   * Render Category Filter Toggles with Edit & Delete Actions
   */
  renderCategoryFilters() {
    const categories = store.categories || [];
    this.sidebarCategoryFilters.innerHTML = '';

    categories.forEach((cat) => {
      const isVisible = store.visibleCategories.has(cat.name);
      const label = document.createElement('label');
      label.className = 'filter-item';

      label.innerHTML = `
        <div class="filter-left">
          <input type="checkbox" class="filter-checkbox" ${isVisible ? 'checked' : ''}>
          <span class="chip-color-dot" style="background:var(--color-${safeColor(cat.color)}-border, #1967d2);"></span>
          <span>${escapeHtml(cat.name)}</span>
        </div>
        <div class="filter-actions">
          <button class="filter-action-btn edit-cat-btn" title="Edit Category">✎</button>
          <button class="filter-action-btn delete-cat-btn" title="Delete Category">✕</button>
        </div>
      `;

      label.querySelector('input').addEventListener('change', () => {
        store.toggleCategory(cat.name);
      });

      label.querySelector('.edit-cat-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.openCategoryModal(cat);
      });

      label.querySelector('.delete-cat-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (confirm(`Delete category "${cat.name}"?`)) {
          store.deleteCategory(cat.name);
          this.showToast(`Deleted category "${cat.name}"`);
        }
      });

      this.sidebarCategoryFilters.appendChild(label);
    });
  }

  /**
   * Mini Month Calendar Datepicker
   */
  initMiniCalendar() {
    this.miniDate = new Date(store.currentDate);
  }

  renderMiniCalendar() {
    this.miniCalendarWidget.innerHTML = '';

    const year = this.miniDate.getFullYear();
    const month = this.miniDate.getMonth();

    const header = document.createElement('div');
    header.className = 'mini-cal-header';

    const title = document.createElement('div');
    title.className = 'mini-cal-title';
    title.textContent = `${MONTH_NAMES[month]} ${year}`;

    const nav = document.createElement('div');
    nav.className = 'mini-cal-nav';
    nav.innerHTML = `
      <button class="mini-cal-nav-btn" id="miniPrevBtn">‹</button>
      <button class="mini-cal-nav-btn" id="miniNextBtn">›</button>
    `;

    header.appendChild(title);
    header.appendChild(nav);
    this.miniCalendarWidget.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'mini-cal-days-grid';

    DAY_NAMES_SHORT.forEach((dayName) => {
      const dH = document.createElement('div');
      dH.className = 'mini-day-header';
      dH.textContent = dayName[0];
      grid.appendChild(dH);
    });

    const firstDayOfMonth = new Date(year, month, 1);
    const startDayIndex = (firstDayOfMonth.getDay() + 6) % 7;
    const startDate = new Date(year, month, 1 - startDayIndex);
    const today = new Date();
    // 5 or 6 week rows, same as the month view (a fixed 35 cells cut off e.g. March 2026)
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalCells = (startDayIndex + daysInMonth > 35) ? 42 : 35;

    for (let i = 0; i < totalCells; i++) {
      const cellDate = new Date(startDate);
      cellDate.setDate(startDate.getDate() + i);

      const isCurrentMonth = cellDate.getMonth() === month;
      const isTodayCell = isSameDay(cellDate, today);
      const isSelectedCell = isSameDay(cellDate, store.currentDate);

      const cell = document.createElement('div');
      cell.className = `mini-date-cell ${isCurrentMonth ? '' : 'other-month'} ${isTodayCell ? 'is-today' : ''} ${isSelectedCell ? 'is-selected' : ''}`;
      cell.textContent = cellDate.getDate();

      cell.addEventListener('click', () => {
        store.setDate(cellDate);
      });

      grid.appendChild(cell);
    }

    this.miniCalendarWidget.appendChild(grid);

    // Day 1 avoids month overflow (e.g. Jan 31 + 1 month would land in March)
    header.querySelector('#miniPrevBtn').addEventListener('click', () => {
      this.miniDate = new Date(year, month - 1, 1);
      this.renderMiniCalendar();
    });
    header.querySelector('#miniNextBtn').addEventListener('click', () => {
      this.miniDate = new Date(year, month + 1, 1);
      this.renderMiniCalendar();
    });
  }

  /**
   * Event Edit / View Modal Handlers (Supports All-Day & Recurring Occurrences)
   */
  initEventEditModal() {
    this.editEventIdInput = document.getElementById('editEventId');
    this.editEventTitleInput = document.getElementById('editEventTitle');
    this.editEventIsAllDay = document.getElementById('editEventIsAllDay');
    this.editEventTimeRow = document.getElementById('editEventTimeRow');
    this.editEventDateRangeRow = document.getElementById('editEventDateRangeRow');
    this.editEventDateInput = document.getElementById('editEventDate');
    this.editEventEndDateTimed = document.getElementById('editEventEndDateTimed');

    // Moving the start date moves the end date with it (keeps multi-day durations)
    this.editEventDateInput?.addEventListener('focus', () => {
      this.editEventPrevStartDate = this.editEventDateInput.value;
    });
    this.editEventDateInput?.addEventListener('change', () => {
      const prev = this.editEventPrevStartDate;
      const next = this.editEventDateInput.value;
      const end = this.editEventEndDateTimed?.value;
      if (prev && next && end) {
        this.editEventEndDateTimed.value = shiftDateKey(end, calculateDaysBetween(prev, next));
      } else if (next && this.editEventEndDateTimed) {
        this.editEventEndDateTimed.value = next;
      }
      this.editEventPrevStartDate = next;
    });
    this.editEventStartTimeInput = document.getElementById('editEventStartTime');
    this.editEventEndTimeInput = document.getElementById('editEventEndTime');
    this.editEventStartDate = document.getElementById('editEventStartDate');
    this.editEventEndDate = document.getElementById('editEventEndDate');
    this.editEventCategorySelect = document.getElementById('editEventCategory');
    this.editEventColorSelect = document.getElementById('editEventColor');
    this.editEventNotesInput = document.getElementById('editEventNotes');
    this.protocolInfoBanner = document.getElementById('protocolInfoBanner');

    this.modalSaveBtn = document.getElementById('modalSaveBtn');
    this.modalDeleteBtn = document.getElementById('modalDeleteBtn');
    this.modalSplitBtn = document.getElementById('modalSplitBtn');
    this.modalDuplicateBtn = document.getElementById('modalDuplicateBtn');
    this.eventModalCloseBtn = document.getElementById('eventModalCloseBtn');

    this.eventModalCloseBtn?.addEventListener('click', () => this.closeEventEditModal());

    // Toggle All-Day rows
    this.editEventIsAllDay?.addEventListener('change', () => {
      const isAllDay = this.editEventIsAllDay.checked;
      if (isAllDay) {
        this.editEventTimeRow?.classList.add('hidden');
        this.editEventDateRangeRow?.classList.remove('hidden');
      } else {
        this.editEventTimeRow?.classList.remove('hidden');
        this.editEventDateRangeRow?.classList.add('hidden');
      }
    });

    this.modalSaveBtn?.addEventListener('click', () => {
      this.saveEventModalChanges();
    });

    this.modalDeleteBtn?.addEventListener('click', () => {
      if (this.currentEditingEvent?.isSeriesOccurrence) {
        const seriesObj = store.findSeries(this.currentEditingEvent.seriesId);
        const occDate = this.currentEditingEvent.occurrenceDate || this.currentEditingEvent.dateKey;
        this.closeEventEditModal();
        if (seriesObj) {
          this.openSeriesPromptModal(seriesObj, occDate, null, true);
        }
        return;
      }

      const id = this.editEventIdInput.value;
      if (id) {
        store.deleteEvent(id);
        this.closeEventEditModal();
        this.showToast('Event deleted');
      }
    });

    this.modalSplitBtn?.addEventListener('click', () => {
      const id = this.editEventIdInput.value;
      if (id) {
        store.splitEvent(id);
        this.closeEventEditModal();
        this.showToast('Event split in two parts');
      }
    });

    this.modalDuplicateBtn?.addEventListener('click', () => {
      const id = this.editEventIdInput.value;
      if (id) {
        store.duplicateEvent(id);
        this.closeEventEditModal();
        this.showToast('Event duplicated');
      }
    });

    // Auto-update color when category changes (user can still override afterwards)
    this.editEventCategorySelect?.addEventListener('change', (e) => {
      const cat = e.target.value;
      const defaultColor = getCategoryDefaultColor(cat);
      if (this.editEventColorSelect) {
        this.editEventColorSelect.value = defaultColor;
      }
    });
  }

  populateCategoriesSelect(selectEl, selectedValue = '') {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    const categories = store.categories || [];
    categories.forEach((cat) => {
      const opt = document.createElement('option');
      opt.value = cat.name;
      opt.textContent = cat.name;
      selectEl.appendChild(opt);
    });
    if (selectedValue) {
      selectEl.value = selectedValue;
    }
  }

  openEventEditModal(event = null) {
    this.currentEditingEvent = event;
    const isAllDay = Boolean(event && isAllDayEvent(event));

    this.populateCategoriesSelect(this.editEventCategorySelect, event?.category || 'Bench Work');

    if (this.editEventIsAllDay) {
      this.editEventIsAllDay.checked = isAllDay;
    }

    if (isAllDay) {
      this.editEventTimeRow?.classList.add('hidden');
      this.editEventDateRangeRow?.classList.remove('hidden');
      const startK = event?.dateKey || formatDateKey(store.currentDate);
      const endK = event?.endDateKey || event?.dateKey || formatDateKey(store.currentDate);
      this.editEventStartDate.value = startK;
      this.editEventEndDate.value = endK;
    } else {
      this.editEventTimeRow?.classList.remove('hidden');
      this.editEventDateRangeRow?.classList.add('hidden');
      this.editEventDateInput.value = event?.dateKey || formatDateKey(store.currentDate);
      this.editEventStartTimeInput.value = event?.startTime || '10:00';
      this.editEventEndDateTimed.value = event?.endDateKey || this.editEventDateInput.value;
      this.editEventEndTimeInput.value = event?.endTime || '11:00';
    }

    if (event && event.id) {
      document.getElementById('eventModalTitle').textContent = event.isSeriesOccurrence ? 'Edit Recurring Event' : 'Edit Event';
      this.editEventIdInput.value = event.id;
      this.editEventTitleInput.value = event.title || '';
      this.editEventColorSelect.value = event.color || getCategoryDefaultColor(event.category || 'Bench Work');
      this.editEventNotesInput.value = event.notes || '';

      if (event.isChained && event.protocolName) {
        this.protocolInfoBanner.innerHTML = `
          <div style="background:var(--google-blue-light); padding:8px 12px; border-radius:6px; font-size:12px; color:var(--google-blue); font-weight:500;">
            🔗 Part of chained protocol: <strong>${escapeHtml(event.protocolName)}</strong> (${escapeHtml(event.derivedStepLabel || 'Step')})
            <br><span style="font-size:11px; opacity:0.85;">Hold Shift while dragging to move all steps; Ctrl to cascade downstream.</span>
          </div>
        `;
        this.protocolInfoBanner.classList.remove('hidden');
      } else {
        this.protocolInfoBanner.classList.add('hidden');
      }

      if (event.isSeriesOccurrence) {
        this.modalSplitBtn.classList.add('hidden');
        this.modalDuplicateBtn.classList.add('hidden');
      } else {
        this.modalSplitBtn.classList.remove('hidden');
        this.modalDuplicateBtn.classList.remove('hidden');
      }
      this.modalDeleteBtn.classList.remove('hidden');
    } else {
      document.getElementById('eventModalTitle').textContent = 'Create New Event';
      this.editEventIdInput.value = '';
      this.editEventTitleInput.value = event?.title || '';
      const cat = event?.category || 'Bench Work';
      this.editEventColorSelect.value = event?.color || getCategoryDefaultColor(cat);
      this.editEventNotesInput.value = event?.notes || '';
      this.protocolInfoBanner.classList.add('hidden');

      this.modalSplitBtn.classList.add('hidden');
      this.modalDuplicateBtn.classList.add('hidden');
      this.modalDeleteBtn.classList.add('hidden');
    }

    this.eventEditModal.classList.remove('hidden');
    setTimeout(() => this.editEventTitleInput?.focus(), 50);
  }

  closeEventEditModal() {
    this.eventEditModal.classList.add('hidden');
    this.currentEditingEvent = null;
  }

  saveEventModalChanges() {
    const id = this.editEventIdInput.value;
    const title = (this.editEventTitleInput.value || '').trim();
    if (!title) {
      alert('Please enter an event title.');
      this.editEventTitleInput.focus();
      return;
    }

    const isAllDay = Boolean(this.editEventIsAllDay?.checked);
    const category = this.editEventCategorySelect.value;
    const color = this.editEventColorSelect.value;
    const notes = this.editEventNotesInput.value;

    let updates = {};

    if (isAllDay) {
      const startDate = this.editEventStartDate.value || formatDateKey(store.currentDate);
      const endDate = this.editEventEndDate.value || startDate;
      if (endDate < startDate) {
        alert('End date cannot be before start date.');
        return;
      }
      updates = {
        title,
        isAllDay: true,
        dateKey: startDate,
        endDateKey: endDate,
        startTime: '00:00',
        endTime: '23:59',
        category,
        color,
        notes
      };
    } else {
      const dateKey = this.editEventDateInput.value;
      const startTime = this.editEventStartTimeInput.value;
      const endTime = this.editEventEndTimeInput.value;
      // Timed events may end on a later day (e.g. overnight incubations)
      const endDateKey = this.editEventEndDateTimed.value || dateKey;

      if (!dateKey || !startTime || !endTime) {
        alert('Please fill in the start and end date and time.');
        return;
      }
      if (toAbsMinutes(endDateKey, endTime) <= toAbsMinutes(dateKey, startTime)) {
        alert('The end must be after the start.');
        return;
      }
      // Recurring occurrences are single-day
      if (this.currentEditingEvent?.isSeriesOccurrence && endDateKey !== dateKey) {
        alert('Recurring events must start and end on the same day.');
        return;
      }
      updates = {
        title,
        isAllDay: false,
        dateKey,
        endDateKey,
        startTime,
        endTime,
        category,
        color,
        notes
      };
    }

    if (this.currentEditingEvent?.isSeriesOccurrence) {
      const seriesObj = store.findSeries(this.currentEditingEvent.seriesId);
      const occDate = this.currentEditingEvent.occurrenceDate || this.currentEditingEvent.dateKey;
      this.closeEventEditModal();
      if (seriesObj) {
        this.openSeriesPromptModal(seriesObj, occDate, updates, false);
      }
      return;
    }

    if (id) {
      store.updateEvent(id, updates);
      this.showToast(`Updated "${title}"`);
    } else {
      const newEvt = {
        id: generateId('evt_user'),
        ...updates
      };
      store.addEvent(newEvt);
      this.showToast(`Created "${title}"`);
    }

    this.closeEventEditModal();
  }

  /**
   * Recurring Series Occurrence Edit Prompt Modal
   */
  initSeriesPromptModal() {
    this.seriesPromptTitle = document.getElementById('seriesPromptTitle');
    this.seriesPromptDescription = document.getElementById('seriesPromptDescription');
    this.seriesPromptConfirmBtn = document.getElementById('seriesPromptConfirmBtn');
    this.seriesPromptCancelBtn = document.getElementById('seriesPromptCancelBtn');
    this.seriesPromptCloseBtn = document.getElementById('seriesPromptCloseBtn');

    this.seriesPromptCancelBtn?.addEventListener('click', () => {
      this.seriesPromptModal.classList.add('hidden');
    });
    this.seriesPromptCloseBtn?.addEventListener('click', () => {
      this.seriesPromptModal.classList.add('hidden');
    });

    this.seriesPromptConfirmBtn?.addEventListener('click', () => {
      const selectedScope = document.querySelector('input[name="seriesEditScope"]:checked')?.value || 'this';
      this.seriesPromptModal.classList.add('hidden');

      if (!this.pendingSeriesContext) return;
      const { seriesObj, occDate, updates, isDelete } = this.pendingSeriesContext;

      if (isDelete) {
        store.deleteSeriesOccurrence(seriesObj.id, occDate, selectedScope);
        this.showToast(`Deleted recurring event (${selectedScope}).`);
      } else if (updates) {
        store.modifySeriesOccurrence(seriesObj.id, occDate, updates, selectedScope);
        this.showToast(`Updated recurring event (${selectedScope}).`);
      }
    });
  }

  openSeriesPromptModal(seriesObj, occDate, updates = null, isDelete = false) {
    this.pendingSeriesContext = { seriesObj, occDate, updates, isDelete };

    if (isDelete) {
      this.seriesPromptTitle.textContent = 'Delete Recurring Event';
      this.seriesPromptDescription.textContent = `Do you want to delete only this occurrence of "${seriesObj.title}", or all occurrences?`;
    } else {
      this.seriesPromptTitle.textContent = 'Edit Recurring Event';
      this.seriesPromptDescription.textContent = `Do you want to edit only this occurrence of "${seriesObj.title}", or all occurrences?`;
    }

    this.seriesPromptModal.classList.remove('hidden');
  }

  /**
   * Quota Creator & Multi-Target Goal Modal Handlers
   */
  initQuotaModal() {
    this.quotaEditIdInput = document.getElementById('quotaEditId');
    this.quotaModalTitle = document.getElementById('quotaModalTitle');
    this.quotaTitleInput = document.getElementById('quotaTitleInput');
    this.quotaWeeklyHoursInput = document.getElementById('quotaWeeklyHoursInput');
    this.quotaMonthlyHoursInput = document.getElementById('quotaMonthlyHoursInput');
    this.quotaTotalHoursInput = document.getElementById('quotaTotalHoursInput');
    this.quotaColorSelect = document.getElementById('quotaColorSelect');
    this.quotaCategoriesCheckboxes = document.getElementById('quotaCategoriesCheckboxes');
    this.quotaDescInput = document.getElementById('quotaDescInput');
    this.quotaSaveBtn = document.getElementById('quotaSaveBtn');
    this.quotaCancelBtn = document.getElementById('quotaCancelBtn');
    this.quotaModalCloseBtn = document.getElementById('quotaModalCloseBtn');

    this.quotaSaveBtn?.addEventListener('click', () => {
      const title = (this.quotaTitleInput.value || '').trim();
      if (!title) {
        alert('Please enter a goal title.');
        return;
      }
      const weeklyVal = parseFloat(this.quotaWeeklyHoursInput.value);
      const weeklyTarget = (!isNaN(weeklyVal) && weeklyVal > 0) ? weeklyVal : null;

      const monthlyVal = parseFloat(this.quotaMonthlyHoursInput.value);
      const monthlyTarget = (!isNaN(monthlyVal) && monthlyVal > 0) ? monthlyVal : null;

      const totalVal = parseFloat(this.quotaTotalHoursInput.value);
      const totalTarget = (!isNaN(totalVal) && totalVal > 0) ? totalVal : null;

      if (!weeklyTarget && !monthlyTarget && !totalTarget) {
        alert('Please specify at least one target (Weekly, Monthly, or Total).');
        return;
      }

      const color = this.quotaColorSelect.value || 'lavender';
      const desc = this.quotaDescInput.value || '';

      const checkedBoxes = this.quotaCategoriesCheckboxes.querySelectorAll('input:checked');
      const selectedCategories = Array.from(checkedBoxes).map((cb) => cb.value);

      const targetParts = [];
      if (weeklyTarget) targetParts.push(`${weeklyTarget}h/wk`);
      if (monthlyTarget) targetParts.push(`${monthlyTarget}h/mo`);
      if (totalTarget) targetParts.push(`${totalTarget}h total`);

      const editId = this.quotaEditIdInput.value;
      if (editId) {
        store.updateQuota(editId, {
          title,
          weeklyTarget,
          monthlyTarget,
          totalTarget,
          targetHours: weeklyTarget || monthlyTarget || totalTarget,
          color,
          categories: selectedCategories,
          description: desc
        });
        this.showToast(`Updated goal "${title}" (${targetParts.join(', ')})`);
      } else {
        store.addQuota({
          id: generateId('quota'),
          title,
          weeklyTarget,
          monthlyTarget,
          totalTarget,
          targetHours: weeklyTarget || monthlyTarget || totalTarget,
          color,
          categories: selectedCategories,
          description: desc
        });
        this.showToast(`Added goal "${title}" (${targetParts.join(', ')})`);
      }

      this.closeQuotaCreatorModal();
    });

    this.quotaCancelBtn?.addEventListener('click', () => this.closeQuotaCreatorModal());
    this.quotaModalCloseBtn?.addEventListener('click', () => this.closeQuotaCreatorModal());
  }

  openQuotaCreatorModal(quota = null) {
    // Populate category checkboxes
    this.quotaCategoriesCheckboxes.innerHTML = '';
    const categories = store.categories || [];
    const linked = new Set(quota?.categories || ['Quota Task']);

    categories.forEach((cat) => {
      const label = document.createElement('label');
      label.style.display = 'inline-flex';
      label.style.alignItems = 'center';
      label.style.gap = '4px';
      label.style.fontSize = '12px';
      label.style.cursor = 'pointer';

      label.innerHTML = `
        <input type="checkbox" value="${escapeHtml(cat.name)}" ${linked.has(cat.name) ? 'checked' : ''} style="accent-color:var(--google-blue);">
        <span>${escapeHtml(cat.name)}</span>
      `;
      this.quotaCategoriesCheckboxes.appendChild(label);
    });

    if (quota) {
      this.quotaModalTitle.textContent = 'Edit Goal & Quota';
      this.quotaEditIdInput.value = quota.id;
      this.quotaTitleInput.value = quota.title;
      this.quotaWeeklyHoursInput.value = (quota.weeklyTarget !== undefined && quota.weeklyTarget !== null) ? quota.weeklyTarget : '';
      this.quotaMonthlyHoursInput.value = (quota.monthlyTarget !== undefined && quota.monthlyTarget !== null) ? quota.monthlyTarget : '';
      this.quotaTotalHoursInput.value = (quota.totalTarget !== undefined && quota.totalTarget !== null) ? quota.totalTarget : '';
      this.quotaColorSelect.value = quota.color || 'lavender';
      this.quotaDescInput.value = quota.description || '';
    } else {
      this.quotaModalTitle.textContent = 'Goal & Quota Setup';
      this.quotaEditIdInput.value = '';
      this.quotaTitleInput.value = '';
      this.quotaWeeklyHoursInput.value = '3.0';
      this.quotaMonthlyHoursInput.value = '';
      this.quotaTotalHoursInput.value = '';
      this.quotaColorSelect.value = 'lavender';
      this.quotaDescInput.value = '';
    }

    this.quotaCreatorModal.classList.remove('hidden');
  }

  closeQuotaCreatorModal() {
    this.quotaCreatorModal.classList.add('hidden');
  }

  /**
   * Quick Event Class Creator & Editor Modal
   */
  initQuickClassModal() {
    this.quickClassModalTitle = document.getElementById('quickClassModalTitle');
    this.quickClassEditIdInput = document.getElementById('quickClassEditId');
    this.quickClassTitleInput = document.getElementById('quickClassTitleInput');
    this.quickClassDurationInput = document.getElementById('quickClassDurationInput');
    this.quickClassCategorySelect = document.getElementById('quickClassCategorySelect');
    this.quickClassColorSelect = document.getElementById('quickClassColorSelect');
    this.quickClassSaveBtn = document.getElementById('quickClassSaveBtn');
    this.quickClassCancelBtn = document.getElementById('quickClassCancelBtn');
    this.quickClassModalCloseBtn = document.getElementById('quickClassModalCloseBtn');

    this.quickClassSaveBtn?.addEventListener('click', () => {
      const title = (this.quickClassTitleInput.value || '').trim();
      if (!title) {
        alert('Please enter a class title.');
        return;
      }
      const duration = parseInt(this.quickClassDurationInput.value, 10) || 60;
      const category = this.quickClassCategorySelect.value || 'Bench Work';
      const color = this.quickClassColorSelect.value || 'ocean';

      const editId = this.quickClassEditIdInput.value;
      if (editId) {
        store.updateQuickClass(editId, { title, duration, category, color });
        this.showToast(`Updated quick class "${title}"`);
      } else {
        store.addQuickClass({
          id: generateId('qc'),
          title,
          duration,
          category,
          color
        });
        this.showToast(`Added quick class "${title}" (${duration}m)`);
      }

      this.closeQuickClassModal();
    });

    this.quickClassCancelBtn?.addEventListener('click', () => this.closeQuickClassModal());
    this.quickClassModalCloseBtn?.addEventListener('click', () => this.closeQuickClassModal());
  }

  openQuickClassModal(cls = null) {
    this.populateCategoriesSelect(this.quickClassCategorySelect, cls?.category || 'Bench Work');

    if (cls) {
      this.quickClassModalTitle.textContent = 'Edit Quick Event Class';
      this.quickClassEditIdInput.value = cls.id;
      this.quickClassTitleInput.value = cls.title;
      this.quickClassDurationInput.value = cls.duration || 60;
      this.quickClassCategorySelect.value = cls.category || 'Bench Work';
      this.quickClassColorSelect.value = cls.color || 'ocean';
    } else {
      this.quickClassModalTitle.textContent = 'New Quick Event Class';
      this.quickClassEditIdInput.value = '';
      this.quickClassTitleInput.value = '';
      this.quickClassDurationInput.value = 60;
      this.quickClassCategorySelect.value = 'Bench Work';
      this.quickClassColorSelect.value = 'ocean';
    }

    this.quickClassModal.classList.remove('hidden');
    setTimeout(() => this.quickClassTitleInput?.focus(), 50);
  }

  closeQuickClassModal() {
    this.quickClassModal.classList.add('hidden');
  }

  /**
   * Calendar Category Creator & Editor Modal
   */
  initCategoryModal() {
    this.categoryModalTitle = document.getElementById('categoryModalTitle');
    this.categoryEditOldNameInput = document.getElementById('categoryEditOldName');
    this.categoryNameInput = document.getElementById('categoryNameInput');
    this.categoryColorSelect = document.getElementById('categoryColorSelect');
    this.categorySaveBtn = document.getElementById('categorySaveBtn');
    this.categoryCancelBtn = document.getElementById('categoryCancelBtn');
    this.categoryModalCloseBtn = document.getElementById('categoryModalCloseBtn');

    this.categorySaveBtn?.addEventListener('click', () => {
      const name = (this.categoryNameInput.value || '').trim();
      if (!name) {
        alert('Please enter a category name.');
        return;
      }
      const color = this.categoryColorSelect.value || 'ocean';
      const oldName = this.categoryEditOldNameInput.value;

      const saved = oldName
        ? store.updateCategory(oldName, { name, color })
        : store.addCategory({ name, color });
      if (!saved) {
        alert(`A category named "${name}" already exists.`);
        return;
      }
      this.showToast(oldName ? `Updated category "${name}"` : `Added category "${name}"`);

      this.closeCategoryModal();
    });

    this.categoryCancelBtn?.addEventListener('click', () => this.closeCategoryModal());
    this.categoryModalCloseBtn?.addEventListener('click', () => this.closeCategoryModal());
  }

  openCategoryModal(cat = null) {
    if (cat) {
      this.categoryModalTitle.textContent = 'Edit Calendar Category';
      this.categoryEditOldNameInput.value = cat.name;
      this.categoryNameInput.value = cat.name;
      this.categoryColorSelect.value = cat.color || 'ocean';
    } else {
      this.categoryModalTitle.textContent = 'New Calendar Category';
      this.categoryEditOldNameInput.value = '';
      this.categoryNameInput.value = '';
      this.categoryColorSelect.value = 'ocean';
    }

    this.categoryModal.classList.remove('hidden');
    setTimeout(() => this.categoryNameInput?.focus(), 50);
  }

  closeCategoryModal() {
    this.categoryModal.classList.add('hidden');
  }

  /**
   * Progressive Web App (PWA) Initialization
   */
  initPwa() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((err) => {
          console.warn('PWA ServiceWorker registration notice:', err);
        });
      });
    }

    this.installPwaBtn = document.getElementById('installPwaBtn');
    let deferredPrompt = null;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (this.installPwaBtn) {
        this.installPwaBtn.classList.remove('hidden');
        this.installPwaBtn.onclick = async () => {
          if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
              this.showToast('LabCal installed successfully!');
              this.installPwaBtn.classList.add('hidden');
            }
            deferredPrompt = null;
          }
        };
      }
    });

    window.addEventListener('appinstalled', () => {
      if (this.installPwaBtn) this.installPwaBtn.classList.add('hidden');
      this.showToast('LabCal is installed on your device!');
    });
  }

  /**
   * Cloud Sync & Multi-Device Modal Coordinator
   */
  initCloudSyncModal() {
    this.cloudSyncBtn = document.getElementById('cloudSyncBtn');
    this.cloudSyncModal = document.getElementById('cloudSyncModal');
    this.cloudSyncCloseBtn = document.getElementById('cloudSyncCloseBtn');
    this.cloudSyncDoneBtn = document.getElementById('cloudSyncDoneBtn');

    this.cloudSyncIndicator = document.getElementById('cloudSyncIndicator');
    this.cloudSyncLabel = document.getElementById('cloudSyncLabel');

    // Status Card Elements
    this.syncModalStatusDot = document.getElementById('syncModalStatusDot');
    this.syncModalStatusText = document.getElementById('syncModalStatusText');
    this.syncModalStatusSubtext = document.getElementById('syncModalStatusSubtext');
    this.syncNowBtn = document.getElementById('syncNowBtn');
    this.signOutBtn = document.getElementById('signOutBtn');

    // Auth Elements
    this.authFormsContainer = document.getElementById('authFormsContainer');
    this.authLoggedInView = document.getElementById('authLoggedInView');
    this.syncEmailInput = document.getElementById('syncEmailInput');
    this.syncPasswordInput = document.getElementById('syncPasswordInput');
    this.signInBtn = document.getElementById('signInBtn');
    this.signUpBtn = document.getElementById('signUpBtn');
    this.triggerSyncNowBtn = document.getElementById('triggerSyncNowBtn');

    // Config Elements
    this.syncSupabaseUrlInput = document.getElementById('syncSupabaseUrlInput');
    this.syncAnonKeyInput = document.getElementById('syncAnonKeyInput');
    this.syncPassphraseInput = document.getElementById('syncPassphraseInput');
    this.saveSyncConfigBtn = document.getElementById('saveSyncConfigBtn');

    // Tabs
    this.tabAccountBtn = document.getElementById('tabAccountBtn');
    this.tabConfigBtn = document.getElementById('tabConfigBtn');
    this.tabGuideBtn = document.getElementById('tabGuideBtn');
    this.syncTabAccount = document.getElementById('syncTabAccount');
    this.syncTabConfig = document.getElementById('syncTabConfig');
    this.syncTabGuide = document.getElementById('syncTabGuide');

    // Guide Elements
    this.sqlSnippetBox = document.getElementById('sqlSnippetBox');
    this.copySqlBtn = document.getElementById('copySqlBtn');

    if (this.sqlSnippetBox) {
      this.sqlSnippetBox.textContent = SUPABASE_SETUP_SQL;
    }

    // Modal open / close
    this.cloudSyncBtn?.addEventListener('click', () => {
      this.openCloudSyncModal();
    });
    this.cloudSyncCloseBtn?.addEventListener('click', () => {
      this.closeCloudSyncModal();
    });
    this.cloudSyncDoneBtn?.addEventListener('click', () => {
      this.closeCloudSyncModal();
    });

    // Tab navigation
    const switchTab = (tabName) => {
      [this.tabAccountBtn, this.tabConfigBtn, this.tabGuideBtn].forEach(b => b?.classList.remove('active'));
      [this.syncTabAccount, this.syncTabConfig, this.syncTabGuide].forEach(p => p?.classList.add('hidden'));

      if (tabName === 'account') {
        this.tabAccountBtn?.classList.add('active');
        this.syncTabAccount?.classList.remove('hidden');
      } else if (tabName === 'config') {
        this.tabConfigBtn?.classList.add('active');
        this.syncTabConfig?.classList.remove('hidden');
      } else if (tabName === 'guide') {
        this.tabGuideBtn?.classList.add('active');
        this.syncTabGuide?.classList.remove('hidden');
      }
    };

    this.tabAccountBtn?.addEventListener('click', () => switchTab('account'));
    this.tabConfigBtn?.addEventListener('click', () => switchTab('config'));
    this.tabGuideBtn?.addEventListener('click', () => switchTab('guide'));

    // Status updates
    this.syncManager.onStatusChange((status, details, config) => {
      this.updateCloudSyncUI(status, details, config);
    });

    // Sign In / Sign Up
    this.signInBtn?.addEventListener('click', async () => {
      const email = (this.syncEmailInput.value || '').trim();
      const password = this.syncPasswordInput.value;
      if (!email || !password) {
        alert('Please enter your email and password.');
        return;
      }
      try {
        this.signInBtn.disabled = true;
        this.signInBtn.textContent = 'Signing In...';
        await this.syncManager.signIn(email, password);
        this.showToast(`Logged in as ${email}`);
      } catch (err) {
        alert(`Login failed: ${err.message}`);
      } finally {
        this.signInBtn.disabled = false;
        this.signInBtn.textContent = 'Sign In';
      }
    });

    this.signUpBtn?.addEventListener('click', async () => {
      const email = (this.syncEmailInput.value || '').trim();
      const password = this.syncPasswordInput.value;
      if (!email || !password) {
        alert('Please enter your email and password.');
        return;
      }
      try {
        this.signUpBtn.disabled = true;
        this.signUpBtn.textContent = 'Creating...';
        await this.syncManager.signUp(email, password);
        this.showToast('Account created!');
      } catch (err) {
        alert(`Account creation failed: ${err.message}`);
      } finally {
        this.signUpBtn.disabled = false;
        this.signUpBtn.textContent = 'Create Account';
      }
    });

    // Disconnect / Log Out
    this.signOutBtn?.addEventListener('click', () => {
      if (confirm('Disconnect from cloud sync? Your local calendar will be preserved.')) {
        this.syncManager.signOut();
        this.showToast('Disconnected from cloud.');
      }
    });

    // Manual Sync
    const handleSync = async () => {
      await this.syncManager.syncNow();
      if (this.syncManager.status === 'synced') {
        this.showToast('Synchronized with cloud!');
      } else if (this.syncManager.status === 'error') {
        this.showToast(`Sync: ${this.syncManager.statusDetails}`);
      }
    };
    this.syncNowBtn?.addEventListener('click', handleSync);
    this.triggerSyncNowBtn?.addEventListener('click', handleSync);

    // Save Database Settings
    this.saveSyncConfigBtn?.addEventListener('click', () => {
      const url = (this.syncSupabaseUrlInput.value || '').trim();
      const key = (this.syncAnonKeyInput.value || '').trim();
      const pass = (this.syncPassphraseInput.value || '').trim();

      if (this.syncManager.formatBaseUrl(url) !== this.syncManager.formatBaseUrl(this.syncManager.config.supabaseUrl)) {
        // Different project: this device has never synced with it
        this.syncManager.config.lastSyncedServerAt = null;
        this.syncManager.config.localDirty = true;
      }
      this.syncManager.config.supabaseUrl = url;
      this.syncManager.config.supabaseAnonKey = key;
      this.syncManager.config.passphrase = pass;
      this.syncManager.saveConfig();

      this.showToast('Database configuration saved!');
      if (this.syncManager.isConnected()) {
        this.syncManager.syncNow();
      } else {
        switchTab('account');
      }
    });

    // Copy SQL Script
    this.copySqlBtn?.addEventListener('click', () => {
      navigator.clipboard.writeText(SUPABASE_SETUP_SQL).then(() => {
        this.copySqlBtn.textContent = 'Copied!';
        setTimeout(() => { this.copySqlBtn.textContent = 'Copy SQL'; }, 2000);
      });
    });
  }

  updateCloudSyncUI(status, details, config) {
    if (!this.cloudSyncIndicator || !this.cloudSyncLabel) return;

    this.cloudSyncIndicator.className = 'sync-dot';
    if (this.syncModalStatusDot) this.syncModalStatusDot.className = 'sync-dot';

    const isConnected = this.syncManager.isConnected();

    if (status === 'synced') {
      this.cloudSyncIndicator.classList.add('sync-dot-synced');
      this.cloudSyncLabel.textContent = 'Synced';
      if (this.syncModalStatusDot) this.syncModalStatusDot.classList.add('sync-dot-synced');
      if (this.syncModalStatusText) this.syncModalStatusText.textContent = 'Connected & Synced';
      if (this.syncModalStatusSubtext) this.syncModalStatusSubtext.textContent = details || `User: ${config.userEmail}`;
    } else if (status === 'syncing') {
      this.cloudSyncIndicator.classList.add('sync-dot-syncing');
      this.cloudSyncLabel.textContent = 'Syncing...';
      if (this.syncModalStatusDot) this.syncModalStatusDot.classList.add('sync-dot-syncing');
      if (this.syncModalStatusText) this.syncModalStatusText.textContent = 'Synchronizing...';
      if (this.syncModalStatusSubtext) this.syncModalStatusSubtext.textContent = 'Communicating with cloud';
    } else if (status === 'error') {
      this.cloudSyncIndicator.classList.add('sync-dot-error');
      this.cloudSyncLabel.textContent = 'Sync Error';
      if (this.syncModalStatusDot) this.syncModalStatusDot.classList.add('sync-dot-error');
      if (this.syncModalStatusText) this.syncModalStatusText.textContent = 'Sync Notice';
      if (this.syncModalStatusSubtext) this.syncModalStatusSubtext.textContent = details;
    } else if (isConnected) {
      this.cloudSyncIndicator.classList.add('sync-dot-synced');
      this.cloudSyncLabel.textContent = 'Connected';
      if (this.syncModalStatusDot) this.syncModalStatusDot.classList.add('sync-dot-synced');
      if (this.syncModalStatusText) this.syncModalStatusText.textContent = `Connected (${config.userEmail})`;
      if (this.syncModalStatusSubtext) this.syncModalStatusSubtext.textContent = details || 'Ready to sync';
    } else {
      this.cloudSyncIndicator.classList.add('sync-dot-local');
      this.cloudSyncLabel.textContent = 'Cloud Sync';
      if (this.syncModalStatusDot) this.syncModalStatusDot.classList.add('sync-dot-local');
      if (this.syncModalStatusText) this.syncModalStatusText.textContent = 'Local Storage Only';
      if (this.syncModalStatusSubtext) this.syncModalStatusSubtext.textContent = 'Click to connect Supabase';
    }

    if (isConnected) {
      this.syncNowBtn?.classList.remove('hidden');
      this.signOutBtn?.classList.remove('hidden');
      this.authFormsContainer?.classList.add('hidden');
      this.authLoggedInView?.classList.remove('hidden');
    } else {
      this.syncNowBtn?.classList.add('hidden');
      this.signOutBtn?.classList.add('hidden');
      this.authFormsContainer?.classList.remove('hidden');
      this.authLoggedInView?.classList.add('hidden');
    }
  }

  openCloudSyncModal() {
    if (this.syncSupabaseUrlInput) this.syncSupabaseUrlInput.value = this.syncManager.config.supabaseUrl || '';
    if (this.syncAnonKeyInput) this.syncAnonKeyInput.value = this.syncManager.config.supabaseAnonKey || '';
    if (this.syncPassphraseInput) this.syncPassphraseInput.value = this.syncManager.config.passphrase || '';
    if (this.syncEmailInput && !this.syncManager.isConnected()) this.syncEmailInput.value = this.syncManager.config.userEmail || '';

    this.cloudSyncModal?.classList.remove('hidden');
  }

  closeCloudSyncModal() {
    this.cloudSyncModal?.classList.add('hidden');
  }

  /**
   * Export to Google Calendar: a week, a date range or everything, with or without
   * passive steps / recurring events / hidden categories.
   */
  initIcsExportModal() {
    this.icsModal = document.getElementById('icsExportModal');
    if (!this.icsModal) return;
    this.icsWeekDate = document.getElementById('icsWeekDate');
    this.icsWeekLabel = document.getElementById('icsWeekLabel');
    this.icsFromDate = document.getElementById('icsFromDate');
    this.icsToDate = document.getElementById('icsToDate');
    this.icsIncludePassive = document.getElementById('icsIncludePassive');
    this.icsIncludeRecurring = document.getElementById('icsIncludeRecurring');
    this.icsOnlyVisible = document.getElementById('icsOnlyVisible');
    this.icsSummary = document.getElementById('icsExportSummary');

    const close = () => this.icsModal.classList.add('hidden');
    document.getElementById('icsExportCloseBtn')?.addEventListener('click', close);
    document.getElementById('icsExportCancelBtn')?.addEventListener('click', close);

    // Picking a date selects the matching range option
    this.icsWeekDate.addEventListener('change', () => this.setIcsRange('week'));
    [this.icsFromDate, this.icsToDate].forEach((input) => input.addEventListener('change', () => this.setIcsRange('custom')));
    this.icsModal.querySelectorAll('input').forEach((input) => input.addEventListener('change', () => this.updateIcsSummary()));

    document.getElementById('icsExportDownloadBtn')?.addEventListener('click', () => {
      const result = this.computeIcsExport();
      if (result.error) {
        alert(result.error);
        return;
      }
      if (result.count === 0) {
        alert('Nothing to export with these options.');
        return;
      }
      exportToIcs(result.events, result.series, result.exceptions, result.fileLabel);
      close();
      this.showToast(`Downloaded ${result.description}. In Google Calendar: Settings → Import & export → Import.`);
    });
  }

  openIcsExportModal() {
    const weekDates = getWeekDates(store.currentDate);
    this.icsWeekDate.value = formatDateKey(store.currentDate);
    this.icsFromDate.value = formatDateKey(weekDates[0]);
    this.icsToDate.value = formatDateKey(weekDates[6]);
    this.icsIncludePassive.checked = store.settings.showPassive !== false;
    this.icsIncludeRecurring.checked = true;
    this.icsOnlyVisible.checked = true;
    this.setIcsRange('week');
    this.icsModal.classList.remove('hidden');
  }

  setIcsRange(value) {
    const radio = this.icsModal.querySelector(`input[name="icsRange"][value="${value}"]`);
    if (radio) radio.checked = true;
    this.updateIcsSummary();
  }

  updateIcsSummary() {
    const weekStart = getWeekDates(parseDateKey(this.icsWeekDate.value || formatDateKey(store.currentDate)))[0];
    const weekEnd = parseDateKey(shiftDateKey(formatDateKey(weekStart), 6));
    const short = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    this.icsWeekLabel.textContent = `(${short(weekStart)} – ${short(weekEnd)})`;

    const result = this.computeIcsExport();
    this.icsSummary.textContent = result.error ? result.error : `Will export: ${result.description}`;
  }

  // Events / series to export for the dialog's current options
  computeIcsExport() {
    const range = this.icsModal.querySelector('input[name="icsRange"]:checked')?.value || 'week';
    const includePassive = this.icsIncludePassive.checked;
    const includeRecurring = this.icsIncludeRecurring.checked;
    const onlyVisible = this.icsOnlyVisible.checked;

    const categoryShown = (category) => !onlyVisible || !category ||
      store.visibleCategories.has(category) || !store.categories.some((c) => c.name === category);
    const keepEvent = (evt) => (includePassive || evt.stepType !== 'passive') && categoryShown(evt.category);
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

    if (range === 'all') {
      const events = store.events.filter(keepEvent);
      const series = includeRecurring ? store.series.filter((s) => categoryShown(s.category)) : [];
      const seriesIds = new Set(series.map((s) => s.id));
      const exceptions = store.exceptions.filter((e) => seriesIds.has(e.seriesId));
      return {
        events,
        series,
        exceptions,
        count: events.length + series.length,
        fileLabel: `all_${formatDateKey(new Date())}`,
        description: `${plural(events.length, 'event')}${series.length ? ` + ${series.length} recurring series` : ''}`
      };
    }

    let fromKey;
    let toKey;
    if (range === 'week') {
      fromKey = formatDateKey(getWeekDates(parseDateKey(this.icsWeekDate.value || formatDateKey(store.currentDate)))[0]);
      toKey = shiftDateKey(fromKey, 6);
    } else {
      fromKey = this.icsFromDate.value;
      toKey = this.icsToDate.value;
      if (!fromKey || !toKey) return { error: 'Choose a start and an end date.', count: 0 };
      if (toKey < fromKey) return { error: 'The end date must be on or after the start date.', count: 0 };
      if (calculateDaysBetween(fromKey, toKey) > 366) return { error: 'Choose a range of at most one year (or "Everything").', count: 0 };
    }

    const dateKeys = [];
    for (let key = fromKey; key <= toKey; key = shiftDateKey(key, 1)) dateKeys.push(key);

    // Recurring events become single events on their dates in this range
    const events = store.getExpandedEventsForRange(dateKeys).filter((evt) => {
      if (evt.isSeriesOccurrence && !includeRecurring) return false;
      const { firstKey, lastKey } = getEventDayRange(evt);
      return firstKey <= toKey && lastKey >= fromKey && keepEvent(evt);
    });

    return {
      events,
      series: [],
      exceptions: [],
      count: events.length,
      fileLabel: range === 'week' ? `week_${fromKey}` : `${fromKey}_to_${toKey}`,
      description: `${plural(events.length, 'event')} (${fromKey} to ${toKey})`
    };
  }

  exportBackup() {
    exportStateToJson({
      series: store.series,
      exceptions: store.exceptions,
      events: store.events,
      quotas: store.quotas,
      customProtocols: store.customProtocols,
      deletedProtocolIds: Array.from(store.deletedProtocolIds),
      quickClasses: store.quickClasses,
      categories: store.categories,
      settings: {
        ...store.settings,
        visibleCategories: Array.from(store.visibleCategories)
      }
    });
  }

  /**
   * Ask which version wins when both this device and the cloud changed.
   * Resolves to 'local', 'cloud' or null (decide later).
   */
  initSyncConflictModal() {
    const modal = document.getElementById('syncConflictModal');
    const localBtn = document.getElementById('syncConflictLocalBtn');
    const cloudBtn = document.getElementById('syncConflictCloudBtn');
    const cancelBtn = document.getElementById('syncConflictCancelBtn');
    const backupBtn = document.getElementById('syncConflictBackupBtn');
    if (!modal) return;

    backupBtn?.addEventListener('click', () => {
      this.exportBackup();
      this.showToast('Downloaded a backup of this device.');
    });

    this.syncManager.conflictResolver = () => new Promise((resolve) => {
      const finish = (choice) => {
        modal.classList.add('hidden');
        localBtn.onclick = cloudBtn.onclick = cancelBtn.onclick = null;
        resolve(choice);
      };
      localBtn.onclick = () => finish('local');
      cloudBtn.onclick = () => finish('cloud');
      cancelBtn.onclick = () => finish(null);
      modal.classList.remove('hidden');
    });
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

document.addEventListener('DOMContentLoaded', () => {
  window.app = new LabCalendarApp();
});

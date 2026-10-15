/**
 * Interactive Protocol Builder Modal & Timeline Editor
 * Implements mutually exclusive anchorType ('after-previous' vs 'day-anchored'),
 * active/passive step type selector, drag-to-reorder steps, and a timeline preview
 * with real clock times (including steps that run past midnight)
 */

import {
  generateId,
  formatDuration,
  formatTimeDisplay,
  escapeHtml,
  safeColor,
  timeToMinutes,
  toAbsMinutes,
  getEventSpan,
  MINUTES_PER_DAY
} from './utils.js';
import {
  instantiateProtocol,
  MAX_STEP_MINUTES,
  normalizeProtocolCategory,
  UNCATEGORIZED_PROTOCOLS
} from './protocols.js';

// Reference date for the preview: only day offsets and clock times are shown
const PREVIEW_DATE_KEY = '2026-01-05';
const MAX_DAY_OFFSET = 30;

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (value === '' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Hours + minutes inputs used for durations and gaps (e.g. a 20 h incubation)
function durationInputsHtml(cls, minutes) {
  const h = Math.floor((minutes || 0) / 60);
  const m = (minutes || 0) % 60;
  return `
    <div class="duration-input ${cls}">
      <input type="number" class="input-sm dur-h" min="0" max="${MAX_STEP_MINUTES / 60}" step="1" inputmode="numeric" value="${h}" aria-label="Hours" />
      <span>h</span>
      <input type="number" class="input-sm dur-m" min="0" max="59" step="5" inputmode="numeric" value="${m}" aria-label="Minutes" />
      <span>min</span>
    </div>
  `;
}

function readDurationInputs(wrapper, min, fallback) {
  const h = clampInt(wrapper.querySelector('.dur-h').value, 0, MAX_STEP_MINUTES / 60, 0);
  const m = clampInt(wrapper.querySelector('.dur-m').value, 0, 59, 0);
  const total = h * 60 + m;
  return total === 0 && min > 0 ? fallback : Math.min(MAX_STEP_MINUTES, Math.max(min, total));
}

export class ProtocolBuilder {
  constructor(store, onProtocolSaved) {
    this.store = store;
    this.onProtocolSaved = onProtocolSaved;

    this.modalEl = document.getElementById('protocolBuilderModal');
    this.steps = [];
    this.collapsedStepIds = new Set();
    this.editingProtocolId = null;

    this.initElements();
    this.initEvents();
  }

  initElements() {
    this.nameInput = document.getElementById('protoBuildName');
    this.categoryInput = document.getElementById('protoBuildCategory');
    this.colorSelect = document.getElementById('protoBuildColor');
    this.descInput = document.getElementById('protoBuildDesc');
    this.stepsContainer = document.getElementById('protoBuildStepsList');
    this.previewContainer = document.getElementById('protoBuildTimelinePreview');
    this.previewStartInput = document.getElementById('protoBuildPreviewStart');

    this.addStepBtn = document.getElementById('protoBuildAddStepBtn');
    this.addStepBottomBtn = document.getElementById('protoBuildAddStepBottomBtn');
    this.saveBtn = document.getElementById('protoBuildSaveBtn');
    this.closeBtn = document.getElementById('protoBuildCloseBtn');
    this.cancelBtn = document.getElementById('protoBuildCancelBtn');
  }

  initEvents() {
    this.addStepBtn?.addEventListener('click', () => this.addStep());
    this.addStepBottomBtn?.addEventListener('click', () => this.addStep());

    this.saveBtn?.addEventListener('click', () => {
      this.saveProtocol();
    });

    this.closeBtn?.addEventListener('click', () => this.close());
    this.cancelBtn?.addEventListener('click', () => this.close());

    this.colorSelect?.addEventListener('change', () => this.renderTimelinePreview());
    this.previewStartInput?.addEventListener('change', () => this.renderTimelinePreview());
  }

  open(templateProtocol = null) {
    // Custom protocols are edited in place; built-ins are copied into a new custom protocol
    const isCustom = Boolean(templateProtocol) &&
      this.store.customProtocols.some((p) => p.id === templateProtocol.id);
    this.editingProtocolId = isCustom ? templateProtocol.id : null;
    this.collapsedStepIds = new Set();

    this.renderCategoryOptions();

    if (templateProtocol) {
      this.nameInput.value = isCustom ? templateProtocol.name : `${templateProtocol.name} (Custom)`;
      const category = normalizeProtocolCategory(templateProtocol.category);
      this.categoryInput.value = category === UNCATEGORIZED_PROTOCOLS ? '' : category;
      this.colorSelect.value = templateProtocol.color || 'ocean';
      this.descInput.value = templateProtocol.description || '';
      this.steps = JSON.parse(JSON.stringify(templateProtocol.steps))
        .map((s) => ({ ...s, id: s.id || generateId('step') }));
    } else {
      this.nameInput.value = '';
      this.categoryInput.value = '';
      this.colorSelect.value = 'ocean';
      this.descInput.value = '';
      this.steps = [
        this.newStep({ title: 'Sample Preparation & Lysis', durationMinutes: 45, gapMinutes: 0 }),
        this.newStep({ title: 'Incubation / Blocking', durationMinutes: 60, gapMinutes: 15, stepType: 'passive' })
      ];
    }

    this.renderStepsList();
    this.renderTimelinePreview();
    this.modalEl.classList.remove('hidden');
  }

  close() {
    this.modalEl.classList.add('hidden');
  }

  // Suggest the protocol categories already used in the library
  renderCategoryOptions() {
    const datalist = document.getElementById('protoBuildCategoryOptions');
    if (!datalist) return;
    const categories = new Set(this.store.getAllProtocols()
      .map((p) => normalizeProtocolCategory(p.category))
      .filter((c) => c !== UNCATEGORIZED_PROTOCOLS));
    datalist.innerHTML = '';
    [...categories].sort((a, b) => a.localeCompare(b)).forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      datalist.appendChild(option);
    });
  }

  newStep(overrides = {}) {
    return {
      id: generateId('step'),
      title: `Step ${this.steps.length + 1}`,
      durationMinutes: 45,
      anchorType: 'after-previous',
      gapMinutes: 15,
      offsetMinutes: 0,
      notBefore: '',
      dayOffset: 0,
      anchorTime: '09:00',
      stepType: 'active',
      notes: '',
      ...overrides
    };
  }

  // Insert a new step at index (default: at the end), then bring it into view
  addStep(index = this.steps.length) {
    const step = this.newStep();
    this.steps.splice(index, 0, step);
    this.refresh();
    this.focusStep(step.id);
  }

  duplicateStep(index) {
    const copy = { ...JSON.parse(JSON.stringify(this.steps[index])), id: generateId('step') };
    copy.title = `${copy.title} (copy)`;
    this.steps.splice(index + 1, 0, copy);
    this.refresh();
    this.focusStep(copy.id);
  }

  removeStep(index) {
    if (this.steps.length <= 1) {
      alert('A protocol must contain at least one step.');
      return;
    }
    this.steps.splice(index, 1);
    this.refresh();
  }

  moveStepTo(fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= this.steps.length || fromIndex === toIndex) {
      this.renderStepsList();
      return;
    }
    const [step] = this.steps.splice(fromIndex, 1);
    this.steps.splice(toIndex, 0, step);
    this.refresh();
  }

  toggleCollapsed(stepId) {
    if (this.collapsedStepIds.has(stepId)) this.collapsedStepIds.delete(stepId);
    else this.collapsedStepIds.add(stepId);
    this.renderStepsList();
  }

  refresh() {
    this.renderStepsList();
    this.renderTimelinePreview();
  }

  focusStep(stepId) {
    const card = this.stepsContainer.querySelector(`[data-step-id="${CSS.escape(stepId)}"]`);
    if (!card) return;
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const title = card.querySelector('.step-title-input');
    setTimeout(() => {
      title?.focus();
      title?.select();
    }, 150);
  }

  // Default "earliest start": the start of the working day from the Display settings
  defaultEarliestStart() {
    return this.store.settings?.workingHoursStart || '09:30';
  }

  stepSummary(step) {
    let timing;
    if (step.anchorType === 'day-anchored') {
      timing = `Day ${(step.dayOffset || 0) + 1} at ${step.anchorTime || '09:00'}`;
    } else if (step.anchorType === 'during-previous') {
      timing = step.offsetMinutes ? `${formatDuration(step.offsetMinutes)} into previous` : 'together with previous';
    } else {
      timing = step.gapMinutes ? `${formatDuration(step.gapMinutes)} after previous` : 'right after previous';
    }
    if (step.notBefore && step.anchorType !== 'day-anchored') timing += `, not before ${step.notBefore}`;
    return `${formatDuration(step.durationMinutes)} • ${timing}`;
  }

  renderStepsList() {
    this.stepsContainer.innerHTML = '';

    this.steps.forEach((step, idx) => {
      this.stepsContainer.appendChild(this.renderStepCard(step, idx));

      // "+" between steps (the button below the list adds at the end)
      if (idx < this.steps.length - 1) {
        const insertBtn = document.createElement('button');
        insertBtn.type = 'button';
        insertBtn.className = 'step-insert-btn';
        insertBtn.title = `Insert a step between step ${idx + 1} and ${idx + 2}`;
        insertBtn.setAttribute('aria-label', insertBtn.title);
        insertBtn.textContent = '+';
        insertBtn.addEventListener('click', () => this.addStep(idx + 1));
        this.stepsContainer.appendChild(insertBtn);
      }
    });
  }

  renderStepCard(step, idx) {
    const stepRow = document.createElement('div');
    const isCollapsed = this.collapsedStepIds.has(step.id);
    stepRow.className = `proto-step-editor-card ${isCollapsed ? 'is-collapsed' : ''}`;
    stepRow.dataset.stepId = step.id;
    stepRow.dataset.index = idx;

    // The first step can't overlap a previous one
    const anchorType = step.anchorType === 'during-previous' && idx === 0 ? 'after-previous' : (step.anchorType || 'after-previous');

    stepRow.innerHTML = `
      <div class="step-card-header">
        <div class="step-card-left">
          <button type="button" class="step-drag-handle" title="Drag to reorder" aria-label="Drag to reorder step ${idx + 1}">⋮⋮</button>
          <div class="step-card-num-badge">Step ${idx + 1}</div>
          <div class="step-card-summary">
            <strong>${escapeHtml(step.title || 'Untitled Step')}</strong>
            <span>${escapeHtml(this.stepSummary(step))}</span>
          </div>
        </div>
        <div class="step-card-actions">
          <button type="button" class="icon-btn-sm" data-action="up" title="Move Up" ${idx === 0 ? 'disabled' : ''}>▲</button>
          <button type="button" class="icon-btn-sm" data-action="down" title="Move Down" ${idx === this.steps.length - 1 ? 'disabled' : ''}>▼</button>
          <button type="button" class="icon-btn-sm" data-action="duplicate" title="Duplicate Step">⧉</button>
          <button type="button" class="icon-btn-sm" data-action="collapse" title="${isCollapsed ? 'Expand' : 'Collapse'}" aria-expanded="${!isCollapsed}">${isCollapsed ? '▸' : '▾'}</button>
          <button type="button" class="icon-btn-sm btn-delete" data-action="delete" title="Remove Step">✕</button>
        </div>
      </div>

      <div class="step-form-grid">
        <div class="form-group full-width">
          <label>Step Title</label>
          <input type="text" class="input-sm step-title-input" value="${escapeHtml(step.title || '')}" placeholder="e.g. Primary Antibody Incubation" />
        </div>

        <div class="form-group">
          <label>Starts</label>
          <select class="input-sm step-anchor-type-select">
            <option value="after-previous" ${anchorType === 'after-previous' ? 'selected' : ''}>After previous step(s) finish</option>
            <option value="during-previous" ${anchorType === 'during-previous' ? 'selected' : ''} ${idx === 0 ? 'disabled' : ''}>During previous step (overlap)</option>
            <option value="day-anchored" ${anchorType === 'day-anchored' ? 'selected' : ''}>On a specific day & time</option>
          </select>
        </div>

        ${anchorType === 'day-anchored' ? `
          <div class="form-group">
            <label>Day</label>
            <input type="number" class="input-sm step-day-input" min="1" max="${MAX_DAY_OFFSET + 1}" step="1" inputmode="numeric" value="${(step.dayOffset || 0) + 1}" />
          </div>
          <div class="form-group">
            <label>Start Time on Day</label>
            <input type="time" class="input-sm step-anchor-time-input" value="${escapeHtml(step.anchorTime || '09:00')}" />
          </div>
        ` : `
          ${anchorType === 'during-previous' ? `
            <div class="form-group">
              <label>Starts after previous step begins</label>
              ${durationInputsHtml('step-offset-input', step.offsetMinutes || 0)}
            </div>
          ` : `
            <div class="form-group">
              <label>Wait Before</label>
              ${durationInputsHtml('step-gap-input', step.gapMinutes || 0)}
            </div>
          `}
          <div class="form-group">
            <label class="not-before-label" title="If the step would start earlier in the day (e.g. right after an overnight incubation ending at 06:00), it waits until this time">
              <input type="checkbox" class="step-not-before-toggle" ${step.notBefore ? 'checked' : ''} />
              Earliest start
            </label>
            <input type="time" class="input-sm step-not-before-input" value="${escapeHtml(step.notBefore || this.defaultEarliestStart())}" ${step.notBefore ? '' : 'disabled'} />
          </div>
        `}

        <div class="form-group">
          <label>Duration</label>
          ${durationInputsHtml('step-duration-input', step.durationMinutes || 30)}
        </div>

        <div class="form-group">
          <label>Step Nature</label>
          <select class="input-sm step-type-select">
            <option value="active" ${step.stepType === 'active' ? 'selected' : ''}>Active Bench Work</option>
            <option value="passive" ${step.stepType === 'passive' ? 'selected' : ''}>Passive / Incubation (Hatched)</option>
            <option value="run" ${step.stepType === 'run' ? 'selected' : ''}>Instrument Run</option>
          </select>
        </div>

        <div class="form-group full-width">
          <label>Reagents & Bench Notes</label>
          <input type="text" class="input-sm step-notes-input" value="${escapeHtml(step.notes || '')}" placeholder="e.g. Centrifuge 4°C, 12,000 rpm; add DTT fresh" />
        </div>
      </div>
    `;

    const updateSummary = () => {
      stepRow.querySelector('.step-card-summary strong').textContent = step.title || 'Untitled Step';
      stepRow.querySelector('.step-card-summary span').textContent = this.stepSummary(step);
    };

    // Inputs handling
    stepRow.querySelector('.step-title-input').addEventListener('input', (e) => {
      step.title = e.target.value;
      updateSummary();
      this.renderTimelinePreview();
    });

    stepRow.querySelector('.step-anchor-type-select').addEventListener('change', (e) => {
      step.anchorType = e.target.value;
      this.refresh();
    });

    stepRow.querySelector('.step-day-input')?.addEventListener('change', (e) => {
      step.dayOffset = clampInt(e.target.value, 1, MAX_DAY_OFFSET + 1, 1) - 1;
      e.target.value = step.dayOffset + 1;
      updateSummary();
      this.renderTimelinePreview();
    });

    stepRow.querySelector('.step-anchor-time-input')?.addEventListener('change', (e) => {
      step.anchorTime = e.target.value || '09:00';
      updateSummary();
      this.renderTimelinePreview();
    });

    const gapWrapper = stepRow.querySelector('.step-gap-input');
    gapWrapper?.addEventListener('change', () => {
      step.gapMinutes = readDurationInputs(gapWrapper, 0, 0);
      updateSummary();
      this.renderTimelinePreview();
    });

    const offsetWrapper = stepRow.querySelector('.step-offset-input');
    offsetWrapper?.addEventListener('change', () => {
      step.offsetMinutes = readDurationInputs(offsetWrapper, 0, 0);
      updateSummary();
      this.renderTimelinePreview();
    });

    const notBeforeToggle = stepRow.querySelector('.step-not-before-toggle');
    const notBeforeInput = stepRow.querySelector('.step-not-before-input');
    const updateNotBefore = () => {
      notBeforeInput.disabled = !notBeforeToggle.checked;
      step.notBefore = notBeforeToggle.checked ? (notBeforeInput.value || this.defaultEarliestStart()) : '';
      updateSummary();
      this.renderTimelinePreview();
    };
    notBeforeToggle?.addEventListener('change', updateNotBefore);
    notBeforeInput?.addEventListener('change', updateNotBefore);

    const durationWrapper = stepRow.querySelector('.step-duration-input');
    durationWrapper.addEventListener('change', () => {
      step.durationMinutes = readDurationInputs(durationWrapper, 5, 30);
      updateSummary();
      this.renderTimelinePreview();
    });

    stepRow.querySelector('.step-type-select').addEventListener('change', (e) => {
      step.stepType = e.target.value;
      this.renderTimelinePreview();
    });

    stepRow.querySelector('.step-notes-input').addEventListener('input', (e) => {
      step.notes = e.target.value;
    });

    stepRow.querySelector('[data-action="up"]').addEventListener('click', () => this.moveStepTo(idx, idx - 1));
    stepRow.querySelector('[data-action="down"]').addEventListener('click', () => this.moveStepTo(idx, idx + 1));
    stepRow.querySelector('[data-action="duplicate"]').addEventListener('click', () => this.duplicateStep(idx));
    stepRow.querySelector('[data-action="collapse"]').addEventListener('click', () => this.toggleCollapsed(step.id));
    stepRow.querySelector('[data-action="delete"]').addEventListener('click', () => this.removeStep(idx));

    stepRow.querySelector('.step-drag-handle').addEventListener('pointerdown', (e) => this.startReorderDrag(e, stepRow));

    return stepRow;
  }

  /**
   * Drag a step card by its handle (mouse, touch or pen). The card follows the pointer,
   * a placeholder shows where it will land, and the dialog scrolls near its edges.
   */
  startReorderDrag(e, card) {
    if (e.button !== 0) return;
    e.preventDefault();

    const list = this.stepsContainer;
    const scroller = this.modalEl.querySelector('.modal-body');
    const fromIndex = Number(card.dataset.index);
    const rect = card.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;

    const placeholder = document.createElement('div');
    placeholder.className = 'step-drop-placeholder';
    placeholder.style.height = `${rect.height}px`;
    list.insertBefore(placeholder, card);
    list.classList.add('is-reordering');

    card.classList.add('is-dragging');
    Object.assign(card.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      zIndex: '2000'
    });

    let lastY = e.clientY;
    let autoScroll = 0;

    const placePlaceholder = () => {
      const others = [...list.querySelectorAll('.proto-step-editor-card')].filter((c) => c !== card);
      const before = others.find((c) => {
        const r = c.getBoundingClientRect();
        return lastY < r.top + r.height / 2;
      });
      if (before) list.insertBefore(placeholder, before);
      else list.appendChild(placeholder);
    };

    const onMove = (ev) => {
      lastY = ev.clientY;
      card.style.top = `${ev.clientY - offsetY}px`;
      placePlaceholder();
      const sr = scroller.getBoundingClientRect();
      if (ev.clientY < sr.top + 48) autoScroll = -10;
      else if (ev.clientY > sr.bottom - 48) autoScroll = 10;
      else autoScroll = 0;
    };

    let rafId = requestAnimationFrame(function tick() {
      if (autoScroll) {
        scroller.scrollTop += autoScroll;
        placePlaceholder();
      }
      rafId = requestAnimationFrame(tick);
    });

    const onUp = (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      cancelAnimationFrame(rafId);
      list.classList.remove('is-reordering');

      const order = [...list.children].filter((el) => (
        el === placeholder || (el.classList.contains('proto-step-editor-card') && el !== card)
      ));
      const toIndex = order.indexOf(placeholder);
      placeholder.remove();
      card.removeAttribute('style');
      card.classList.remove('is-dragging');

      if (ev.type === 'pointercancel') {
        this.renderStepsList();
      } else {
        this.moveStepTo(fromIndex, toIndex);
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  /**
   * Steps placed at their real times for a given start time (same rules as when the
   * protocol is dropped on the calendar), with the day index of each step.
   */
  computeSchedule() {
    const startMin = timeToMinutes(this.previewStartInput?.value || '09:00');
    const { events } = instantiateProtocol({ id: 'preview', name: '', steps: this.steps }, PREVIEW_DATE_KEY, startMin);
    const day0 = toAbsMinutes(PREVIEW_DATE_KEY, '00:00');
    return events.map((evt, i) => {
      const { startAbs, endAbs } = getEventSpan(evt);
      return {
        step: this.steps[i],
        index: i + 1,
        evt,
        startDay: Math.floor((startAbs - day0) / MINUTES_PER_DAY),
        endDay: Math.floor((Math.max(startAbs, endAbs - 1) - day0) / MINUTES_PER_DAY)
      };
    });
  }

  renderTimelinePreview() {
    this.previewContainer.innerHTML = '';
    const themeColor = safeColor(this.colorSelect.value);
    const use24 = this.store.settings?.use24Hour;
    const schedule = this.computeSchedule();

    // Group steps by the day they start on
    const daysMap = new Map();
    schedule.forEach((item) => {
      if (!daysMap.has(item.startDay)) daysMap.set(item.startDay, []);
      daysMap.get(item.startDay).push(item);
    });

    Array.from(daysMap.keys()).sort((a, b) => a - b).forEach((dayIndex) => {
      const dayWrapper = document.createElement('div');
      dayWrapper.className = 'timeline-day-block';

      const dayTitle = document.createElement('div');
      dayTitle.className = 'timeline-day-title';
      dayTitle.textContent = `Day ${dayIndex + 1}`;
      dayWrapper.appendChild(dayTitle);

      const stepsChain = document.createElement('div');
      stepsChain.className = 'timeline-steps-chain';

      daysMap.get(dayIndex).forEach(({ step, index, evt, startDay, endDay }) => {
        const isPassive = step.stepType === 'passive';
        const laterDay = endDay > startDay ? ` (Day ${endDay + 1})` : '';
        const times = `${formatTimeDisplay(evt.startTime, use24)} – ${formatTimeDisplay(evt.endTime, use24)}${laterDay}`;
        const stepPill = document.createElement('div');
        stepPill.className = `timeline-step-pill color-${themeColor} ${isPassive ? 'is-passive-pill' : ''}`;
        stepPill.innerHTML = `
          <div class="pill-badge">#${index}</div>
          <div class="pill-content">
            <span class="pill-name">${escapeHtml(step.title || 'Untitled Step')}</span>
            <span class="pill-meta">${escapeHtml(times)} • ${formatDuration(step.durationMinutes)}${isPassive ? ' • Passive' : ''}</span>
          </div>
        `;
        stepsChain.appendChild(stepPill);
      });

      dayWrapper.appendChild(stepsChain);
      this.previewContainer.appendChild(dayWrapper);
    });
  }

  saveProtocol() {
    const name = (this.nameInput.value || '').trim();
    if (!name) {
      alert('Please enter a protocol name.');
      this.nameInput.focus();
      return;
    }

    if (this.steps.length === 0) {
      alert('Please add at least one step.');
      return;
    }

    // Number of calendar days the protocol covers (incl. steps that run past midnight)
    const schedule = this.computeSchedule();
    const totalDays = Math.max(...schedule.map((item) => item.endDay)) + 1;

    const protocol = {
      id: this.editingProtocolId || generateId('proto_custom'),
      name: name,
      category: normalizeProtocolCategory(this.categoryInput.value.slice(0, 60)),
      color: this.colorSelect.value || 'ocean',
      totalDays,
      version: 1,
      description: this.descInput.value || '',
      steps: JSON.parse(JSON.stringify(this.steps))
    };

    // Previously this deleted and re-added the protocol under the same id, which put the id
    // in deletedProtocolIds and made the edited protocol disappear from the library.
    if (this.editingProtocolId) {
      this.store.updateCustomProtocol(this.editingProtocolId, protocol);
    } else {
      this.store.addCustomProtocol(protocol);
    }

    this.close();
    if (this.onProtocolSaved) {
      this.onProtocolSaved(protocol);
    }
  }
}

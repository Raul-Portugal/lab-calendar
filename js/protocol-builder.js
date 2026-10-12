/**
 * Interactive Protocol Builder Modal & Timeline Editor
 * Implements mutually exclusive anchorType ('after-previous' vs 'day-anchored'),
 * active/passive step type selector, timeline preview, and single protocol export
 */

import { generateId, formatDuration, escapeHtml, safeColor } from './utils.js';
import { exportSingleProtocol } from './storage.js';

export class ProtocolBuilder {
  constructor(store, onProtocolSaved) {
    this.store = store;
    this.onProtocolSaved = onProtocolSaved;

    this.modalEl = document.getElementById('protocolBuilderModal');
    this.steps = [];
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

    this.addStepBtn = document.getElementById('protoBuildAddStepBtn');
    this.saveBtn = document.getElementById('protoBuildSaveBtn');
    this.closeBtn = document.getElementById('protoBuildCloseBtn');
    this.cancelBtn = document.getElementById('protoBuildCancelBtn');
  }

  initEvents() {
    this.addStepBtn?.addEventListener('click', () => {
      this.addStep();
    });

    this.saveBtn?.addEventListener('click', () => {
      this.saveProtocol();
    });

    this.closeBtn?.addEventListener('click', () => this.close());
    this.cancelBtn?.addEventListener('click', () => this.close());

    this.colorSelect?.addEventListener('change', () => {
      this.renderTimelinePreview();
    });
  }

  open(templateProtocol = null) {
    // Custom protocols are edited in place; built-ins are copied into a new custom protocol
    const isCustom = Boolean(templateProtocol) &&
      this.store.customProtocols.some((p) => p.id === templateProtocol.id);
    this.editingProtocolId = isCustom ? templateProtocol.id : null;

    if (templateProtocol) {
      this.nameInput.value = isCustom ? templateProtocol.name : `${templateProtocol.name} (Custom)`;
      this.categoryInput.value = templateProtocol.category || 'Protocol';
      this.colorSelect.value = templateProtocol.color || 'ocean';
      this.descInput.value = templateProtocol.description || '';
      this.steps = JSON.parse(JSON.stringify(templateProtocol.steps));
    } else {
      this.nameInput.value = '';
      this.categoryInput.value = 'Protocol';
      this.colorSelect.value = 'ocean';
      this.descInput.value = '';
      this.steps = [
        {
          id: generateId('step'),
          title: 'Sample Preparation & Lysis',
          durationMinutes: 45,
          anchorType: 'after-previous',
          gapMinutes: 0,
          stepType: 'active',
          color: 'ocean',
          notes: ''
        },
        {
          id: generateId('step'),
          title: 'Incubation / Blocking',
          durationMinutes: 60,
          anchorType: 'after-previous',
          gapMinutes: 15,
          stepType: 'passive',
          color: 'lavender',
          notes: ''
        }
      ];
    }

    this.renderStepsList();
    this.renderTimelinePreview();
    this.modalEl.classList.remove('hidden');
  }

  close() {
    this.modalEl.classList.add('hidden');
  }

  addStep() {
    this.steps.push({
      id: generateId('step'),
      title: `Step ${this.steps.length + 1}`,
      durationMinutes: 45,
      anchorType: 'after-previous',
      gapMinutes: 15,
      dayOffset: 0,
      anchorTime: '09:00',
      stepType: 'active',
      color: this.colorSelect.value || 'ocean',
      notes: ''
    });

    this.renderStepsList();
    this.renderTimelinePreview();
  }

  removeStep(index) {
    if (this.steps.length <= 1) {
      alert('A protocol must contain at least one step.');
      return;
    }
    this.steps.splice(index, 1);
    this.renderStepsList();
    this.renderTimelinePreview();
  }

  moveStep(index, direction) {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= this.steps.length) return;

    const temp = this.steps[index];
    this.steps[index] = this.steps[targetIdx];
    this.steps[targetIdx] = temp;

    this.renderStepsList();
    this.renderTimelinePreview();
  }

  renderStepsList() {
    this.stepsContainer.innerHTML = '';

    this.steps.forEach((step, idx) => {
      const stepRow = document.createElement('div');
      stepRow.className = 'proto-step-editor-card';

      const isAnchored = step.anchorType === 'day-anchored';

      stepRow.innerHTML = `
        <div class="step-card-header">
          <div class="step-card-num-badge">Step ${idx + 1}</div>
          <div class="step-card-actions">
            <button type="button" class="icon-btn-sm" data-action="up" title="Move Up" ${idx === 0 ? 'disabled' : ''}>▲</button>
            <button type="button" class="icon-btn-sm" data-action="down" title="Move Down" ${idx === this.steps.length - 1 ? 'disabled' : ''}>▼</button>
            <button type="button" class="icon-btn-sm btn-delete" data-action="delete" title="Remove Step">✕</button>
          </div>
        </div>

        <div class="step-form-grid">
          <div class="form-group full-width">
            <label>Step Title</label>
            <input type="text" class="input-sm step-title-input" value="${escapeHtml(step.title || '')}" placeholder="e.g. Primary Antibody Incubation" />
          </div>

          <div class="form-group">
            <label>Timing Model</label>
            <select class="input-sm step-anchor-type-select">
              <option value="after-previous" ${!isAnchored ? 'selected' : ''}>After Previous Step</option>
              <option value="day-anchored" ${isAnchored ? 'selected' : ''}>Anchor to Specific Day & Time</option>
            </select>
          </div>

          <div class="form-group ${isAnchored ? '' : 'hidden'} step-anchor-day-wrapper">
            <label>Day Offset</label>
            <select class="input-sm step-day-select">
              <option value="0" ${(step.dayOffset || 0) === 0 ? 'selected' : ''}>Day 1 (Same day)</option>
              <option value="1" ${(step.dayOffset || 0) === 1 ? 'selected' : ''}>Day 2 (+1 day)</option>
              <option value="2" ${(step.dayOffset || 0) === 2 ? 'selected' : ''}>Day 3 (+2 days)</option>
            </select>
          </div>

          <div class="form-group ${isAnchored ? '' : 'hidden'} step-anchor-time-wrapper">
            <label>Start Time on Day</label>
            <input type="time" class="input-sm step-anchor-time-input" value="${escapeHtml(step.anchorTime || '09:00')}" />
          </div>

          <div class="form-group ${isAnchored ? 'hidden' : ''} step-gap-wrapper">
            <label>Wait Gap Before</label>
            <select class="input-sm step-gap-select">
              <option value="0" ${step.gapMinutes === 0 ? 'selected' : ''}>0 min (Immediate)</option>
              <option value="15" ${step.gapMinutes === 15 ? 'selected' : ''}>15 min gap</option>
              <option value="30" ${step.gapMinutes === 30 ? 'selected' : ''}>30 min gap</option>
              <option value="60" ${step.gapMinutes === 60 ? 'selected' : ''}>1 hour gap</option>
            </select>
          </div>

          <div class="form-group">
            <label>Duration</label>
            <select class="input-sm step-duration-select">
              <option value="15" ${step.durationMinutes === 15 ? 'selected' : ''}>15 min</option>
              <option value="30" ${step.durationMinutes === 30 ? 'selected' : ''}>30 min</option>
              <option value="45" ${step.durationMinutes === 45 ? 'selected' : ''}>45 min</option>
              <option value="60" ${step.durationMinutes === 60 ? 'selected' : ''}>1 hour</option>
              <option value="90" ${step.durationMinutes === 90 ? 'selected' : ''}>1.5 hours</option>
              <option value="120" ${step.durationMinutes === 120 ? 'selected' : ''}>2 hours</option>
              <option value="150" ${step.durationMinutes === 150 ? 'selected' : ''}>2.5 hours</option>
              <option value="180" ${step.durationMinutes === 180 ? 'selected' : ''}>3 hours</option>
            </select>
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

      // Inputs handling
      stepRow.querySelector('.step-title-input').addEventListener('input', (e) => {
        step.title = e.target.value;
        this.renderTimelinePreview();
      });

      stepRow.querySelector('.step-anchor-type-select').addEventListener('change', (e) => {
        step.anchorType = e.target.value;
        this.renderStepsList();
        this.renderTimelinePreview();
      });

      stepRow.querySelector('.step-day-select')?.addEventListener('change', (e) => {
        step.dayOffset = parseInt(e.target.value, 10);
        this.renderTimelinePreview();
      });

      stepRow.querySelector('.step-anchor-time-input')?.addEventListener('change', (e) => {
        step.anchorTime = e.target.value;
        this.renderTimelinePreview();
      });

      stepRow.querySelector('.step-gap-select')?.addEventListener('change', (e) => {
        step.gapMinutes = parseInt(e.target.value, 10);
        this.renderTimelinePreview();
      });

      stepRow.querySelector('.step-duration-select').addEventListener('change', (e) => {
        step.durationMinutes = parseInt(e.target.value, 10);
        this.renderTimelinePreview();
      });

      stepRow.querySelector('.step-type-select').addEventListener('change', (e) => {
        step.stepType = e.target.value;
        this.renderTimelinePreview();
      });

      stepRow.querySelector('.step-notes-input').addEventListener('input', (e) => {
        step.notes = e.target.value;
      });

      stepRow.querySelector('[data-action="up"]').addEventListener('click', () => this.moveStep(idx, -1));
      stepRow.querySelector('[data-action="down"]').addEventListener('click', () => this.moveStep(idx, 1));
      stepRow.querySelector('[data-action="delete"]').addEventListener('click', () => this.removeStep(idx));

      this.stepsContainer.appendChild(stepRow);
    });
  }

  renderTimelinePreview() {
    this.previewContainer.innerHTML = '';
    const themeColor = safeColor(this.colorSelect.value);

    // Group steps by computed day
    let curDay = 0;
    const daysMap = new Map();

    this.steps.forEach((step, idx) => {
      if (step.anchorType === 'day-anchored') {
        curDay = step.dayOffset || 0;
      }
      if (!daysMap.has(curDay)) daysMap.set(curDay, []);
      daysMap.get(curDay).push({ ...step, index: idx + 1 });
    });

    const sortedDays = Array.from(daysMap.keys()).sort((a, b) => a - b);

    sortedDays.forEach((dayOffset) => {
      const dayWrapper = document.createElement('div');
      dayWrapper.className = 'timeline-day-block';

      const dayTitle = document.createElement('div');
      dayTitle.className = 'timeline-day-title';
      dayTitle.textContent = `Day ${dayOffset + 1}`;
      dayWrapper.appendChild(dayTitle);

      const stepsChain = document.createElement('div');
      stepsChain.className = 'timeline-steps-chain';

      const daySteps = daysMap.get(dayOffset);
      daySteps.forEach((s) => {
        const isPassive = s.stepType === 'passive';
        const stepPill = document.createElement('div');
        stepPill.className = `timeline-step-pill color-${themeColor} ${isPassive ? 'is-passive-pill' : ''}`;
        stepPill.innerHTML = `
          <div class="pill-badge">#${s.index}</div>
          <div class="pill-content">
            <span class="pill-name">${escapeHtml(s.title || 'Untitled Step')}</span>
            <span class="pill-meta">${formatDuration(s.durationMinutes)} • ${isPassive ? 'Passive (Hatched)' : 'Active'}</span>
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

    let maxDayOffset = 0;
    this.steps.forEach((s) => {
      if (s.anchorType === 'day-anchored' && s.dayOffset > maxDayOffset) {
        maxDayOffset = s.dayOffset;
      }
    });

    const protocol = {
      id: this.editingProtocolId || generateId('proto_custom'),
      name: name,
      category: 'Protocol',
      color: this.colorSelect.value || 'ocean',
      totalDays: maxDayOffset + 1,
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

/**
 * Weekly Quotas & Flexible Tasks Engine
 * Calculates weekly hour allocations, remaining goals, and generates draggable task cards
 * Supports dynamic summation, split event preservation, and over-scheduling visual indicators
 */

import {
  generateId,
  getWeekDates,
  formatDateKey,
  isAllDayEvent,
  getEventSpan,
  fromAbsMinutes,
  toAbsMinutes,
  spanToFields,
  MINUTES_PER_DAY
} from './utils.js';

// [{ dateKey, minutes }] for each calendar day a timed event covers
function splitMinutesByDay(evt) {
  const { startAbs, endAbs } = getEventSpan(evt);
  const parts = [];
  let cursor = startAbs;
  while (cursor < endAbs) {
    const dayEnd = (Math.floor(cursor / MINUTES_PER_DAY) + 1) * MINUTES_PER_DAY;
    const segmentEnd = Math.min(endAbs, dayEnd);
    parts.push({ dateKey: fromAbsMinutes(cursor).dateKey, minutes: segmentEnd - cursor });
    cursor = segmentEnd;
  }
  return parts;
}

export const DEFAULT_QUOTAS = [
  {
    id: 'quota_thesis',
    title: 'Thesis Writing',
    weeklyTarget: 4.0,
    monthlyTarget: 16.0,
    totalTarget: 300.0,
    color: 'lavender',
    categories: ['Quota Task'],
    description: 'Weekly draft chapters, figure descriptions, and results synthesis.'
  },
  {
    id: 'quota_paper_reading',
    title: 'Journal Club & Paper Reading',
    weeklyTarget: 2.5,
    monthlyTarget: null,
    totalTarget: null,
    color: 'ocean',
    categories: ['Quota Task'],
    description: 'Read and annotate relevant preprints or publications.'
  },
  {
    id: 'quota_lab_maintenance',
    title: 'Lab Inventory & Reagent Prep',
    weeklyTarget: 1.5,
    monthlyTarget: null,
    totalTarget: null,
    color: 'rose',
    categories: ['Lab Operations'],
    description: 'Check stock of buffers, autoclave tips, restock serological pipettes.'
  }
];

/**
 * Calculate weekly, monthly, and total allocated hours for each quota,
 * supporting linked categories across different events.
 * Targets are individually optional: a quota may have only weekly, only monthly,
 * only total, or any combination.
 */
export function calculateQuotaStats(quotas, events, referenceDate) {
  const ref = new Date(referenceDate);
  const weekDates = getWeekDates(ref);
  const weekDateKeys = new Set(weekDates.map((d) => formatDateKey(d)));
  const refYear = ref.getFullYear();
  const refMonth = ref.getMonth();

  const stats = {};

  quotas.forEach((quota) => {
    const hasWeekly = typeof quota.weeklyTarget === 'number' && quota.weeklyTarget > 0;
    const hasMonthly = typeof quota.monthlyTarget === 'number' && quota.monthlyTarget > 0;
    const hasTotal = typeof quota.totalTarget === 'number' && quota.totalTarget > 0;

    const weeklyTarget = hasWeekly ? quota.weeklyTarget : (Number(quota.targetHours) || 0);
    const monthlyTarget = hasMonthly ? quota.monthlyTarget : 0;
    const totalTarget = hasTotal ? quota.totalTarget : 0;

    stats[quota.id] = {
      quota,
      hasWeekly,
      hasMonthly,
      hasTotal,
      weeklyTarget,
      monthlyTarget,
      totalTarget,

      weeklyMinutes: 0,
      weeklyHours: 0,
      weeklyPercentage: 0,
      isWeeklyOver: false,

      monthlyMinutes: 0,
      monthlyHours: 0,
      monthlyPercentage: 0,
      isMonthlyOver: false,

      totalMinutes: 0,
      totalHours: 0,
      totalPercentage: 0,
      isTotalOver: false,

      // Backward compatibility aliases
      allocatedHours: 0,
      targetHours: weeklyTarget,
      percentage: 0,
      remainingMinutes: Math.round(weeklyTarget * 60),
      remainingHours: weeklyTarget,
      isOverScheduled: false
    };
  });

  events.forEach((evt) => {
    if (!evt.dateKey) return;
    // Minutes per calendar day, so an overnight event counts towards each day it covers
    const perDay = isAllDayEvent(evt) ? [] : splitMinutesByDay(evt);

    quotas.forEach((quota) => {
      let matches = false;
      if (evt.quotaId && evt.quotaId === quota.id) {
        matches = true;
      } else if (quota.categories && Array.isArray(quota.categories) && quota.categories.length > 0 && evt.category) {
        if (quota.categories.includes(evt.category)) {
          matches = true;
        }
      }

      if (matches) {
        const s = stats[quota.id];
        perDay.forEach(({ dateKey, minutes }) => {
          const [y, m] = dateKey.split('-').map(Number);
          s.totalMinutes += minutes;
          if (y === refYear && (m - 1) === refMonth) s.monthlyMinutes += minutes;
          if (weekDateKeys.has(dateKey)) s.weeklyMinutes += minutes;
        });
      }
    });
  });

  Object.values(stats).forEach((s) => {
    // Weekly
    s.weeklyHours = Math.round((s.weeklyMinutes / 60) * 10) / 10;
    if (s.hasWeekly && s.weeklyTarget > 0) {
      s.weeklyPercentage = Math.round((s.weeklyHours / s.weeklyTarget) * 100);
      s.isWeeklyOver = s.weeklyHours > s.weeklyTarget;
      s.allocatedHours = s.weeklyHours;
      s.percentage = s.weeklyPercentage;
      s.remainingMinutes = Math.max(0, Math.round(s.weeklyTarget * 60 - s.weeklyMinutes));
      s.remainingHours = Math.max(0, Math.round((s.weeklyTarget - s.weeklyHours) * 10) / 10);
      s.isOverScheduled = s.isWeeklyOver;
    } else {
      s.weeklyPercentage = 0;
      s.isWeeklyOver = false;
    }

    // Monthly
    s.monthlyHours = Math.round((s.monthlyMinutes / 60) * 10) / 10;
    if (s.hasMonthly && s.monthlyTarget > 0) {
      s.monthlyPercentage = Math.round((s.monthlyHours / s.monthlyTarget) * 100);
      s.isMonthlyOver = s.monthlyHours > s.monthlyTarget;
      if (!s.hasWeekly) {
        s.allocatedHours = s.monthlyHours;
        s.percentage = s.monthlyPercentage;
        s.remainingMinutes = Math.max(0, Math.round(s.monthlyTarget * 60 - s.monthlyMinutes));
        s.remainingHours = Math.max(0, Math.round((s.monthlyTarget - s.monthlyHours) * 10) / 10);
        s.isOverScheduled = s.isMonthlyOver;
      }
    } else {
      s.monthlyPercentage = 0;
      s.isMonthlyOver = false;
    }

    // Total
    s.totalHours = Math.round((s.totalMinutes / 60) * 10) / 10;
    if (s.hasTotal && s.totalTarget > 0) {
      s.totalPercentage = Math.round((s.totalHours / s.totalTarget) * 100);
      s.isTotalOver = s.totalHours > s.totalTarget;
      if (!s.hasWeekly && !s.hasMonthly) {
        s.allocatedHours = s.totalHours;
        s.percentage = s.totalPercentage;
        s.remainingMinutes = Math.max(0, Math.round(s.totalTarget * 60 - s.totalMinutes));
        s.remainingHours = Math.max(0, Math.round((s.totalTarget - s.totalHours) * 10) / 10);
        s.isOverScheduled = s.isTotalOver;
      }
    } else {
      s.totalPercentage = 0;
      s.isTotalOver = false;
    }
  });

  return stats;
}

export const calculateWeeklyQuotaStats = calculateQuotaStats;

/**
 * Compute suggested drop duration for quota: min(120, remainingMinutes), at least 30 min
 */
export function getSuggestedQuotaDuration(stat) {
  if (!stat || stat.remainingMinutes <= 0) return 60; // 1h if already fulfilled or over-scheduled
  return Math.max(30, Math.min(120, stat.remainingMinutes));
}

/**
 * Create a new calendar event from a weekly quota block
 */
export function createEventFromQuota(quota, dateKey, startMinutes, durationMinutes = 120) {
  const startAbs = toAbsMinutes(dateKey, '00:00') + startMinutes;
  return {
    id: generateId('evt_quota'),
    title: quota.title,
    ...spanToFields(startAbs, startAbs + durationMinutes),
    isAllDay: false,
    color: quota.color || 'lavender',
    category: 'Quota Task',
    quotaId: quota.id,
    notes: quota.description || ''
  };
}

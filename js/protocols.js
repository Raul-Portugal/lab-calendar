/**
 * Protocol Definitions, Anchored Timing Engine, and Three-Tier Chained Shifting
 * Guarantees unified protocol color inheritance and explicit anchor modeling
 */

import { generateId, timeToMinutes, minutesToTime, formatDateKey, parseDateKey, shiftDateKey, safeColor } from './utils.js';

const STEP_TYPES = ['active', 'passive', 'run'];
const ANCHOR_TYPES = ['after-previous', 'day-anchored'];

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function cleanInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/**
 * Validate an untrusted protocol template (e.g. an imported .protocol.json shared by
 * another lab member). Only known fields survive; text is kept as plain strings and
 * numbers / enums are coerced to safe ranges. Returns null if it is not a usable protocol.
 */
export function sanitizeProtocol(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.steps)) return null;
  const name = cleanText(raw.name, 200).trim();
  if (!name) return null;

  const steps = raw.steps
    .filter((s) => s && typeof s === 'object')
    .slice(0, 100)
    .map((s) => {
      const anchorType = ANCHOR_TYPES.includes(s.anchorType) ? s.anchorType : 'after-previous';
      const anchorTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(s.anchorTime) ? s.anchorTime : '09:00';
      return {
        id: generateId('step'),
        title: cleanText(s.title, 200) || 'Untitled Step',
        durationMinutes: cleanInt(s.durationMinutes, 5, 1440, 30),
        anchorType,
        gapMinutes: cleanInt(s.gapMinutes, 0, 1440, 0),
        dayOffset: cleanInt(s.dayOffset, 0, 30, 0),
        anchorTime,
        stepType: STEP_TYPES.includes(s.stepType) ? s.stepType : 'active',
        notes: cleanText(s.notes, 2000)
      };
    });
  if (steps.length === 0) return null;

  const maxDayOffset = steps.reduce(
    (max, s) => (s.anchorType === 'day-anchored' ? Math.max(max, s.dayOffset) : max), 0
  );

  return {
    name,
    category: 'Protocol',
    color: safeColor(raw.color),
    totalDays: maxDayOffset + 1,
    version: cleanInt(raw.version, 1, 1000, 1),
    description: cleanText(raw.description, 2000),
    steps
  };
}

export const BUILT_IN_PROTOCOLS = [
  {
    id: 'proto_western_blot',
    name: 'Western Blot (2 Days)',
    category: 'Protocol',
    color: 'ocean', // Unified experimental blue
    totalDays: 2,
    version: 1,
    description: 'Gold-standard 2-day Western Blot with gel casting, sample prep, SDS-PAGE, transfer, Ponceau S, blocking, 1° Ab overnight, and Day 2 2° Ab & imaging.',
    steps: [
      // Day 1
      {
        id: 'wb_s1',
        title: 'Hand Cast Gels (Mix & Polymerization)',
        durationMinutes: 60,
        anchorType: 'after-previous',
        gapMinutes: 0,
        stepType: 'active', // 20m active pour + 40m polymerization
        notes: 'Cast resolving (10%) and stacking (4%) acrylamide gels. Insert comb; allow 45 min for polymerization at room temperature.'
      },
      {
        id: 'wb_s2',
        title: 'Prepare Samples (Lysate & Denature)',
        durationMinutes: 45,
        anchorType: 'after-previous',
        gapMinutes: 15,
        stepType: 'active',
        notes: 'Measure protein concentration (BCA), normalize with lysis buffer, add 4x Laemmli buffer with DTT, boil at 95°C for 5 min.'
      },
      {
        id: 'wb_s3',
        title: 'Load and Run SDS-PAGE',
        durationMinutes: 120, // 2h (15m load + 105m run)
        anchorType: 'after-previous',
        gapMinutes: 15,
        stepType: 'run',
        notes: 'Assemble gel cassette in running buffer. Load ladder (5 µL) and normalized samples (20 µg/well). Run at 80V for 15 min, then 120V for 1h45.'
      },
      {
        id: 'wb_s4',
        title: 'Rapid Transfer to PVDF Membrane',
        durationMinutes: 45,
        anchorType: 'after-previous',
        gapMinutes: 15,
        stepType: 'active',
        notes: 'Pre-wet PVDF membrane in MeOH for 1 min, assemble transfer sandwich on ice with pre-chilled transfer buffer. Run at 100V for 45 min.'
      },
      {
        id: 'wb_s5',
        title: 'Ponceau S Staining & Normalization Wash',
        durationMinutes: 15,
        anchorType: 'after-previous',
        gapMinutes: 15,
        stepType: 'active',
        notes: 'Stain membrane with Ponceau S for 5 min to assess transfer efficiency and total protein loading. Document on scanner, destain in TBST.'
      },
      {
        id: 'wb_s6',
        title: 'Membrane Blocking (5% BSA/Milk)',
        durationMinutes: 60,
        anchorType: 'after-previous',
        gapMinutes: 15,
        stepType: 'passive', // Passive incubation block
        notes: 'Incubate membrane in 5% non-fat dry milk or 5% BSA in TBST at room temperature on gentle orbital shaker for 1 hour.'
      },
      {
        id: 'wb_s7',
        title: 'Primary Antibody Incubation Setup (Overnight 4°C)',
        durationMinutes: 15, // 15m active setup
        anchorType: 'after-previous',
        gapMinutes: 15,
        stepType: 'active',
        notes: 'Dilute 1° Ab (1:1000 in 5% BSA-TBST). Add to membrane in sealed hybridization bag or incubation box; place on orbital rocker at 4°C overnight.'
      },
      // Day 2
      {
        id: 'wb_s8',
        title: 'Washes (TBST 3x 10 min)',
        durationMinutes: 30,
        anchorType: 'day-anchored', // Day 2 anchored at 09:00 AM
        dayOffset: 1,
        anchorTime: '09:00',
        stepType: 'active',
        notes: 'Collect and store primary antibody for reuse. Wash membrane 3 times for 10 minutes each with 1x TBST on rocker at room temperature.'
      },
      {
        id: 'wb_s9',
        title: 'Secondary Antibody Incubation (HRP)',
        durationMinutes: 60,
        anchorType: 'after-previous',
        gapMinutes: 15,
        stepType: 'passive', // Passive incubation block
        notes: 'Dilute HRP-conjugated 2° antibody (1:5000 in 5% milk-TBST). Incubate membrane for 1 hour at room temperature, protected from light.'
      },
      {
        id: 'wb_s10',
        title: 'Final Washes & ChemiDoc ECL Imaging',
        durationMinutes: 40,
        anchorType: 'after-previous',
        gapMinutes: 15,
        stepType: 'active',
        notes: 'Wash membrane 3x 10 min with TBST. Prepare chemiluminescent ECL substrate (1:1), apply to blot for 1-2 min, acquire signal on ChemiDoc.'
      }
    ]
  },
  {
    id: 'proto_pcr_gel',
    name: 'PCR & Agarose Gel Electrophoresis',
    category: 'Protocol',
    color: 'ocean',
    totalDays: 1,
    version: 1,
    description: 'Reaction setup, thermocycler amplification, gel casting, and band quantification.',
    steps: [
      {
        id: 'pcr_s1',
        title: 'PCR Master Mix & Primer Setup',
        durationMinutes: 45,
        anchorType: 'after-previous',
        gapMinutes: 0,
        stepType: 'active',
        notes: 'Assemble polymerase, dNTPs, forward & reverse primers, and DNA templates on ice.'
      },
      {
        id: 'pcr_s2',
        title: 'Thermocycler Run (35 Cycles)',
        durationMinutes: 120,
        anchorType: 'after-previous',
        gapMinutes: 15,
        stepType: 'run',
        notes: 'Denaturation at 95°C, annealing at 58°C, extension at 72°C.'
      },
      {
        id: 'pcr_s3',
        title: 'Cast & Load 1.5% Agarose Gel',
        durationMinutes: 45,
        anchorType: 'after-previous',
        gapMinutes: 15,
        stepType: 'active',
        notes: 'Melt agarose in 1x TAE, add GelRed/SYBR Safe, cast gel tray with comb. Load samples + 1kb DNA ladder.'
      },
      {
        id: 'pcr_s4',
        title: 'Run Gel & UV/Blue-Light Imaging',
        durationMinutes: 45,
        anchorType: 'after-previous',
        gapMinutes: 15,
        stepType: 'active',
        notes: 'Run at 100V for 35 min. Image under UV/Blue light and document target amplicon sizes.'
      }
    ]
  },
  {
    id: 'proto_rna_extraction',
    name: 'RNA Extraction & cDNA Synthesis',
    category: 'Protocol',
    color: 'ocean',
    totalDays: 1,
    version: 1,
    description: 'Cell lysis, TRIzol phase separation, RNA precipitation, Nanodrop QC, and reverse transcription.',
    steps: [
      {
        id: 'rna_s1',
        title: 'Cell Lysis & TRIzol Phase Separation',
        durationMinutes: 60,
        anchorType: 'after-previous',
        gapMinutes: 0,
        stepType: 'active',
        notes: 'Lyse cell pellets in TRIzol reagent, add chloroform, vortex, centrifuge at 12,000g for 15 min at 4°C.'
      },
      {
        id: 'rna_s2',
        title: 'Isopropanol Precipitation & 75% EtOH Wash',
        durationMinutes: 60,
        anchorType: 'after-previous',
        gapMinutes: 15,
        stepType: 'active',
        notes: 'Collect aqueous phase, add isopropanol, pellet RNA, wash twice with cold 75% ethanol.'
      },
      {
        id: 'rna_s3',
        title: 'Air Dry, Resuspend & Nanodrop QC',
        durationMinutes: 45,
        anchorType: 'after-previous',
        gapMinutes: 15,
        stepType: 'active',
        notes: 'Resuspend in nuclease-free water, measure A260/A280 and concentration on NanoDrop.'
      },
      {
        id: 'rna_s4',
        title: 'Reverse Transcription (cDNA Synthesis)',
        durationMinutes: 90,
        anchorType: 'after-previous',
        gapMinutes: 15,
        stepType: 'active',
        notes: 'Prepare 1 µg RNA + oligo(dT) / random hexamers + reverse transcriptase. Incubate at 42°C for 60 min.'
      }
    ]
  },
  {
    id: 'proto_transformation',
    name: 'Bacterial Transformation (2 Days)',
    category: 'Protocol',
    color: 'ocean',
    totalDays: 2,
    version: 1,
    description: 'Heat-shock competent E. coli, SOC outgrowth, selective agar plating, and colony inoculation.',
    steps: [
      {
        id: 'trans_s1',
        title: 'Competent Cells Heat Shock & SOC Outgrowth',
        durationMinutes: 90,
        anchorType: 'after-previous',
        gapMinutes: 0,
        stepType: 'active',
        notes: 'Thaw DH5a on ice, add 2 µL plasmid DNA, heat shock at 42°C for 45 sec, recover in SOC broth at 37°C for 1 h.'
      },
      {
        id: 'trans_s2',
        title: 'Plating on Selective LB-Agar Plates',
        durationMinutes: 30,
        anchorType: 'after-previous',
        gapMinutes: 15,
        stepType: 'active',
        notes: 'Spread 50 µL and 200 µL on Amp/Kan plates. Incubate plates inverted overnight at 37°C.'
      },
      {
        id: 'trans_s3',
        title: 'Colony Count & Inoculate Starter Cultures',
        durationMinutes: 45,
        anchorType: 'day-anchored',
        dayOffset: 1,
        anchorTime: '09:00',
        stepType: 'active',
        notes: 'Check colony efficiency, pick 3 single colonies into 5 mL LB + antibiotic for mini-prep.'
      }
    ]
  }
];

/**
 * Instantiate a protocol from a template snapshot
 * All steps inherit the protocol's chosen theme color for visual consistency
 */
const MINUTES_PER_DAY = 1440;

/**
 * Place an event at an absolute minute offset from baseDateKey 00:00 (may be negative or
 * beyond one day). Events never cross midnight. One that would is either moved to start at
 * the next midnight (rollForward, used when chaining steps so they never overlap their
 * predecessor) or to whichever side of midnight is closest to the requested time.
 * Returns the date/time fields plus the absolute start actually used.
 */
export function placeAtAbsoluteMinute(baseDateKey, absStartMin, durationMinutes, rollForward = false) {
  let dayOffset = Math.floor(absStartMin / MINUTES_PER_DAY);
  let start = absStartMin - dayOffset * MINUTES_PER_DAY;
  if (start + durationMinutes > MINUTES_PER_DAY && start > 0) {
    const fitBefore = Math.max(0, MINUTES_PER_DAY - durationMinutes);
    if (rollForward || (MINUTES_PER_DAY - start) <= (start - fitBefore)) {
      dayOffset += 1;
      start = 0;
    } else {
      start = fitBefore;
    }
  }
  const end = Math.min(MINUTES_PER_DAY, start + durationMinutes);
  return {
    dateKey: shiftDateKey(baseDateKey, dayOffset),
    startTime: minutesToTime(start),
    endTime: minutesToTime(end),
    absStart: dayOffset * MINUTES_PER_DAY + start
  };
}

export function instantiateProtocol(protocol, targetDateKey, targetStartMinutes) {
  const protocolGroupId = generateId(`grp_${protocol.id}`);
  const events = [];
  const protocolColor = protocol.color || 'ocean';

  // Minutes since targetDateKey 00:00, so long chains roll over into the next day(s)
  let currentAbs = targetStartMinutes;

  protocol.steps.forEach((step, index) => {
    if (step.anchorType === 'day-anchored') {
      currentAbs = (step.dayOffset || 0) * MINUTES_PER_DAY + timeToMinutes(step.anchorTime || '09:00');
    } else if (index > 0) {
      currentAbs += (step.gapMinutes || 0);
    }

    const placed = placeAtAbsoluteMinute(targetDateKey, currentAbs, step.durationMinutes, true);
    currentAbs = placed.absStart + step.durationMinutes;

    const event = {
      id: generateId('evt_step'),
      title: step.title,
      dateKey: placed.dateKey,
      startTime: placed.startTime,
      endTime: placed.endTime,
      color: protocolColor, // Unified protocol color scheme
      category: 'Protocol',
      stepType: step.stepType || 'active',
      notes: step.notes || '',
      protocolGroupId: protocolGroupId,
      protocolTemplateId: protocol.id,
      protocolTemplateVersion: protocol.version || 1,
      protocolName: protocol.name,
      stepDefId: step.id,
      isChained: true
    };

    events.push(event);
  });

  return {
    protocolGroupId,
    events
  };
}

/**
 * Shift entire protocol group by deltaDays and deltaMinutes (Shift + Drag)
 */
// Move one event by days + minutes, rolling across midnight instead of clamping to the same day
function shiftEventBy(evt, deltaDays, deltaMinutes) {
  const startMin = timeToMinutes(evt.startTime);
  const duration = timeToMinutes(evt.endTime) - startMin;
  const placed = placeAtAbsoluteMinute(evt.dateKey, deltaDays * MINUTES_PER_DAY + startMin + deltaMinutes, duration);
  return {
    ...evt,
    dateKey: placed.dateKey,
    startTime: placed.startTime,
    endTime: placed.endTime
  };
}

export function shiftProtocolGroup(allEvents, protocolGroupId, deltaDays, deltaMinutes) {
  return allEvents.map((evt) => (
    evt.protocolGroupId === protocolGroupId ? shiftEventBy(evt, deltaDays, deltaMinutes) : evt
  ));
}

/**
 * Cascade Shift: Shift selected step and push downstream steps by the delta, preserving subsequent gaps! (Ctrl / Cmd + Drag)
 */
export function cascadeShiftProtocolSteps(allEvents, protocolGroupId, targetStepId, deltaDays, deltaMinutes, includeTarget = true) {
  const groupSteps = allEvents
    .filter((e) => e.protocolGroupId === protocolGroupId)
    .sort((a, b) => {
      if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
      return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
    });

  const targetIdx = groupSteps.findIndex((e) => e.id === targetStepId);
  if (targetIdx === -1) return allEvents;

  const downstreamIds = new Set(groupSteps.slice(includeTarget ? targetIdx : targetIdx + 1).map((e) => e.id));

  return allEvents.map((evt) => (
    downstreamIds.has(evt.id) ? shiftEventBy(evt, deltaDays, deltaMinutes) : evt
  ));
}

/**
 * Check protocol group chain integrity.
 */
export function checkProtocolChainIntegrity(allEvents, protocolGroupId) {
  if (!protocolGroupId) return new Set();

  const groupSteps = allEvents
    .filter((e) => e.protocolGroupId === protocolGroupId)
    .sort((a, b) => {
      if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
      return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
    });

  const brokenSteps = new Set();

  for (let i = 1; i < groupSteps.length; i++) {
    const prev = groupSteps[i - 1];
    const curr = groupSteps[i];

    if (curr.dateKey === prev.dateKey) {
      if (timeToMinutes(curr.startTime) < timeToMinutes(prev.endTime)) {
        brokenSteps.add(curr.id);
      }
    } else if (curr.dateKey < prev.dateKey) {
      brokenSteps.add(curr.id);
    }
  }

  return brokenSteps;
}

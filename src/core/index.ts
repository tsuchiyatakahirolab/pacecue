/**
 * PaceCue's deterministic routine engine.
 *
 * No timers, browser APIs, network calls or storage live here. All calculations
 * use an explicit wall-clock timestamp. A suspended WebView therefore consumes
 * real deadline time, while an explicitly paused step consumes no work time.
 */

export interface RoutineStep {
  id: string;
  title: string;
  desiredSec: number;
  minimumSec: number;
  required: boolean;
}

export interface Routine {
  id: string;
  title: string;
  bufferSec: number;
  steps: RoutineStep[];
}

export interface StepProgress {
  stepId: string;
  status: 'pending' | 'done' | 'skipped';
  /** Work already recorded at the last state transition. */
  elapsedMs: number;
}

export interface Session {
  /** A copy keeps editing a saved routine from changing a running session. */
  routine: Routine;
  deadlineMs: number;
  startedAtMs: number;
  updatedAtMs: number;
  status: 'running' | 'paused' | 'completed';
  currentIndex: number;
  /** Running work since this timestamp has not yet been recorded in progress. */
  stepStartedAtMs: number | null;
  /**
   * Total active-work allowance for this step, including work already spent.
   * This cap stops a tick-by-tick replan from extending its own countdown.
   * Only starting a step or explicitly changing the deadline resets the cap.
   */
  currentTargetSec: number | null;
  progress: StepProgress[];
}

export interface PlannedStep extends RoutineStep {
  index: number;
  elapsedSec: number;
  desiredRemainingSec: number;
  minimumRemainingSec: number;
  /** Remaining work allowance, rather than the original step duration. */
  allocatedSec: number;
  /** A skip is a suggestion. It never changes progress or completes a step. */
  recommendation: 'do' | 'skip';
  plannedStartMs: number;
  plannedEndMs: number;
}

export interface SessionPlan {
  nowMs: number;
  deadlineMs: number;
  workDeadlineMs: number;
  bufferSec: number;
  /** Signed time remaining before the reserved buffer begins. */
  availableSec: number;
  desiredRemainingSec: number;
  protectedMinimumSec: number;
  desiredSlackSec: number;
  minimumOverrunSec: number;
  allocatedRemainingSec: number;
  feasible: boolean;
  completed: boolean;
  paused: boolean;
  currentElapsedSec: number;
  currentStep: PlannedStep | null;
  /** Only pending steps, in the original routine order. */
  steps: PlannedStep[];
  /** Projected work finish if work proceeds now. The buffer is not work. */
  finishMs: number;
  finishWithBufferMs: number;
}

export interface Snapshot {
  version: 1;
  routines: Routine[];
  session: Session | null;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export const LIMITS = Object.freeze({
  maxRoutines: 20,
  maxSteps: 30,
  maxStepSec: 14_400,
  maxRoutineSec: 86_400,
  maxBufferSec: 21_600,
  maxDeadlineHorizonMs: 7 * 24 * 60 * 60 * 1_000,
  maxSnapshotBytes: 512 * 1_024,
});

const MAX_TIMESTAMP = 8_640_000_000_000_000;
const EPSILON = 1e-7;

function fail(message: string): never {
  throw new ValidationError(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function numberInRange(
  value: unknown,
  label: string,
  min: number,
  max: number,
  integer = true,
): number {
  if (
    typeof value !== 'number' || !Number.isFinite(value) ||
    value < min || value > max || (integer && !Number.isSafeInteger(value))
  ) {
    fail(`${label} must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}.`);
  }
  return value;
}

function timestamp(value: unknown, label: string): number {
  return numberInRange(value, label, 0, MAX_TIMESTAMP);
}

function text(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') fail(`${label} must be text.`);
  const clean = value.trim();
  if (clean.length === 0 || clean.length > maxLength || /[\u0000-\u001f\u007f]/u.test(clean)) {
    fail(`${label} must contain 1 to ${maxLength} characters on one line.`);
  }
  return clean;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(value)) {
    fail(`${label} must use 1 to 64 letters, numbers, hyphens or underscores.`);
  }
  return value;
}

function validateStep(value: unknown, index: number): RoutineStep {
  const raw = record(value, `Step ${index + 1}`);
  const desiredSec = numberInRange(raw.desiredSec, 'Step duration', 1, LIMITS.maxStepSec);
  const minimumSec = numberInRange(raw.minimumSec, 'Step minimum', 1, desiredSec);
  if (typeof raw.required !== 'boolean') fail('Step required must be true or false.');
  return {
    id: identifier(raw.id, 'Step ID'),
    title: text(raw.title, 'Step title', 120),
    desiredSec,
    minimumSec,
    required: raw.required,
  };
}

/** Validate untrusted input and return a new object containing only known keys. */
export function validateRoutine(value: unknown): Routine {
  const raw = record(value, 'Routine');
  if (!Array.isArray(raw.steps) || raw.steps.length < 1 || raw.steps.length > LIMITS.maxSteps) {
    fail(`A routine needs 1 to ${LIMITS.maxSteps} steps.`);
  }
  const steps = raw.steps.map(validateStep);
  if (new Set(steps.map((step) => step.id)).size !== steps.length) fail('Step IDs must be unique.');
  const bufferSec = numberInRange(raw.bufferSec, 'Buffer', 0, LIMITS.maxBufferSec);
  if (steps.reduce((sum, step) => sum + step.desiredSec, bufferSec) > LIMITS.maxRoutineSec) {
    fail('A routine and its buffer must fit within 24 hours.');
  }
  return {
    id: identifier(raw.id, 'Routine ID'),
    title: text(raw.title, 'Routine title', 80),
    bufferSec,
    steps,
  };
}

/** Validate state invariants as well as field types before restoring a session. */
export function validateSession(value: unknown): Session {
  const raw = record(value, 'Session');
  const routine = validateRoutine(raw.routine);
  const startedAtMs = timestamp(raw.startedAtMs, 'Start time');
  const updatedAtMs = timestamp(raw.updatedAtMs, 'Update time');
  const deadlineMs = timestamp(raw.deadlineMs, 'Deadline');
  if (updatedAtMs < startedAtMs) fail('Update time precedes the session start.');
  if (deadlineMs <= startedAtMs || deadlineMs - startedAtMs > LIMITS.maxDeadlineHorizonMs) {
    fail('The deadline must be within 7 days after the session start.');
  }
  if (raw.status !== 'running' && raw.status !== 'paused' && raw.status !== 'completed') {
    fail('Unknown session status.');
  }
  const status = raw.status;
  const currentIndex = numberInRange(raw.currentIndex, 'Current step', 0, routine.steps.length);
  if (!Array.isArray(raw.progress) || raw.progress.length !== routine.steps.length) {
    fail('Session progress does not match the routine.');
  }
  const progress: StepProgress[] = raw.progress.map((item, index) => {
    const entry = record(item, 'Step progress');
    const step = routine.steps[index]!;
    if (entry.stepId !== step.id) fail('Progress IDs must follow the routine order.');
    if (entry.status !== 'pending' && entry.status !== 'done' && entry.status !== 'skipped') {
      fail('Unknown step status.');
    }
    if (entry.status === 'skipped' && step.required) fail('A required step cannot be skipped.');
    if ((index < currentIndex) === (entry.status === 'pending')) {
      fail('Completed steps must precede all pending steps.');
    }
    const elapsedMs = numberInRange(entry.elapsedMs, 'Elapsed work', 0, MAX_TIMESTAMP);
    if (index > currentIndex && elapsedMs !== 0) fail('Future steps cannot contain elapsed work.');
    return { stepId: step.id, status: entry.status, elapsedMs };
  });
  if (progress.reduce((sum, entry) => sum + entry.elapsedMs, 0) > updatedAtMs - startedAtMs) {
    fail('Recorded work exceeds elapsed session time.');
  }
  if ((status === 'completed') !== (currentIndex === routine.steps.length)) {
    fail('Session completion does not match its current step.');
  }
  let stepStartedAtMs: number | null = null;
  let currentTargetSec: number | null = null;
  if (status === 'running') {
    stepStartedAtMs = timestamp(raw.stepStartedAtMs, 'Current step start');
    if (stepStartedAtMs !== updatedAtMs) fail('Running work must be anchored to the last update.');
  } else if (raw.stepStartedAtMs !== null) {
    fail('Paused and completed sessions cannot have an active work clock.');
  }
  if (status === 'completed') {
    if (raw.currentTargetSec !== null) fail('Completed sessions cannot have an active step target.');
  } else {
    const current = routine.steps[currentIndex]!;
    currentTargetSec = numberInRange(
      raw.currentTargetSec, 'Current step target', current.required ? current.minimumSec : 0,
      current.desiredSec, false,
    );
  }
  return {
    routine, deadlineMs, startedAtMs, updatedAtMs, status, currentIndex,
    stepStartedAtMs, currentTargetSec, progress,
  };
}

function effectiveTime(session: Session, nowMs: number): number {
  const now = timestamp(nowMs, 'Current time');
  // A clock rollback cannot subtract work already checkpointed or start work
  // before the session exists. A completed result stays fixed at completion.
  return session.status === 'completed' ? session.updatedAtMs : Math.max(now, session.updatedAtMs);
}

function workElapsedMs(session: Session, nowMs: number): number {
  if (session.status === 'completed') return 0;
  const saved = session.progress[session.currentIndex]!.elapsedMs;
  return saved + (session.status === 'running' ? nowMs - session.stepStartedAtMs! : 0);
}

function planValidated(session: Session, requestedNowMs: number, anchorCurrent = true): SessionPlan {
  const nowMs = effectiveTime(session, requestedNowMs);
  const workDeadlineMs = session.deadlineMs - session.routine.bufferSec * 1_000;
  const availableSec = (workDeadlineMs - nowMs) / 1_000;
  const currentElapsedSec = workElapsedMs(session, nowMs) / 1_000;
  const steps: PlannedStep[] = session.routine.steps.slice(session.currentIndex).map((step, offset) => {
    const elapsedSec = offset === 0 ? currentElapsedSec : 0;
    return {
      ...step,
      index: session.currentIndex + offset,
      elapsedSec,
      desiredRemainingSec: Math.max(0, step.desiredSec - elapsedSec),
      minimumRemainingSec: Math.max(0, step.minimumSec - elapsedSec),
      allocatedSec: 0,
      recommendation: 'do',
      plannedStartMs: nowMs,
      plannedEndMs: nowMs,
    };
  });
  const desiredRemainingSec = steps.reduce((sum, step) => sum + step.desiredRemainingSec, 0);
  const required = steps.filter((step) => step.required);
  const optional = steps.filter((step) => !step.required);
  const protectedMinimumSec = required.reduce((sum, step) => sum + step.minimumRemainingSec, 0);

  const cap = (step: PlannedStep): number => {
    if (step.index !== session.currentIndex) return step.desiredRemainingSec;
    return Math.min(
      step.desiredRemainingSec,
      Math.max(step.required ? step.minimumRemainingSec : 0, session.currentTargetSec! - currentElapsedSec),
    );
  };
  const requiredRequested = required.reduce((sum, step) => sum + cap(step), 0);
  const budget = Math.max(0, availableSec);
  if (budget + EPSILON >= requiredRequested) {
    for (const step of required) step.allocatedSec = cap(step);
    let optionalBudget = Math.max(0, budget - requiredRequested);
    // Keep optional work in its original order. An optional step only receives
    // time if its minimum fits; omitted steps are still pending until confirmed.
    for (const step of optional) {
      const wanted = cap(step);
      if (optionalBudget + EPSILON >= step.minimumRemainingSec && wanted + EPSILON >= step.minimumRemainingSec) {
        step.allocatedSec = Math.min(wanted, optionalBudget);
        optionalBudget = Math.max(0, optionalBudget - step.allocatedSec);
      }
    }
  } else {
    // Protect every required minimum, even when this necessarily misses the
    // deadline. Any remaining budget is shared proportionally across the
    // compressible portions. Optional work receives no time in this branch.
    let totalFlex = requiredRequested - protectedMinimumSec;
    let flexBudget = Math.max(0, budget - protectedMinimumSec);
    const active = anchorCurrent ? required.find((step) => step.index === session.currentIndex) : undefined;
    if (active) {
      // Once a step has started, reserve its agreed allowance before allocating
      // flexibility to later steps. Otherwise applying proportional compression
      // a second time would shrink the target on the very first display tick.
      const activeFlex = Math.max(0, cap(active) - active.minimumRemainingSec);
      const assignedFlex = Math.min(activeFlex, flexBudget);
      active.allocatedSec = active.minimumRemainingSec + assignedFlex;
      flexBudget = Math.max(0, flexBudget - assignedFlex);
      totalFlex = Math.max(0, totalFlex - activeFlex);
    }
    for (const step of required) {
      if (step === active) continue;
      const flex = Math.max(0, cap(step) - step.minimumRemainingSec);
      step.allocatedSec = step.minimumRemainingSec + (totalFlex > EPSILON ? flex * Math.min(1, flexBudget / totalFlex) : 0);
    }
  }

  let cursor = nowMs;
  for (const step of steps) {
    if (!step.required && step.allocatedSec <= EPSILON && step.desiredRemainingSec > EPSILON) {
      step.recommendation = 'skip';
    }
    step.plannedStartMs = cursor;
    cursor += step.allocatedSec * 1_000;
    step.plannedEndMs = cursor;
  }
  const allocatedRemainingSec = steps.reduce((sum, step) => sum + step.allocatedSec, 0);
  const minimumOverrunSec = Math.max(0, protectedMinimumSec - availableSec);
  return {
    nowMs,
    deadlineMs: session.deadlineMs,
    workDeadlineMs,
    bufferSec: session.routine.bufferSec,
    availableSec,
    desiredRemainingSec,
    protectedMinimumSec,
    desiredSlackSec: availableSec - desiredRemainingSec,
    minimumOverrunSec,
    allocatedRemainingSec,
    feasible: minimumOverrunSec <= EPSILON,
    completed: session.status === 'completed',
    paused: session.status === 'paused',
    currentElapsedSec,
    currentStep: steps[0] ?? null,
    steps,
    finishMs: cursor,
    finishWithBufferMs: cursor + session.routine.bufferSec * 1_000,
  };
}

export function planSession(session: Session, nowMs = Date.now()): SessionPlan {
  return planValidated(validateSession(session), nowMs);
}

function checkNewDeadline(deadlineMs: number, nowMs: number, startedAtMs: number): void {
  timestamp(deadlineMs, 'Deadline');
  if (deadlineMs <= nowMs) fail('Choose a deadline in the future.');
  if (deadlineMs - startedAtMs > LIMITS.maxDeadlineHorizonMs) {
    fail('Choose a deadline within 7 days of the session start.');
  }
}

/** Set a stable allowance on entry to a new step, or after a manual deadline edit. */
function setStepTarget(session: Session, nowMs: number): Session {
  if (session.status === 'completed') return session;
  const current = session.routine.steps[session.currentIndex]!;
  session.currentTargetSec = current.desiredSec;
  const plan = planValidated(session, nowMs, false);
  session.currentTargetSec = Math.min(
    current.desiredSec,
    Math.max(current.required ? current.minimumSec : 0, plan.currentElapsedSec + plan.currentStep!.allocatedSec),
  );
  return session;
}

export function startSession(routine: Routine, deadlineMs: number, nowMs = Date.now()): Session {
  const clean = validateRoutine(routine);
  timestamp(nowMs, 'Current time');
  checkNewDeadline(deadlineMs, nowMs, nowMs);
  return setStepTarget({
    routine: clean,
    deadlineMs,
    startedAtMs: nowMs,
    updatedAtMs: nowMs,
    status: 'running',
    currentIndex: 0,
    stepStartedAtMs: nowMs,
    currentTargetSec: clean.steps[0]!.desiredSec,
    progress: clean.steps.map((step) => ({ stepId: step.id, status: 'pending', elapsedMs: 0 })),
  }, nowMs);
}

/** Returns a validated clone and records elapsed work exactly once. */
function checkpoint(session: Session, requestedNowMs: number): Session {
  const next = validateSession(session);
  if (next.status === 'completed') fail('This routine is already complete.');
  const nowMs = effectiveTime(next, requestedNowMs);
  next.progress[next.currentIndex]!.elapsedMs = workElapsedMs(next, nowMs);
  next.updatedAtMs = nowMs;
  next.stepStartedAtMs = next.status === 'running' ? nowMs : null;
  return next;
}

export function pauseSession(session: Session, nowMs = Date.now()): Session {
  const next = checkpoint(session, nowMs);
  next.status = 'paused';
  next.stepStartedAtMs = null;
  return next;
}

export function resumeSession(session: Session, nowMs = Date.now()): Session {
  const next = checkpoint(session, nowMs);
  // A pause consumes deadline time. Commit any smaller allowance before the
  // active work clock resumes; resuming never increases the previous target.
  const plan = planValidated(next, next.updatedAtMs);
  const current = next.routine.steps[next.currentIndex]!;
  next.currentTargetSec = Math.max(
    current.required ? current.minimumSec : 0,
    Math.min(next.currentTargetSec!, plan.currentElapsedSec + plan.currentStep!.allocatedSec),
  );
  next.status = 'running';
  next.stepStartedAtMs = next.updatedAtMs;
  return next;
}

function advance(session: Session, status: 'done' | 'skipped', nowMs: number): Session {
  const next = checkpoint(session, nowMs);
  const current = next.routine.steps[next.currentIndex]!;
  if (status === 'skipped' && current.required) fail('Required steps must be completed, not skipped.');
  next.progress[next.currentIndex]!.status = status;
  next.currentIndex += 1;
  if (next.currentIndex === next.routine.steps.length) {
    next.status = 'completed';
    next.stepStartedAtMs = null;
    next.currentTargetSec = null;
    return next;
  }
  return setStepTarget(next, next.updatedAtMs);
}

/** Explicit confirmation may finish a step early; elapsed time alone never does. */
export function completeCurrentStep(session: Session, nowMs = Date.now()): Session {
  return advance(session, 'done', nowMs);
}

export function skipCurrentStep(session: Session, nowMs = Date.now()): Session {
  return advance(session, 'skipped', nowMs);
}

export function changeDeadline(session: Session, deadlineMs: number, nowMs = Date.now()): Session {
  const next = checkpoint(session, nowMs);
  checkNewDeadline(deadlineMs, next.updatedAtMs, next.startedAtMs);
  next.deadlineMs = deadlineMs;
  return setStepTarget(next, next.updatedAtMs);
}

export function validateSnapshot(value: unknown): Snapshot {
  const raw = record(value, 'Backup');
  if (raw.version !== 1) fail('This backup version is not supported.');
  if (!Array.isArray(raw.routines) || raw.routines.length < 1 || raw.routines.length > LIMITS.maxRoutines) {
    fail(`A backup needs 1 to ${LIMITS.maxRoutines} routines.`);
  }
  const routines = raw.routines.map(validateRoutine);
  if (new Set(routines.map((routine) => routine.id)).size !== routines.length) fail('Routine IDs must be unique.');
  const session = raw.session === null ? null : validateSession(raw.session);
  return { version: 1, routines, session };
}

export function parseSnapshot(json: string): Snapshot {
  if (typeof json !== 'string' || json.length > LIMITS.maxSnapshotBytes) fail('This backup is too large.');
  // Bound UTF-8 bytes too, without relying on a browser TextEncoder.
  let bytes = 0;
  for (const character of json) {
    const codePoint = character.codePointAt(0)!;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes > LIMITS.maxSnapshotBytes) fail('This backup is too large.');
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    fail('This backup is not valid JSON.');
  }
  return validateSnapshot(value);
}

export function serializeSnapshot(snapshot: Snapshot): string {
  return JSON.stringify(validateSnapshot(snapshot));
}

/** Generic examples; callers may edit or remove them without network access. */
export function getPresetRoutines(locale: 'en' | 'ja' = 'en'): Routine[] {
  const ja = locale === 'ja';
  return [
    {
      id: 'leave-home', title: ja ? '出発の準備' : 'Leave home', bufferSec: 120,
      steps: [
        { id: 'get-ready', title: ja ? '身支度を整える' : 'Get ready', desiredSec: 480, minimumSec: 300, required: true },
        { id: 'pack', title: ja ? '必要なものをバッグに入れる' : 'Pack essentials', desiredSec: 240, minimumSec: 120, required: true },
        { id: 'coffee', title: ja ? '飲み物を用意する' : 'Make a drink', desiredSec: 300, minimumSec: 180, required: false },
        { id: 'check', title: ja ? '鍵・財布・スマホを確認する' : 'Check keys, wallet and phone', desiredSec: 120, minimumSec: 60, required: true },
      ],
    },
    {
      id: 'focus-block', title: ja ? '集中して作業する' : 'Focus block', bufferSec: 60,
      steps: [
        { id: 'clear', title: ja ? '机を整える' : 'Clear the desk', desiredSec: 120, minimumSec: 60, required: false },
        { id: 'outcome', title: ja ? '今回終えることを1つ選ぶ' : 'Choose one outcome', desiredSec: 120, minimumSec: 60, required: true },
        { id: 'focus', title: ja ? '選んだ作業に取り組む' : 'Work on that outcome', desiredSec: 1_500, minimumSec: 900, required: true },
        { id: 'close', title: ja ? '次に行うことを書き残す' : 'Write the next action', desiredSec: 120, minimumSec: 60, required: true },
      ],
    },
    {
      id: 'wind-down', title: ja ? '寝る前の準備' : 'Wind down', bufferSec: 120,
      steps: [
        { id: 'tomorrow', title: ja ? '明日の持ち物を準備する' : 'Prepare for tomorrow', desiredSec: 300, minimumSec: 180, required: true },
        { id: 'tidy', title: ja ? '部屋を片づける' : 'Tidy up', desiredSec: 300, minimumSec: 120, required: false },
        { id: 'wash', title: ja ? '洗面を済ませる' : 'Wash and brush', desiredSec: 300, minimumSec: 180, required: true },
        { id: 'bed', title: ja ? '寝室の準備をする' : 'Get the room ready', desiredSec: 180, minimumSec: 60, required: true },
      ],
    },
  ].map(validateRoutine);
}

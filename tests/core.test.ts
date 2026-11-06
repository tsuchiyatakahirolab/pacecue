import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changeDeadline,
  completeCurrentStep,
  getPresetRoutines,
  LIMITS,
  parseSnapshot,
  pauseSession,
  planSession,
  resumeSession,
  serializeSnapshot,
  skipCurrentStep,
  startSession,
  validateRoutine,
  validateSession,
  ValidationError,
} from '../src/core/index.ts';
import type { Routine } from '../src/core/index.ts';

const START = 1_800_000_000_000;
const routine = (): Routine => ({
  id: 'test', title: 'A daily routine', bufferSec: 60,
  steps: [
    { id: 'first', title: 'Prepare', desiredSec: 300, minimumSec: 120, required: true },
    { id: 'optional', title: 'Read', desiredSec: 180, minimumSec: 60, required: false },
    { id: 'last', title: 'Final check', desiredSec: 120, minimumSec: 60, required: true },
  ],
});
const almost = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test('ordinary work and the buffer fit without changing the routine order', () => {
  const session = startSession(routine(), START + 660_000, START);
  const plan = planSession(session, START);
  assert.equal(plan.feasible, true);
  assert.equal(plan.desiredSlackSec, 0);
  assert.deepEqual(plan.steps.map((step) => step.id), ['first', 'optional', 'last']);
  assert.deepEqual(plan.steps.map((step) => step.allocatedSec), [300, 180, 120]);
  assert.equal(plan.finishMs, START + 600_000);
  assert.equal(plan.finishWithBufferMs, session.deadlineMs);
});

test('optional time is removed before compressing protected work', () => {
  const session = startSession(routine(), START + 420_000, START);
  const plan = planSession(session, START);
  assert.equal(plan.feasible, true);
  assert.equal(plan.steps[1]!.recommendation, 'skip');
  assert.equal(plan.steps[1]!.allocatedSec, 0);
  almost(plan.allocatedRemainingSec, 360);
  for (const step of plan.steps.filter((entry) => entry.required)) {
    assert.ok(step.allocatedSec >= step.minimumRemainingSec);
  }
  assert.equal(session.progress[1]!.status, 'pending');
});

test('infeasible plans retain every protected minimum and show the overrun', () => {
  const session = startSession(routine(), START + 180_000, START);
  const plan = planSession(session, START);
  assert.equal(plan.availableSec, 120);
  assert.equal(plan.protectedMinimumSec, 180);
  assert.equal(plan.minimumOverrunSec, 60);
  assert.equal(plan.feasible, false);
  assert.deepEqual(plan.steps.map((step) => step.allocatedSec), [120, 0, 60]);
  assert.equal(plan.finishWithBufferMs, session.deadlineMs + 60_000);
});

test('a background gap uses absolute time and never auto-completes a step', () => {
  const session = startSession(routine(), START + 660_000, START);
  const plan = planSession(session, START + 400_000);
  assert.equal(plan.currentElapsedSec, 400);
  assert.equal(plan.currentStep!.allocatedSec, 0);
  assert.equal(session.currentIndex, 0);
  assert.equal(session.progress[0]!.status, 'pending');
  assert.equal(plan.completed, false);
});

test('repeated replans cannot move the active countdown forward', () => {
  const session = startSession(routine(), START + 420_000, START);
  const initial = planSession(session, START).currentStep!.allocatedSec;
  for (const sec of [1, 20, 119, 120, 150, 220, 280]) {
    const next = planSession(session, START + sec * 1_000);
    assert.ok(next.currentStep!.allocatedSec <= Math.max(0, initial - sec) + 1e-6);
    assert.equal(next.currentElapsedSec, sec);
  }
  assert.equal(session.progress[0]!.elapsedMs, 0);
});

test('pause freezes work but consumes fixed deadline margin; resume counts work once', () => {
  const session = startSession(routine(), START + 660_000, START);
  const paused = pauseSession(session, START + 60_000);
  const pausedPlan = planSession(paused, START + 300_000);
  assert.equal(pausedPlan.currentElapsedSec, 60);
  assert.equal(pausedPlan.availableSec, 300);
  assert.equal(pausedPlan.paused, true);
  const resumed = resumeSession(paused, START + 300_000);
  const after = planSession(resumed, START + 330_000);
  assert.equal(after.currentElapsedSec, 90);
  assert.equal(after.availableSec, 270);
  assert.ok(resumed.currentTargetSec! <= paused.currentTargetSec!);
  validateSession(resumed);
});

test('pausing and resuming repeatedly do not double-count elapsed work', () => {
  let session = startSession(routine(), START + 900_000, START);
  session = pauseSession(session, START + 30_000);
  session = pauseSession(session, START + 60_000);
  session = resumeSession(session, START + 90_000);
  session = resumeSession(session, START + 120_000);
  session = pauseSession(session, START + 150_000);
  assert.equal(planSession(session, START + 400_000).currentElapsedSec, 90);
});

test('only explicit actions advance; required steps cannot be skipped', () => {
  const initial = startSession(routine(), START + 900_000, START);
  assert.throws(() => skipCurrentStep(initial, START + 30_000), ValidationError);
  const second = completeCurrentStep(initial, START + 30_000);
  assert.equal(second.currentIndex, 1);
  assert.equal(second.progress[0]!.status, 'done');
  assert.equal(second.progress[0]!.elapsedMs, 30_000);
  const third = skipCurrentStep(second, START + 40_000);
  assert.equal(third.currentIndex, 2);
  assert.equal(third.progress[1]!.status, 'skipped');
  const done = completeCurrentStep(third, START + 50_000);
  assert.equal(done.status, 'completed');
  assert.equal(done.currentIndex, 3);
  assert.equal(done.currentTargetSec, null);
  assert.equal(done.stepStartedAtMs, null);
  const plan = planSession(done, START + 10_000_000);
  assert.equal(plan.completed, true);
  assert.equal(plan.currentStep, null);
  assert.equal(plan.steps.length, 0);
  assert.equal(plan.finishMs, START + 50_000);
  assert.throws(() => completeCurrentStep(done, START + 60_000), ValidationError);
});

test('advancing while paused does not start an invisible work clock', () => {
  const initial = startSession(routine(), START + 900_000, START);
  const paused = pauseSession(initial, START + 20_000);
  const second = completeCurrentStep(paused, START + 30_000);
  assert.equal(second.status, 'paused');
  assert.equal(second.stepStartedAtMs, null);
  assert.equal(planSession(second, START + 60_000).currentElapsedSec, 0);
  validateSession(second);
});

test('session copies isolate running work from saved routine edits', () => {
  const original = routine();
  const session = startSession(original, START + 900_000, START);
  const saved = JSON.stringify(session);
  original.steps[0]!.title = 'Changed externally';
  planSession(session, START + 30_000);
  const next = completeCurrentStep(session, START + 30_000);
  next.routine.steps[0]!.title = 'Another change';
  assert.equal(JSON.stringify(session), saved);
});

test('snapshot round-trip recovers elapsed background work', () => {
  const initial = startSession(routine(), START + 900_000, START);
  const paused = pauseSession(initial, START + 30_000);
  const running = resumeSession(paused, START + 60_000);
  const snapshot = parseSnapshot(serializeSnapshot({ version: 1, routines: [routine()], session: running }));
  assert.deepEqual(snapshot.session, running);
  assert.equal(planSession(snapshot.session!, START + 120_000).currentElapsedSec, 90);
  assert.deepEqual(snapshot.routines, [routine()]);
});

test('snapshot rejects wrong versions, missing fields, malformed JSON and large payloads', () => {
  for (const json of ['null', '{', '{}', '{"version":2,"routines":[],"session":null}']) {
    assert.throws(() => parseSnapshot(json), ValidationError);
  }
  assert.throws(() => parseSnapshot(' '.repeat(LIMITS.maxSnapshotBytes + 1)), ValidationError);
  assert.throws(() => parseSnapshot('あ'.repeat(Math.floor(LIMITS.maxSnapshotBytes / 3) + 1)), ValidationError);
});

test('untrusted routines reject invalid durations, oversized arrays and duplicate IDs', () => {
  for (const duration of [NaN, Infinity, -1, 0, 1.5, LIMITS.maxStepSec + 1, '300']) {
    const item = routine() as unknown as { steps: Array<{ desiredSec: unknown }> };
    item.steps[0]!.desiredSec = duration;
    assert.throws(() => validateRoutine(item), ValidationError);
  }
  const minimum = routine();
  minimum.steps[0]!.minimumSec = minimum.steps[0]!.desiredSec + 1;
  assert.throws(() => validateRoutine(minimum), ValidationError);
  const duplicate = routine();
  duplicate.steps[1]!.id = duplicate.steps[0]!.id;
  assert.throws(() => validateRoutine(duplicate), ValidationError);
  const tooMany = routine();
  tooMany.steps = Array.from({ length: 31 }, (_, i) => ({ ...tooMany.steps[0]!, id: `s${i}` }));
  assert.throws(() => validateRoutine(tooMany), ValidationError);
});

test('untrusted session state cannot skip required work or fabricate elapsed time', () => {
  const fresh = () => startSession(routine(), START + 900_000, START);
  const skipped = fresh();
  skipped.progress[0]!.status = 'skipped';
  skipped.currentIndex = 1;
  assert.throws(() => validateSession(skipped), ValidationError);
  const impossible = fresh();
  impossible.progress[0]!.elapsedMs = 1_000;
  assert.throws(() => validateSession(impossible), ValidationError);
  const wrongOrder = fresh();
  wrongOrder.progress[2]!.status = 'done';
  assert.throws(() => validateSession(wrongOrder), ValidationError);
  const badTarget = fresh();
  badTarget.currentTargetSec = 0;
  assert.throws(() => validateSession(badTarget), ValidationError);
  const badClock = fresh();
  badClock.stepStartedAtMs = START - 1;
  assert.throws(() => validateSession(badClock), ValidationError);
});

test('deadline changes are explicit, retain work and can restore optional capacity', () => {
  const initial = startSession(routine(), START + 420_000, START);
  const changed = changeDeadline(initial, START + 900_000, START + 60_000);
  assert.equal(changed.deadlineMs, START + 900_000);
  assert.equal(planSession(changed, START + 60_000).currentElapsedSec, 60);
  assert.equal(planSession(changed, START + 60_000).steps[1]!.recommendation, 'do');
  assert.throws(() => changeDeadline(changed, START, START + 60_000), ValidationError);
  assert.throws(() => startSession(routine(), START, START), ValidationError);
  assert.throws(() => startSession(routine(), START + LIMITS.maxDeadlineHorizonMs + 1, START), ValidationError);
});

test('clock rollback cannot invent negative work, and overdue work stays visible', () => {
  const initial = startSession(routine(), START + 660_000, START);
  assert.equal(planSession(initial, START - 1_000).currentElapsedSec, 0);
  const saved = pauseSession(initial, START + 60_000);
  const rolledBack = resumeSession(saved, START + 30_000);
  assert.equal(rolledBack.updatedAtMs, START + 60_000);
  assert.equal(planSession(rolledBack, START + 30_000).currentElapsedSec, 60);
  const late = planSession(initial, START + 1_000_000);
  assert.ok(late.availableSec < 0);
  assert.ok(late.minimumOverrunSec > 0);
  assert.equal(late.feasible, false);
  assert.equal(late.currentStep!.title, 'Prepare');
});

test('all-optional routines may recommend skipping without completing anything', () => {
  const item = routine();
  for (const step of item.steps) step.required = false;
  const session = startSession(item, START + 120_000, START);
  const plan = planSession(session, START);
  assert.equal(plan.feasible, true);
  assert.equal(plan.protectedMinimumSec, 0);
  assert.equal(plan.currentStep!.recommendation, 'skip');
  assert.equal(session.status, 'running');
  assert.equal(session.progress.every((entry) => entry.status === 'pending'), true);
  validateSession(session);
});

test('English and Japanese presets are valid, separate copies with stable IDs', () => {
  const english = getPresetRoutines('en');
  const japanese = getPresetRoutines('ja');
  assert.deepEqual(english.map((item) => item.id), japanese.map((item) => item.id));
  assert.notEqual(english[0]!.title, japanese[0]!.title);
  english[0]!.steps[0]!.title = 'Changed';
  assert.notEqual(getPresetRoutines('en')[0]!.steps[0]!.title, 'Changed');
  for (const item of japanese) validateRoutine(item);
});

test('deadline feasibility and minimum invariants hold across a range of budgets and elapsed times', () => {
  for (const budgetSec of [1, 60, 120, 180, 240, 360, 600, 900]) {
    const initial = startSession(routine(), START + budgetSec * 1_000, START);
    for (const elapsedSec of [0, 1, 30, 120, 240, 300, 600, 1_000]) {
      const plan = planSession(initial, START + elapsedSec * 1_000);
      assert.equal(plan.feasible, plan.minimumOverrunSec <= 1e-7);
      assert.ok(Number.isFinite(plan.finishMs));
      assert.ok(plan.allocatedRemainingSec >= 0);
      for (const step of plan.steps) {
        assert.ok(step.allocatedSec >= 0);
        if (step.required) {
          assert.ok(step.allocatedSec + 1e-6 >= step.minimumRemainingSec);
          assert.equal(step.recommendation, 'do');
        }
      }
      if (plan.feasible) assert.ok(plan.finishWithBufferMs <= initial.deadlineMs + 0.001);
    }
  }
});

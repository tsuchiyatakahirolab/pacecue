import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createPersistence, type PersistenceStatus, type StorageBridge } from '../src/persistence.ts';
import { createGlassesAdapter, MENU_PAUSE_RESUME, MENU_SKIP_OPTIONAL, MENU_UNDO,
  type GlassesAdapter, type GlassesFrame, type GlassesStatus } from '../src/glasses.ts';
import {
  EvenAppBridge, Sys_ItemEvent, Text_ItemEvent, List_ItemEvent, IMU_Report_Data,
  OsEventTypeList, MenuItemClickEvent, type EvenHubEvent, type CreateStartUpPageContainer,
  type TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk';

interface State { updatedAt: number; value: number }
const key = 'pacecue.test';
const valid = (value: unknown): value is State => Boolean(value && typeof value === 'object'
  && Number.isFinite((value as State).updatedAt) && Number.isFinite((value as State).value));

function localStore(raw: string | null = null) {
  const items = new Map<string, string>(raw ? [[key, raw]] : []);
  return {
    getItem: (item: string) => items.get(item) ?? null,
    setItem: (item: string, value: string) => { items.set(item, value); },
  };
}

function stored(value: State, stamp = value.updatedAt): string {
  return JSON.stringify({ format: 'pacecue.storage.v1', savedAt: stamp, value });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

interface TestWindow extends EventTarget {
  __getStateSnapshot?: () => string;
  __getState?: () => string;
  __restoreState?: (snapshot: unknown) => boolean;
  flutter_inappwebview?: { callHandler: () => void };
  EvenAppBridge?: unknown;
}

function hostWindow(t: TestContext): TestWindow {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const host = new EventTarget() as TestWindow;
  Object.defineProperty(globalThis, 'window', { value: host, configurable: true, writable: true });
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, 'window', prior);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  return host;
}

function displayHost(t: TestContext, update: (value: TextContainerUpgrade, count: number) => Promise<boolean>) {
  const host = hostWindow(t);
  host.flutter_inappwebview = { callHandler: () => undefined };
  let dispatch: (event: EvenHubEvent) => void = () => undefined;
  const writes: TextContainerUpgrade[] = [];
  const exitModes: number[] = [];
  host.EvenAppBridge = {
    ready: true, _ready: true,
    onEvenHubEvent: (callback: (event: EvenHubEvent) => void) => {
      dispatch = callback; return () => undefined;
    },
    createStartUpPageContainer: async () => 0,
    textContainerUpgrade: async (value: TextContainerUpgrade) => {
      writes.push(value); return update(value, writes.length);
    },
    shutDownPageContainer: async (mode: number) => { exitModes.push(mode); return true; },
  };
  return { writes, exitModes,
    fire: (eventType: OsEventTypeList) => dispatch({ sysEvent: new Sys_ItemEvent({ eventType }) }) };
}

test('native progress survives a fresh browser session and restores the newest saved state', async () => {
  let state: State = { updatedAt: 0, value: 0 };
  const storage = localStore(stored({ updatedAt: 10, value: 1 }));
  const bridge: StorageBridge = {
    getLocalStorage: async () => stored({ updatedAt: 20, value: 2 }),
    setLocalStorage: async () => true,
  };
  const persistence = createPersistence({ key, storage, getState: () => state,
    restoreState: (value) => { state = value; }, validate: valid });
  assert.equal(await persistence.load(bridge), true);
  assert.equal(state.value, 2);
  assert.equal(JSON.parse(storage.getItem(key)!).value.value, 2);
  persistence.dispose();
});

test('native state wins equal timestamps; a newer browser backup is copied to native storage', async () => {
  let state: State = { updatedAt: 0, value: 0 };
  const writes: string[] = [];
  const storage = localStore(stored({ updatedAt: 30, value: 1 }));
  const bridge: StorageBridge = {
    getLocalStorage: async () => stored({ updatedAt: 30, value: 2 }),
    setLocalStorage: async (_key, value) => { writes.push(value); return true; },
  };
  const persistence = createPersistence({ key, storage, getState: () => state,
    restoreState: (value) => { state = value; }, validate: valid });
  await persistence.load(bridge);
  assert.equal(state.value, 2);
  assert.equal(writes.length, 0);
  storage.setItem(key, stored({ updatedAt: 40, value: 3 }));
  await persistence.load(bridge);
  assert.equal(state.value, 3);
  assert.equal(JSON.parse(writes.at(-1)!).value.value, 3);
  persistence.dispose();
});

test('edits made during a slow restore cannot be overwritten by the old native response', async () => {
  let state: State = { updatedAt: 10, value: 1 };
  const read = deferred<string>();
  const bridge: StorageBridge = {
    getLocalStorage: () => read.promise,
    setLocalStorage: async () => true,
  };
  const persistence = createPersistence({ key, storage: localStore(), getState: () => state,
    restoreState: (value) => { state = value; }, validate: valid });
  const loading = persistence.load(bridge);
  state = { updatedAt: 30, value: 3 };
  await persistence.save();
  read.resolve(stored({ updatedAt: 20, value: 2 }));
  await loading;
  assert.equal(state.value, 3);
  persistence.dispose();
});

test('rapid actions are written in order and each write preserves its original snapshot', async () => {
  let state: State = { updatedAt: 1, value: 1 };
  const first = deferred<boolean>();
  const writes: string[] = [];
  const bridge: StorageBridge = {
    getLocalStorage: async () => '',
    setLocalStorage: async (_key, value) => {
      writes.push(value);
      return writes.length === 1 ? first.promise : true;
    },
  };
  const persistence = createPersistence({ key, storage: localStore(), getState: () => state,
    restoreState: (value) => { state = value; }, validate: valid });
  await persistence.load(bridge);
  const one = persistence.save();
  state = { updatedAt: 2, value: 2 };
  const two = persistence.save();
  await turn();
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(writes[0]).value.value, 1);
  first.resolve(true);
  await Promise.all([one, two]);
  assert.equal(writes.length, 2);
  assert.equal(JSON.parse(writes[1]).value.value, 2);
  assert.equal(await persistence.flush(), true);
  persistence.dispose();
});

test('a timed-out save does not let a later native write overtake it', async () => {
  let state: State = { updatedAt: 1, value: 1 };
  const first = deferred<boolean>();
  const writes: string[] = [];
  const status: PersistenceStatus[] = [];
  const bridge: StorageBridge = {
    getLocalStorage: async () => '',
    setLocalStorage: async (_key, value) => {
      writes.push(value);
      return writes.length === 1 ? first.promise : true;
    },
  };
  const persistence = createPersistence({ key, storage: localStore(), timeoutMs: 100,
    getState: () => state, restoreState: (value) => { state = value; }, validate: valid,
    onStatus: (value) => { status.push(value); } });
  await persistence.load(bridge);
  // Browser persistence still succeeds while the native write is delayed.
  assert.equal(await persistence.save(), true);
  state = { updatedAt: 2, value: 2 };
  const second = persistence.save();
  await turn();
  assert.equal(writes.length, 1);
  assert.ok(status.some((value) => value.mode === 'error'));
  first.resolve(true);
  await second;
  assert.equal(writes.length, 2);
  assert.equal(JSON.parse(writes[1]).value.value, 2);
  persistence.dispose();
});

test('corrupt native data leaves a valid browser backup intact and reports the problem', async () => {
  let state: State = { updatedAt: 0, value: 0 };
  const status: PersistenceStatus[] = [];
  let writes = 0;
  const bridge: StorageBridge = {
    getLocalStorage: async () => '{invalid',
    setLocalStorage: async () => { writes += 1; return true; },
  };
  const persistence = createPersistence({ key, storage: localStore(stored({ updatedAt: 10, value: 7 })),
    getState: () => state, restoreState: (value) => { state = value; }, validate: valid,
    onStatus: (value) => { status.push(value); } });
  assert.equal(await persistence.load(bridge), true);
  assert.equal(state.value, 7);
  assert.equal(writes, 0);
  assert.equal(status.at(-1)?.mode, 'error');
  persistence.dispose();
});

test('a save fails visibly when neither native nor browser storage can persist it', async () => {
  const status: PersistenceStatus[] = [];
  const bridge: StorageBridge = {
    getLocalStorage: async () => '',
    setLocalStorage: async () => false,
  };
  const persistence = createPersistence({ key,
    storage: { getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } },
    getState: () => ({ updatedAt: 10, value: 2 }), restoreState: () => undefined, validate: valid,
    onStatus: (value) => { status.push(value); } });
  await persistence.load(bridge);
  assert.equal(await persistence.save(), false);
  assert.equal(status.at(-1)?.mode, 'error');
  assert.match(status.at(-1)!.message, /only in memory/);
  persistence.dispose();
});

test('host migration hooks are synchronous and reject invalid or stale background snapshots', async (t) => {
  const host = hostWindow(t);
  let state: State = { updatedAt: 10, value: 1 };
  const storage = localStore();
  const persistence = createPersistence({ key, storage, getState: () => state,
    restoreState: (value) => { state = value; }, validate: valid });
  // No load(), connect() or await is needed to register the host entry points.
  assert.equal(typeof host.__getStateSnapshot, 'function');
  assert.equal(typeof host.__getState, 'function');
  assert.equal(typeof host.__restoreState, 'function');
  // Startup defaults are not exported as authoritative over an unread native save.
  assert.deepEqual(JSON.parse(host.__getStateSnapshot!()), {});
  await persistence.save();
  const oldSnapshot = host.__getStateSnapshot!();
  assert.equal(JSON.parse(oldSnapshot)[key].value.value, 1);
  const newState: State = { updatedAt: Date.now() + 10_000, value: 2 };
  assert.equal(host.__restoreState!({ [key]: JSON.parse(stored(newState)) }), true);
  assert.equal(state.value, 2);
  assert.equal(host.__restoreState!(oldSnapshot), false);
  assert.equal(host.__restoreState!('{invalid'), false);
  assert.equal(host.__restoreState!({ [key]: { updatedAt: 40, value: 'wrong type' } }), false);
  assert.equal(state.value, 2);
  assert.equal(JSON.parse(storage.getItem(key)!).value.value, 2);
  persistence.dispose();
  assert.equal(host.__getStateSnapshot, undefined);
  assert.equal(host.__restoreState, undefined);
});

test('headless restoration outranks an older native read still in flight', async (t) => {
  const host = hostWindow(t);
  let state: State = { updatedAt: Date.now(), value: 0 };
  const read = deferred<string>();
  const bridge: StorageBridge = {
    getLocalStorage: () => read.promise,
    setLocalStorage: async () => true,
  };
  const persistence = createPersistence({ key, storage: localStore(), getState: () => state,
    restoreState: (value) => { state = value; }, validate: valid });
  const loading = persistence.load(bridge);
  // The initial default's current timestamp must not block a real older session.
  assert.equal(host.__restoreState!(JSON.stringify({ [key]: JSON.parse(stored({ updatedAt: 20, value: 3 })) })), true);
  read.resolve(stored({ updatedAt: 10, value: 1 }));
  await loading;
  assert.equal(state.value, 3);
  persistence.dispose();
});

test('a later load cannot replace a restored host session with older browser or native data', async (t) => {
  const host = hostWindow(t);
  let state: State = { updatedAt: 0, value: 0 };
  const storage = localStore();
  const writes: string[] = [];
  const bridge: StorageBridge = {
    getLocalStorage: async () => stored({ updatedAt: 15, value: 1 }),
    setLocalStorage: async (_key, value) => { writes.push(value); return true; },
  };
  const persistence = createPersistence({ key, storage, getState: () => state,
    restoreState: (value) => { state = value; }, validate: valid });
  host.__restoreState!({ [key]: JSON.parse(stored({ updatedAt: 30, value: 4 })) });
  storage.setItem(key, stored({ updatedAt: 10, value: 2 }));
  await persistence.load(bridge);
  assert.equal(state.value, 4);
  assert.equal(JSON.parse(writes.at(-1)!).value.value, 4);
  persistence.dispose();
});

test('hiding an unchanged foreground view cannot timestamp stale data as a new edit', async (t) => {
  const host = hostWindow(t);
  let state: State = { updatedAt: 20, value: 2 };
  const writes: string[] = [];
  const persistence = createPersistence({ key, storage: localStore(), getState: () => state,
    restoreState: (value) => { state = value; }, validate: valid });
  await persistence.load({ getLocalStorage: async () => '',
    setLocalStorage: async (_key, value) => { writes.push(value); return true; } });
  await persistence.save();
  const before = JSON.parse(host.__getStateSnapshot!())[key].savedAt;
  host.dispatchEvent(new Event('pagehide'));
  const after = JSON.parse(host.__getStateSnapshot!())[key].savedAt;
  await persistence.flush();
  assert.equal(before, after);
  assert.equal(writes.length, 1);
  persistence.dispose();
});

test('native system and container gestures reach actions while OS overlays do not pause or exit', async (t) => {
  const host = hostWindow(t);
  host.flutter_inappwebview = { callHandler: () => undefined };
  let eventHandler: (event: EvenHubEvent) => void = () => undefined;
  let page: CreateStartUpPageContainer | null = null;
  const exitModes: number[] = [];
  const calls = { click: 0, up: 0, down: 0, exit: 0, menu: [] as number[] };
  const fake = {
    ready: true,
    _ready: true,
    onEvenHubEvent: (callback: (event: EvenHubEvent) => void) => {
      eventHandler = callback; return () => undefined;
    },
    createStartUpPageContainer: async (value: CreateStartUpPageContainer) => { page = value; return 0; },
    shutDownPageContainer: async (mode: number) => { exitModes.push(mode); return true; },
  };
  host.EvenAppBridge = fake;
  t.mock.method(EvenAppBridge, 'getInstance', () => fake as unknown as EvenAppBridge);
  const adapter = createGlassesAdapter({
    onClick: () => { calls.click += 1; }, onScrollUp: () => { calls.up += 1; },
    onScrollDown: () => { calls.down += 1; }, onExit: () => { calls.exit += 1; },
    onMenu: (id) => { calls.menu.push(id); },
    menuLabels: () => ({ pauseResume: '一時停止／再開', skipOptional: '任意の手順を省略', undo: '元に戻す' }),
  });
  assert.equal(await adapter.connect(), true);
  eventHandler({ sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.CLICK_EVENT }) });
  eventHandler({ sysEvent: new Sys_ItemEvent({}) }); // protobuf-omitted zero
  eventHandler({ sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.SCROLL_TOP_EVENT }) });
  eventHandler({ sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT }) });
  eventHandler({ textEvent: new Text_ItemEvent({ eventType: OsEventTypeList.CLICK_EVENT }) });
  eventHandler({ listEvent: new List_ItemEvent({ eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT }) });
  eventHandler({ sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT }) });
  eventHandler({ sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT }) });
  eventHandler({ sysEvent: new Sys_ItemEvent({ imuData: new IMU_Report_Data({ x: 1, y: 1, z: 1 }) }) });
  assert.deepEqual(calls, { click: 3, up: 1, down: 2, exit: 0, menu: [] });
  for (const itemID of [MENU_PAUSE_RESUME, MENU_SKIP_OPTIONAL, MENU_UNDO]) {
    eventHandler({ menuItemClickEvent: new MenuItemClickEvent({ itemID }) });
  }
  assert.deepEqual(calls.menu, [1, 2, 3]);
  eventHandler({ sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.DOUBLE_CLICK_EVENT }) });
  await turn();
  assert.deepEqual(exitModes, [1]);
  assert.equal(calls.exit, 0);
  eventHandler({ sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.SYSTEM_EXIT_EVENT }) });
  assert.equal(calls.exit, 1);
  const renderedPage = page as unknown as CreateStartUpPageContainer;
  assert.deepEqual(renderedPage.menuObject?.menuItems?.map((item) => item.itemName),
    ['一時停止／再開', '任意の手順を省略', '元に戻す']);
  adapter.dispose();
});

test('an idle action works, but a second tap cannot complete a step before its frame is acknowledged', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000 });
  const pendingFrame = deferred<boolean>();
  const native = displayHost(t, async (_value, count) => count === 1 ? pendingFrame.promise : true);
  const home: GlassesFrame = { header: 'PaceCue', title: 'Choose morning routine',
    body: 'Finish at 08:30', footer: 'Tap: start', interactionKey: 'home:morning:0830' };
  const step: GlassesFrame = { header: 'Morning / 1 / 3', title: 'Prepare your bag',
    body: '05:00', footer: 'Tap: done', interactionKey: 'active:123:0:current:running' };
  let actions = 0;
  let adapter: GlassesAdapter;
  adapter = createGlassesAdapter({ onClick: () => {
    if (!adapter.isDisplayCurrent()) return;
    actions += 1;
    if (actions === 1) adapter.display(step);
  } });
  adapter.display(home);
  assert.equal(adapter.isDisplayCurrent(), false);
  await adapter.connect();
  assert.equal(adapter.isDisplayCurrent(), true);
  native.fire(OsEventTypeList.CLICK_EVENT);
  assert.equal(actions, 1);
  assert.equal(adapter.isDisplayCurrent(), false);
  t.mock.timers.tick(500);
  await turn();
  native.fire(OsEventTypeList.CLICK_EVENT);
  assert.equal(actions, 1); // A 400ms input debounce alone would permit this tap.
  t.mock.timers.tick(500);
  await turn();
  assert.equal(native.writes.length, 1);
  native.fire(OsEventTypeList.CLICK_EVENT);
  assert.equal(actions, 1); // First container write has not yet acknowledged.
  pendingFrame.resolve(true);
  await turn();
  assert.equal(adapter.isDisplayCurrent(), true);
  native.fire(OsEventTypeList.CLICK_EVENT);
  assert.equal(actions, 2);
  adapter.dispose();
});

test('queued or in-flight countdown updates do not suppress actions for the same visible step', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000 });
  const pendingClock = deferred<boolean>();
  const native = displayHost(t, async (_value, count) => count === 1 ? pendingClock.promise : true);
  const first: GlassesFrame = { header: 'Morning / 1 / 3', title: 'Prepare your bag',
    body: '05:00', footer: 'Tap: done', interactionKey: 'active:123:0:current:running' };
  const adapter = createGlassesAdapter();
  adapter.display(first);
  await adapter.connect();
  const next = { ...first, body: '04:59' };
  adapter.display(next);
  assert.equal(adapter.isDisplayCurrent(), true);
  t.mock.timers.tick(1_000);
  await turn();
  assert.equal(native.writes.length, 1);
  assert.equal(adapter.isDisplayCurrent(), true);
  pendingClock.resolve(true);
  await turn();
  assert.equal(adapter.isDisplayCurrent(), true);
  // Identical, already acknowledged pixels require no extra BLE write merely
  // because the application's interaction identity changed.
  adapter.display({ ...next, interactionKey: 'active:456:0:current:running' });
  assert.equal(adapter.isDisplayCurrent(), true);
  assert.equal(native.writes.length, 1);
  adapter.dispose();
});

test('exit immediately holds writes and ignores their closing-page failure; cancellation resumes updates', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000 });
  const pending = deferred<boolean>();
  const native = displayHost(t, async (_value, count) => count === 1 ? pending.promise : true);
  const statuses: GlassesStatus[] = [];
  let exits = 0;
  const frame: GlassesFrame = { header: 'Morning', title: 'Prepare your bag', body: '05:00',
    footer: 'Tap: done', interactionKey: 'active:123:0:current:running' };
  const adapter = createGlassesAdapter({ onStatus: (value) => { statuses.push(value); },
    onExit: () => { exits += 1; } });
  adapter.display(frame);
  await adapter.connect();
  adapter.display({ ...frame, body: '04:59' });
  t.mock.timers.tick(1_000);
  await turn();
  native.fire(OsEventTypeList.DOUBLE_CLICK_EVENT);
  assert.equal(adapter.isDisplayCurrent(), false);
  assert.deepEqual(native.exitModes, [1]);
  pending.resolve(false); // Simulator/host closed the native page first.
  await turn();
  adapter.display({ ...frame, body: '04:58' });
  t.mock.timers.tick(10_000);
  await turn();
  assert.equal(native.writes.length, 1);
  assert.equal(statuses.some((value) => value.mode === 'error'), false);
  native.fire(OsEventTypeList.FOREGROUND_EXIT_EVENT); // User cancelled the dialog.
  t.mock.timers.tick(0);
  await turn();
  assert.equal(native.writes.length, 2);
  assert.equal(native.writes[1].content, '04:58');
  assert.equal(adapter.isDisplayCurrent(), true);
  assert.equal(exits, 0);
  native.fire(OsEventTypeList.DOUBLE_CLICK_EVENT);
  native.fire(OsEventTypeList.SYSTEM_EXIT_EVENT);
  assert.equal(exits, 1);
  assert.equal(adapter.isDisplayCurrent(), false);
  adapter.dispose();
});

test('cancelling exit before an older display rejection arrives does not disable later redraws', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000 });
  const pending = deferred<boolean>();
  const native = displayHost(t, async (_value, count) => count === 1 ? pending.promise : true);
  const statuses: GlassesStatus[] = [];
  const frame: GlassesFrame = { header: 'Morning', title: 'Prepare your bag', body: '05:00',
    footer: 'Tap: done', interactionKey: 'active:123:0:current:running' };
  const adapter = createGlassesAdapter({ onStatus: (value) => { statuses.push(value); } });
  adapter.display(frame);
  await adapter.connect();
  adapter.display({ ...frame, body: '04:59' });
  t.mock.timers.tick(1_000);
  await turn();
  native.fire(OsEventTypeList.DOUBLE_CLICK_EVENT);
  native.fire(OsEventTypeList.FOREGROUND_EXIT_EVENT);
  pending.resolve(false);
  await turn();
  t.mock.timers.tick(1_000);
  await turn();
  assert.equal(native.writes.length, 2);
  assert.equal(adapter.isDisplayCurrent(), true);
  assert.equal(statuses.some((value) => value.mode === 'error'), false);
  adapter.dispose();
});

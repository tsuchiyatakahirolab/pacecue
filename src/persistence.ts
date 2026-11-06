/** The native SDK and test doubles can both satisfy this narrow storage surface. */
export interface StorageBridge {
  getLocalStorage(key: string): Promise<string>;
  setLocalStorage(key: string, value: string): Promise<boolean>;
}

export interface PersistenceStatus {
  mode: 'local' | 'device' | 'saving' | 'error';
  message: string;
}

export interface PersistenceOptions<T> {
  key: string;
  getState: () => T;
  restoreState: (state: T) => void;
  validate: (value: unknown) => value is T;
  onStatus?: (status: PersistenceStatus) => void;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  timeoutMs?: number;
}

export interface PersistenceController {
  load(bridge?: StorageBridge | null): Promise<boolean>;
  save(): Promise<boolean>;
  flush(): Promise<boolean>;
  dispose(): void;
}

interface Envelope<T> {
  format: 'pacecue.storage.v1';
  savedAt: number;
  value: T;
}

interface Candidate<T> {
  value: T;
  stamp: number;
  serialized: string;
  fingerprint: string;
}

interface HostStateWindow {
  __getStateSnapshot?: () => unknown;
  __getState?: () => unknown;
  __restoreState?: (snapshot: unknown) => unknown;
}

function unpackJSON(value: unknown): unknown {
  // Some native injection paths pass a string, others the already parsed object.
  let result = value;
  for (let depth = 0; depth < 2 && typeof result === 'string'; depth += 1) {
    result = JSON.parse(result);
  }
  return result;
}

function stateTimestamp(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const updatedAt = (value as Record<string, unknown>).updatedAt;
  return typeof updatedAt === 'number' && Number.isFinite(updatedAt) && updatedAt >= 0
    ? updatedAt : 0;
}

function browserStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function boundedWait<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Storage response timed out')), milliseconds);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Application callbacks are captured synchronously. Restore from the browser
 * first, then prefer the newest valid native SDK copy (native wins equal dates).
 * Every mutation should call save(); elapsed time should be derived from saved
 * wall-clock timestamps, not persisted every animation frame.
 */
export function createPersistence<T>(options: PersistenceOptions<T>): PersistenceController {
  const storage = options.storage ?? browserStorage();
  const timeoutMs = Math.max(100, options.timeoutMs ?? 5_000);
  let bridge: StorageBridge | null = null;
  let disposed = false;
  let revision = 0;
  let loadID = 0;
  let lastStamp = 0;
  let latest: Candidate<T> | null = null;
  let pending = 0;
  let lastNativeOkay = true;
  let nativeQueue: Promise<void> = Promise.resolve();

  const status = (mode: PersistenceStatus['mode'], message: string): void => {
    if (!disposed) options.onStatus?.({ mode, message });
  };

  function parse(raw: string | null | undefined): Candidate<T> | null {
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    let value: unknown = parsed;
    let savedAt = 0;
    if (parsed && typeof parsed === 'object'
      && (parsed as Record<string, unknown>).format === 'pacecue.storage.v1') {
      const envelope = parsed as Record<string, unknown>;
      if (typeof envelope.savedAt !== 'number' || !Number.isFinite(envelope.savedAt)
        || envelope.savedAt < 0) throw new Error('Invalid saved timestamp');
      savedAt = envelope.savedAt;
      value = envelope.value;
    }
    if (!options.validate(value)) throw new Error('Invalid saved state');
    return { value, stamp: Math.max(savedAt, stateTimestamp(value)), serialized: raw,
      fingerprint: JSON.stringify(value) };
  }

  function snapshot(): Candidate<T> {
    const value = options.getState();
    if (!options.validate(value)) throw new Error('Current state is invalid');
    lastStamp = Math.max(Date.now(), lastStamp + 1, stateTimestamp(value));
    const envelope: Envelope<T> = { format: 'pacecue.storage.v1', savedAt: lastStamp, value };
    // Serialize at invocation, before a queued native write can observe later edits.
    return { value, stamp: lastStamp, serialized: JSON.stringify(envelope),
      fingerprint: JSON.stringify(value) };
  }

  function writeBrowser(serialized: string): boolean {
    if (!storage) return false;
    try {
      storage.setItem(options.key, serialized);
      return true;
    } catch {
      return false;
    }
  }

  function enqueueNative(serialized: string): Promise<boolean> {
    const target = bridge;
    if (!target) return Promise.resolve(false);
    pending += 1;
    status('saving', 'Saving progress to this device…');
    const write = nativeQueue.then(async () => {
      try {
        // Keep the actual SDK promise in the queue. Timing out a caller must NOT
        // allow a subsequent write to overtake a still-pending native operation.
        const okay = await target.setLocalStorage(options.key, serialized);
        lastNativeOkay = okay;
        if (!okay) status('error', 'Device storage did not confirm the save. A browser backup was attempted.');
        return okay;
      } catch {
        lastNativeOkay = false;
        status('error', 'Device storage is unavailable. A browser backup was attempted.');
        return false;
      } finally {
        pending -= 1;
        if (pending === 0 && lastNativeOkay) status('device', 'Saved on this device.');
      }
    });
    nativeQueue = write.then(() => undefined);
    return boundedWait(write, timeoutMs).catch(() => {
      status('error', 'Device storage has not responded. The local backup will be used until it recovers.');
      return false;
    });
  }

  function save(): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    revision += 1;
    let copy: Candidate<T>;
    try {
      copy = snapshot();
      latest = copy;
    } catch {
      status('error', 'Progress could not be saved because its data is invalid.');
      return Promise.resolve(false);
    }
    const browserOkay = writeBrowser(copy.serialized);
    if (bridge) {
      return enqueueNative(copy.serialized).then((nativeOkay) => {
        if (!nativeOkay && !browserOkay) status('error', 'Progress is only in memory. Keep this page open and export a backup.');
        return nativeOkay || browserOkay;
      });
    }
    status(browserOkay ? 'local' : 'error', browserOkay
      ? 'Saved in this browser. Open PaceCue in Even Hub for device storage.'
      : 'Browser storage is unavailable. Keep this page open and export a backup.');
    return Promise.resolve(browserOkay);
  }

  async function load(nextBridge: StorageBridge | null = null): Promise<boolean> {
    if (disposed) return false;
    bridge = nextBridge;
    const thisLoad = ++loadID;
    const startRevision = revision;
    let local: Candidate<T> | null = null;
    let localInvalid = false;
    try {
      local = parse(storage?.getItem(options.key));
      // A host snapshot or unsaved in-memory edit can be newer than browser data.
      if (latest && (!local || latest.stamp >= local.stamp)) local = latest;
      if (local) {
        latest = local;
        lastStamp = Math.max(lastStamp, local.stamp);
        options.restoreState(local.value);
      }
    } catch {
      localInvalid = true;
      local = latest;
    }
    if (!nextBridge) {
      status(localInvalid ? 'error' : 'local', localInvalid
        ? 'Browser data could not be restored. The current setup is kept.'
        : 'Using local browser storage.');
      return local !== null;
    }

    let native: Candidate<T> | null = null;
    try {
      const raw = await boundedWait(nextBridge.getLocalStorage(options.key), timeoutMs);
      if (disposed || thisLoad !== loadID) return local !== null;
      native = parse(raw);
    } catch {
      if (!disposed && thisLoad === loadID) {
        status('error', local
          ? 'Device data could not be read. Using the valid browser backup.'
          : 'Saved device data could not be read. The current setup is kept.');
      }
      return local !== null;
    }

    // User edits made while native storage was loading must not be overwritten.
    if (revision !== startRevision) return local !== null;
    const chosen = native && (!local || native.stamp >= local.stamp) ? native : local;
    if (chosen) {
      latest = chosen;
      lastStamp = Math.max(lastStamp, chosen.stamp);
      options.restoreState(chosen.value);
      writeBrowser(chosen.serialized);
      if (chosen === local && (!native || local.stamp > native.stamp)) {
        await enqueueNative(chosen.serialized);
      } else {
        status('device', 'Restored from this device.');
      }
      return true;
    }
    if (localInvalid) {
      status('error', 'Saved data could not be restored. The current setup is kept.');
      return false;
    }
    status('device', 'Device storage is ready.');
    return false;
  }

  const lifecycleSave = (): void => {
    // The foreground/headless WebViews can overlap briefly. Merely hiding an
    // old foreground view must not generate a "newer" timestamp for stale data.
    // Every explicit mutation already saves eagerly; checkpoint only real changes.
    if (!latest) return;
    try {
      if (JSON.stringify(options.getState()) !== latest.fingerprint) void save();
    } catch {
      status('error', 'Progress could not be checked before this view closed.');
    }
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') lifecycleSave();
  };
  if (typeof window !== 'undefined') window.addEventListener('pagehide', lifecycleSave);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  // The official background-state guide describes these host globals, while
  // SDK 0.0.16 does not export its documented setBackgroundState helpers:
  // github.com/even-realities/everything-evenhub/tree/main/plugins/everything-evenhub/skills/background-state
  // Register synchronously, before load(), bridge setup, or any other await.
  // Keep SDK storage as the durable fallback when a host does not invoke them.
  const host = typeof window === 'undefined' ? null : window as Window & HostStateWindow;
  const previousSnapshot = host?.__getStateSnapshot;
  const previousGetState = host?.__getState;
  const previousRestore = host?.__restoreState;

  const getHostSnapshot = (): string => {
    const aggregate: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    try {
      const inherited = unpackJSON(previousSnapshot?.());
      if (inherited && typeof inherited === 'object' && !Array.isArray(inherited)) {
        Object.assign(aggregate, inherited);
      }
    } catch {
      // A separate exporter must not prevent our own validated state export.
    }
    if (!disposed && latest) {
      try {
        lifecycleSave();
        const value = options.getState();
        if (options.validate(value)) {
          // Exporting a snapshot is a read: it must not advance its version.
          aggregate[options.key] = {
            format: 'pacecue.storage.v1', savedAt: lastStamp, value,
          } satisfies Envelope<T>;
        }
      } catch {
        status('error', 'The current state could not be prepared for background use.');
      }
    }
    return JSON.stringify(aggregate);
  };

  const restoreHostSnapshot = (incoming: unknown): boolean => {
    if (disposed) return false;
    let decoded: unknown;
    let candidate: Candidate<T> | null;
    try {
      decoded = unpackJSON(incoming);
      let scoped = decoded;
      if (decoded && typeof decoded === 'object'
        && Object.prototype.hasOwnProperty.call(decoded, options.key)) {
        scoped = (decoded as Record<string, unknown>)[options.key];
      }
      candidate = parse(typeof scoped === 'string' ? scoped : JSON.stringify(scoped));
    } catch {
      status('error', 'An invalid background snapshot was ignored. Current progress is kept.');
      return false;
    }
    if (!candidate) return false;
    if (latest && (candidate.stamp < latest.stamp
      || (candidate.stamp === latest.stamp && candidate.fingerprint !== latest.fingerprint))) {
      return false;
    }
    try {
      // Preserve other registered exporters/restorers without trusting them to
      // restore this application's data. Our own validation remains mandatory.
      previousRestore?.(incoming);
    } catch {
      // Continue with our validated snapshot if another restorer rejects it.
    }
    revision += 1; // Invalidates a slower, older native storage read in flight.
    latest = candidate;
    lastStamp = Math.max(lastStamp, candidate.stamp);
    options.restoreState(candidate.value);
    const browserOkay = writeBrowser(candidate.serialized);
    if (bridge) void enqueueNative(candidate.serialized);
    else status(browserOkay ? 'local' : 'error', browserOkay
      ? 'Restored the background session.'
      : 'Background progress is restored in memory. Export a backup if storage remains unavailable.');
    return true;
  };

  if (host) {
    host.__getStateSnapshot = getHostSnapshot;
    host.__getState = getHostSnapshot;
    host.__restoreState = restoreHostSnapshot;
  }

  return {
    load,
    save,
    async flush() {
      try {
        await boundedWait(nativeQueue, timeoutMs);
        return lastNativeOkay;
      } catch {
        status('error', 'Device save is still pending. The browser backup is kept.');
        return false;
      }
    },
    dispose() {
      if (disposed) return;
      lifecycleSave();
      disposed = true;
      loadID += 1;
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', lifecycleSave);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      if (host?.__getStateSnapshot === getHostSnapshot) {
        if (previousSnapshot) host.__getStateSnapshot = previousSnapshot;
        else delete host.__getStateSnapshot;
      }
      if (host?.__getState === getHostSnapshot) {
        if (previousGetState) host.__getState = previousGetState;
        else delete host.__getState;
      }
      if (host?.__restoreState === restoreHostSnapshot) {
        if (previousRestore) host.__restoreState = previousRestore;
        else delete host.__restoreState;
      }
    },
  };
}

import {
  CreateStartUpPageContainer,
  EvenAppBridge,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';

export interface GlassesFrame {
  header: string;
  title: string;
  body: string;
  footer: string;
  /** Identity of the visible action; leave live countdown values out of this key. */
  interactionKey?: string;
}

export interface GlassesStatus {
  mode: 'preview' | 'connecting' | 'connected' | 'error';
  message: string;
}

export const MENU_PAUSE_RESUME = 1;
export const MENU_SKIP_OPTIONAL = 2;
export const MENU_UNDO = 3;

export interface GlassesMenuLabels {
  pauseResume: string;
  skipOptional: string;
  undo: string;
}

export interface GlassesOptions {
  onClick?: () => void;
  onScrollUp?: () => void;
  onScrollDown?: () => void;
  /** Called for the confirmed system exit, never when its dialog merely opens. */
  onExit?: () => void;
  onMenu?: (id: number) => void;
  onStatus?: (status: GlassesStatus) => void;
  timeoutMs?: number;
  /** A function reads the restored language when the native page is first created. */
  menuLabels?: Partial<GlassesMenuLabels> | (() => Partial<GlassesMenuLabels>);
}

export interface GlassesAdapter {
  connect(): Promise<boolean>;
  display(frame: GlassesFrame): void;
  /** True only when the currently actionable step/view has been acknowledged. */
  isDisplayCurrent(): boolean;
  getBridge(): EvenAppBridge | null;
  dispose(): void;
}

type NativeWindow = Window & {
  flutter_inappwebview?: { callHandler?: (...args: unknown[]) => unknown };
};

const FRAME_INTERVAL_MS = 1_000;
const FIELD_ORDER = ['header', 'title', 'body', 'footer'] as const;
const DEFAULT_FRAME: GlassesFrame = {
  header: 'PaceCue',
  title: 'Your next step',
  body: 'Choose a routine in the phone app.\nThen follow each step here.',
  footer: 'Double tap: exit',
};
const LAYOUT = {
  header: { xPosition: 16, yPosition: 8, width: 544, height: 36, textColor: 2 },
  title: { xPosition: 16, yPosition: 48, width: 544, height: 54, textColor: 4 },
  body: { xPosition: 16, yPosition: 108, width: 544, height: 112, textColor: 4 },
  footer: { xPosition: 16, yPosition: 228, width: 544, height: 56, textColor: 2 },
} as const;

function boundedText(value: string, limit: number): string {
  const plain = String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  const characters = Array.from(plain);
  return characters.length <= limit ? plain : `${characters.slice(0, limit - 1).join('')}…`;
}

function normalizeFrame(frame: GlassesFrame): GlassesFrame {
  return {
    header: boundedText(frame.header, 70),
    title: boundedText(frame.title, 120),
    body: boundedText(frame.body, 560),
    footer: boundedText(frame.footer, 120),
    ...(frame.interactionKey === undefined ? {} : {
      interactionKey: boundedText(frame.interactionKey, 512),
    }),
  };
}

function menuLabel(value: string | undefined, fallback: string): string {
  const characters = Array.from((value ?? fallback).replace(/\s+/g, ' ').trim());
  while (new TextEncoder().encode(characters.join('')).byteLength > 32) characters.pop();
  return characters.join('') || fallback;
}

function timeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

function hasNativeTransport(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as NativeWindow).flutter_inappwebview?.callHandler === 'function';
}

/** A late native injection gets a short grace period; a normal browser never hangs. */
async function waitForNativeTransport(milliseconds: number): Promise<boolean> {
  if (hasNativeTransport()) return true;
  if (typeof window === 'undefined') return false;
  const nativeHint = Boolean((window as NativeWindow).flutter_inappwebview)
    || /\bwv\b|evenhub|even realities/i.test(navigator.userAgent);
  const until = Date.now() + (nativeHint ? milliseconds : Math.min(milliseconds, 350));
  while (Date.now() < until) {
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    if (hasNativeTransport()) return true;
  }
  return false;
}

/**
 * Native display adapter. The phone UI can render the same frame independently.
 * All mutable callbacks are registered before connect() performs asynchronous work.
 */
export function createGlassesAdapter(options: GlassesOptions = {}): GlassesAdapter {
  let bridge: EvenAppBridge | null = null;
  let connected = false;
  let disposed = false;
  let startupAttempted = false;
  let connecting: Promise<boolean> | null = null;
  let unsubscribe: (() => void) | null = null;
  let requested: GlassesFrame = { ...DEFAULT_FRAME };
  let rendered: GlassesFrame | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rendering = false;
  let lastFrameStarted = 0;
  let renderFailure = false;
  let exitPending = false;
  let exitVersion = 0;
  const limit = Math.max(500, options.timeoutMs ?? 5_000);

  const status = (mode: GlassesStatus['mode'], message: string): void => {
    if (!disposed) options.onStatus?.({ mode, message });
  };

  const invoke = (callback: (() => void) | undefined): void => {
    try {
      callback?.();
    } catch (error) {
      console.error('[PaceCue] input handler failed', error);
      status('error', 'An action could not be completed. Your saved routine is kept.');
    }
  };

  function schedule(): void {
    if (!connected || disposed || renderFailure || rendering || exitPending) return;
    if (rendered && FIELD_ORDER.every((field) => rendered?.[field] === requested[field])) {
      // No native pixels need changing: their previous acknowledgement also
      // covers a new interaction identity with identical visible content.
      rendered = { ...requested };
      if (timer !== null) clearTimeout(timer);
      timer = null;
      return;
    }
    if (timer !== null) return;
    const delay = Math.max(0, FRAME_INTERVAL_MS - (Date.now() - lastFrameStarted));
    timer = setTimeout(() => {
      timer = null;
      void render();
    }, delay);
  }

  async function render(): Promise<void> {
    if (!bridge || !connected || disposed || rendering || exitPending) return;
    rendering = true;
    lastFrameStarted = Date.now();
    const frame = { ...requested };
    const startedExitVersion = exitVersion;
    try {
      for (let index = 0; index < FIELD_ORDER.length; index += 1) {
        if (disposed || !connected || exitPending || startedExitVersion !== exitVersion) return;
        const field = FIELD_ORDER[index];
        if (rendered?.[field] === frame[field]) continue;
        const okay = await timeout(bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: index + 1,
          containerName: field,
          content: frame[field],
        })), limit, 'Display update');
        if (!okay) throw new Error(`Display update rejected: ${field}`);
      }
      if (disposed || !connected || exitPending || startedExitVersion !== exitVersion) return;
      rendered = frame;
    } catch (error) {
      // A host may reject an in-flight update as it closes the page. This is an
      // expected exit race, including a cancellation that arrived before the
      // rejected update settled; it must not poison the next display session.
      if (disposed || !connected || exitPending || startedExitVersion !== exitVersion) return;
      // Do not send later writes after a timed-out write: native completion order
      // would otherwise be unknown. Reopening the app starts a clean display session.
      renderFailure = true;
      console.error('[PaceCue] display update failed', error);
      status('error', 'Glasses updates stopped. Reopen PaceCue to reconnect; the phone preview still works.');
    } finally {
      rendering = false;
      schedule();
    }
  }

  function handleEvent(event: EvenHubEvent): void {
    if (disposed) return;
    const menuID = event.menuItemClickEvent?.itemID;
    if (menuID !== undefined) {
      if (connected && !exitPending && [MENU_PAUSE_RESUME, MENU_SKIP_OPTIONAL, MENU_UNDO].includes(menuID)) {
        invoke(() => options.onMenu?.(menuID));
      }
      return;
    }

    const systemType = event.sysEvent?.eventType;
    if (systemType === OsEventTypeList.SYSTEM_EXIT_EVENT) {
      connected = false;
      exitPending = false;
      exitVersion += 1;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      invoke(options.onExit);
      return;
    }
    if (systemType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
      connected = false;
      exitPending = false;
      exitVersion += 1;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      status('error', 'The glasses session ended. Your saved progress can be resumed.');
      return;
    }
    // FOREGROUND_EXIT_EVENT means an OS overlay closed, not that our app exited.
    // A contextual menu must not pause a routine, stop timers or discard progress.
    if (systemType === OsEventTypeList.FOREGROUND_EXIT_EVENT && exitPending && connected) {
      exitPending = false;
      exitVersion += 1;
      schedule();
      return;
    }
    if (!connected || exitPending) return;

    // Hosts send single/double taps on sysEvent as well as the capturing
    // container. A protobuf-omitted zero is still a click. An IMU sample with
    // an absent eventType must never be interpreted as an input gesture.
    const input = event.textEvent ?? event.listEvent ?? event.sysEvent;
    const type = input?.eventType
      ?? (input && !event.sysEvent?.imuData ? OsEventTypeList.CLICK_EVENT : undefined);
    switch (type) {
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        // Opening this dialog is not a pause. Only the OS-confirmed exit fires onExit.
        if (bridge) {
          exitPending = true;
          const request = ++exitVersion;
          if (timer !== null) clearTimeout(timer);
          timer = null;
          void timeout(bridge.shutDownPageContainer(1), limit, 'Exit dialog').then((okay) => {
            if (!okay && request === exitVersion && connected && !disposed) {
              exitPending = false;
              status('error', 'The exit dialog could not open. Try double tapping again.');
              schedule();
            }
          }).catch(() => {
            if (request !== exitVersion || !connected || disposed) return;
            // The host might already have closed the page. Keep writes held until
            // an overlay-dismiss event confirms cancellation or the app reopens.
            status('error', 'The exit dialog did not respond. Reopen PaceCue if the glasses page closed.');
          });
        }
        break;
      case OsEventTypeList.CLICK_EVENT:
        invoke(options.onClick);
        break;
      case OsEventTypeList.SCROLL_TOP_EVENT:
        invoke(options.onScrollUp);
        break;
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        invoke(options.onScrollDown);
        break;
      default:
        break;
    }
  }

  async function connectOnce(): Promise<boolean> {
    if (disposed) return false;
    if (connected) return true;
    if (startupAttempted) {
      status('error', 'Reopen PaceCue to start a new glasses session.');
      return false;
    }
    status('connecting', 'Connecting to glasses…');
    if (!(await waitForNativeTransport(limit))) {
      status('preview', 'Browser preview. Open PaceCue in Even Hub to connect glasses.');
      return false;
    }
    try {
      bridge = await timeout(waitForEvenAppBridge(), limit, 'Glasses connection');
      if (disposed) return false;
      unsubscribe = bridge.onEvenHubEvent(handleEvent);
      startupAttempted = true;
      const firstFrame = { ...requested };
      const labels = typeof options.menuLabels === 'function'
        ? options.menuLabels() : options.menuLabels;
      const page = new CreateStartUpPageContainer({
        containerTotalNum: FIELD_ORDER.length,
        textObject: FIELD_ORDER.map((field, index) => new TextContainerProperty({
          ...LAYOUT[field],
          containerID: index + 1,
          containerName: field,
          borderWidth: 0,
          paddingLength: 0,
          content: firstFrame[field],
          isEventCapture: field === 'body' ? 1 : 0,
        })),
        menuObject: new MenuContainerProperty({
          menuItems: [
            new MenuItemProperty({ itemID: MENU_PAUSE_RESUME, itemName: menuLabel(labels?.pauseResume, 'Pause / Resume') }),
            new MenuItemProperty({ itemID: MENU_SKIP_OPTIONAL, itemName: menuLabel(labels?.skipOptional, 'Skip optional') }),
            new MenuItemProperty({ itemID: MENU_UNDO, itemName: menuLabel(labels?.undo, 'Undo') }),
          ],
        }),
      });
      const startupExitVersion = exitVersion;
      const result = await timeout(bridge.createStartUpPageContainer(page), limit, 'Glasses startup');
      if (result !== 0) throw new Error(`Glasses startup returned ${result}`);
      if (disposed || startupExitVersion !== exitVersion) return false;
      connected = true;
      rendered = firstFrame;
      lastFrameStarted = Date.now();
      status('connected', 'Connected to glasses.');
      console.info('[PaceCue] ready');
      schedule();
      return true;
    } catch (error) {
      unsubscribe?.();
      unsubscribe = null;
      console.error('[PaceCue] glasses connection failed', error);
      status('error', 'Glasses connection failed. Reopen PaceCue; the phone preview remains available.');
      return false;
    }
  }

  return {
    connect() {
      if (connecting) return connecting;
      connecting = connectOnce().finally(() => { connecting = null; });
      return connecting;
    },
    display(frame) {
      if (disposed) return;
      requested = normalizeFrame(frame);
      schedule();
    },
    isDisplayCurrent() {
      if (!connected || disposed || renderFailure || exitPending || !rendered) return false;
      if (requested.interactionKey !== undefined || rendered.interactionKey !== undefined) {
        return requested.interactionKey !== undefined
          && requested.interactionKey === rendered.interactionKey;
      }
      // Legacy callers without an identity still distinguish step/view titles
      // while allowing countdown-only body updates to remain interactive.
      return rendered.header === requested.header && rendered.title === requested.title;
    },
    getBridge: () => bridge,
    dispose() {
      disposed = true;
      connected = false;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}

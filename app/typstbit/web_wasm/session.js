export const STATUS = { IDLE: 0, COMPILING: 1, SUCCESS: 2, FAILED: 3 };

export function createSession(initial = {}) {
  const state = {
    source: "",
    status: STATUS.IDLE,
    revision: 0,
    docRevision: null,
    pageCount: 0,
    page: 0,
    diagnostics: [],
    previewUrl: null,
    previewReady: false,
    previewFailed: false,
    blobUrls: [],
    pendingTimer: null,
    compilingCount: 0,
    selection: { from: 0, to: 0 },
    ...initial,
  };
  const listeners = new Set();
  const getState = () => state;
  const update = patch => {
    Object.assign(state, patch);
    for (const listener of listeners) listener(state);
    return state;
  };
  const subscribe = listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return { state, getState, update, subscribe };
}

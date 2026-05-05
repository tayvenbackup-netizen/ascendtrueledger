type Listener = () => void;
interface AuthSnapshot { ready: boolean; authed: boolean; csrfToken: string | null; sessionToken: string | null; }
let state: AuthSnapshot = { ready: false, authed: false, csrfToken: null, sessionToken: null };
const listeners = new Set<Listener>();
export function getAuthState(): AuthSnapshot { return state; }
export function setAuthState(patch: Partial<AuthSnapshot>) { state = { ...state, ...patch }; listeners.forEach(l => l()); }
export function subscribeAuth(l: Listener): () => void { listeners.add(l); return () => listeners.delete(l); }

/** Server-internal room names. Never sent to clients. */
export const accountRoom = (accountId: string) => `a:${accountId}`;
export const personaRoom = (personaId: string) => `p:${personaId}`;
export const sessionRoom = (sessionId: string) => `s:${sessionId}`;

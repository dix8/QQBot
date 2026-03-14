import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../services/auth.js', () => ({
  authService: {
    getTokenVersion: vi.fn().mockReturnValue(1),
    isDefaultPassword: vi.fn().mockReturnValue(false),
  },
}));

vi.mock('../../routes/auth.js', () => ({
  validateAndConsumeWsTicket: vi.fn(),
}));

import { AdminWsManager } from '../../ws/admin-ws.js';
import { authService } from '../../services/auth.js';

const mockGetTokenVersion = authService.getTokenVersion as ReturnType<typeof vi.fn>;
const mockIsDefaultPassword = authService.isDefaultPassword as ReturnType<typeof vi.fn>;

function createMockSocket() {
  return {
    close: vi.fn(),
    send: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(),
    readyState: 1,
    on: vi.fn(),
    OPEN: 1,
    CONNECTING: 0,
  };
}

function createMockLogger(): any {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    silent: vi.fn(),
    level: 'info',
  };
}

/** Helper: inject a client directly into the private clients set */
function addTestClient(manager: AdminWsManager, userId: number, tokenVersion: number) {
  const socket = createMockSocket();
  const client = { socket, alive: true, userId, tokenVersion };
  (manager as any).clients.add(client);
  return { client, socket };
}

describe('AdminWsManager', () => {
  let manager: AdminWsManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTokenVersion.mockReturnValue(1);
    mockIsDefaultPassword.mockReturnValue(false);
    manager = new AdminWsManager(createMockLogger());
  });

  describe('invalidateUserSessions', () => {
    it('closes all connections for the specified userId', () => {
      const { socket: s1 } = addTestClient(manager, 1, 1);
      const { socket: s2 } = addTestClient(manager, 1, 1);
      const { socket: s3 } = addTestClient(manager, 2, 1);

      manager.invalidateUserSessions(1);

      expect(s1.close).toHaveBeenCalledWith(4004, expect.any(String));
      expect(s2.close).toHaveBeenCalledWith(4004, expect.any(String));
      expect(s3.close).not.toHaveBeenCalled();
      expect(manager.clientCount).toBe(1);
    });

    it('does nothing when userId has no connections', () => {
      addTestClient(manager, 2, 1);
      manager.invalidateUserSessions(999);
      expect(manager.clientCount).toBe(1);
    });

    it('uses custom reason in close message', () => {
      const { socket } = addTestClient(manager, 1, 1);
      manager.invalidateUserSessions(1, 'Password changed');
      expect(socket.close).toHaveBeenCalledWith(4004, 'Password changed');
    });
  });

  describe('broadcast', () => {
    it('sends to all valid clients', () => {
      const { socket: s1 } = addTestClient(manager, 1, 1);
      const { socket: s2 } = addTestClient(manager, 2, 1);

      manager.broadcast('test', { value: 42 });

      const expected = JSON.stringify({ event: 'test', data: { value: 42 } });
      expect(s1.send).toHaveBeenCalledWith(expected);
      expect(s2.send).toHaveBeenCalledWith(expected);
    });

    it('skips and closes clients with stale tokenVersion', () => {
      // User 1: valid (tokenVersion matches DB)
      const { socket: s1 } = addTestClient(manager, 1, 1);
      // User 2: stale (DB tokenVersion is 2, client has 1)
      const { socket: s2 } = addTestClient(manager, 2, 1);

      mockGetTokenVersion.mockImplementation((id: number) => (id === 1 ? 1 : 2));

      manager.broadcast('test', {});

      expect(s1.send).toHaveBeenCalled();
      expect(s2.send).not.toHaveBeenCalled();
      expect(s2.close).toHaveBeenCalledWith(4004, 'Session invalidated');
      expect(manager.clientCount).toBe(1);
    });

    it('skips and closes clients on default password', () => {
      const { socket: s1 } = addTestClient(manager, 1, 1);

      mockIsDefaultPassword.mockReturnValue(true);

      manager.broadcast('test', {});

      expect(s1.send).not.toHaveBeenCalled();
      expect(s1.close).toHaveBeenCalledWith(4004, 'Session invalidated');
      expect(manager.clientCount).toBe(0);
    });

    it('does nothing when no clients exist', () => {
      // Should not throw
      manager.broadcast('test', {});
      expect(manager.clientCount).toBe(0);
    });
  });

  describe('clientCount', () => {
    it('reflects the number of active clients', () => {
      expect(manager.clientCount).toBe(0);
      addTestClient(manager, 1, 1);
      expect(manager.clientCount).toBe(1);
      addTestClient(manager, 2, 1);
      expect(manager.clientCount).toBe(2);
    });
  });

  describe('close', () => {
    it('closes all clients with 1001 code', () => {
      const { socket: s1 } = addTestClient(manager, 1, 1);
      const { socket: s2 } = addTestClient(manager, 2, 1);

      manager.close();

      expect(s1.close).toHaveBeenCalledWith(1001, 'Server shutting down');
      expect(s2.close).toHaveBeenCalledWith(1001, 'Server shutting down');
      expect(manager.clientCount).toBe(0);
    });
  });
});

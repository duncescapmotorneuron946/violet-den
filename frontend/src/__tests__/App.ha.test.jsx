import { render, screen, waitFor, act } from '@testing-library/react';
import App from '../App';

jest.mock('../viteEnv');
jest.mock('../SSHPanel', () => () => <div data-testid="ssh-panel-mock" />);

beforeEach(() => {
  jest.restoreAllMocks();
});

describe('App HA integration', () => {
  it('detects HA mode and falls through to login when not in iframe', async () => {
    global.fetch = jest.fn((url) => {
      if (url === '/api/setup-status') {
        return Promise.resolve({
          json: () => Promise.resolve({ setup_complete: true, ha_mode: true }),
        });
      }
      // validate-token called by AuthWrapper
      if (url === '/api/validate-token') {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ valid: false }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    render(<App />);

    // When not in iframe (window.parent === window), should fall through to login
    await waitFor(() => {
      expect(screen.getByText('Sign In')).toBeInTheDocument();
    });
  });

  it('sends violetden-ready postMessage when in iframe', async () => {
    const postMessageMock = jest.fn();
    const originalParent = window.parent;

    // Simulate being in an iframe (parent !== self)
    Object.defineProperty(window, 'parent', {
      value: { postMessage: postMessageMock },
      writable: true,
      configurable: true,
    });

    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ setup_complete: false, ha_mode: true }),
      })
    );

    render(<App />);

    await waitFor(() => {
      expect(postMessageMock).toHaveBeenCalledWith(
        { type: 'violetden-ready' },
        '*'
      );
    });

    Object.defineProperty(window, 'parent', {
      value: originalParent,
      writable: true,
      configurable: true,
    });
  });

  it('auto-authenticates on ha-auth postMessage', async () => {
    // Setup: HA mode enabled, setup not complete
    let fetchCallCount = 0;
    global.fetch = jest.fn((url) => {
      fetchCallCount++;
      if (url === '/api/setup-status') {
        return Promise.resolve({
          json: () => Promise.resolve({ setup_complete: false, ha_mode: true }),
        });
      }
      if (url === '/api/ha-auth') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, token: 'vd-token-123' }),
        });
      }
      // /api/sections
      if (url === '/api/sections') {
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve([]),
        });
      }
      return Promise.resolve({
        status: 200,
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    render(<App />);

    // Wait for setup-status to complete
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/setup-status');
    });

    // Simulate HA panel sending auth message
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'ha-auth', token: 'ha-access-token-123' },
          origin: 'http://localhost',
        })
      );
    });

    // Should have called ha-auth endpoint
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/ha-auth', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ha_token: 'ha-access-token-123' }),
      }));
    });
  });

  it('ignores non-ha-auth postMessages', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ setup_complete: false, ha_mode: true }),
      })
    );

    render(<App />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/setup-status');
    });

    // Send unrelated message — should not trigger any auth call
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'unrelated-event', payload: 'test' },
        })
      );
    });

    // Only setup-status should have been called
    const haAuthCalls = global.fetch.mock.calls.filter(
      ([url]) => url === '/api/ha-auth'
    );
    expect(haAuthCalls).toHaveLength(0);
  });
});

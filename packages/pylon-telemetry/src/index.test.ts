import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendVersionEvent, sendDevEvent, sendBuildEvent, sendCreateEvent, sendFunctionEvent } from './index';

// Mock fetch
global.fetch = vi.fn();

// Mock console.log for checking debug output
console.log = vi.fn();

// Mock environment and other dependencies
const mockEnv: Record<string, string | undefined> = {};
vi.mock('@getcronit/pylon', async () => {
  return {
    getEnv: async () => mockEnv
  };
});

// Mock hono/adapter
vi.mock('hono/adapter', () => {
  return {
    getRuntimeKey: () => 'node'
  };
});

describe('Pylon Telemetry', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Reset environment
    Object.keys(mockEnv).forEach(key => {
      delete mockEnv[key];
    });

    // Mock successful fetch response
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { event: { id: 'test-id' } } })
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('PYLON_TELEMETRY_DISABLED', () => {
    const caseDisabled = [
      '1', // just 1
      'true', 'TRUE', 'True', // True variations
      'yes', 'YES', 'Yes', // Yes variations
    ];

    caseDisabled.forEach((value) => {
      it(`should not send telemetry when PYLON_TELEMETRY_DISABLED is set to truthy value (case: ${value})`, async () => {
        mockEnv.PYLON_TELEMETRY_DISABLED = value;
        await sendVersionEvent();
        expect(global.fetch).not.toHaveBeenCalled();
      })
    })

    const caseEnabled = [
      0,
      'false', 'FALSE', 'False', // False variations
      'no', 'NO', 'No', // No variations
      '', // empty string
      'Some random string',
    ];

    caseEnabled.forEach((value) => {
      it(`should send telemetry when PYLON_TELEMETRY_DISABLED is set to non-truthy value (case: ${value})`, async () => {
        mockEnv.PYLON_TELEMETRY_DISABLED = value;
        await sendVersionEvent();
        expect(global.fetch).toHaveBeenCalledTimes(1);
      })
    })

    it('should send telemetry when PYLON_TELEMETRY_DISABLED is not set', async () => {
      // Call the function
      await sendVersionEvent();

      // Verify fetch was called
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://pylon-telemetry.cronit.io/graphql',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );
    });
  });

  describe('PYLON_TELEMETRY_DEBUG', () => {
    const caseEnabled = [
      '1', // just 1
      'true', 'TRUE', 'True', // True variations
      'yes', 'YES', 'Yes', // Yes variations
    ];

    caseEnabled.forEach((value) => {
      it(`should log debug information when PYLON_TELEMETRY_DEBUG is set to truthy value (case: ${value})`, async () => {
        mockEnv.PYLON_TELEMETRY_DEBUG = value
        await sendVersionEvent();

        // Verify console.log was called with debug info
        expect(console.log).toHaveBeenCalledWith(
          '[Pylon Telemetry]',
          expect.objectContaining({
            type: 'PYLON_VERSION'
          })
        );
      })
    })

    const caseDisabled = [
      '0',
      'false', 'FALSE', 'False', // False variations
      'no', 'NO', 'No', // No variations
      '', // empty string
      'Some random string',
    ];

    caseDisabled.forEach((value) => {
      it(`should not log debug information when PYLON_TELEMETRY_DEBUG is set to non-truthy value (case: ${value})`, async () => {
        mockEnv.PYLON_TELEMETRY_DEBUG = value;
        await sendVersionEvent();

        // Verify console.log was not called
        expect(console.log).not.toHaveBeenCalled();
      })
    })

    it('should not log debug information when PYLON_TELEMETRY_DEBUG is not set', async () => {
      await sendVersionEvent();

      // Verify console.log was not called
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe('sendVersionEvent', () => {
    it('should send pylon version', async () => {
      await sendVersionEvent();

      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.variables.payload.type).toBe('PYLON_VERSION');
    });
  })

  describe('sendDevEvent', () => {
    it('should send dev event', async () => {
      await sendDevEvent({ duration: 100, clientPath: '/test', clientPort: 3000 });

      // Verify the event type in the payload
      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.variables.payload.type).toBe('PYLON_DEV');
      expect(body.variables.payload.duration).toBe(100);
      expect(body.variables.payload.clientPath).toBe('/test');
      expect(body.variables.payload.clientPort).toBe(3000);
    });
  })

  describe('sendBuildEvent', () => {
    it('should send build event', async () => {
      await sendBuildEvent({
        duration: 200,
        totalFiles: 10,
        totalSize: 1024,
        isDevelopment: false
      });

      // Verify the event type in the payload
      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.variables.payload.type).toBe('PYLON_BUILD');
      expect(body.variables.payload.duration).toBe(200);
      expect(body.variables.payload.totalFiles).toBe(10);
      expect(body.variables.payload.totalSize).toBe(1024);
      expect(body.variables.payload.isDevelopment).toBe(false);
    });
  })

  describe('sendCreateEvent', () => {
    it('should send create event', async () => {
      await sendCreateEvent({
        pylonCreateVersion: '1.0.0',
        name: 'test-project',
        runtime: 'node',
        template: 'default'
      });

      // Verify the event type in the payload
      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.variables.payload.type).toBe('PYLON_CREATE');
      expect(body.variables.payload.pylonCreateVersion).toBe('1.0.0');
      expect(body.variables.payload.name).toBe('test-project');
      expect(body.variables.payload.runtime).toBe('node');
      expect(body.variables.payload.template).toBe('default');
    });
  })

  describe('sendFunctionEvent', () => {
    it('should send function event', async () => {
      await sendFunctionEvent({
        name: 'test-function',
        duration: 50
      });

      // Verify the event type in the payload
      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.variables.payload.type).toBe('PYLON_FUNCTION');
      expect(body.variables.payload.name).toBe('test-function');
      expect(body.variables.payload.duration).toBe(50);
    });
  });

  describe('Error Handling', () => {
    it('should not throw error when fetch fails', async () => {
      // Make fetch throw an error
      (global.fetch as any).mockRejectedValue(new Error('Network Error'));

      // This should not throw an error
      await expect(sendVersionEvent()).resolves.not.toThrow();
    });
  });
});

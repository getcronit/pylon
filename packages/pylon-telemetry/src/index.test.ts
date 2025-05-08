import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendVersionEvent, sendDevEvent, sendBuildEvent, sendCreateEvent, sendFunctionEvent } from './index';

// Mock fetch
global.fetch = vi.fn();

// Mock console.log for checking debug output
console.log = vi.fn();

// Mock environment and other dependencies
const mockEnv = {};
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

  describe('Telemetry Disabled Flag', () => {
    it('should not send telemetry when PYLON_TELEMETRY_DISABLED is set to 1', async () => {
      // Set environment variable
      mockEnv.PYLON_TELEMETRY_DISABLED = '1';
      
      // Call the function
      await sendVersionEvent();
      
      // Verify fetch was not called
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should not send telemetry when PYLON_TELEMETRY_DISABLED is set to any truthy value', async () => {
      // Set environment variable to a truthy value
      mockEnv.PYLON_TELEMETRY_DISABLED = 'true';
      
      // Call the function
      await sendVersionEvent();
      
      // Verify fetch was not called
      expect(global.fetch).not.toHaveBeenCalled();
    });

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

  describe('Debug Mode', () => {
    it('should log debug information when PYLON_TELEMETRY_DEBUG is set', async () => {
      // Set debug flag
      mockEnv.PYLON_TELEMETRY_DEBUG = '1';
      
      // Call the function
      await sendVersionEvent();
      
      // Verify console.log was called with debug info
      expect(console.log).toHaveBeenCalledWith(
        '[Pylon Telemetry]',
        expect.objectContaining({
          type: 'PYLON_VERSION'
        })
      );
    });

    it('should not log debug information when PYLON_TELEMETRY_DEBUG is not set', async () => {
      // Call the function
      await sendVersionEvent();
      
      // Verify console.log was not called
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe('Different Event Types', () => {
    it('should send version event with correct payload', async () => {
      await sendVersionEvent();
      
      // Verify the event type in the payload
      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.variables.payload.type).toBe('PYLON_VERSION');
    });

    it('should send dev event with correct payload', async () => {
      await sendDevEvent({ duration: 100, clientPath: '/test', clientPort: 3000 });
      
      // Verify the event type in the payload
      const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
      expect(body.variables.payload.type).toBe('PYLON_DEV');
      expect(body.variables.payload.duration).toBe(100);
      expect(body.variables.payload.clientPath).toBe('/test');
      expect(body.variables.payload.clientPort).toBe(3000);
    });

    it('should send build event with correct payload', async () => {
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

    it('should send create event with correct payload', async () => {
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

    it('should send function event with correct payload', async () => {
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

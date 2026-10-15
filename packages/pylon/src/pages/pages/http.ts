class PylonErrorResponse {
  public readonly data: any

  constructor(
    public readonly status: number,
    public readonly statusText: string,
    rawPayload: any,
    public readonly internal = true
  ) {
    // Handle data serialization
    const serializedData =
      rawPayload instanceof Error ? rawPayload.toString() : rawPayload

    this.data =
      typeof serializedData === 'object'
        ? JSON.stringify(serializedData)
        : serializedData

    // Environment-specific behavior:
    // If on server (no window), throw a standard Response object immediately
    if (typeof window === 'undefined') {
      throw new Response(this.data, {
        status: this.status,
        statusText: this.statusText,
        headers: {
          'Content-Type': 'application/json'
        }
      })
    }
  }
}

export function notFound(
  message = 'Not Found message',
  args?: {
    statusText?: string
    returnText?: string
    returnUrl?: string
  }
): never {
  // Trigger the class logic
  throw new PylonErrorResponse(404, args?.statusText || 'Not Found', {
    message,
    returnText: args?.returnText,
    returnUrl: args?.returnUrl
  })
}

export function forbidden(
  message = 'Forbidden',
  args?: {
    statusText?: string
    returnText?: string
    returnUrl?: string
  }
): never {
  throw new PylonErrorResponse(403, args?.statusText || 'Forbidden', {
    message,
    returnText: args?.returnText,
    returnUrl: args?.returnUrl
  })
}

export function unauthorized(
  message = 'Unauthorized',
  args?: {
    statusText?: string
    returnText?: string
    returnUrl?: string
  }
): never {
  throw new PylonErrorResponse(401, args?.statusText || 'Unauthorized', {
    message,
    returnText: args?.returnText,
    returnUrl: args?.returnUrl
  })
}

export function redirect(
  url: string,
  args?: {
    statusText?: string
    status?: number
    headers?: HeadersInit
  }
): never {
  if (typeof window !== 'undefined' && (window as any).__PYLON_NAVIGATE__) {
    setTimeout(() => {
      ;(window as any).__PYLON_NAVIGATE__(url, {
        replace: true
      })
    }, 0)

    // Throw a promise that never resolves to suspend the component
    // and wait for the navigation to unmount it.
    throw new Promise(() => {})
  }

  const response = new Response(null, {
    status: args?.status || 302,
    headers: {
      Location: url,
      ...args?.headers
    }
  })

  throw response
}

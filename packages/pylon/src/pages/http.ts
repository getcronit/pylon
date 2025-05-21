export function notFound(
  message = 'Not Found',
  args?: {
    statusText?: string
    returnText?: string
    returnUrl?: string
  }
): never {
  const data = {
    message,
    returnText: args?.returnText,
    returnUrl: args?.returnUrl
  }

  throw new Response(JSON.stringify(data), {
    status: 404,
    statusText: args?.statusText || "This page doesn't exist"
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
  const data = {
    message,
    returnText: args?.returnText,
    returnUrl: args?.returnUrl
  }

  throw new Response(JSON.stringify(data), {
    status: 403,
    statusText: args?.statusText || 'Forbidden'
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
  const data = {
    message,
    returnText: args?.returnText,
    returnUrl: args?.returnUrl
  }

  throw new Response(JSON.stringify(data), {
    status: 401,
    statusText: args?.statusText || 'Unauthorized'
  })
}

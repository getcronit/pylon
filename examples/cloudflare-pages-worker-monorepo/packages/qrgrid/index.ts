import {generateQr} from '@qrgrid/server'

export function generateQRCode(data: string): string {
  const qr = generateQr(data)

  return qr
}

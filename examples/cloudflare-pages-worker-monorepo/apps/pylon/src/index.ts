import {app, ServiceError} from '@getcronit/pylon'
import {generateQRCode} from '@repo/qrgrid'

const qrCodeStorage: string[] = []

export const graphql = {
  Query: {
    qrCodes: () => {
      return qrCodeStorage
    }
  },
  Mutation: {
    generateRandomQRCode: async () => {
      const randomURL = await fetch(
        `https://decapi.me/youtube/latest_video?skip=${Math.floor(
          Math.random() * 50
        )}&user=apple`
      )
        .then(res => res.text())
        .then(text => {
          // Split by space and get the last element
          const split = text.split(' ')
          return split[split.length - 1]
        })

      // Generate the QR code
      const qrCode = generateQRCode(randomURL)
      qrCodeStorage.push(qrCode)
      return qrCode
    }
  }
}

export default app

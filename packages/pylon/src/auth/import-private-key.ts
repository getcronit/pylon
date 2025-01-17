import * as crypto from 'crypto'

/*
Convert a string into an ArrayBuffer
from https://developers.google.com/web/updates/2012/06/How-to-convert-ArrayBuffer-to-and-from-String
*/
function str2ab(str) {
  const buf = new ArrayBuffer(str.length)
  const bufView = new Uint8Array(buf)
  for (let i = 0, strLen = str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i)
  }
  return buf
}

const convertPKCS1ToPKCS8 = pkcs1 => {
  // with cryto module

  const key = crypto.createPrivateKey(pkcs1)

  return key.export({
    type: 'pkcs8',
    format: 'pem'
  })
}

/*
Import a PEM encoded RSA private key, to use for RSA-PSS signing.
Takes a string containing the PEM encoded key, and returns a Promise
that will resolve to a CryptoKey representing the private key.
*/
function importPKCS8PrivateKey(pem) {
  // fetch the part of the PEM string between header and footer
  const pemHeader = '-----BEGIN PRIVATE KEY-----'
  const pemFooter = '-----END PRIVATE KEY-----'
  const pemContents = pem.substring(
    pemHeader.length,
    pem.length - pemFooter.length - 1
  )
  // base64 decode the string to get the binary data
  const binaryDerString = atob(pemContents)
  // convert from a binary string to an ArrayBuffer
  const binaryDer = str2ab(binaryDerString)

  return crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    true,
    ['sign']
  )
}

export const importPrivateKey = async (pkcs1Pem: string) => {
  const pkcs8Pem = convertPKCS1ToPKCS8(pkcs1Pem)

  return await importPKCS8PrivateKey(pkcs8Pem)
}

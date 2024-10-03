import pylonLogo from '/pylon.svg'
import './App.css'

import {resolve, useQuery} from '../gqty'

function App() {
  const data = useQuery()

  const createNewQRCode = async () => {
    // Get some random URL of google.com

    await resolve(({mutation}) => {
      return mutation.generateRandomQRCode
    })

    data.$refetch()
  }

  return (
    <>
      <div>
        <a href="https://pylon.cronit.io" target="_blank">
          <img src={pylonLogo} className="logo" alt="Pylon logo" />
        </a>
      </div>
      <h1>Vite + Pylon on Cloudflare</h1>
      <div className="card">
        {data.qrCodes.map((qrCode, key) => (
          <div key={key} dangerouslySetInnerHTML={{__html: qrCode}} />
        ))}
      </div>

      <button onClick={createNewQRCode}>Generate QR Code</button>
      <p className="read-the-docs">Click on the Pylon logo to read the docs</p>
    </>
  )
}

export default App

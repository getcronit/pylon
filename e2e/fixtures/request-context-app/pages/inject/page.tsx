import {useResponseCookies} from '@getcronit/pylon/pages'

// Hostile value: CRLF to attempt a header break, `;` to attempt attribute injection.
const Inject: React.FC = () => {
  useResponseCookies().set('probe', 'x\r\nSet-Cookie: injected=admin\r\nX-Evil: 1; HttpOnly')
  return <p>inject</p>
}
export default Inject

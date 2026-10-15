import {useResponseCookies} from '@getcronit/pylon/pages'

// An invalid cookie name must fail INSIDE the render (where the boundary handles it and the
// stack names this component), not later from the flush with an opaque Headers TypeError.
const BadName: React.FC = () => {
  useResponseCookies().set('bad\r\nX-Injected: 1', 'v')
  return <p>unreachable</p>
}
export default BadName

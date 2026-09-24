import { useData } from '@getcronit/pylon/pages'
import { Row } from './Row'

export default function Page() {
  const data = useData()
  const greeting = data.me.email
  const row = Row(data.user({ id: '1' }))
  return greeting + row
}

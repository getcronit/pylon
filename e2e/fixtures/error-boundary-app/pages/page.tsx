import {useData} from '@getcronit/pylon/pages'

export default function Page() {
  const data = useData()
  return <main id="home">home:{data.ok}</main>
}

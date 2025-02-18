import { Button } from '@/components/ui/button'
import { PageProps } from '@getcronit/pylon/pages'

const Page: React.FC<PageProps> = ({ data }) => {
  return (
    <div>
      <title>{data.hello}</title>
      <Button>{data.hello}</Button>
    </div>
  )
}

export default Page

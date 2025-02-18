import { Button } from '@/components/ui/button'
import { PageProps } from '@getcronit/pylon/pages'

const Page: React.FC<PageProps> = props => {
  return (
    <div className="bg-red-500">
      <title>{props.data.hello}</title>
      <Button>Test562: {props.data.hello}</Button>
    </div>
  )
}

export default Page

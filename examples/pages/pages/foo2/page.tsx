import {Button} from '@/components/ui/button'
import {PageProps} from '@getcronit/pylon'

const Page: React.FC<PageProps> = props => {
  return (
    <div className="bg-bluee-500">
      <title>{props.data.hello}</title>
      <Button>{props.data.someOtherHello}</Button>
    </div>
  )
}

export default Page

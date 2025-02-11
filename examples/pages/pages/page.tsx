import {Button} from '@/components/ui/button'
import {PageProps} from '@getcronit/pylon'

const Page: React.FC<PageProps> = props => {
  return (
    <div className="bg-amber-500">
      <title>{props.data.hello}</title>
      <Button>Nico {props.data.someOtherHello3}</Button>
    </div>
  )
}

export default Page

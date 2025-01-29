import Counter from "@/components/Counter"
import { PageProps } from "@getcronit/pylon"
import React, { useId } from "react"

const Page: React.FC<PageProps> = (props) => {

  console.log('props', props)

  const id = useId()

  return (
    <div>
      <h1 className="text-6xl">{props.data.users({take: 1})[0].name}</h1>
      <p>Id: {id}</p>

      <Counter />
    </div>
  )
}

export default Page


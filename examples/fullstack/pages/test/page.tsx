import Counter from "@/components/Counter"
import { PageProps } from "@getcronit/pylon"
import img from "./test.png"
import React, { useId } from "react"
import { Image } from "@/components/image"



const Page: React.FC<PageProps> = (props) => {

  console.log('props', props)

  const id = useId()

  return (
    <div>
      <h1 className="text-6xl">{props.data.users({take: 1})[0].name}</h1>
      <p>Id: {id}</p>

      <Image src={img} alt="test" height={100} />

      <Counter />
    </div>
  )
}

export default Page


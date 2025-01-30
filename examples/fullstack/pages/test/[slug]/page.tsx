"use client"

import Counter from "@/components/Counter"
import { PageProps } from "@getcronit/pylon"
import React, { useId } from "react"

const Page: React.FC<PageProps> = (props) => {

  console.log('props', props)

  const id = useId()

  return (
    <div>
      <p>Id: {id}</p>
    </div>
  )
}

export default Page


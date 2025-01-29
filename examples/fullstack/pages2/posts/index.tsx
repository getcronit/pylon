import Counter from "@/components/Counter"
import { PageProps } from "@getcronit/pylon"
import React, { useId } from "react"

const Page: React.FC<PageProps> = ({
  data
}) => {

  const id = useId()

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-100 to-gray-200 flex flex-col items-center justify-center p-4">
      <p>{id}</p>
      <h1 className="text-4xl font-bold mb-8 text-gray-800">
        {data.users({take: 1})[0].name}'s Profile
      </h1>
      <Counter />
    </div>
  )
}

export default Page


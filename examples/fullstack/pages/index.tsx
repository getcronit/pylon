import { Button } from '@/components/ui/button'
import { PageProps } from '@getcronit/pylon'
import React, { use, useRef } from 'react'


const Page: React.FC<PageProps> = ({ data }) => {
  const ref = useRef<HTMLDivElement>(null)

  const handleRefetch = () => {
    data.$refetch()
  }

  const [showContent, setShowContent] = React.useState(false)

  const handleClick = () => {
    setShowContent(true)
  }

  console.log('loading', data.$state)

  const [take, setTake] = React.useState(1)

  const nextPage = () => {
    setTake((prev) => prev + 1)
  }

  console.log("data", data.posts[0].title)


  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">User and Post Data</h1>
      <Button onClick={nextPage}>Next</Button>
      <Button onClick={handleRefetch}>Refetch</Button>
      {data.users({take}).map((user, idx) => (
        <div key={idx} className="mb-8 p-4 border rounded-lg shadow-md">
          <h2 className="text-2xl font-semibold mb-2">{user.name}</h2>
          <p className="text-gray-600 mb-4">{user.email}</p>
          <h3 className="text-xl font-semibold mb-2">Posts:</h3>
          {user.posts.map((post, idx) => (
            <div key={idx} className="mb-4 p-3 bg-gray-100 rounded">
              <h4 className="text-lg font-semibold">{post.title}</h4>
              <p className="text-gray-700 mb-2">{post.content}</p>
              <div className="flex gap-2">
                {post.tags.map((tag, index) => (
                  <span key={index} className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export default Page

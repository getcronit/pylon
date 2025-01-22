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


  return (
    <div>
      Index Page


      {data.$state.isLoading && <div>Loading...</div>}

      <Button onClick={handleClick}>
        Show Content
      </Button>
      {data.posts.map((post, id) => (
        <div key={id} className='bg-slate-600'>
          {post.title} {showContent && data.lazy}
        </div>
      ))}
    </div>
  )
}

export default Page

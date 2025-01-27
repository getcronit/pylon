
interface Author {
  id: number
  name: string
  email: string
}

interface Post {
  id: number
  title: string
  content: string
  author: Author
  tags: string[]
}

export default function PostCard({ post }: { post: Post }) {
  return (
    <div className="bg-white shadow-md rounded-lg p-6 mb-4">
      <h2 className="text-2xl font-semibold mb-2">{post.title}</h2>
      <p className="text-gray-600 mb-4">{post.content}</p>
      <div className="flex justify-between items-center">
        <a href={`/users/${post.author.id}`} className="text-blue-500 hover:underline">
          {post.author.name}
        </a>
        <div className="space-x-2">
          {post.tags.map((tag, key) => (
            <span key={key} className="bg-gray-200 text-gray-700 px-2 py-1 rounded text-sm">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}


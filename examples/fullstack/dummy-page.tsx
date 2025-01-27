import type React from "react"

class Post {
  constructor(
    public id: number,
    public title: string,
    public content: string,
    public author: User,
    public tags: string[],
  ) {}
}

class User {
  constructor(
    public id: number,
    public name: string,
    public email: string,
    public posts: Post[],
  ) {}
}

// Create dummy data
const createDummyData = () => {
  const user1 = new User(1, "Alice Johnson", "alice@example.com", [])
  const user2 = new User(2, "Bob Smith", "bob@example.com", [])

  const post1 = new Post(1, "First Post", "This is the content of the first post.", user1, ["tech", "news"])
  const post2 = new Post(2, "Second Post", "This is the content of the second post.", user1, ["lifestyle"])
  const post3 = new Post(3, "Third Post", "This is the content of the third post.", user2, ["tech", "tutorial"])

  user1.posts = [post1, post2]
  user2.posts = [post3]

  return [user1, user2]
}

const DummyPage: React.FC = () => {
  const users = createDummyData()

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold mb-6">User and Post Data</h1>
      {users.map((user) => (
        <div key={user.id} className="mb-8 p-4 border rounded-lg shadow-md">
          <h2 className="text-2xl font-semibold mb-2">{user.name}</h2>
          <p className="text-gray-600 mb-4">{user.email}</p>
          <h3 className="text-xl font-semibold mb-2">Posts:</h3>
          {user.posts.map((post) => (
            <div key={post.id} className="mb-4 p-3 bg-gray-100 rounded">
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

export default DummyPage


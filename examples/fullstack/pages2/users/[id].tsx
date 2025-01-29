import PostCard from "@/components/PostCard";
import { PageProps } from "@getcronit/pylon";

const Page: React.FC<PageProps> = ({data, params, searchParams}) => {

    console.log('data', data, 'params', params, "searchParams", searchParams)

    const user = data.users.find((user) => {
        console.log("user match", user.id, params.id, user.id === Number(params.id))

        return user.id === Number(params.id)
    }) || data.users[0]

    console.log("user", user)


    return  <div>
    <h2 className="text-3xl font-semibold mb-6">{user?.name}'s Profile</h2>
    <div className="mb-8">
      <p className="text-lg">Email: {user?.email}</p>
    </div>
    <h3 className="text-2xl font-semibold mb-4">Posts by {user?.name}</h3>
    {user?.posts.map((post, key) => (
      <PostCard key={key} post={post} />
    ))}
  </div>
}

export default Page
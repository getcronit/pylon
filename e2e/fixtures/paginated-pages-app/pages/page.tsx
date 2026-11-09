import {usePaginatedData} from '@getcronit/pylon/pages'

export default function Page() {
  const posts = usePaginatedData(q => q.posts)
  return (
    <div>
      <ul id="list">
        {posts.nodes.map(n => (
          <li key={n.id}>{n.title}</li>
        ))}
      </ul>
      <span id="count">{posts.nodes.length}</span>
      <span id="total">{posts.totalCount}</span>
      <span id="hasNext">{String(posts.pageInfo.hasNextPage)}</span>
      <button id="more" onClick={() => posts.loadNext()}>
        more
      </button>
    </div>
  )
}

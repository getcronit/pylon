import {usePaginatedData} from '@getcronit/pylon-pages'

export default function Page() {
  const data = usePaginatedData()
  return (
    <div>
      <ul id="list">
        {data.posts.nodes.map(n => (
          <li key={n.id}>{n.title}</li>
        ))}
      </ul>
      <span id="count">{data.posts.nodes.length}</span>
      <span id="total">{data.posts.totalCount}</span>
      <span id="hasNext">{String(data.posts.pageInfo.hasNextPage)}</span>
      <button id="more" onClick={() => data.posts.loadNext()}>
        more
      </button>
    </div>
  )
}

import {usePaginatedData} from '@getcronit/pylon-pages'

export default function Thread() {
  // nested connection rooted at a specific post, with a base arg
  const comments = usePaginatedData(q => q.post({id: '1'}).comments, {
    role: 'all',
    first: 3
  })
  return (
    <div>
      <ul id="list">
        {comments.nodes.map(c => (
          <li key={c.id}>{c.body}</li>
        ))}
      </ul>
      <span id="count">{comments.nodes.length}</span>
      <span id="total">{comments.totalCount}</span>
      <span id="hasNext">{String(comments.pageInfo.hasNextPage)}</span>
    </div>
  )
}

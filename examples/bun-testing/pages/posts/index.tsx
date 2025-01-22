import { useState, } from 'react'

const Counter = () => {
  const [count, setCount] = useState(0)

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>Increment</button>
      <button onClick={() => setCount(count - 1)}>Decrement</button>
    </div>
  )
}

const Page = () => {
  return (
    <div>
      <h1>Posts</h1>
      <Counter />
    </div>
  )
}

export default Page


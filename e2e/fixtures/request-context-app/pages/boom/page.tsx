// Forces the SSR error path, which renders the tree TWICE (once to discover the throw, once
// with the populated error context). The layout above therefore queues its cookie twice —
// the collector must still emit exactly one Set-Cookie.
const Boom: React.FC = () => {
  throw new Error('intentional boom')
}
export default Boom

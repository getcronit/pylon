import {describe, expect, it} from 'vitest'
import {extractAdvancedSelectors} from '@/pages/plugins/use-pages/build/plugins/use-data-static-analyzer/analyze'

describe('Bracket Access Analysis', () => {
  it('should treat string bracket access as property access, not list', () => {
    const input = `
      const data = {user: {email: 'email'}}
      const user = data.user;
      const email = user["email"];
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      user: {
        email: true
      }
    })
  })

  it('should treat number bracket access as list access', () => {
    const input = `
      const data = {users: [{name: 'name'}]}
      const users = data.users;
      const first = users[0];
      console.log(first.name);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      users: {
        __isList: true,
        name: true
      }
    })
  })

  it('should work when i pass a node into a constructed array', () => {
    const input = `
    const data = {
      edges: {
        nodes: [{
          name: "name",
          createdAt: "createdAt",
          updatedAt: "updatedAt"
        }]
      }
    }


    function printNodes(nodes: Node[]) {
      console.log(nodes.length, nodes[0].name)
      for (const node of nodes) {
        console.log( node.createdAt, node.updatedAt);
      }
    }

    printNodes([data.edges.nodes[0]])
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      edges: {
        nodes: {
          __isList: true,
          name: true,
          createdAt: true,
          updatedAt: true
        }
      }
    })
  })

  it('should not mark an object as a list when it is wrapped in an array literal', () => {
    const input = `
      const data = {
        products: {
          edges: {
            node: {
              title: "title",
              status: "status",
              id: "id"
            }
          }
        }
      }

      function handleBulkDelete(products: Product[]) {
        console.log(products.length);
        for (const p of products) {
          console.log(p.id);
        }
        console.log(products[0].title);
      }

      const product = data.products.edges.node;
      console.log(product.status);
      handleBulkDelete([product]);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      products: {
        edges: {
          node: {
            // __isList should NOT be here!
            status: true,
            title: true,
            id: true
          }
        }
      }
    })
  })
})

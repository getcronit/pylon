import { Card, CardContent } from "@/components/ui/card"
import { PageData } from "@getcronit/pylon"


export default function ProductCards(props: { products: PageData["products"] }) {
  return (
    <section className="py-20 bg-gray-50">
      <div className="container mx-auto px-4">
        <h2 className="text-4xl font-bold text-center mb-12">Unsere Bestseller</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 mb-12">
          {props.products.map((product) => (
            <a href={`/product/${product.id}`} key={product.id}>
              <Card className="h-full transition-all duration-300 hover:shadow-lg hover:-translate-y-1 cursor-pointer">
                <div className="relative h-48 sm:h-56 md:h-64">
                  <img
                    src={product.image || "/placeholder.svg"}
                    alt={product.name}
                    layout="fill"
                    objectFit="cover"
                    className="rounded-t-lg  object-cover"
                  />
                </div>
                <CardContent className="p-4">
                  <h3 className="text-lg font-semibold mb-2 line-clamp-2">{product.name}</h3>
                  <p className="text-sm text-gray-600 mb-4 line-clamp-2">{product.description}</p>
                  <p className="text-xl font-bold text-red-600">{product.price?.toFixed(2)} €</p>
                </CardContent>
              </Card>
            </a>
          ))}
        </div>
        <div className="text-center">
          <a href="/products" className="inline-block bg-red-600 hover:bg-red-700 text-white px-8 py-4 text-lg font-semibold rounded-full transition-all duration-300 hover:shadow-lg">
            Alle Produkte ansehen
          </a>
        </div>
      </div>
    </section>
  )
}


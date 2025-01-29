
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowRight } from 'lucide-react'

const articles = [
  {
    id: 1,
    title: "Die richtige Pflege von Latexballons",
    excerpt: "Erfahren Sie, wie Sie Ihre Latexballons länger haltbar machen und optimal präsentieren können.",
    category: "Pflege & Wartung",
    readTime: "5 min",
    image: "/placeholder.svg?height=200&width=300"
  },
  {
    id: 2,
    title: "Helium vs. Luft: Was ist besser?",
    excerpt: "Ein ausführlicher Vergleich zwischen Helium- und Luftbefüllung für verschiedene Anlässe.",
    category: "Grundlagen",
    readTime: "4 min",
    image: "/placeholder.svg?height=200&width=300"
  },
  {
    id: 3,
    title: "Nachhaltige Ballondekoration",
    excerpt: "Tipps für umweltfreundliche Dekorationen und biologisch abbaubare Alternativen.",
    category: "Nachhaltigkeit",
    readTime: "6 min",
    image: "/placeholder.svg?height=200&width=300"
  }
]

export default function KnowledgeSection() {
  return (
    <section className="py-20 bg-white">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-12">
          <div>
            <h2 className="text-4xl font-bold mb-4">Wissen & Tipps</h2>
            <p className="text-lg text-gray-600 max-w-2xl">
              Entdecken Sie hilfreiche Artikel und Expertentipps rund um Ballons und Dekorationen
            </p>
          </div>
          <Button 
            variant="outline" 
            className="mt-4 md:mt-0"
            asChild
          >
            <a href="/wissen" className="flex items-center gap-2">
              Alle Artikel
              <ArrowRight className="w-4 h-4" />
            </a>
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {articles.map((article) => (
            <a key={article.id} href={`/wissen/${article.id}`}>
              <Card className="h-full transition-all duration-300 hover:shadow-lg hover:-translate-y-1">
                <CardHeader className="p-0">
                  <div className="relative h-48">
                    <img
                      src={article.image || "/placeholder.svg"}
                      alt={article.title}
                      layout="fill"
                      objectFit="cover"
                      className="rounded-t-lg  object-cover"
                    />
                    <div className="absolute top-4 left-4 bg-white px-3 py-1 rounded-full text-sm font-medium">
                      {article.category}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="text-sm text-gray-500 mb-2">{article.readTime} Lesezeit</div>
                  <CardTitle className="text-xl mb-3">{article.title}</CardTitle>
                  <p className="text-gray-600 line-clamp-2">{article.excerpt}</p>
                </CardContent>
              </Card>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}


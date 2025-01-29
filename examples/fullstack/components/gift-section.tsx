import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowRight } from 'lucide-react'

export default function GiftSection() {
  const cards = [
    {
      title: "Alle Dimensionen",
      description: "Denke groß und hinterlasse Eindruck.",
      image: "/placeholder.svg?height=400&width=300"
    },
    {
      title: "Liebe zum Detail",
      description: "Auf die Kleinigkeiten kommt es an.",
      image: "/placeholder.svg?height=400&width=300"
    },
    {
      title: "Lösungen nach Maß",
      description: "Besondere Anforderungen brauchen bemerkenswerte Ideen.",
      image: "/placeholder.svg?height=400&width=300"
    },
  ]

  return (
  <section className="py-20 bg-white">
    <div className="container mx-auto px-4">
      <div className="max-w-3xl mx-auto text-center mb-12">
        <h2 className="text-4xl md:text-5xl font-bold mb-6">
          Gute Dekoration<br />ist kein Zufall
        </h2>
        <p className="text-lg text-gray-700">
          Du möchtest eine Idee herausheben, Aufmerksamkeit erzielen, einen Wunsch erfüllen oder einen gebührenden Auftritt hinlegen…
          Durch eine professionell umgesetzte Ballondekoration mit Kreation und Phantasie verleihen wir deiner Veranstaltung den passenden "Zauber".
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {cards.map((card, index) => (
          <Card key={index} className="overflow-hidden">
            <div className="relative aspect-[3/2]">
              <a
                src={card.image || "/placeholder.svg"}
                alt={card.title}
                layout="fill"
                objectFit="cover"
              />
            </div>
            <CardContent className="p-6">
              <h3 className="text-xl font-semibold mb-2">{card.title}</h3>
              <p className="text-gray-600 mb-4">{card.description}</p>
              <Button variant="link" className="p-0 h-auto font-semibold text-red-600 hover:text-red-700">
                Mehr anzeigen
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  </section>
)
}


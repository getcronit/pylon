import { Button } from "@/components/ui/button"

export default function FeaturesSection() {
  const features = [
    {
      title: "Kreative Lösungen",
      description: "Wir helfen beim Umsetzen deiner atemberaubenden Ideen für eine unvergessliche Atmosphäre."
    },
    {
      title: "Vielfältiges Sortiment",
      description: "Wir bieten eine breite Auswahl an Ballon-Formen, Farben und Größen und das nötige Zubehör."
    },
    {
      title: "Persönliches",
      description: "Namen, Botschaften oder Logos - wir machen deine Ballons einzigartig."
    },
    {
      title: "Ballongas",
      description: "Wir bieten die bequeme Heliumbefüllung und Lieferung für deine Ballons."
    },
    {
      title: "Nachhaltigkeit",
      description: "Wir unterstützen dich mit 100% biologisch abbaubaren, Natur-Latexballons."
    },
    {
      title: "Ballongeschenke",
      description: "Sie sind perfekt für besondere Anlässe wie Geburtstage, Jubiläen oder Hochzeiten."
    }
  ]

  return (
    <section className="py-20 bg-white">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
          {/* Left Column */}
          <div className="space-y-6">
            <div className="space-y-2">
              <h2 className="text-4xl md:text-5xl lg:text-6xl leading-tight font-bold text-gray-900">
                Riesiges
              </h2>
              <div className="relative h-24">
                <span className="text-4xl md:text-5xl lg:text-6xl leading-tight font-script text-red-500">
                  Angebot
                </span>
              </div>
            </div>
            <p className="text-base md:text-lg text-gray-700 max-w-lg">
              Du kannst aus dem Vollen schöpfen. Hier findest du Produkte für das Alltägliche, 
              aber auch ganz besondere Anlässe. Ballons bereiten uns viel Freude und genau das 
              vermitteln wir weiter.
            </p>
            <Button 
              variant="outline" 
              className="rounded-full px-8 py-6 h-auto text-lg border-2 border-red-500 text-red-500 hover:bg-red-50"
            >
              Mehr erfahren
            </Button>
          </div>

          {/* Right Column */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {features.map((feature, index) => (
              <div key={index} className="flex gap-4">
                <div className="flex-shrink-0">
                  <svg
                    viewBox="0 0 40 40"
                    className="w-10 h-10 fill-[#FFD7D7]"
                    aria-hidden="true"
                  >
                    <path d="M20 4c7.732 0 14 6.268 14 14 0 4.874-2.618 9.139-6.52 11.5-1.605.973-2.98 2.473-3.48 4.5h-8c-.5-2.027-1.875-3.527-3.48-4.5C8.618 27.139 6 22.874 6 18c0-7.732 6.268-14 14-14z" />
                  </svg>
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg md:text-xl font-semibold text-gray-900">
                    {feature.title}
                  </h3>
                  <p className="text-sm md:text-base text-gray-600">
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}


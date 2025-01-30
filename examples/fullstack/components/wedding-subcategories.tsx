import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const subcategories = [
  {
    id: "ceremony",
    title: "Zeremonie",
    content: "Gestalten Sie den perfekten Rahmen für Ihr Ja-Wort mit unseren eleganten Ballondekorationen.",
    imageGrid: [
      "/placeholder.svg?height=300&width=300",
      "/placeholder.svg?height=300&width=300",
      "/placeholder.svg?height=300&width=300",
      "/placeholder.svg?height=300&width=300",
    ],
    fullImage: "/placeholder.svg?height=600&width=1200",
  },
  {
    id: "reception",
    title: "Empfang",
    content: "Verwandeln Sie Ihren Empfangsbereich in ein Ballonparadies, das Ihre Gäste begeistern wird.",
    imageGrid: [
      "/placeholder.svg?height=300&width=300",
      "/placeholder.svg?height=300&width=300",
      "/placeholder.svg?height=300&width=300",
      "/placeholder.svg?height=300&width=300",
    ],
    fullImage: "/placeholder.svg?height=600&width=1200",
  },
  {
    id: "photobooth",
    title: "Fotohintergrund",
    content: "Kreieren Sie unvergessliche Erinnerungen mit unseren maßgeschneiderten Ballon-Fotohintergründen.",
    imageGrid: [
      "/placeholder.svg?height=300&width=300",
      "/placeholder.svg?height=300&width=300",
      "/placeholder.svg?height=300&width=300",
      "/placeholder.svg?height=300&width=300",
    ],
    fullImage: "/placeholder.svg?height=600&width=1200",
  },
]

export default function WeddingSubcategories() {
  return (
    <div className="mt-12">
      <h3 className="text-2xl font-semibold mb-6">Entdecken Sie unsere Hochzeitsdekorationen</h3>
      <Tabs defaultValue={subcategories[0].id} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          {subcategories.map((subcat) => (
            <TabsTrigger key={subcat.id} value={subcat.id}>{subcat.title}</TabsTrigger>
          ))}
        </TabsList>
        {subcategories.map((subcat) => (
          <TabsContent key={subcat.id} value={subcat.id}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
              <div>
                <p className="text-lg text-gray-700 mb-6">{subcat.content}</p>
                <div className="grid grid-cols-2 gap-4">
                  {subcat.imageGrid.map((src, index) => (
                    <div key={index} className="relative aspect-square">
                      <img
                        src={src || "/placeholder.svg"}
                        alt={`${subcat.title} Beispiel ${index + 1}`}
                        layout="fill"
                        objectFit="cover"
                        className="rounded-lg object-cover"
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div className="relative aspect-video">
                <img
                  src={subcat.fullImage || "/placeholder.svg"}
                  alt={`${subcat.title} Vollbild`}
                  layout="fill"
                  objectFit="cover"
                  className="rounded-lg"
                />
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}


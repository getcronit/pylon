
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowRight } from 'lucide-react'
import { Image } from "./image"

export default function MainPoints() {
  const points = [
    {
      id: 'partyshop',
      title: 'Partyshop',
      description: 'mit Auswahl',
      image: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/BQACAgQAAxkDAAIrFWUCwKeadu5VNJWyftjKKz4EgUsSAALbEgACWK8QUCdMFCFuQmoPLwQ-BF4IPFe8lnVM4k4TUVBOUnZygOMPod.png",
      href: '/partyshop'
    },
    {
      id: 'deko-design',
      title: 'Deko & Design',
      description: 'mit Kreativität',
      image: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/BQACAgQAAxkDAAIq8GUCv5pwg4Rs0CXEc2o1r52OkWmiAAK2EgACWK8QULxHea1OjNEJLwQ-wcHUdclvd5ywKUqAkfz0wsFaeXuJwA.png",
      href: '/deko-design'
    },
    {
      id: 'ballongas',
      title: 'Ballongas',
      description: 'für Partner',
      image: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/BQACAgQAAxkDAAIrsmUC2bSN6tAP6j9pKCmT_finGpMiAAKrEwACWK8QUCpuliK8T4BqLwQ-M72mhinizGKZGHjUsXtAYl8YACRrco.png",
      href: '/ballongas'
    }
  ]

  return (
    <section className="py-20 bg-gray-100">
      <div className="container mx-auto px-4">
        <h2 className="text-3xl font-bold text-center mb-12">Unsere Dienstleistungen</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {points.map((point) => (
            <a href={point.href} key={point.id}>
              <Card className="group relative h-[400px] overflow-hidden cursor-pointer">
                <div className="absolute inset-0">
                  <Image
                    src={point.image || "/placeholder.svg"}
                    alt={point.title}
                    layout="fill"
                    objectFit="cover"
                    className="transition-transform duration-500 group-hover:scale-105  object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent" />
                </div>
                <div className="relative h-full flex flex-col justify-end p-6 text-white">
                  <h3 className="text-2xl font-bold mb-2">{point.title}</h3>
                  <p className="text-lg text-white mb-4">{point.description}</p>
                  <Button 
                    variant="outline" 
                    className="w-fit border-white text-black bg-white hover:bg-transparent hover:text-white mt-4"
                  >
                    Mehr anzeigen
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </Card>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}


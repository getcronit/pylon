import { Button } from "@/components/ui/button"
import { ArrowRight } from 'lucide-react'

export default function ConfiguratorSection() {
  return (
    <section className="py-24 bg-white">
      <div className="container mx-auto px-4">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="space-y-6">
              <div className="inline-block">
                <p className="text-sm font-semibold tracking-wider text-red-600 mb-2">
                  MY BALLONS & BALLONS
                </p>
                <h2 className="text-4xl md:text-5xl font-bold leading-tight">
                  Dein personalisierter Geschenkballon
                </h2>
              </div>
              <p className="text-xl text-gray-600">
                Gestalten Sie Ihre Ballons individuell mit vielfältigen Optionen und kreieren Sie die perfekte Atmosphäre für Ihre Feier.
              </p>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-1">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-600" />
                  </div>
                  <p className="text-gray-700">Personalisierte Texte und Designs</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-1">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-600" />
                  </div>
                  <p className="text-gray-700">Verschiedene Größen und Farben</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-1">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-600" />
                  </div>
                  <p className="text-gray-700">Einfache Online-Gestaltung</p>
                </div>
              </div>
              <Button className="mt-4 bg-red-600 hover:bg-red-700" size="lg">
                Jetzt gestalten
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </div>
          </div>
          <div className="relative">
            <img
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/onfi-2-5AOv7oHhqJYkHMUbqKdNCcXO0CsHhG.png"
              alt="Ballons & Ballons Konfigurator Interface"
              width={800}
              height={600}
              className="w-full h-auto"
              priority
            />
            <div className="absolute -bottom-6 -left-6 bg-white p-4 rounded-lg shadow-xl">
              <p className="text-2xl font-bold text-red-600">100+</p>
              <p className="text-sm text-gray-600">Designvorlagen</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}


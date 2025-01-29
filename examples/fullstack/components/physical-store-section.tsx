
import { Button } from "@/components/ui/button"
import { MapPin, Clock, Phone } from 'lucide-react'

export default function PhysicalStoreSection() {
  return (
    <section className="py-20 bg-gray-50">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900">
              Besuchen Sie unseren Laden in Wien
            </h2>
            <p className="text-lg text-gray-700">
              Entdecken Sie unser vielfältiges Sortiment an Ballons und Partyzubehör in unserem Geschäft. Unser freundliches Team berät Sie gerne persönlich!
            </p>
            <div className="space-y-4">
              <div className="flex items-center space-x-3">
                <MapPin className="w-5 h-5 text-red-500" />
                <span className="text-gray-700">Taborstraße 98, 1020 Wien</span>
              </div>
              <div className="flex items-center space-x-3">
                <Clock className="w-5 h-5 text-red-500" />
                <span className="text-gray-700">Mo-Fr 09:00 - 17:00</span>
              </div>
              <div className="flex items-center space-x-3">
                <Phone className="w-5 h-5 text-red-500" />
                <span className="text-gray-700">+43 121 634 25</span>
              </div>
            </div>
            <div className="pt-4">
              <Button asChild className="bg-red-500 hover:bg-red-600 text-white">
                <a href="/kontakt">Kontaktieren Sie uns</a>
              </Button>
            </div>
          </div>
          <div className="relative h-[400px] rounded-lg overflow-hidden shadow-lg">
            <img
              src="/placeholder.svg?height=400&width=600"
              alt="Ballons & Ballons Geschäft in Wien"
              layout="fill"
              objectFit="cover"
              className="transition-transform duration-300 hover:scale-105  object-cover"
            />
          </div>
        </div>
      </div>
    </section>
  )
}


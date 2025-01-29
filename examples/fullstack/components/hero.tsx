import { Button } from "@/components/ui/button"

export default function Hero() {
  return (
    <section className="relative bg-gradient-to-r from-red-500/90 to-red-600/90 text-white py-20 overflow-hidden">
      <div className="container mx-auto px-4 flex flex-col lg:flex-row items-center">
        <div className="lg:w-1/2 z-10">
          <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight">
            Verwandeln Sie Ihre Feier in ein <span className="text-yellow-300">magisches Erlebnis</span>
          </h1>
          <p className="text-xl mb-8 max-w-lg">
            Mit unseren atemberaubenden Ballondekorationen machen wir Ihren besonderen Tag unvergesslich. Vom eleganten Hochzeitstraum bis zur farbenfrohen Kinderparty!
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Button size="lg" className="bg-yellow-400 text-red-600 hover:bg-yellow-300" asChild>
              <a href="#kontakt">Jetzt Angebot anfordern</a>
            </Button>
            <Button size="lg" variant="outline" className="bg-transparent text-white border-white hover:bg-white hover:text-red-600" asChild>
              <a href="#gallery">Unsere Arbeiten entdecken</a>
            </Button>
          </div>
        </div>
        <div className="lg:w-1/2 mt-12 lg:mt-0 relative">
          <img
            src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/3ee39ec745179c8e744ee7c38d056424.jpg-imClCgT930j4N6WhLe9jqY85ZjMEKB.webp"
            alt="Festliche Ballondekoration mit grünen und goldenen Ballons"
            width={600}
            height={600}
            className="rounded-lg shadow-2xl object-cover"
            
          />
          <div className="absolute -bottom-4 -left-4 bg-white text-red-600 rounded-lg p-4 shadow-lg">
            <p className="font-bold text-2xl">100+</p>
            <p className="text-sm">zufriedene Kunden</p>
          </div>
        </div>
      </div>
      <div className="absolute top-0 left-0 w-full h-full">
        <img
          src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/bg-qEBdCDBcihDS9u4ZroQTIG1bHMlo3F.webp"
          alt="Balloon pattern"
          layout="fill"
          objectFit="cover"
          className="opacity-5 mix-blend-overlay"
          priority
        />
      </div>
    </section>
  )
}



const balloonIdeas = [
  {
    src: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/BQACAgQAAxkDAAIkzWUB07BiMjzCpl3MhKTbDYVAuzq5AALBEwACk04JUPdgpVJXwB75LwQ-3iwwofEmBTOk3Z7msAxD1j2Z5cjLdk.jpeg",
    alt: "Regenbogen-Ballonbogen mit eleganten Blumenarrangements für eine Hochzeitsdekoration",
    className: "lg:col-span-2 lg:row-span-2"
  },
  {
    src: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/BQACAgQAAxkDAAIk0GUB073bIHNx7KGSJsP-S8H7X8P-AALEEwACk04JUJMtRHHU2m2bLwQ-GGzlSq3i2OPwoC0cwxcdXwfRUhaHCT.jpeg",
    alt: "Kreative Partydekoration mit großer '2' und Minnie Mouse Ballonfiguren",
    className: "lg:col-span-1"
  },
  {
    src: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/BQACAgQAAxkDAAIk02UB0-EUj3cq38c83pXZwDnsWkerAALHEwACk04JUNWws8Umow0gLwQ-jh90Sy6JQtSbDFBSoe8nHL5UWjqEDc.jpeg",
    alt: "Elegante Balloninstallation in Lila und Pink für eine Firmenveranstaltung",
    className: "lg:col-span-1"
  },
  {
    src: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/BQACAgQAAxkDAAIkzmUB07AkIfAUW07EmLOKvLsM_rSkAALCEwACk04JUJh5Gynm732zLwQ-cF2NcKwBOZU1BDJOzMZFjKiifT56LR.jpeg",
    alt: "Sommerliche Poolparty-Dekoration mit schwebenden Großballons",
    className: "lg:col-span-2"
  },
  {
    src: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/BQACAgQAAxkDAAIk0mUB08qhd7fyp7CJBBfsQmRKtBW5AALGEwACk04JUCYFL2esuJYTLwQ-Z6kSNPQ1S7rZ8y30BwyKNmITbL90WL.jpeg",
    alt: "Stilvolle Bar-Dekoration mit goldenen Ballons und Pop-Art",
    className: "lg:col-span-1 lg:row-span-2"
  },
  {
    src: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/BQACAgQAAxkDAAIkz2UB07gF1h6icwql-5Mj0mClrf8_AALDEwACk04JUEH_UvZx8nnELwQ-2rdJRukaSt7aMcKhh86wo9g70z96AO.jpeg",
    alt: "Imposanter Ballonbogen in Rot und Gold für einen Geschäftseingang",
    className: "lg:col-span-1"
  },
  {
    src: "https://hebbkx1anhila5yf.public.blob.vercel-storage.com/BQACAgQAAxkDAAIk0WUB074Qq8LJrEDm3c49dyPioSseAALFEwACk04JUAo3X_Og1URVLwQ-cR5J4jbdDTI18mHFJZcRpquiU2SLz0.jpeg",
    alt: "Luxuriöse Sweet 16 Ballon-Dekoration in Gold mit Krone",
    className: "lg:col-span-1"
  }
]

export default function BalloonIdeasSection() {
  return (
    <section className="py-20 bg-gray-50">
      <div className="container mx-auto px-4">
        <div className="max-w-3xl mx-auto text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Was man mit Ballons alles machen kann?...
          </h2>
          <p className="text-xl md:text-2xl text-gray-600">
            Mit ein wenig Phantasie Alles
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-[200px] md:auto-rows-[300px]">
          {balloonIdeas.map((idea, index) => (
            <div 
              key={index} 
              className={`
                relative overflow-hidden rounded-lg shadow-lg
                ${idea.className}
              `}
            >
              <div className="absolute inset-0 w-full h-full">
                <img
                  src={idea.src || "/placeholder.svg"}
                  alt={idea.alt}
                  
                  className="transition-transform duration-500 hover:scale-105 object-cover object-center w-full h-full"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/20 opacity-0 hover:opacity-100 transition-opacity duration-300" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}



export default function Footer() {
  return (
    <footer className="bg-gray-100 text-gray-600 py-12">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <div>
            <h3 className="font-bold text-lg mb-4">UNTERNEHMEN</h3>
            <address className="not-italic">
              Taborstraße 98<br />
              1020 Wien<br />
              Austria
            </address>
            <p className="mt-2">
              <a href="tel:+4312163425" className="hover:text-red-500">+43 121 634 25</a><br />
              <a href="mailto:office@ballons-ballons.com" className="hover:text-red-500">office@ballons-ballons.com</a>
            </p>
          </div>
          <div>
            <h3 className="font-bold text-lg mb-4">ÖFFNUNGSZEITEN</h3>
            <p>Mo-Fr 09:00 - 17:00</p>
            <p>Sa-So Lieferungen und<br />Dekorationen vor Ort</p>
          </div>
          <div>
            <h3 className="font-bold text-lg mb-4">KATEGORIEN</h3>
            <ul className="space-y-2">
              {['Partyshop', 'Deko & Design', 'Grosshandel', 'Ballongas', 'Wissen', 'Kontakt'].map((item) => (
                <li key={item}>
                  <a href={`/${item.toLowerCase().replace(' & ', '-')}`} className="hover:text-red-500">
                    {item}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-bold text-lg mb-4">LINKS</h3>
            <ul className="space-y-2">
              {['Home', 'Jobs', 'Kontakt', 'FAQs', 'AGB', 'Datenschutz', 'Impressum'].map((item) => (
                <li key={item}>
                  <a href={`/${item.toLowerCase()}`} className="hover:text-red-500">
                    {item}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-8 pt-8 border-t border-gray-200">
          <p className="text-sm text-center">
            Durch unsere umfangreiche Auswahl, können Sie bei uns von einem einzelnen Ballon bis hin zur Festsaal-Dekoration alles bekommen. Ballons schaffen es wie nichts anderes, den Menschen ein Lächeln ins Gesicht zu zaubern.
          </p>
        </div>
      </div>
    </footer>
  )
}


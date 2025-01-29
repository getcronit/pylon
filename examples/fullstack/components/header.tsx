import { useState, useEffect } from 'react'

import { Button } from "@/components/ui/button"
import { Menu, X, Phone, MapPin, Clock } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const navItems = [
    { href: '/partyshop', label: 'Partyshop' },
    { href: '/deko-design', label: 'Deko & Design' },
    { href: '/grosshandel', label: 'Großhandel' },
    { href: '/ballongas', label: 'Ballongas' },
    { href: '/wissen', label: 'Wissen' },
    { href: '/kontakt', label: 'Kontakt' },
  ]

  const contactInfo = [
    { icon: Phone, text: '+43 121 634 25', href: 'tel:+4312163425' },
    { icon: MapPin, text: 'Taborstraße 98, 1020 Wien', href: 'https://maps.google.com' },
    { icon: Clock, text: 'Mo-Fr 09:00 - 17:00', href: '#' },
  ]

  return (
    <>
      {/* Top Bar */}
      <div className="hidden lg:block bg-gray-50 border-b border-gray-100">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-center h-10 text-sm text-gray-600">
            <div className="flex items-center space-x-6">
              {contactInfo.map((item, index) => (
                <a 
                  key={index} 
                  href={item.href}
                  className="flex items-center space-x-2 hover:text-red-600 transition-colors"
                  target={item.href.startsWith('http') ? '_blank' : undefined}
                  rel={item.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.text}</span>
                </a>
              ))}
            </div>
            <div className="flex items-center space-x-4">
              <a href="/my-ballons" className="hover:text-red-600 transition-colors">
                My Ballons & Ballons
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Main Header */}
      <header 
        className={`sticky top-0 z-50 bg-white transition-all duration-300 ${
          isScrolled ? 'shadow-md py-2' : 'py-4'
        }`}
      >
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <a href="/" className="flex-shrink-0 relative z-10">
              <img
                src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/ballons-2-iT81YyvajNusESewwhzEHYIgduzdjK.png"
                alt="Ballons & Ballons"
                width={120}
                height={24}
                className="h-8 w-auto"
                priority
              />
            </a>

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center space-x-1">
              {navItems.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="px-3 py-2 text-sm font-medium text-gray-600 hover:text-red-500 transition-colors relative group"
                >
                  {item.label}
                  <span className="absolute bottom-1.5 left-3 w-0 h-0.5 bg-red-500 transition-all duration-300 group-hover:w-[calc(100%-24px)]" />
                </a>
              ))}
              <Button className="ml-4 bg-red-600 hover:bg-red-700 text-white text-sm" asChild>
                <a href="/shop">Onlineshop</a>
              </Button>
            </nav>

            {/* Mobile Menu Button */}
            <button
              className="lg:hidden p-2 rounded-md text-gray-600 hover:text-red-500 transition-colors duration-200"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              aria-expanded={isMenuOpen}
              aria-label="Toggle menu"
            >
              {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>

          {/* Mobile Navigation */}
          <AnimatePresence>
            {isMenuOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="lg:hidden overflow-hidden"
              >
                <nav className="py-4 border-t mt-4 space-y-2">
                  {contactInfo.map((item, index) => (
                    <a
                      key={`mobile-${index}`}
                      href={item.href}
                      className="flex items-center space-x-2 p-2 text-sm text-gray-600 hover:text-red-500"
                      onClick={() => setIsMenuOpen(false)}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.text}</span>
                    </a>
                  ))}
                  <div className="h-px bg-gray-100 my-4" />
                  {navItems.map((item) => (
                    <a
                      key={item.href}
                      href={item.href}
                      className="block p-2 text-sm font-medium text-gray-600 hover:text-red-500 transition-colors"
                      onClick={() => setIsMenuOpen(false)}
                    >
                      {item.label}
                    </a>
                  ))}
                  <Button className="mt-4 w-full bg-red-600 hover:bg-red-700 text-white text-sm" asChild>
                    <a href="/shop" onClick={() => setIsMenuOpen(false)}>Onlineshop</a>
                  </Button>
                  <Button variant="outline" className="w-full mt-2" asChild>
                    <a href="/my-ballons" onClick={() => setIsMenuOpen(false)}>
                      My Ballons & Ballons
                    </a>
                  </Button>
                </nav>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>
    </>
  )
}


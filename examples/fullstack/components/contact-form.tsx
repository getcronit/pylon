'use client'

import { useState } from 'react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"

export default function ContactForm() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setIsSubmitting(true)
    // Simulate form submission
    await new Promise(resolve => setTimeout(resolve, 1000))
    setIsSubmitting(false)
    toast({
      title: "Anfrage gesendet",
      description: "Wir werden uns bald bei Ihnen melden!",
    })
  }

  return (
    <section id="kontakt" className="py-20 bg-gray-100">
      <div className="container mx-auto px-4">
        <h2 className="text-3xl font-bold text-center mb-8">Kontaktieren Sie uns</h2>
        <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input type="text" placeholder="Name" required className="w-full" />
            <Input type="email" placeholder="E-Mail" required className="w-full" />
            <Input type="tel" placeholder="Telefon" className="w-full" />
            <Textarea placeholder="Ihre Nachricht" required className="w-full" />
            <Button type="submit" className="w-full bg-red-500 hover:bg-red-600 text-white" disabled={isSubmitting}>
              {isSubmitting ? 'Wird gesendet...' : 'Anfrage senden'}
            </Button>
          </form>
        </div>
      </div>
    </section>
  )
}


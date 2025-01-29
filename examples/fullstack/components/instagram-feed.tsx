import { useState, useEffect } from 'react'
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Instagram } from 'lucide-react'
import { PageData } from '@getcronit/pylon';



export default function InstagramFeed(props: {posts: PageData["instagramPosts"]}) {
 
  return (
    <section className="py-20 bg-gray-50">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">Folgen Sie uns auf Instagram</h2>
          <p className="text-xl text-gray-600">Entdecken Sie unsere neuesten Kreationen und Inspirationen</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          {props.posts.map((post) => (
            <Card key={post.id} className="overflow-hidden">
              <CardContent className="p-0">
                <div className="relative aspect-square">
                  <img
                    src={post.media_url || "/placeholder.svg"}
                    alt={post.caption}
                    layout="fill"
                    objectFit="cover"
                    className="transition-transform duration-300 hover:scale-105  object-cover"
                  />
                </div>
                <div className="p-4">
                  <p className="text-sm text-gray-600 line-clamp-2">{post.caption}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="text-center mt-12">
          <Button variant="outline" size="lg" className="inline-flex items-center" asChild>
            <a href="https://www.instagram.com/ballons_ballons" target="_blank" rel="noopener noreferrer">
              <Instagram className="mr-2 h-5 w-5" />
              Mehr auf Instagram
            </a>
          </Button>
        </div>
      </div>
    </section>
  )
}


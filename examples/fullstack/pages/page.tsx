import Header from '@/components/header'
import Hero from '@/components/hero'
import MainPoints from '@/components/main-points'
import FeaturesSection from '@/components/features-section'
import ProductCards from '@/components/product-cards'
import GiftSection from '@/components/gift-section'
import ConfiguratorSection from '@/components/configurator-section'
import PhysicalStoreSection from '@/components/physical-store-section'
import InstagramFeed from '@/components/instagram-feed'
import KnowledgeSection from '@/components/knowledge-section'
import Footer from '@/components/footer'
import { Divider } from '@/components/divider'
import { PageProps } from '@getcronit/pylon'

const Page:  React.FC<PageProps> = ({data}) => {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main>
        <Hero />
        <Divider 
          topGradient={{ from: 'fill-red-500', to: 'fill-red-600' }} 
          bottomColor="bg-gray-100" 
        />
        <MainPoints />
        <Divider 
          topColor="fill-gray-100"
          bottomColor="bg-white" 
        />
        <FeaturesSection />
        <Divider 
          topColor="fill-white"
          bottomColor="bg-gray-50" 
        />
        <ProductCards products={data.products} />
        <Divider 
          topColor="fill-gray-50"
          bottomColor="bg-transparent" 
        />
        <GiftSection />
        <Divider 
          topColor="fill-transparent"
          bottomColor="bg-white" 
        />
        <ConfiguratorSection />
        <Divider 
          topColor="fill-white"
          bottomColor="bg-gray-50" 
        />
        <PhysicalStoreSection />
        <Divider 
          topColor="fill-gray-50"
          bottomColor="bg-white" 
        />
        <InstagramFeed posts={data.instagramPosts}/>
        <Divider 
          topColor="fill-white"
          bottomColor="bg-gray-50" 
        />
        <KnowledgeSection />
        <Divider 
          topColor="fill-gray-50"
          bottomColor="bg-gray-100" 
        />
      </main>
      <Footer />
    </div>
  )
}

export default Page


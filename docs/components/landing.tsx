import {ArrowRightIcon} from 'lucide-react'
import Link from 'next/link'
import {ClipboardButton} from './clipboard-button'
import Logo from './logo'
import {Button} from './ui/button'

export const Landing: React.FC = () => {
  return (
    <div className="h-full flex flex-col justify-center items-center text-center space-y-8 pb-48">
      <div className="max-w-full text-center md:max-w-[45rem]">
        <div className="mb-8 flex items-center justify-center">
          <Logo className="h-28" />
        </div>
        <h1 className="relative text-4xl font-bold md:text-7xl mb-8 before:absolute before:left-0 before:top-0 before:w-full before:animate-[shine_2s_ease-in-out] before:bg-shine before:bg-[length:200%] before:bg-clip-text before:text-transparent before:content-['The_next_generation_of_building_APIs']">
          The next generation of building APIs
        </h1>
        <div className="sm:px-20">
          <h2 className="text-lg mb-2 text-slate-400 md:!text-2xl">
            A code-first framework for GraphQL API development, where your
            schema reflects your functionality.
          </h2>
        </div>
      </div>
      <div className="mt-10 flex items-center justify-center gap-4 flex-col md:flex-row">
        <Button asChild>
          <Link href="/docs">
            Explore documentation
            <ArrowRightIcon className="ml-2" size={16} />
          </Link>
        </Button>

        <ClipboardButton text="npm create pylon@latest" />
      </div>
    </div>
  )
}

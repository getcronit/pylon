import {MdxFile, Meta} from 'nextra'
import {Link} from 'nextra-theme-docs'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader
} from '@/components/ui/card'
import {Badge} from '@/components/ui/badge'

export const PagePreviewCard: React.FC<{
  page: MdxFile & {meta?: Exclude<Meta, string>}
}> = ({page}) => {
  return (
    <Card key={page.route} className="bg-transparent">
      {page.frontMatter?.new && (
        <Badge
          variant="secondary"
          className="absolute top-0 left-1/2 -translate-y-1/2 -translate-x-1/2 px-4 font-bold bg-background dark:bg-[#111111] group-hover:bg-[#0ea6e9] group-hover:text-white transition-none">
          🔥 New
        </Badge>
      )}
      <CardHeader>
        <h3 className="text-2xl text-black dark:text-gray-100">
          <Link href={page.route} className="!no-underline">
            <span className="absolute -inset-px rounded-xl"></span>
            {page.meta.title || page.frontMatter?.title || page.name}
          </Link>
        </h3>
        <span className="text-sm text-muted-foreground dark:text-gray-400">
          {page.frontMatter?.date}
        </span>
      </CardHeader>
      <CardContent>
        <CardDescription>{page.frontMatter?.description}</CardDescription>
      </CardContent>
      <CardFooter className="flex justify-end">
        <p className="block nx-text-primary-600 group/link hover:!no-underline">
          Read more
          <span className="relative left-1">→</span>
        </p>
      </CardFooter>
    </Card>
  )
}

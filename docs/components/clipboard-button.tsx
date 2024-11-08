'use client'

import {useState} from 'react'
import {Copy, Check} from 'lucide-react'
import {useCopyToClipboard} from 'usehooks-ts'
import {Button, ButtonProps} from '@/components/ui/button'

interface ClipboardButtonProps extends ButtonProps {
  text: string
}

export function ClipboardButton(
  {text, ...rest}: ClipboardButtonProps = {text: 'Copy me!'}
) {
  const [isCopied, setIsCopied] = useState(false)
  const [_, copy] = useCopyToClipboard()

  const handleCopy = () => {
    copy(text)
    setIsCopied(true)
    setTimeout(() => setIsCopied(false), 2000)
  }

  return (
    <Button
      variant="outline"
      size="icon"
      className="font-mono text-sm"
      onClick={handleCopy}
      aria-label={isCopied ? 'Copied!' : 'Copy to clipboard'}
      {...rest}>
      {isCopied ? (
        <Check className="size-4 text-green-500" />
      ) : (
        <Copy className="size-4" />
      )}
    </Button>
  )
}

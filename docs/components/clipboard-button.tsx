"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { useCopyToClipboard } from "usehooks-ts";
import { Button } from "@/components/ui/button";

interface ClipboardButtonProps {
  text: string;
}

export function ClipboardButton(
  { text }: ClipboardButtonProps = { text: "Copy me!" }
) {
  const [isCopied, setIsCopied] = useState(false);
  const [_, copy] = useCopyToClipboard();

  const handleCopy = () => {
    copy(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <Button
      variant="outline"
      className="font-mono text-sm"
      onClick={handleCopy}
      aria-label={isCopied ? "Copied!" : "Copy to clipboard"}
    >
      {text}
      {isCopied ? (
        <Check className="ml-2 h-4 w-4 text-green-500" />
      ) : (
        <Copy className="ml-2 h-4 w-4" />
      )}
    </Button>
  );
}

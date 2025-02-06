import { useState } from "react";

export const Image: React.FC<{
  src: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
  priority?: boolean;
  quality?: number;
  blurDataURL?: string;
}> = ({ src, alt, className, width, height, priority, blurDataURL, quality = 80 }) => {


  const url = new URL(src, "http://localhost:3000");

  if(url.searchParams.has("w") && !width) {
    width = parseInt(url.searchParams.get("w") || "0");

  }
  if(url.searchParams.has("h") && !height) {
    height = parseInt(url.searchParams.get("h")!);
  }
  if(url.searchParams.has("blurDataURL") && !blurDataURL) {
    blurDataURL = url.searchParams.get("blurDataURL") || undefined
  }

  const params = new URLSearchParams({ src: url.pathname });
  if (width) params.set("w", width.toString());
  if (height) params.set("h", height.toString());
  params.set("q", quality.toString());

  return (
   <>   
   <img
   style={{ backgroundImage: `url(${blurDataURL})`, backgroundSize: "cover" }}
    className={className}
    src={`/__pylon/image?${params.toString()}`}
    width={width}
    height={height}
    alt={alt}
    loading={priority ? "eager" : "lazy"}
    onLoad={(e) => {
      alert("Image loaded")
    }}
  /></>
   
  );
};

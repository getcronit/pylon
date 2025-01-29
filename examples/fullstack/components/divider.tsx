import { useId, useMemo } from 'react'

interface GradientProps {
  from: string;
  to: string;
}

interface DividerProps {
  topColor?: string;
  topGradient?: GradientProps;
  bottomColor: string;
}

export function Divider({ topColor, topGradient, bottomColor }: DividerProps) {
  const id = useId();
  const gradientId = `divider-gradient-${id}`;

  return (
    <div className={bottomColor}>
      <svg 
        xmlns="http://www.w3.org/2000/svg" 
        viewBox="0 0 1000 100" 
        className="w-full h-auto"
        preserveAspectRatio="none"
      >
        {topGradient ? (
          <>
            <defs>
              <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                <rect width="100%" height="100%" className={topGradient.from} />
                <rect width="100%" height="100%" className={topGradient.to} />
              </linearGradient>
            </defs>
            <path 
              d="M1000 0H0v52C62.5 28 125 4 250 4c250 0 250 96 500 96 125 0 187.5-24 250-48V0Z" 
              fill={`url(#${gradientId})`}
            />
          </>
        ) : (
          <path 
            d="M1000 0H0v52C62.5 28 125 4 250 4c250 0 250 96 500 96 125 0 187.5-24 250-48V0Z" 
            className={topColor}
          />
        )}
      </svg>
    </div>
  )
}


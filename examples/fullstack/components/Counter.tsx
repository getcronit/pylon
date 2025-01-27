import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const Counter = () => {
  const [count, setCount] = useState(0)

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-center">Counter</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center space-y-4">
        <p className="text-4xl font-bold">{count}</p>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={() => setCount(count - 1)} className="w-24">
            Decrement
          </Button>
          <Button onClick={() => setCount(count + 1)} className="w-24">
            Increment
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default Counter


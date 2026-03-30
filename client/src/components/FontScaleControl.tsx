import { useAppStore } from '@/lib/store'
import { Minus, Plus, ZoomIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export function FontScaleControl() {
  const { fontScale, setFontScale } = useAppStore()

  const decrease = () => setFontScale(Math.max(50, fontScale - 1))
  const increase = () => setFontScale(Math.min(150, fontScale + 1))

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6" title={`Font scale: ${fontScale}%`}>
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2" align="end">
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground uppercase tracking-wider">Font Scale</div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-6 w-6 bg-transparent"
              onClick={decrease}
              disabled={fontScale <= 50}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <div className="flex-1 text-center text-sm font-medium">{fontScale}%</div>
            <Button
              variant="outline"
              size="icon"
              className="h-6 w-6 bg-transparent"
              onClick={increase}
              disabled={fontScale >= 150}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          <input
            type="range"
            min="50"
            max="150"
            step="5"
            value={fontScale}
            onChange={(e) => setFontScale(Number(e.target.value))}
            className="w-full h-1.5 bg-muted rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>50%</span>
            <button className="hover:text-foreground" onClick={() => setFontScale(100)}>
              Reset
            </button>
            <span>150%</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

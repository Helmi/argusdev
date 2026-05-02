import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { AgentOption } from '@/lib/types'

interface AgentOptionsFormProps {
  options: AgentOption[]
  values: Record<string, boolean | string>
  onChange: (values: Record<string, boolean | string>) => void
}

/**
 * Renders a dynamic form based on AgentOption[] configuration.
 * Handles boolean toggles, string inputs, dropdowns (choices), and grouped radio buttons (mutual exclusivity).
 */
export function AgentOptionsForm({ options, values, onChange }: AgentOptionsFormProps) {
  // Group options by their 'group' field for mutual exclusivity
  const groups = new Map<string, AgentOption[]>()
  const ungrouped: AgentOption[] = []

  for (const opt of options) {
    if (opt.group) {
      const list = groups.get(opt.group) || []
      list.push(opt)
      groups.set(opt.group, list)
    } else {
      ungrouped.push(opt)
    }
  }

  const handleBooleanChange = (id: string, checked: boolean) => {
    onChange({ ...values, [id]: checked })
  }

  const handleStringChange = (id: string, value: string) => {
    onChange({ ...values, [id]: value })
  }

  // For grouped options, only one can be selected (radio behavior)
  const handleGroupChange = (groupOptions: AgentOption[], selectedId: string) => {
    const newValues = { ...values }
    // Deselect all in group
    for (const opt of groupOptions) {
      newValues[opt.id] = false
    }
    // Select the chosen one
    newValues[selectedId] = true
    onChange(newValues)
  }

  const renderOption = (opt: AgentOption) => {
    const value = values[opt.id]

    // String with choices = dropdown. The Select stores choice.args directly
    // (that's what buildAgentArgs needs); the dropdown displays choice.label.
    if (opt.type === 'string' && opt.choices && opt.choices.length > 0) {
      // Filter empty/duplicate args so Radix Select doesn't get an empty value
      // or duplicate keys. Mirrors the editor's filter for the same reasons.
      const visibleChoices = opt.choices.filter(
        (c, i, arr) => c.args && arr.findIndex(o => o.args === c.args) === i,
      )
      return (
        <div key={opt.id} className="space-y-1">
          <Label className="text-xs">{opt.label}</Label>
          <Select
            value={typeof value === 'string' ? value : (opt.default as string) || ''}
            onValueChange={(v) => handleStringChange(opt.id, v)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder={`Select ${opt.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {visibleChoices.map((choice) => (
                <SelectItem key={choice.args} value={choice.args}>
                  {choice.label || choice.args}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {opt.description && (
            <p className="text-xs text-muted-foreground">{opt.description}</p>
          )}
        </div>
      )
    }

    // Plain string = text input
    if (opt.type === 'string') {
      return (
        <div key={opt.id} className="space-y-1">
          <Label htmlFor={opt.id} className="text-xs">{opt.label}</Label>
          <Input
            id={opt.id}
            value={typeof value === 'string' ? value : (opt.default as string) || ''}
            onChange={(e) => handleStringChange(opt.id, e.target.value)}
            placeholder={opt.flag || opt.label}
            className="h-8 text-xs"
          />
          {opt.description && (
            <p className="text-xs text-muted-foreground">{opt.description}</p>
          )}
        </div>
      )
    }

    // Boolean = checkbox
    return (
      <div key={opt.id} className="flex items-start gap-2">
        <Checkbox
          id={opt.id}
          checked={typeof value === 'boolean' ? value : (opt.default as boolean) || false}
          onCheckedChange={(checked) => handleBooleanChange(opt.id, checked === true)}
        />
        <div className="grid gap-0.5 leading-none">
          <label htmlFor={opt.id} className="text-xs cursor-pointer">
            {opt.label}
          </label>
          {opt.description && (
            <p className="text-xs text-muted-foreground">{opt.description}</p>
          )}
        </div>
      </div>
    )
  }

  const renderGroup = (groupName: string, groupOptions: AgentOption[]) => {
    // Find which option is currently selected in this group
    const selectedId = groupOptions.find((opt) => values[opt.id] === true)?.id || ''

    return (
      <div key={groupName} className="space-y-2">
        <Label className="text-xs capitalize">{groupName.replace(/-/g, ' ')}</Label>
        <RadioGroup
          value={selectedId}
          onValueChange={(id) => handleGroupChange(groupOptions, id)}
          className="space-y-1"
        >
          {groupOptions.map((opt) => (
            <div key={opt.id} className="flex items-center gap-2">
              <RadioGroupItem value={opt.id} id={`group-${opt.id}`} />
              <label htmlFor={`group-${opt.id}`} className="text-xs cursor-pointer flex-1">
                {opt.label}
                {opt.description && (
                  <span className="text-muted-foreground ml-1">- {opt.description}</span>
                )}
              </label>
            </div>
          ))}
          {/* Option to select none */}
          <div className="flex items-center gap-2">
            <RadioGroupItem value="" id={`group-${groupName}-none`} />
            <label htmlFor={`group-${groupName}-none`} className="text-xs cursor-pointer text-muted-foreground">
              None
            </label>
          </div>
        </RadioGroup>
      </div>
    )
  }

  if (options.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      {/* Render grouped options as radio buttons */}
      {Array.from(groups.entries()).map(([groupName, groupOptions]) =>
        renderGroup(groupName, groupOptions)
      )}

      {/* Render ungrouped options */}
      {ungrouped.map(renderOption)}
    </div>
  )
}

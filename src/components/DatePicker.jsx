import { useState } from 'react';
import { format, isValid, parse } from 'date-fns';
import { CalendarIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// Dates are kept as YYYY-MM-DD strings in the person's own time zone, the same as the API and <input type="date">.
const FORMAT = 'yyyy-MM-dd';
const toDate = (s) => {
  if (!s) return undefined;
  const d = parse(s, FORMAT, new Date());
  return isValid(d) ? d : undefined;
};

// A date field: a button showing the date, opening a calendar. value and onChange use 'YYYY-MM-DD', '' for no date.
// min/max limit the dates that can be picked. Unless it's required, a picked date can be cleared.
export default function DatePicker({ id, value, onChange, min, max, required, placeholder = 'Pick a date', className, 'aria-label': ariaLabel }) {
  const [open, setOpen] = useState(false);
  const selected = toDate(value);
  const minDate = toDate(min);
  const maxDate = toDate(max);
  const disabled = [minDate && { before: minDate }, maxDate && { after: maxDate }].filter(Boolean);

  const pick = (date) => {
    onChange(date ? format(date, FORMAT) : '');
    setOpen(false);
  };

  return (
    <div className={cn('relative', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            aria-label={ariaLabel}
            className={cn('w-full justify-start px-3 font-normal', !selected && 'text-muted-foreground', selected && !required && 'pr-9')}
          >
            <CalendarIcon className="text-muted-foreground" />
            <span className="truncate">{selected ? selected.toLocaleDateString() : placeholder}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected ?? maxDate}
            onSelect={pick}
            disabled={disabled}
            captionLayout="dropdown"
            startMonth={minDate ?? new Date(1950, 0)}
            endMonth={maxDate ?? new Date(new Date().getFullYear() + 5, 11)}
            required={required}
          />
        </PopoverContent>
      </Popover>
      {selected && !required && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-1/2 right-1 size-7 -translate-y-1/2 text-muted-foreground"
          onClick={() => onChange('')}
          aria-label="Clear date"
        >
          <X />
        </Button>
      )}
      {/* Lets the form's own "please fill in this field" check work for a required date. */}
      {required && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          required
          value={value ?? ''}
          onChange={() => {}}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-0"
        />
      )}
    </div>
  );
}

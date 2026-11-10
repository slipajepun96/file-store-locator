import { useOffices } from '@/office.jsx';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

// Radix Select items can't have an empty value, so "no office" / "all offices" ('' in the app) uses this stand-in.
const EMPTY = '__none__';

// An office picker. value and onChange(id) use '' for "no office". With emptyLabel, that choice is listed first
// ("All offices", "— No office —"); without it, '' shows the placeholder until an office is picked.
export default function OfficeSelect({ value, onChange, emptyLabel, placeholder = 'Choose an office', size, className, disabled, label = 'Office', id }) {
  const { offices } = useOffices();
  const current = value || (emptyLabel ? EMPTY : '');
  return (
    <Select value={current} onValueChange={(v) => onChange(v === EMPTY ? '' : v)} disabled={disabled}>
      <SelectTrigger id={id} size={size} className={cn('w-full sm:w-fit sm:min-w-40 sm:max-w-64', className)} aria-label={label}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {emptyLabel && (
          <>
            <SelectItem value={EMPTY}>{emptyLabel}</SelectItem>
            {offices.length > 0 && <SelectSeparator />}
          </>
        )}
        {offices.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

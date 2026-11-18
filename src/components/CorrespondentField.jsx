import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { api } from '@/api.js';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { useLive } from '@/live.js';

const MAX_SHOWN = 8;
const norm = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();

// The shared list of senders and recipients (Settings → Senders & Recipients), loaded while `active`.
export function useCorrespondents(active = true) {
  const [list, setList] = useState([]);
  const reload = () => api.get('/correspondents').then(setList).catch(() => {});
  useEffect(() => {
    if (active) reload();
  }, [active]);
  useLive(['correspondent', 'letter'], () => active && reload());
  return { list, reload };
}

// A letter's From / To field: type to search the shared list and pick a name, or add the typed name to the list
// when it's new. The value is plain text, so a name can still be typed and saved as is (saving adds it to the list).
// Up/Down move through the suggestions, Enter picks, Escape closes.
export default function CorrespondentField({ id, value, onChange, names, onAdded, placeholder, required, autoFocus }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const typed = norm(value);
  const exact = names.find((n) => norm(n.name) === typed);
  // Names starting with what's typed come first, then names containing it anywhere.
  const matches = useMemo(() => {
    if (!typed) return names.slice(0, MAX_SHOWN);
    const starts = [];
    const contains = [];
    for (const n of names) {
      const name = norm(n.name);
      if (name.startsWith(typed)) starts.push(n);
      else if (name.includes(typed)) contains.push(n);
    }
    return [...starts, ...contains].slice(0, MAX_SHOWN);
  }, [names, typed]);
  const canAdd = Boolean(typed) && !exact;
  // The options in order: the matches, then "Add …" when the name is new.
  const options = [...matches.map((n) => ({ kind: 'name', name: n.name })), ...(canAdd ? [{ kind: 'add' }] : [])];
  const showList = open && options.length > 0;

  useEffect(() => setActive(0), [typed]);

  const pick = (name) => {
    onChange(name);
    setOpen(false);
    setError('');
  };

  async function add() {
    const name = value.trim().replace(/\s+/g, ' ');
    setAdding(true);
    try {
      const added = await api.post('/correspondents', { name });
      await onAdded?.(added);
      pick(added.name);
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  const choose = (option) => (option.kind === 'add' ? add() : pick(option.name));

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + step + options.length) % Math.max(options.length, 1));
    } else if (e.key === 'Enter' && showList) {
      e.preventDefault();
      choose(options[active] ?? options[0]);
    } else if (e.key === 'Escape' && open) {
      // Closes the list without closing the dialog around it.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  const listId = `${id}-options`;

  return (
    <div className="grid gap-1.5">
      <Popover open={showList} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <Input
            ref={inputRef}
            id={id}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setOpen(true);
              setError('');
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            required={required}
            autoFocus={autoFocus}
            autoComplete="off"
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) min-w-64 p-1"
          // Typing stays in the field while the list is open.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.target === inputRef.current && e.preventDefault()}
        >
          <ul id={listId} role="listbox" aria-label="Senders and recipients" className="max-h-64 overflow-y-auto">
            {options.map((o, i) => (
              <li
                key={o.kind === 'add' ? '__add__' : o.name}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // mousedown would take focus from the field and close the list before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
                onMouseMove={() => setActive(i)}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-sm',
                  i === active && 'bg-accent text-accent-foreground',
                  o.kind === 'add' && matches.length > 0 && 'mt-1 border-t pt-2'
                )}
              >
                {o.kind === 'add' ? (
                  <>
                    <Plus className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 break-words">
                      {adding ? 'Adding…' : <>Add <span className="font-medium">"{value.trim()}"</span> as a new name</>}
                    </span>
                  </>
                ) : (
                  <>
                    <Check className={cn('mt-0.5 size-4 shrink-0', norm(o.name) === typed ? 'opacity-100' : 'opacity-0')} />
                    <span className="min-w-0 break-words">{o.name}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!error && canAdd && !open && (
        <p className="text-xs text-muted-foreground">New name: it's added to the list of senders and recipients when you save.</p>
      )}
    </div>
  );
}

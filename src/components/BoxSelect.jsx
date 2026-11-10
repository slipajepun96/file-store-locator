import { useOffices } from '@/office.jsx';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';

// A file box picker. Boxes from more than one office are grouped under each office's name.
// With areas, each box also shows its area. onChange gets the box id.
export default function BoxSelect({ boxes, areas, value, onChange, id, disabled, invalid }) {
  const { offices } = useOffices();
  const label = (b) => {
    const area = areas?.find((a) => a.id === b.areaId)?.name;
    return area ? `${b.name} (${area})` : b.name;
  };
  const item = (b) => <SelectItem key={b.id} value={b.id}>{label(b)}</SelectItem>;

  const officeIds = new Set(boxes.map((b) => b.officeId));
  const items =
    officeIds.size <= 1
      ? boxes.map(item)
      : offices
          .filter((o) => officeIds.has(o.id))
          .map((o) => (
            <SelectGroup key={o.id}>
              <SelectLabel>{o.name}</SelectLabel>
              {boxes.filter((b) => b.officeId === o.id).map(item)}
            </SelectGroup>
          ));

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid || undefined}>
        <SelectValue placeholder="Select file box" />
      </SelectTrigger>
      <SelectContent>{items}</SelectContent>
    </Select>
  );
}

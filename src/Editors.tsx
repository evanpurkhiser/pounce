import {Autocomplete} from '@base-ui/react/autocomplete';
import {Tabs} from '@base-ui/react/tabs';
import {parseDate, type CalendarDate} from '@internationalized/date';
import {Button, Calendar, CalendarCell, CalendarGrid, DateInput, DatePicker, DateSegment, Dialog, Group, Heading, Label, Popover} from 'react-aria-components';
import {useState} from 'react';
import {type Choice, type Range, type Row} from './api';
import {Picker, useInitialFocus} from './Palette';
import {rank} from './search';

export function PayeeEditor({value, payees, apply, cancel, onLeave}: {
  value: string; payees: string[]; apply: (value: string) => void; cancel: () => void; onLeave?: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useInitialFocus<HTMLInputElement>(true);
  const suggestions = rank(payees.map(label => ({label})), draft).slice(0, 12).map(item => item.label);

  return <form className="editor payee-editor" onSubmit={event => {
    event.preventDefault();
    const name = ref.current?.value.trim();
    if (name) apply(name);
  }} onBlurCapture={onLeave && (event => {
    const editor = event.currentTarget;
    if (!editor.contains(event.relatedTarget)) {
      queueMicrotask(() => {
        if (editor.isConnected && !editor.contains(document.activeElement)) onLeave();
      });
    }
  })} onKeyDownCapture={event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  }}>
    <Autocomplete.Root inline open items={payees} filteredItems={suggestions} value={draft} onValueChange={setDraft}>
      <div className="controls">
        <Autocomplete.Input aria-label="Payee" ref={ref} />
        <button type="submit" disabled={!draft.trim()}>Save payee</button>
      </div>
      {!!suggestions.length && <Autocomplete.List className="suggestions">
        {(payee: string) => <Autocomplete.Item key={payee} value={payee} className="choice">{payee}</Autocomplete.Item>}
      </Autocomplete.List>}
    </Autocomplete.Root>
  </form>;
}

function DateControl({label, value, setValue, autoFocus}: {
  label: string; value: CalendarDate | null; setValue: (date: CalendarDate | null) => void; autoFocus?: boolean;
}) {
  return <DatePicker value={value} onChange={setValue} autoFocus={autoFocus} className="date-picker">
    <Label>{label}</Label>
    <Group className="date-input">
      <DateInput>{segment => <DateSegment segment={segment} />}</DateInput>
      <Button aria-label={'Open calendar for ' + label}>▦</Button>
    </Group>
    <Popover className="calendar-popup">
      <Dialog>
        <Calendar>
          <header><Button slot="previous" aria-label="Previous calendar month">‹</Button><Heading/><Button slot="next" aria-label="Next calendar month">›</Button></header>
          <CalendarGrid>{date => <CalendarCell date={date} />}</CalendarGrid>
        </Calendar>
      </Dialog>
    </Popover>
  </DatePicker>;
}

export function DateEditor({value, apply}: {value: string; apply: (value: string) => void}) {
  const [date, setDate] = useState<CalendarDate | null>(value ? parseDate(value) : null);
  return <form className="editor" onSubmit={event => { event.preventDefault(); if (date) apply(date.toString()); }}>
    <DateControl label="Transaction date" value={date} setValue={setDate} autoFocus />
    <button type="submit" disabled={!date}>Apply date</button>
  </form>;
}

export function RangeEditor({range, apply}: {range: Range; apply: (range: Range) => void}) {
  const [start, setStart] = useState<CalendarDate | null>(parseDate(range.start));
  const [end, setEnd] = useState<CalendarDate | null>(parseDate(range.end));
  const valid = start && end && start.compare(end) <= 0;

  return <form className="editor" onSubmit={event => {
    event.preventDefault();
    if (valid) apply({start: start.toString(), end: end.toString()});
  }}>
    <DateControl label="From" value={start} setValue={setStart} autoFocus />
    <DateControl label="Through" value={end} setValue={setEnd} />
    <button type="submit" disabled={!valid}>Search date range</button>
  </form>;
}

export function NoteEditor({value, apply}: {value: string; apply: (value: string) => void}) {
  const [draft, setDraft] = useState(value);
  const ref = useInitialFocus<HTMLTextAreaElement>();
  return <form className="editor" onSubmit={event => { event.preventDefault(); if (draft.trim()) apply(draft.trim()); }}>
    <label>Note<textarea ref={ref} rows={5} value={draft} onChange={event => setDraft(event.target.value)} /></label>
    <div className="controls">
      <button type="submit" disabled={!draft.trim()}>Save note</button>
      <button type="button" onClick={() => apply('')}>Clear note</button>
    </div>
  </form>;
}

export function Details({row, note, apply, category, account}: {
  row: Row; note: boolean; apply?: (value: string) => void; category: string; account: string;
}) {
  return <Tabs.Root defaultValue={note ? 'notes' : 'details'} className="details">
    <Tabs.List aria-label="Transaction details">
      <Tabs.Tab value="details">Details</Tabs.Tab><Tabs.Tab value="notes">Notes</Tabs.Tab>
    </Tabs.List>
    <Tabs.Panel value="details">
      <dl><dt>Payee</dt><dd>{row.payee}</dd><dt>Original descriptor</dt><dd>{row.original_name || '—'}</dd>
        <dt>Date</dt><dd>{row.date}</dd><dt>Category</dt><dd>{category}</dd><dt>Account</dt><dd>{account}</dd>
        <dt>Review status</dt><dd>{row.status.replaceAll('_', ' ')}</dd></dl>
    </Tabs.Panel>
    <Tabs.Panel value="notes">{apply ? <NoteEditor value={row.notes ?? ''} apply={apply} /> : <p>{row.notes || 'No note.'}</p>}</Tabs.Panel>
  </Tabs.Root>;
}

export function CategoryPicker({rows, choices, apply}: {
  rows: Row[]; choices: Choice[]; apply: (category: number | null) => void;
}) {
  const items = choices.filter(choice => !choice.group).map(choice => {
    const count = rows.filter(row => String(row.category_id ?? 0) === choice.id).length;
    return {...choice, mark: count === rows.length ? 'checked' as const : count ? 'mixed' as const : 'unchecked' as const,
      detail: count && rows.length > 1 ? count + ' of ' + rows.length : undefined};
  });

  return <Picker title="Search categories" items={items} choose={id => apply(Number(id) || null)} />;
}

export function TagPicker({rows, choices, apply}: {
  rows: Row[]; choices: Choice[]; apply: (changes: Map<number, boolean>) => void;
}) {
  const [staged, setStaged] = useState(new Map<number, boolean>());
  const counts = new Map(choices.map(choice => [choice.id, rows.filter(row => row.tag_ids.includes(Number(choice.id))).length]));
  const items = choices.map(choice => {
    const change = staged.get(Number(choice.id));
    const count = counts.get(choice.id) ?? 0;
    const checked = change ?? count === rows.length;
    return {...choice, mark: checked ? 'checked' as const : change === undefined && count ? 'mixed' as const : 'unchecked' as const,
      detail: change !== undefined ? (change ? 'Add to all' : 'Remove from all') : rows.length > 1 ? count + ' of ' + rows.length : undefined};
  });
  const toggle = (id: string) => {
    const current = staged.get(Number(id)) ?? counts.get(id) === rows.length;
    setStaged(new Map(staged).set(Number(id), !current));
  };
  const reset = (id: string) => {
    const changes = new Map(staged);
    changes.delete(Number(id));
    setStaged(changes);
  };
  return <Picker title="Search tags" items={items} checked={items.filter(item => item.mark === 'checked').map(item => item.id)}
    choose={toggle} toggle={toggle} reset={reset} footer={<>
      <button onClick={() => apply(staged)} disabled={!staged.size}>Apply tags</button>
      {staged.size > 0 && <button onClick={() => setStaged(new Map())}>Reset changes</button>}
      <small>Alt+Enter resets a tag</small>
    </>} />;
}

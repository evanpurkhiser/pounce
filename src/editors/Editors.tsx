import {
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import {
  Button,
  Calendar,
  CalendarCell,
  CalendarGrid,
  DateInput,
  DatePicker,
  DateSegment,
  Dialog,
  Group,
  Heading,
  Label,
  Popover,
} from 'react-aria-components';

import {Autocomplete} from '@base-ui/react/autocomplete';
import {parseDate, type CalendarDate} from '@internationalized/date';

import type {Choice, Range, Row, TagChoice} from '../data/api';
import {TransactionTag} from '../transactions/TransactionTag';
import {KeyboardShortcut} from '../ui/KeyboardShortcut';
import {Picker, useInitialFocus} from '../ui/Palette';
import {rank} from '../ui/search';
import ui from '../ui/ui.module.css';

import styles from './Editors.module.css';

type TextEditorProps = {
  value: string;
  apply: (value: string) => void;
  cancel?: () => void;
  onLeave?: (value?: string) => void;
};

function useTextDraft(
  {value, apply, cancel, onLeave}: TextEditorProps,
  options?: {
    allowEmpty?: boolean;
    mixed?: boolean;
    popup?: RefObject<HTMLElement | null>;
  },
) {
  const [draft, setDraft] = useState(value);
  const pending = useRef<string>(undefined);

  function update(next: string) {
    pending.current = next;
    setDraft(next);
  }

  function finish(leave: boolean, confirmed = pending.current) {
    const next = confirmed?.trim();
    if (!leave && next === '' && !options?.allowEmpty) {
      return;
    }

    pending.current = undefined;
    const changed =
      next !== undefined &&
      (options?.allowEmpty || next.length > 0) &&
      (options?.mixed || next !== value);
    if (leave && onLeave) {
      onLeave(changed ? next : undefined);
    } else if (changed) {
      apply(next);
    } else if (!leave) {
      cancel?.();
    }
  }

  return {
    draft,
    update,
    confirm: (confirmed?: string) => finish(false, confirmed),
    bindings: {
      onPointerDown:
        onLeave &&
        ((event: PointerEvent<HTMLFormElement>) => {
          if (event.target !== event.currentTarget || event.button !== 0) {
            return;
          }

          event.preventDefault();
          event.currentTarget.querySelector<HTMLElement>('input,textarea')?.focus();
        }),
      onBlurCapture(event: FocusEvent<HTMLFormElement>) {
        const editor = event.currentTarget;
        const contains = (target: Node | null) =>
          editor.contains(target) || Boolean(options?.popup?.current?.contains(target));
        if (contains(event.relatedTarget)) {
          return;
        }

        if (event.relatedTarget) {
          finish(true);
        } else {
          queueMicrotask(() => {
            if (editor.isConnected && !contains(document.activeElement)) {
              finish(true);
            }
          });
        }
      },
      onKeyDownCapture(event: KeyboardEvent<HTMLFormElement>) {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) {
          return;
        }

        pending.current = undefined;
        if (cancel) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      },
    },
  };
}

export function PayeeEditor({payees, ...editor}: TextEditorProps & {payees: string[]}) {
  const popup = useRef<HTMLDivElement>(null);
  const {draft, update, confirm, bindings} = useTextDraft(editor, {popup});
  const [showSuggestions, setShowSuggestions] = useState(true);
  const input = useInitialFocus<HTMLInputElement>(true);
  const suggestions = rank(
    payees.map(label => ({label})),
    draft,
  )
    .slice(0, 12)
    .map(item => item.label);

  return (
    <form
      className={ui.editor}
      {...bindings}
      onSubmit={event => {
        event.preventDefault();
        confirm(draft);
      }}
    >
      <Autocomplete.Root
        open={showSuggestions && suggestions.length > 0}
        onOpenChange={setShowSuggestions}
        items={payees}
        filteredItems={suggestions}
        value={draft}
        onValueChange={(name, event) => {
          update(name);
          setShowSuggestions(true);
          if (event.reason === 'item-press') {
            confirm(name);
          }
        }}
      >
        <Autocomplete.Input aria-label="Payee" ref={input} />
        <Autocomplete.Portal>
          <Autocomplete.Positioner
            align="start"
            sideOffset={4}
            className={styles.payeePositioner}
          >
            <Autocomplete.Popup ref={popup} className={styles.suggestions}>
              <Autocomplete.List>
                {(payee: string) => (
                  <Autocomplete.Item key={payee} value={payee} className={ui.choice}>
                    {payee}
                  </Autocomplete.Item>
                )}
              </Autocomplete.List>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      </Autocomplete.Root>
      <button type="submit" hidden />
    </form>
  );
}

function DateControl({
  label,
  value,
  setValue,
  autoFocus,
}: {
  label: string;
  value: CalendarDate | null;
  setValue: (date: CalendarDate | null) => void;
  autoFocus?: boolean;
}) {
  return (
    <DatePicker
      value={value}
      onChange={setValue}
      autoFocus={autoFocus}
      className={styles.datePicker}
    >
      <Label>{label}</Label>
      <Group className={styles.dateInput}>
        <DateInput className={styles.dateField}>
          {segment => <DateSegment className={styles.dateSegment} segment={segment} />}
        </DateInput>
        <Button aria-label={`Open calendar for ${label}`}>▦</Button>
      </Group>
      <Popover className={styles.calendarPopup}>
        <Dialog>
          <Calendar className={styles.calendar}>
            <header>
              <Button slot="previous" aria-label="Previous calendar month">
                ‹
              </Button>
              <Heading />
              <Button slot="next" aria-label="Next calendar month">
                ›
              </Button>
            </header>
            <CalendarGrid>
              {date => <CalendarCell className={styles.calendarCell} date={date} />}
            </CalendarGrid>
          </Calendar>
        </Dialog>
      </Popover>
    </DatePicker>
  );
}

export function DateEditor({
  value,
  apply,
}: {
  value: string;
  apply: (value: string) => void;
}) {
  const [date, setDate] = useState<CalendarDate | null>(value ? parseDate(value) : null);
  return (
    <form
      className={ui.editor}
      onSubmit={event => {
        event.preventDefault();
        if (date) {
          apply(date.toString());
        }
      }}
    >
      <DateControl label="Transaction date" value={date} setValue={setDate} autoFocus />
      <button type="submit" disabled={!date}>
        Apply date
      </button>
    </form>
  );
}

export function RangeEditor({
  range,
  apply,
}: {
  range: Range;
  apply: (range: Range) => void;
}) {
  const [start, setStart] = useState<CalendarDate | null>(parseDate(range.start));
  const [end, setEnd] = useState<CalendarDate | null>(parseDate(range.end));
  const valid = start && end && start.compare(end) <= 0;

  return (
    <form
      className={ui.editor}
      onSubmit={event => {
        event.preventDefault();
        if (valid) {
          apply({start: start.toString(), end: end.toString()});
        }
      }}
    >
      <DateControl label="From" value={start} setValue={setStart} autoFocus />
      <DateControl label="Through" value={end} setValue={setEnd} />
      <button type="submit" disabled={!valid}>
        Search date range
      </button>
    </form>
  );
}

const singleLineNote = (value: string) => value.replace(/[\r\n]+/g, ' ');

export function NoteEditor({
  inline,
  mixed,
  ...editor
}: TextEditorProps & {inline?: boolean; mixed?: boolean}) {
  const {draft, update, confirm, bindings} = useTextDraft(
    {...editor, value: singleLineNote(editor.value)},
    {allowEmpty: true, mixed},
  );
  const ref = useInitialFocus<HTMLTextAreaElement>(inline);
  return (
    <form className={ui.editor} {...bindings} onSubmit={event => event.preventDefault()}>
      <label>
        {inline ? <span className={ui.visuallyHidden}>Note</span> : 'Note'}
        <textarea
          ref={ref}
          rows={inline ? 1 : 5}
          value={draft}
          placeholder={mixed ? 'Mixed notes' : undefined}
          onChange={event => update(singleLineNote(event.target.value))}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
              return;
            }

            event.preventDefault();
            confirm();
          }}
        />
      </label>
    </form>
  );
}

export function CategoryPicker({
  rows,
  choices,
  apply,
}: {
  rows: Row[];
  choices: Choice[];
  apply: (category: number | null) => void;
}) {
  const [initialCategories] = useState(
    () => new Set(rows.map(row => String(row.category_id ?? 0))),
  );
  const items = choices
    .filter(choice => !choice.group)
    .map(choice => {
      const count = rows.filter(row => String(row.category_id ?? 0) === choice.id).length;
      return {
        ...choice,
        mark:
          count === rows.length
            ? ('checked' as const)
            : count
              ? ('mixed' as const)
              : ('unchecked' as const),
        detail: count && rows.length > 1 ? `${count} of ${rows.length}` : undefined,
      };
    })
    .sort(
      (a, b) => Number(initialCategories.has(b.id)) - Number(initialCategories.has(a.id)),
    );

  return (
    <Picker
      title="Search categories"
      items={items}
      choose={id => apply(Number(id) || null)}
    />
  );
}

export function TagPicker({
  rows,
  choices,
  apply,
}: {
  rows: Row[];
  choices: TagChoice[];
  apply: (changes: Map<number, boolean>) => void;
}) {
  const [staged, setStaged] = useState(new Map<number, boolean>());
  const [initialTags] = useState(() => new Set(rows.flatMap(row => row.tag_ids)));
  const counts = new Map(
    choices.map(choice => [
      choice.id,
      rows.filter(row => row.tag_ids.includes(Number(choice.id))).length,
    ]),
  );
  const items = choices
    .map(choice => {
      const change = staged.get(Number(choice.id));
      const count = counts.get(choice.id) ?? 0;
      const checked = change ?? count === rows.length;
      return {
        ...choice,
        labelContent: <TransactionTag {...choice} />,
        mark: checked
          ? ('checked' as const)
          : change === undefined && count
            ? ('mixed' as const)
            : ('unchecked' as const),
        detail:
          change !== undefined
            ? change
              ? 'Add to all'
              : 'Remove from all'
            : rows.length > 1
              ? `${count} of ${rows.length}`
              : undefined,
      };
    })
    .sort(
      (a, b) =>
        Number(initialTags.has(Number(b.id))) - Number(initialTags.has(Number(a.id))),
    );
  const toggle = (id: string) => {
    const current = staged.get(Number(id)) ?? counts.get(id) === rows.length;
    setStaged(new Map(staged).set(Number(id), !current));
  };
  const reset = (id: string) => {
    const changes = new Map(staged);
    changes.delete(Number(id));
    setStaged(changes);
  };
  return (
    <Picker
      title="Search tags"
      items={items}
      checked={items.filter(item => item.mark === 'checked').map(item => item.id)}
      choose={toggle}
      toggle={toggle}
      reset={reset}
      footer={
        <>
          <button type="button" onClick={() => apply(staged)} disabled={!staged.size}>
            Apply tags
          </button>
          {staged.size > 0 && (
            <button type="button" onClick={() => setStaged(new Map())}>
              Reset changes
            </button>
          )}
          <small>
            <KeyboardShortcut keys={['alt-Enter']} /> resets a tag
          </small>
        </>
      }
    />
  );
}

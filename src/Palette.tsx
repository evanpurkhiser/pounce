import {Combobox} from '@base-ui/react/combobox';
import {Dialog} from '@base-ui/react/dialog';
import {Command} from 'cmdk';
import type {LucideIcon} from 'lucide-react';
import {useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {rank, type Searchable} from './search';

export function Modal({title, children, close, restore, back, wide}: {
  title: string; children: ReactNode; close: () => void; restore: () => HTMLElement | null; back?: () => void; wide?: boolean;
}) {
  return <Dialog.Root open onOpenChange={open => { if (!open) close(); }}>
    <Dialog.Portal>
      <Dialog.Backdrop className="backdrop" />
      <Dialog.Popup className={wide ? 'modal wide' : 'modal'} finalFocus={restore}>
        <header className="modal-heading">
          {back && <button onClick={back} aria-label="Back">‹</button>}
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Close aria-label="Close">Esc</Dialog.Close>
        </header>
        {children}
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function useInitialFocus<T extends HTMLElement>(select = false) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    ref.current?.focus();
    if (select && ref.current instanceof HTMLInputElement) ref.current.select();
  }, [select]);
  return ref;
}

export type CommandItem = Searchable & {id: string; group: string; shortcut?: string; detail?: string; icon?: LucideIcon; invoke: () => void};

export function CommandList({items, nested}: {items: CommandItem[]; nested?: (query: string) => CommandItem[]}) {
  const [query, setQuery] = useState('');
  const input = useInitialFocus<HTMLInputElement>();
  const results = [...(nested?.(query) ?? []), ...rank(items, query)];
  const groups = Map.groupBy(results, item => item.group);

  return <Command className="command-palette" label="Transaction commands" shouldFilter={false} vimBindings={false} loop>
    <Command.Input ref={input} value={query} onValueChange={setQuery} placeholder="Type a command…" className="search-input" />
    <Command.List className="choice-list">
      <Command.Empty className="empty">No matching commands.</Command.Empty>
      {[...groups].map(([group, commands]) => <Command.Group key={group} heading={group}>
        {commands.map(item => <Command.Item key={item.id} value={item.id} onSelect={item.invoke} className="choice">
          {item.icon && <item.icon className="command-icon action-icon" aria-hidden />}
          <span className="command-label">{item.label}</span>
          {item.detail && <small className="command-detail">{item.detail}</small>}
          {item.shortcut && <kbd>{item.shortcut}</kbd>}
        </Command.Item>)}
      </Command.Group>)}
    </Command.List>
  </Command>;
}

type PickItem = Searchable & {id: string; detail?: string; mark?: 'checked' | 'mixed' | 'unchecked'};

export function Picker({items, title, choose, checked, toggle, modifierToggle, reset, footer}: {
  items: PickItem[];
  title: string;
  choose: (id: string) => void;
  checked?: readonly string[];
  toggle?: (id: string) => void;
  modifierToggle?: (id: string) => void;
  reset?: (id: string) => void;
  footer?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState<string>();
  const input = useInitialFocus<HTMLInputElement>();
  const common = {
    items,
    filteredItems: rank(items, query),
    inline: true as const,
    open: true as const,
    autoHighlight: true,
    inputValue: query,
    itemToStringLabel: (item: PickItem) => item.label,
    isItemEqualToValue: (item: PickItem, value: PickItem) => item.id === value.id,
    onItemHighlighted: (item: PickItem | undefined) => setHighlight(item?.id),
    onInputValueChange: (value: string, event: {isItemPress?: boolean}) => {
      if (!event.isItemPress) setQuery(value);
    },
  };

  const body = <>
    <Combobox.Input ref={input} className="search-input" aria-label={title} placeholder={title} onKeyDownCapture={event => {
      if (!highlight || event.key !== 'Enter' || event.nativeEvent.isComposing) return;
      const action = event.altKey ? reset : event.metaKey || event.ctrlKey ? modifierToggle : undefined;
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        action(highlight);
      }
    }} />
    <Combobox.List className="choice-list">
      {(item: PickItem) => <Combobox.Item key={item.id} value={item} className="choice">
        {item.mark && <span aria-hidden className="mark">{item.mark === 'mixed' ? '−' : item.mark === 'checked' ? '✓' : '□'}</span>}
        <span>{item.label}</span>
        {item.detail && <small>{item.detail}</small>}
      </Combobox.Item>}
    </Combobox.List>
    <Combobox.Empty className="empty">No matching choices.</Combobox.Empty>
    {(footer || modifierToggle) && <footer className="editor-footer">
      {modifierToggle && <button disabled={!highlight} onMouseDown={event => event.preventDefault()}
        onClick={() => { if (highlight) modifierToggle(highlight); input.current?.focus(); }}>Toggle highlighted value</button>}
      {footer}
    </footer>}
  </>;

  if (toggle && checked) {
    return <Combobox.Root<PickItem, true> {...common} multiple value={items.filter(item => checked.includes(item.id))}
      onValueChange={next => {
        const change = items.find(item => checked.includes(item.id) !== next.some(value => value.id === item.id));
        if (change) toggle(change.id);
      }}>
      {body}
    </Combobox.Root>;
  }

  return <Combobox.Root<PickItem> {...common} value={null} onValueChange={item => { if (item) choose(item.id); }}>
    {body}
  </Combobox.Root>;
}

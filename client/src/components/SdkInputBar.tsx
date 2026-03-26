import type {KeyboardEvent} from 'react';
import {useState, useRef, useCallback, useEffect} from 'react';
import {SendHorizontal} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {cn} from '@/lib/utils';

interface SdkInputBarProps {
	onSend: (content: string) => void;
	disabled?: boolean;
	placeholder?: string;
}

export function SdkInputBar({
	onSend,
	disabled = false,
	placeholder,
}: SdkInputBarProps) {
	const [value, setValue] = useState('');
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const adjustHeight = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = 'auto';
		const lineHeight = 20;
		const maxHeight = lineHeight * 6;
		textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
	}, []);

	useEffect(() => {
		adjustHeight();
	}, [value, adjustHeight]);

	const handleSend = useCallback(() => {
		const trimmed = value.trim();
		if (!trimmed || disabled) return;
		onSend(trimmed);
		setValue('');
	}, [value, disabled, onSend]);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				handleSend();
			}
		},
		[handleSend],
	);

	const resolvedPlaceholder = disabled
		? 'Claude is working...'
		: placeholder || 'Send a message...';

	return (
		<div className="flex items-end gap-2 border-t border-border bg-card p-2">
			<textarea
				ref={textareaRef}
				value={value}
				onChange={e => setValue(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder={resolvedPlaceholder}
				disabled={disabled}
				rows={1}
				className={cn(
					'flex-1 resize-none rounded-md border border-border bg-background px-3 py-2',
					'text-sm text-foreground placeholder:text-muted-foreground',
					'focus:outline-none focus:ring-1 focus:ring-ring',
					'disabled:cursor-not-allowed disabled:opacity-50',
				)}
			/>
			<Button
				size="icon"
				className="h-9 w-9 shrink-0"
				onClick={handleSend}
				disabled={disabled || !value.trim()}
				title="Send message"
			>
				<SendHorizontal className="h-4 w-4" />
			</Button>
		</div>
	);
}

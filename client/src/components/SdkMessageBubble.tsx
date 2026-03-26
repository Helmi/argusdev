import type {ReactNode} from 'react';
import {memo} from 'react';
import {Info} from 'lucide-react';
import {cn} from '@/lib/utils';
import {SdkThinkingBlock} from '@/components/SdkThinkingBlock';
import {SdkToolCallCard} from '@/components/SdkToolCallCard';
import type {SdkMessage, SdkContentBlock} from '@/lib/types';

interface SdkMessageBubbleProps {
	message: SdkMessage;
	pendingToolIds?: Set<string>;
	onApprove?: () => void;
	onReject?: () => void;
}

// Simple inline text formatting — no heavy markdown library.
// Handles: code blocks (```), inline code (`), bold (**), and links.
function formatText(text: string): ReactNode[] {
	const nodes: ReactNode[] = [];
	// Split on fenced code blocks first
	const parts = text.split(/(```[\s\S]*?```)/g);

	parts.forEach((part, i) => {
		if (part.startsWith('```') && part.endsWith('```')) {
			// Fenced code block — strip the backtick fences and optional language tag
			const inner = part.slice(3, -3);
			const newlineIndex = inner.indexOf('\n');
			const code = newlineIndex >= 0 ? inner.slice(newlineIndex + 1) : inner;
			nodes.push(
				<pre
					key={`code-${i}`}
					className="my-1 rounded bg-muted p-2 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all"
				>
					{code}
				</pre>,
			);
			return;
		}

		// Process inline formatting within non-code-block text
		nodes.push(...formatInline(part, i));
	});

	return nodes;
}

function formatInline(text: string, parentKey: number): ReactNode[] {
	const nodes: ReactNode[] = [];
	// Match inline code, bold, or markdown links
	const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[([^\]]+)\]\(([^)]+)\))/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(text)) !== null) {
		// Plain text before this match
		if (match.index > lastIndex) {
			nodes.push(text.slice(lastIndex, match.index));
		}

		if (match[1]) {
			// Inline code
			nodes.push(
				<code
					key={`ic-${parentKey}-${match.index}`}
					className="rounded bg-muted px-1 py-0.5 text-xs font-mono"
				>
					{match[1].slice(1, -1)}
				</code>,
			);
		} else if (match[2]) {
			// Bold
			nodes.push(
				<strong key={`b-${parentKey}-${match.index}`}>
					{match[2].slice(2, -2)}
				</strong>,
			);
		} else if (match[3]) {
			// Link
			nodes.push(
				<a
					key={`a-${parentKey}-${match.index}`}
					href={match[5]}
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary underline underline-offset-2 hover:text-primary/80"
				>
					{match[4]}
				</a>,
			);
		}

		lastIndex = match.index + match[0].length;
	}

	// Trailing text
	if (lastIndex < text.length) {
		nodes.push(text.slice(lastIndex));
	}

	return nodes;
}

function renderContentBlock(
	block: SdkContentBlock,
	index: number,
	pendingToolIds?: Set<string>,
	onApprove?: () => void,
	onReject?: () => void,
): ReactNode {
	switch (block.type) {
		case 'text':
			return (
				<div
					key={`text-${index}`}
					className="text-sm whitespace-pre-wrap leading-relaxed"
				>
					{formatText(block.text)}
				</div>
			);

		case 'thinking':
			return <SdkThinkingBlock key={`think-${index}`} text={block.text} />;

		case 'tool_use':
			return (
				<SdkToolCallCard
					key={`tool-${block.id}`}
					toolName={block.name}
					input={block.input}
					isPending={pendingToolIds?.has(block.id)}
					onApprove={onApprove}
					onReject={onReject}
				/>
			);

		case 'tool_result':
			return (
				<SdkToolCallCard
					key={`result-${block.toolUseId}-${index}`}
					toolName="Result"
					input={{}}
					output={block.content}
					isError={block.isError}
				/>
			);

		case 'system_info':
			return (
				<div
					key={`sysinfo-${index}`}
					className="flex items-center gap-2 rounded bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground"
				>
					<Info className="h-3 w-3 shrink-0" />
					<span>{block.text}</span>
					{block.model && (
						<span className="ml-auto font-mono text-xs">{block.model}</span>
					)}
				</div>
			);

		default:
			return null;
	}
}

export const SdkMessageBubble = memo(function SdkMessageBubble({
	message,
	pendingToolIds,
	onApprove,
	onReject,
}: SdkMessageBubbleProps) {
	const role = message.role;

	if (role === 'system') {
		return (
			<div className="flex justify-center px-4 py-1">
				<div className="max-w-[90%] text-center">
					{message.content.map((block, i) => renderContentBlock(block, i))}
				</div>
			</div>
		);
	}

	if (role === 'result') {
		return (
			<div className="flex justify-center px-4 py-1">
				<div className="max-w-[90%] rounded-md border border-green-500/30 bg-green-500/5 px-3 py-2">
					{message.content.map((block, i) => renderContentBlock(block, i))}
					{message.costUsd !== undefined && (
						<div className="mt-1 text-xs text-muted-foreground text-right">
							${message.costUsd.toFixed(4)}
						</div>
					)}
				</div>
			</div>
		);
	}

	const isUser = role === 'user';

	return (
		<div
			className={cn('flex px-4 py-1', isUser ? 'justify-end' : 'justify-start')}
		>
			<div
				className={cn(
					'max-w-[85%] rounded-lg px-3 py-2',
					isUser
						? 'bg-primary text-primary-foreground'
						: 'bg-card border border-border',
				)}
			>
				{message.content.map((block, i) =>
					renderContentBlock(block, i, pendingToolIds, onApprove, onReject),
				)}
				{message.costUsd !== undefined && (
					<div
						className={cn(
							'mt-1 text-xs text-right',
							isUser ? 'text-primary-foreground/70' : 'text-muted-foreground',
						)}
					>
						${message.costUsd.toFixed(4)}
					</div>
				)}
			</div>
		</div>
	);
});
